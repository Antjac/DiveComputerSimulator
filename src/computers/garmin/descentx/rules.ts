import type { DiveSession } from '../../../engine/session';
import type { AlertCue, AlertExplain, ComputerView, SettingDef } from '../../base';
import { DescentRules, descentSettings } from '../rules';

/**
 * Garmin Descent X30 and X50i (rectangular dive computers, 2024), Single-Gas and Multi-Gas dive modes.
 * The decompression model, the safety stop, the ascent rate, the deco lockout and the PO2 thresholds
 * are those of the Descent family (rules.ts, same wording in the X30 and X50i owner's manuals: Dive
 * Setup, Performing a Safety Stop / a Decompression Stop, Dive Mode Advanced Settings); what differs is
 * cited here: the alert table (two-line alerts, "Switch to %1 now?"), and a declined gas switch that is
 * offered again two minutes later instead of becoming a backup gas.
 */
export abstract class DescentXRules extends DescentRules {
  /** Settings of the Descent family that these models have: no Big Numbers mode (Display Settings
   *  only customises the data screens), no transmitter on the X30. */
  protected static xSettings(transmitter: boolean): SettingDef[] {
    return descentSettings().filter((d) => d.key !== 'layout' && (transmitter || d.key !== 'reserve'));
  }

  /** Multi-Gas: gases declined (Not Now, or the prompt ignored), offered again at this session clock. */
  private readonly retry = new Map<number, number>();

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.retry.clear();
  }

  /**
   * Dive Alerts, "Switch to %1 now?": "In a multi-gas dive, a gas with a higher oxygen content is now
   * safe to breathe [...] You can switch gases now, or wait to switch gases later in the dive." and
   * "Continuing on %1. Switch at any time.": "You selected Not Now when prompted to switch to a
   * higher-oxygen gas, or you ignored the prompt. — The gas does not change. You will be prompted again
   * in two minutes." The declined gas stays a decompression gas (counted in the NDL and TTS, Dive
   * Modes); the X manuals have no Never answer. Delay before an unanswered prompt counts as ignored:
   * not given (30 s assumed, as on the Mk3).
   */
  protected updatePrompt(s: DiveSession): number | null {
    if (!this.multiGas || !s.inDive || this.locked) {
      this.prompt.offer = null;
      return null;
    }
    for (const [g, at] of this.retry) {
      if (s.clock >= at) {
        this.retry.delete(g);
        if (s.breathing !== g) this.prompt.rearm(g);
      }
    }
    const mods = this.knownGases(s).map((g) => this.decoMod(g.o2));
    const { expired } = this.prompt.update(s, mods, 30);
    if (expired !== null) this.retry.set(expired, s.clock + 120);
    return expired;
  }

  answerPrompt(s: DiveSession, answer: 'yes' | 'notnow' | 'never'): void {
    const g = this.prompt.offer;
    if (g === null) return;
    if (answer === 'yes') {
      this.prompt.accept(s);
      return;
    }
    this.prompt.decline();
    this.retry.set(g, s.clock + 120);
  }

  /**
   * Dive Alerts: "%1 OTU accumulated. — Your oxygen toxicity units are above the safe limit." The limit
   * is not given: 300 OTU assumed (the Mk3's "End your dive now" level).
   */
  readonly otuLimit = 300;

  /** "DESCEND OR SWITCH GAS / PO2 is low.": "Your PO2 value is below 0.18 bar." */
  readonly po2Low = 0.18;

  /**
   * Alert bubble (app/alertHelp.ts): the Dive Alerts and Transceiver Alerts tables of the X30 and X50i
   * owner's manuals, as the pop-ups of the model word them (`msg:` keys: the first line on display).
   */
  alertExplain(key: string): AlertExplain | null {
    // Common alarm codes: what these computers do for them (Dive Alerts table).
    if (key === 'CNS') {
      return { what: { fr: 'Pas d’alerte de CNS dans le tableau des alertes du X30 et du X50i : le CNS n’est qu’un champ de données.', en: 'No CNS alert in the X30 and X50i alert table: CNS is only a data field.' } };
    }
    if (key === 'ASCENT_WARN') {
      return { what: { fr: 'Chevrons de vitesse en jaune entre 7,9 et 10,1 m/min, en rouge au-delà ; l’alerte « SLOW YOUR ASCENT » vient après 5 s au-dessus de 9,1 m/min.', en: 'Rate chevrons yellow between 7.9 and 10.1 m/min, red beyond; the “SLOW YOUR ASCENT” alert comes after 5 s faster than 9.1 m/min.' } };
    }
    const codes: Record<string, string> = { NDL_LOW: 'ndl-5', DECO: 'deco', ASCENT: 'fast-ascent', CEILING: 'ceiling', PPO2_HIGH: 'po2', LOW_GAS: 'tank-reserve' };
    if (codes[key]) key = codes[key];
    const msg = key.startsWith('msg:') ? key.slice(4) : null;
    if (key === 'ndl-10' || key === 'ndl-5' || msg?.endsWith('minutes to NDL.')) {
      return {
        id: 'ndl', screen: '10 minutes to NDL. / 5 minutes to NDL.', code: 'NDL_LOW',
        what: { fr: 'Fenêtre affichée quand il reste 10 min de NDL, puis 5 min.', en: 'Pop-up shown with 10 minutes of NDL left, then 5 minutes.' },
      };
    }
    if (key === 'deco' || msg === 'NDL exceeded.') {
      return {
        id: 'deco', screen: 'NDL exceeded. Deco required.', code: 'DECO',
        what: {
          fr: 'Fenêtre affichée au passage en décompression : l’ordinateur donne ensuite les paliers (bandeau DECO jaune : profondeur du palier et durée). « Approaching deco stop. » prévient à moins de 3 m du palier, « Decompression cleared. » annonce la fin des paliers. On est au palier jusqu’à 0,6 m plus profond.',
          en: 'Pop-up shown when decompression becomes required: the computer then gives the stops (yellow DECO banner: stop depth and time). “Approaching deco stop.” warns within 3 m of the stop, “Decompression cleared.” announces the end of the stops. You are at the stop down to 0.6 m deeper.',
        },
      };
    }
    if (msg === 'Approaching deco stop.') {
      return {
        screen: msg,
        what: { fr: 'Fenêtre affichée en arrivant à moins d’un intervalle de palier (3 m) du palier.', en: 'Pop-up shown when coming within one stop interval (3 m) of the stop.' },
        todo: { fr: 'Ralentissez et stabilisez-vous à la profondeur du palier, sans la dépasser.', en: 'Slow down and settle at the stop depth, without going above it.' },
      };
    }
    if (msg === 'Decompression cleared.') {
      return {
        screen: msg,
        what: { fr: 'Fenêtre affichée quand tous les paliers obligatoires sont faits. Chaque palier terminé fait clignoter sa profondeur et sa durée.', en: 'Pop-up shown when all the mandatory stops are done. Each completed stop makes its depth and time flash.' },
        todo: { fr: 'Faites encore le palier de sécurité si possible, puis remontez lentement.', en: 'Still make the safety stop if you can, then ascend slowly.' },
      };
    }
    if (key === 'fast-ascent' || msg === 'SLOW YOUR ASCENT') {
      return {
        id: 'fast-ascent', screen: 'SLOW YOUR ASCENT / Ascending too fast.', code: 'ASCENT',
        what: {
          fr: 'Fenêtre affichée après plus de 5 s au-dessus de 9,1 m/min. Les chevrons de vitesse sont verts sous 7,9 m/min, jaunes jusqu’à 10,1 m/min, rouges au-delà.',
          en: 'Pop-up shown after more than 5 s faster than 9.1 m/min. The rate chevrons are green below 7.9 m/min, yellow up to 10.1 m/min, red beyond.',
        },
      };
    }
    if (key === 'ceiling' || msg?.startsWith('DESCEND TO')) {
      return {
        id: 'ceiling', screen: 'DESCEND TO … / You are above your deco ceiling.', code: 'CEILING',
        what: {
          fr: 'Fenêtre affichée à plus de 0,6 m au-dessus du palier : la profondeur et celle du palier clignotent en rouge, le chronomètre du palier s’arrête. Après 3 min au-dessus, verrouillage de déco : plus de plongée au gaz pendant 24 h.',
          en: 'Pop-up shown more than 0.6 m above the stop: the depth and the stop depth flash red, the stop timer halts. After 3 min above it, decompression lockout: no gas dives for 24 hours.',
        },
      };
    }
    if (key === 'LOCKED') {
      return {
        what: { fr: 'Verrouillage de déco (Deco Lockout) : plafond dépassé plus de 3 min, pas de plongée au gaz pendant 24 h. Il peut être désactivé dans les réglages avancés (non simulé).', en: 'Decompression lockout: ceiling violated for more than 3 min, no gas dives for 24 hours. It can be disabled in the advanced settings (not simulated).' },
      };
    }
    if (key === 'po2' || msg === 'ASCEND OR SWITCH GAS') {
      return {
        id: 'po2', screen: 'ASCEND OR SWITCH GAS / PO2 is high.', code: 'PPO2_HIGH',
        what: {
          fr: 'Au-dessus du seuil « PO2 Critical » (1,6 bar supposé, non donné par le manuel) : la valeur de PO2 clignote en rouge et la fenêtre revient toutes les 30 s, 3 fois au plus. Au-dessus du seuil « PO2 Warning » (1,4 bar supposé), la valeur clignote seulement en jaune.',
          en: 'Above the “PO2 Critical” threshold (1.6 bar assumed, not given by the manual): the PO2 value flashes red and the pop-up comes back every 30 s, 3 times at most. Above the “PO2 Warning” threshold (1.4 bar assumed), the value only flashes yellow.',
        },
      };
    }
    if (key === 'po2-low' || msg === 'DESCEND OR SWITCH GAS') {
      return {
        id: 'po2-low', screen: 'DESCEND OR SWITCH GAS / PO2 is low.',
        what: { fr: 'PO2 sous 0,18 bar (gaz hypoxique près de la surface) : la valeur clignote en jaune les 2 premières minutes de la plongée, en rouge ensuite ; fenêtre toutes les 30 s, 3 fois au plus.', en: 'PO2 below 0.18 bar (hypoxic gas near the surface): the value flashes yellow during the first 2 minutes of the dive, red afterwards; pop-up every 30 s, 3 times at most.' },
        todo: { fr: 'Descendez ou passez sur un gaz plus riche en oxygène.', en: 'Descend or switch to a gas with more oxygen.' },
      };
    }
    if (msg?.endsWith('OTU accumulated.')) {
      return {
        id: 'otu', screen: '… OTU accumulated.',
        what: { fr: 'Fenêtre répétée toutes les 2 min, 3 fois au plus, quand les OTU (toxicité pulmonaire de l’oxygène) dépassent la limite (non donnée par le manuel : 300 supposées).', en: 'Pop-up repeated every 2 minutes, 3 times at most, when the OTU (oxygen pulmonary toxicity) exceed the limit (not given by the manual: 300 assumed).' },
        todo: { fr: 'Limitez l’exposition à l’oxygène : terminez la plongée.', en: 'Limit the oxygen exposure: end the dive.' },
      };
    }
    if (msg === 'Safety stop started.') {
      return {
        screen: msg,
        what: {
          fr: 'En remontant au-dessus de 6 m après un passage sous 11 m, sans autre consigne de déco. Le palier se fait à 5 m (bandeau STOP vert) : le décompte court à 1 m près, s’arrête plus de 3 m au-dessus et repart de zéro sous 11 m.',
          en: 'When ascending above 6 m after going below 11 m, with no other decompression guidance. The stop is at 5 m (green STOP banner): the countdown runs within 1 m of it, halts more than 3 m above and starts over below 11 m.',
        },
        todo: { fr: 'Restez stable vers 5 m jusqu’à la fin du décompte.', en: 'Stay steady around 5 m until the countdown ends.' },
      };
    }
    if (msg === 'Descend to complete safety stop.') {
      return {
        screen: msg,
        what: { fr: 'Plus de 2 m au-dessus du palier de sécurité : la profondeur et celle du palier passent en jaune ; au-delà de 3 m, le décompte est en pause.', en: 'More than 2 m above the safety stop: the depth and the stop depth turn yellow; beyond 3 m, the countdown is paused.' },
        todo: { fr: 'Redescendez vers 5 m pour le terminer.', en: 'Go back down to about 5 m to finish it.' },
      };
    }
    if (msg === 'Safety stop cleared.') {
      return { screen: msg, what: { fr: 'Fenêtre affichée à la fin du palier de sécurité.', en: 'Pop-up shown when the safety stop is complete.' }, todo: { fr: 'Terminez la remontée lentement.', en: 'Finish the ascent slowly.' } };
    }
    if (key.startsWith('switch-') || msg?.startsWith('Switch to')) {
      return {
        id: 'switch', screen: 'Switch to … now?',
        what: {
          fr: 'En mode Multi-Gas, à la MOD/Deco PO2 d’un gaz plus riche pendant la remontée, l’ordinateur propose d’y passer. Il ne change jamais de gaz de lui-même.',
          en: 'In Multi-Gas mode, at the MOD/Deco PO2 of a richer gas during the ascent, the computer offers to switch to it. It never switches gases by itself.',
        },
        todo: {
          fr: 'PREV / NEXT puis ENTER : Yes (changer) ou Not Now (libellés déduits, non donnés). Vérifiez le détendeur et le gaz avant de valider.',
          en: 'PREV / NEXT then ENTER: Yes (switch) or Not Now (wording deduced, not given). Check the regulator and the gas before confirming.',
        },
      };
    }
    if (msg?.startsWith('Switched to')) {
      return {
        screen: 'Switched to …',
        what: { fr: 'Confirmation du changement de gaz (« A confirmation message for your choice appears » ; texte non donné par le manuel, déduit).', en: 'Gas switch confirmation (“A confirmation message for your choice appears”; wording not given by the manual, deduced).' },
      };
    }
    if (msg?.startsWith('Continuing on')) {
      return {
        id: 'switch-not-now', screen: 'Continuing on … Switch at any time.',
        what: { fr: 'Changement de gaz refusé (Not Now) ou invite ignorée (30 s supposées) : le gaz ne change pas, il reste compté dans le calcul, et l’invite revient dans 2 min.', en: 'Gas switch declined (Not Now) or prompt ignored (30 s assumed): the gas does not change, it stays counted in the calculation, and the prompt comes back in 2 minutes.' },
        todo: { fr: 'Pour changer plus tôt : ENTER > Switch Gas.', en: 'To switch earlier: ENTER > Switch Gas.' },
      };
    }
    if (key === 'tank-reserve' || msg?.endsWith('is below reserve pressure.')) {
      return {
        id: 'tank-reserve', screen: 'T1 is below reserve pressure.', code: 'LOW_GAS',
        what: { fr: 'Pression du bloc sous la réserve réglée (50 bar supposé, non donné par le manuel) : la valeur passe en jaune, avec vibration et bip.', en: 'Tank pressure below the set reserve (50 bar assumed, not given by the manual): the value turns yellow, with vibration and tone.' },
      };
    }
    if (key === 'tank-critical' || msg === 'PRESSURE CRITICAL') {
      return {
        id: 'tank-critical', screen: 'PRESSURE CRITICAL / T1 pressure is critically low.', code: 'LOW_GAS',
        what: { fr: 'Pression sous la plus grande valeur entre 21 bar et la moitié de la réserve : la valeur clignote en rouge, avec vibration et bip.', en: 'Pressure below the larger of 21 bar or half the reserve: the value flashes red, with vibration and tone.' },
        todo: { fr: 'Pression critique : remontez sans attendre avec votre binôme.', en: 'Critical pressure: ascend at once with your buddy.' },
      };
    }
    if (msg?.startsWith('Depth Alert') || msg?.startsWith('Time Alert')) {
      const depth = msg.startsWith('Depth');
      return {
        id: depth ? 'depth-alert' : 'time-alert', screen: depth ? 'Depth Alert' : 'Time Alert',
        what: depth
          ? { fr: 'Alerte personnalisée (Scuba Alerts) : profondeur choisie atteinte (texte non donné par le manuel : nom de l’alerte, déduit). Aucune n’est réglée par défaut.', en: 'Custom alert (Scuba Alerts): chosen depth reached (wording not given by the manual: the alert name, deduced). None is set by default.' }
          : { fr: 'Alerte personnalisée (Scuba Alerts) : un intervalle de la durée choisie s’est écoulé (texte non donné par le manuel : nom de l’alerte, déduit). Aucune n’est réglée par défaut.', en: 'Custom alert (Scuba Alerts): an interval of the chosen length has elapsed (wording not given by the manual: the alert name, deduced). None is set by default.' },
      };
    }
    return null;
  }

  /** Dive Alerts: each pop-up comes with a tone and a vibration ("Sound & Vibe"), unless Silent Diving. */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    const cues = super.alertCues(v, all);
    if ((all || this.settings.silent !== 'on') && v.inDive && v.ppO2 < this.po2Low) cues.push({ key: 'po2-low', kind: 'both', level: 'alarm', until: 'once' });
    return cues;
  }
}

import { ceilingDepth, pressureToDepth, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef, type AlertExplain } from '../../base';
import { DeepStop, FastAscentRgbm, GasSequence, MissedStop, maresCues, maresRgbmParams } from '../common';
import { CNS100, RGBM_ASCENT, gasSwitch } from '../alerts';
import { GasPrompt } from '../../common/gasSwitch';
import { ppo2Setting } from '../../common/ppo2';

/**
 * Mares Puck Pro. Display and rules follow the Puck Pro instruction manual (display information,
 * alarms, missed deco stop, uncontrolled ascent). Mares RGBM (Wienke) itself is proprietary: it is
 * approximated with Bühlmann + a repetitive-dive penalty.
 */
export abstract class PuckRules extends DiveComputer {
  readonly id = 'mares';
  readonly name = 'Mares Puck Pro';
  readonly algorithm = 'Mares RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: 'Le RGBM Mares est propriétaire : approximation (Bühlmann + P0/P1/P2, pénalité en successives). Affichage et règles conformes au manuel : alarme à 10 m/min, remontée incontrôlée (> 12 m/min) ou palier manqué > 3 min = mode profondimètre pour les plongées suivantes. Bouton : informations alternatives (profondeur moyenne, O2 % et CNS en nitrox, heure) ; appui long : rétroéclairage. Deux gaz G1 et G2 (§3.5 ; bloc principal et premier gaz de déco de la page) : au MOD de G2 pendant la remontée, bip et O2 % de G1 clignotant 20 s ; appui : G2 proposé (O2 % clignotant, MOD en haut à droite) ; appui long : confirmation, appui : annulation ; appui long avec l’O2 % affiché : changement manuel. Remontée calculée avec le gaz respiré seulement (non vérifié : la note du §3.5 « la MOD de G2 […] est ce que le Puck Pro utilise pour son calcul » est ambiguë ; le manuel du Quad Air, qui porte la même note, précise que le temps de remontée est mis à jour après le changement) ; retour à G1 (§3.5.3.1) : même séquence, appui long avec l’O2 % affiché ; sous la MOD du gaz respiré : alarme MOD (§3.5.3.2) ; ppO2max de G2 1,6 bar supposé. Deep stop facultatif (§3.3), désactivable (réglage DEEp, absent du manuel de 02/2012 mais ajouté par le firmware V4.0 : « Option to disable display of deep stops (Set/Set dive/Deep) » ; activé par défaut supposé) : proposé à l’approche de la limite sans palier, sa profondeur à gauche de la durée sans palier ou comme premier palier en décompression (compté dans l’ASC), puis à ±1 m « deep deco » et décompte de 2 min ; sa profondeur n’est pas donnée par le manuel : règle du Quad 2 et du Quad Ci supposée (profondeur où le 5e compartiment, 27 min, cesse de se charger) ; une seule fois 2 min (la variante « deux paliers de 1 min » n’est pas décrite). Palier de sécurité, comportement incertain (le manuel n’en dit rien) : redescendu sous 6 m, l’écran revient à NO DECO (constaté sur un Quad) ; le décompte reprend là où il s’était arrêté entre 6 et 3 m (témoignage sur un Mares Matrix) et repart de zéro au-delà de 10 m (supposé).',
    en: 'Mares RGBM is proprietary: approximation (Bühlmann + P0/P1/P2, repetitive-dive penalty). Display and rules as per the manual: alarm at 10 m/min, uncontrolled ascent (> 12 m/min) or missed stop > 3 min = bottom timer mode for the following dives. Button: alternate information (average depth, O2 % and CNS on nitrox, time of day); hold: backlight. Two gases G1 and G2 (§3.5; the main tank and the first deco gas set on the page): at the MOD of G2 during the ascent, a beep and the O2 % of G1 blinking for 20 s; press: G2 proposed (O2 % blinking, MOD top right); hold: confirm, press: cancel; hold with the O2 % shown: manual switch. Ascent computed with the gas breathed only (not verified: the §3.5 note "the MOD for G2 […] is what Puck Pro uses for its calculation" is ambiguous; the Quad Air manual, with the same note, states that the ascent time is updated after the switch); back to G1 (§3.5.3.1): same sequence, hold with the O2 % shown; below the MOD of the gas breathed: MOD alarm (§3.5.3.2); ppO2max of G2 1.6 bar assumed. Optional deep stop (§3.3), can be turned off (DEEp setting, missing from the 02/2012 manual but added by firmware V4.0: "Option to disable display of deep stops (Set/Set dive/Deep)"; on by default assumed): suggested as the no deco limit approaches, its depth left of the no deco time or as the first stop in decompression (counted in the ASC), then within ±1 m "deep deco" and a 2-minute countdown; its depth is not given by the manual: the Quad 2 and Quad Ci rule is assumed (depth where the 5th compartment, 27 min, stops loading); a single 2-minute stop (the "two 1-minute stops" variant is not described). Safety stop, uncertain behaviour (the manual is silent): back deeper than 6 m, the display returns to NO DECO (reported on a Quad); the countdown resumes where it stopped between 6 and 3 m (reported on a Mares Matrix) and restarts deeper than 10 m (assumed).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'personal',
      label: { fr: 'Facteur P', en: 'P factor' },
      options: [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }],
      default: 'P0',
    },
    {
      // §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
      key: 'alrm',
      label: { fr: 'Alarmes sonores (ALRM)', en: 'Audible alarms (ALRM)' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    {
      // Not in the manual (02/12): firmware V4.0 release notes, "Option to disable display of deep stops
      // (Set/Set dive/Deep)", between ALRM and ErASE in the menu. Default not given: on (always shown
      // before that firmware).
      key: 'deepstop',
      label: { fr: 'Deep stop (DEEp)', en: 'Deep stop (DEEp)' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // Manual §2.2: ppO2max 1.4 bar from the factory, adjustable between 1.2 and 1.6 bar (step not given: 0.1).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §3.5.1: G2 has its own ppO2max, set "in a manner completely similar to G1" (1.2 to 1.6 bar); its
      // value is not given: 1.6 bar assumed.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max du gaz G2', en: 'ppO2max of gas G2' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
  ];

  /** §3.5: two gases, G1 and G2. */
  get maxGases(): number {
    return 2;
  }
  /** §3.5.2: gas switch prompt (O2 % of G1 blinking, 20 s) and the switch sequence. */
  protected prompt = new GasPrompt();
  protected seq = new GasSequence();

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /**
   * Ascent time with the gas breathed only (not verified). §3.5 NOTE: "The MOD for G2 is the switch depth
   * for the corresponding gas. This is what Puck Pro uses for its calculation, alarms and suggested
   * switch points": ambiguous on its own. The Quad Air manual has the same note and also states that
   * after the switch "within 20 seconds the ascent time is updated to reflect the higher oxygen
   * concentration in the breathing gas" (§3.5.2), i.e. a calculation with the gas breathed; the Puck
   * Pro, of the same generation, is assumed to do the same (deduced, not stated in its manual).
   */
  planGases() {
    return [];
  }

  /** MOD of G1 and G2, each with its own ppO2max (the MOD of G2 is its switch depth, §3.5). */
  protected gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : Math.max(0, pressureToDepth(this.decoPpo2() / g.o2))));
  }

  /**
   * §3.3: deep stops "generated as you approach the no deco limit", "one 2-minute stop or two 1-minute
   * stops" (a single 2-minute stop here), "NOT mandatory", counted down within "+/- 1m /3ft of the
   * displayed depth"; can be hidden since firmware V4.0 (deepstop setting). Their depth is not given: the rule of the
   * Quad 2 and Quad Ci (5th tissue) is assumed.
   */
  protected deep = new DeepStop(1);
  /** Depth where a >12 m/min ascent started (uncontrolled ascent detection). */
  protected fast = new FastAscentRgbm();
  protected fastViolation = false;
  protected missed = new MissedStop('rgbm');
  protected decoViolation = false;
  /** Violations behind the bottom timer mode, whose symbols stay on during the next dives (§3.2.1, §3.2.4.1). */
  protected lockedFast = false;
  protected lockedDeco = false;

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // alarm when more than 0.3 m above the stop
    this.lockAfter = null; // handled below (1 m for 3 min)
    this.lockHours = 24;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return maresRgbmParams(this.settings.personal, null);
  }

  algoParams(s: DiveSession): DecoParams {
    return maresRgbmParams(this.settings.personal, s);
  }

  /** Fast-ascent alarm from 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deep.reset();
    this.fast.reset();
    this.fastViolation = false;
    this.missed.reset();
    this.decoViolation = false;
    this.screen = 0;
    this.prompt.reset();
    this.seq.cancel();
  }

  onDiveEnd(s: DiveSession): void {
    // After a violation, the following dives run in bottom timer mode only.
    if (this.fastViolation || this.decoViolation) {
      this.lock(s);
      this.lockedFast = this.fastViolation;
      this.lockedDeco = this.decoViolation;
    }
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;
    // §3.5.2: "The automatic blinking of the oxygen concentration of G1 lasts only for 20 seconds."
    if (!this.locked) {
      this.prompt.update(s, this.gasMods(s), 20);
      this.seq.expire(s, 20);
    }

    // Uncontrolled ascent: > 12 m/min started deeper than 12 m and kept for 2/3 of that depth.
    if (this.fast.update(s.ascentRate, s.depth)) this.fastViolation = true;

    // Missed deco stop: more than 1 m above the stop for more than 3 minutes.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    const stopDepth = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    if (inDeco) {
      if (this.missed.update(stopDepth - s.depth, dt)) this.decoViolation = true;
    } else {
      this.missed.reset();
    }

    this.deep.update(s, ceil, p, dt, this.settings.deepstop !== 'off');
  }

  /**
   * Alert bubble (app/alertHelp.ts): §3.2.1 ascent ("slow", "fast"), §3.2.2 MOD, §3.2.3 CNS, §3.2.4
   * missed stop (desaturation halted) and §3.2.4.1 violation (hourglass), deep stop, §3.5.2 gas switch;
   * `msg:` keys: what the screen shows with no sound of its own (see screenAlerts).
   */
  alertExplain(key: string): AlertExplain | null {
    switch (key) {
      case 'fast-ascent':
        return { screen: 'slow', code: 'ASCENT', what: { fr: `« slow » clignote avec la vitesse. ${RGBM_ASCENT.fr}`, en: `“slow” blinks with the rate. ${RGBM_ASCENT.en}` } };
      case 'msg:fast':
        return { screen: 'fast', what: { fr: '« fast » clignote : plus de 12 m/min depuis une profondeur de plus de 12 m. Poursuivie sur les deux tiers de cette profondeur, c’est une violation : « fast » reste allumé et les plongées suivantes se font en profondimètre seulement (24 h).', en: '“fast” blinks: faster than 12 m/min from deeper than 12 m. Kept over two thirds of that depth, it is a violation: “fast” stays on and the following dives run as a depth gauge only (24 h).' }, todo: { fr: 'Ralentissez tout de suite.', en: 'Slow down at once.' } };
      case 'msg:fast-violation':
        return { screen: 'fast', title: { fr: 'Violation : remontée incontrôlée', en: 'Violation: uncontrolled ascent' }, critical: true, what: { fr: '« fast » reste allumé : les plongées des 24 h suivantes se font en profondimètre seulement.', en: '“fast” stays on: the dives of the next 24 h run as a depth gauge only.' }, todo: { fr: 'Faites un palier de prudence et surveillez les symptômes.', en: 'Make a precautionary stop and watch for symptoms.' } };
      case 'missed-stop':
        return { code: 'CEILING', what: { fr: 'À plus de 0,3 m au-dessus du palier : flèche ▼ et profondeur clignotantes, alarme ; la désaturation des tissus s’arrête jusqu’au retour au palier. Plus de 1 m au-dessus pendant plus de 3 min : violation (sablier ⧗, profondimètre seulement pendant 24 h).', en: 'More than 0.3 m above the stop: blinking ▼ arrow and depth, alarm; tissue desaturation halts until you are back at the stop. More than 1 m above for more than 3 min: violation (hourglass ⧗, depth gauge only for 24 h).' } };
      case 'msg:missed-violation':
        return { screen: '⧗', title: { fr: 'Violation : palier manqué', en: 'Violation: missed stop' }, critical: true, what: { fr: 'Sablier : palier manqué plus de 3 min ; les plongées des 24 h suivantes se font en profondimètre seulement.', en: 'Hourglass: stop missed for more than 3 minutes; the dives of the next 24 h run as a depth gauge only.' }, todo: { fr: 'Terminez les paliers autant que possible et surveillez les symptômes.', en: 'Complete the stops as far as you can and watch for symptoms.' } };
      case 'LOCKED':
        return { what: { fr: 'Profondimètre seulement pendant 24 h après une violation ; « fast » ou le sablier restent affichés.', en: 'Depth gauge only for 24 h after a violation; “fast” or the hourglass stay on.' } };
      case 'mod':
        return { code: 'PPO2_HIGH', what: { fr: 'Alarme sonore, profondeur clignotante et MOD affichée en haut à droite.', en: 'Audible alarm, blinking depth and MOD shown top right.' } };
      case 'msg:cns':
        return { screen: 'cns', code: 'CNS', what: { fr: 'Dès 75 %, le CNS s’affiche et clignote en bas à droite.', en: 'From 75 %, the CNS is shown and blinks bottom right.' } };
      case 'cns-100':
        return CNS100;
      case 'msg:deep':
        // §3.3: deep stops; their depth is not given by the manual (assumed, see the notes).
        return { screen: 'deep deco', what: { fr: 'Palier profond (deep stop) facultatif, proposé à l’approche de la limite sans palier : sa profondeur s’affiche à gauche de la durée sans palier, ou comme premier palier en décompression (la durée de remontée ASC le compte alors). À ±1 m de cette profondeur, « deep deco » et un décompte de 2 min s’affichent. Il peut être désactivé (réglage DEEp, depuis le firmware V4.0). Le temps passé au deep stop entre dans le calcul comme le reste de la plongée : les paliers obligatoires n’en sont que peu modifiés.', en: 'Optional deep stop, suggested as the no-deco limit approaches: its depth is shown left of the no-deco time, or as the first stop in decompression (the ascent time ASC then includes it). Within ±1 m of that depth, “deep deco” and a 2-minute countdown are shown. It can be turned off (DEEp setting, since firmware V4.0). The time spent at the deep stop enters the calculation like the rest of the dive: the mandatory stops are only slightly changed by it.' }, todo: { fr: 'Arrêtez-vous à sa profondeur pendant le décompte, ou continuez la remontée : il n’est pas obligatoire.', en: 'Stop at its depth during the countdown, or carry on ascending: it is not mandatory.' } };
      default:
        if (key.startsWith('switch-')) {
          return gasSwitch('O2 %', { fr: 'L’O2 % de G1 clignote 20 s. Appui : G2 proposé (O2 % clignotant, MOD en haut à droite) ; appui long : confirmer ; appui : annuler.', en: 'The O2 % of G1 blinks for 20 s. Press: G2 offered (O2 % blinking, MOD top right); hold: confirm; press: cancel.' });
        }
        return null;
    }
  }

  /**
   * Audible alarms (instruction manual §3.2): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals. §2.2.1.7 ALRM turns the audible alarms off (on by default, assumed).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.alrm === 'off') || !v.inDive) return [];
    const cues = maresCues(v);
    // §3.5.2: "Puck Pro sounds an audible signal" at the MOD of G2.
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}

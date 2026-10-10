// Explanations of the Shearwater notifications (alert bubble, app/alertHelp.ts), shared by the
// Perdix 2 (Recreational manual RevC) and the Peregrine TX: same notifications, same wording, same
// thresholds; the sections of each manual are cited by the caller's comments (Perdix §10 / §4.9 /
// §4.10 / §6 / §12.3, Peregrine §4.8 / §4.9 / §4.10 / §5 / §12.3).
import type { AlertExplain } from '../base';

/** What differs between the two models. */
export interface ShearwaterAlertInfo {
  /** Button(s) that dismiss a notification. */
  dismiss: { fr: string; en: string };
  /** Deepest depth (m) of the safety stop countdown window. */
  safetyBottom: number;
  /** PPO2 limit of HIGH PPO2 (text). */
  ppo2Limit: { fr: string; en: string };
  /** Colours of the ascent rate arrows (text). */
  arrows: { fr: string; en: string };
  /** When MISSED DECO STOP appears (text). */
  missedWhen: { fr: string; en: string };
}

export function shearwaterExplain(key: string, m: ShearwaterAlertInfo): AlertExplain | null {
  const vib = { fr: 'L’appareil vibre à l’apparition puis toutes les 10 s', en: 'It vibrates when it appears, then every 10 s' };
  const dismiss = { fr: `${vib.fr} jusqu’à l’acquittement (${m.dismiss.fr}).`, en: `${vib.en} until dismissed (${m.dismiss.en}).` };
  switch (key) {
    case 'high-ppo2':
    case 'high-ppo2-now':
      return {
        id: 'high-ppo2',
        screen: 'HIGH PPO2',
        code: 'PPO2_HIGH',
        what: {
          fr: `Avertissement affiché quand la ppO₂ moyenne reste au-dessus de ${m.ppo2Limit.fr} plus de 30 s. Il vibre tant que la ppO₂ reste trop élevée, même après acquittement.`,
          en: `Warning shown when the average ppO₂ stays above ${m.ppo2Limit.en} for more than 30 s. It keeps vibrating while the ppO₂ stays too high, even once dismissed.`,
        },
      };
    case 'missed-stop':
      return {
        screen: 'MISSED DECO STOP',
        code: 'CEILING',
        what: {
          fr: `Avertissement affiché ${m.missedWhen.fr} ; la profondeur du palier clignote en rouge dès qu’on est au-dessus. ${dismiss.fr}`,
          en: `Warning shown ${m.missedWhen.en}; the stop depth flashes red as soon as you are above it. ${dismiss.en}`,
        },
      };
    case 'fast-ascent':
      return {
        screen: 'FAST ASCENT',
        code: 'ASCENT',
        what: {
          fr: `Avertissement affiché quand la remontée reste plus rapide que 10 m/min (durée non précisée par le manuel : 10 s dans le simulateur). ${m.arrows.fr} ${dismiss.fr}`,
          en: `Warning shown when the ascent stays faster than 10 m/min (duration not given by the manual: 10 s in the simulator). ${m.arrows.en} ${dismiss.en}`,
        },
      };
    case 'high-cns':
      return {
        screen: 'HIGH CNS',
        code: 'CNS',
        what: { fr: `Avertissement affiché quand le CNS dépasse 90 %. ${dismiss.fr}`, en: `Warning shown when the CNS exceeds 90 %. ${dismiss.en}` },
      };
    case 'very-high-cns':
      return {
        screen: 'VERY HIGH CNS',
        code: 'CNS',
        what: { fr: `Avertissement affiché quand le CNS dépasse 150 %. ${dismiss.fr}`, en: `Warning shown when the CNS exceeds 150 %. ${dismiss.en}` },
        todo: {
          fr: 'Bien au-delà de la limite : terminez la plongée et réduisez la ppO₂ (moins profond, gaz moins riche).',
          en: 'Far beyond the limit: end the dive and lower the ppO₂ (shallower, leaner gas).',
        },
      };
    case 'low-ndl':
      return {
        screen: 'Low NDL Alert',
        code: 'NDL_LOW',
        what: {
          fr: `Alerte réglable (5 min par défaut) : le NDL est descendu à la valeur choisie. Elle ne se réarme que lorsque le NDL repasse 3 min au-dessus. ${dismiss.fr}`,
          en: `Settable alert (5 min by default): the NDL has dropped to the chosen value. It re-arms only once the NDL is back 3 min above it. ${dismiss.en}`,
        },
      };
    case 'depth-alert':
      return {
        screen: 'Depth Alert',
        what: {
          fr: `Alerte réglable (40 m par défaut) : vous êtes descendu plus profond que la valeur choisie. Elle se réarme quand vous remontez 2 m au-dessus. ${dismiss.fr}`,
          en: `Settable alert (40 m by default): you went deeper than the chosen value. It re-arms once you are 2 m shallower. ${dismiss.en}`,
        },
        todo: {
          fr: 'Vérifiez votre profondeur par rapport à celle prévue (niveau, MOD du gaz) et remontez si besoin.',
          en: 'Check your depth against the planned one (training level, gas MOD) and ascend if needed.',
        },
      };
    case 'time-alert':
      return {
        screen: 'Time Alert',
        what: {
          fr: `Alerte réglable (60 min, désactivée par défaut) : la durée de plongée a atteint la valeur choisie. Elle ne sonne qu’une fois par plongée. ${dismiss.fr}`,
          en: `Settable alert (60 min, off by default): the dive time has reached the chosen value. It fires only once per dive. ${dismiss.en}`,
        },
        todo: { fr: 'Comparez avec la durée prévue et préparez la remontée.', en: 'Compare with the planned time and get ready to ascend.' },
      };
    case 'gas':
    case 'critical-pres':
      return {
        id: 'critical-pres',
        screen: 'T1 CRITICAL PRES',
        code: 'LOW_GAS',
        what: {
          fr: `Avertissement de l’émetteur T1 quand la pression passe sous la plus grande valeur entre 21 bar et la moitié de la pression de réserve. La réserve elle-même ne fait que passer la pression en jaune. ${dismiss.fr}`,
          en: `Warning from the T1 transmitter when the pressure drops below the larger of 21 bar or half the reserve pressure. The reserve itself only turns the pressure yellow. ${dismiss.en}`,
        },
        todo: { fr: 'Pression critique : remontez sans attendre avec votre binôme.', en: 'Critical pressure: ascend at once with your buddy.' },
      };
    case 'safety-active':
      return {
        screen: 'SAFETY STOP',
        what: {
          fr: `Le décompte du palier de sécurité a commencé (titre vert) : il est proposé après un passage sous 11 m, démarre en remontant au-dessus de 6 m et ne court qu’entre 2,4 et ${String(m.safetyBottom).replace('.', ',')} m. Vibration brève.`,
          en: `The safety stop countdown has started (green title): it is offered after going below 11 m, starts when ascending above 6 m and only runs between 2.4 and ${m.safetyBottom} m. Short vibration.`,
        },
        todo: {
          fr: 'Restez stable vers 5 m jusqu’à la fin du décompte. Il n’est pas obligatoire, mais fortement recommandé.',
          en: 'Stay steady around 5 m until the countdown ends. It is not mandatory, but strongly recommended.',
        },
      };
    case 'safety-paused':
      return {
        screen: 'SAFETY STOP',
        what: {
          fr: `Décompte en pause (titre jaune) : vous êtes sorti de la plage 2,4 – ${String(m.safetyBottom).replace('.', ',')} m. Il reprend en y revenant ; il repart de zéro si vous redescendez sous 11 m. Vibration brève.`,
          en: `Countdown paused (yellow title): you left the 2.4 – ${m.safetyBottom} m range. It resumes once back in it; it starts over if you go below 11 m again. Short vibration.`,
        },
        todo: { fr: 'Revenez vers 5 m pour terminer le palier.', en: 'Go back to about 5 m to finish the stop.' },
      };
    case 'safety-done':
      return {
        screen: 'Complete',
        what: { fr: 'Le palier de sécurité est terminé (« Complete » en vert). Vibration brève.', en: 'The safety stop is complete (green “Complete”). Short vibration.' },
        todo: { fr: 'Terminez la remontée lentement, surtout dans les derniers mètres.', en: 'Finish the ascent slowly, especially in the last metres.' },
      };
    case 'DECO':
      return {
        what: {
          fr: 'Le NDL laisse place au palier (profondeur et durée) et au TTS. On est « au palier » à sa profondeur ou jusqu’à 1,5 m plus profond. Une fois les paliers terminés, « Complete » s’affiche.',
          en: 'The NDL gives way to the stop (depth and time) and the TTS. You are “at the stop” at its depth or up to 1.5 m deeper. Once the stops are done, “Complete” is shown.',
        },
      };
    default:
      return null;
  }
}

// Explanations of the alerts shared by the Mares models (alert bubble, app/alertHelp.ts), worded
// after the rules of mares/common.ts and each model's manual (sections cited by the callers).
import type { AlertExplain, Bi } from '../base';

/** Ascent rate limits of the ZH-L16C models (quadAscentLimit). */
export const ZHL_ASCENT: Bi = {
  fr: 'La vitesse maximale dépend de la profondeur : 20 m/min sous 50 m, 15 entre 30 et 50 m, 10 entre 10 et 30 m, 5 au-dessus de 10 m.',
  en: 'The maximum rate depends on the depth: 20 m/min below 50 m, 15 between 30 and 50 m, 10 between 10 and 30 m, 5 above 10 m.',
};

/** Uncontrolled ascent of the ZH-L16C models (FastAscentZhl), with the lock it brings. */
export function zhlUncontrolled(hours: number): Bi {
  return {
    fr: `Plus de 120 % de la vitesse permise sur plus de 20 m de remontée est une violation : l’ordinateur se verrouille ${hours} h (profondimètre seulement).`,
    en: `More than 120 % of the allowed rate over more than 20 m of ascent is a violation: the computer locks for ${hours} h (depth gauge only).`,
  };
}

/** RGBM models (Puck Pro, Quad Air): alarm and uncontrolled ascent (FastAscentRgbm). */
export const RGBM_ASCENT: Bi = {
  fr: 'Alarme à partir de 10 m/min. Une remontée à plus de 12 m/min commencée sous 12 m et poursuivie sur les deux tiers de cette profondeur est une remontée incontrôlée : les plongées des 24 h suivantes se font en profondimètre seulement.',
  en: 'Alarm from 10 m/min. An ascent faster than 12 m/min started deeper than 12 m and kept over two thirds of that depth is an uncontrolled ascent: the dives of the next 24 h run as a depth gauge only.',
};

/** ZH-L16C models: when a stop counts as missed (MissedStop 'zhl'). */
export const ZHL_MISSED: Bi = {
  fr: 'Le palier est manqué après 3 min à moins de 1 m au-dessus, ou 1 min à plus de 1 m au-dessus.',
  en: 'The stop counts as missed after 3 min less than 1 m above it, or 1 min more than 1 m above it.',
};

/** CNS 100 % sound of the Mares (maresCues). */
export const CNS100: AlertExplain = {
  code: 'CNS',
  what: { fr: 'À 100 % de CNS, le signal sonore dure 5 s et se répète chaque minute.', en: 'At 100 % CNS, the audible signal lasts 5 s and repeats every minute.' },
  todo: { fr: 'Terminez la plongée.', en: 'End the dive.' },
};

/** Generic explanation of a gas switch prompt, with the model's own wording and buttons. */
export function gasSwitch(screen: string, how: Bi): AlertExplain {
  return {
    id: 'switch', screen,
    what: {
      fr: 'En remontant, vous atteignez la MOD d’un gaz plus riche : l’ordinateur propose d’y passer (signal sonore).',
      en: 'While ascending, you reach the MOD of a richer gas: the computer offers to switch to it (audible signal).',
    },
    todo: how,
  };
}

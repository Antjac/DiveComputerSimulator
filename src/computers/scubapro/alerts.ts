// Explanations of the Scubapro alerts (alert bubble, app/alertHelp.ts). The G2 and the Luna 2.0 AI
// manuals describe the same rules in the same terms (common.ts): ideal ascent rate, MB levels, PDIS,
// SOS lock, RBT; each model has its own wording on screen (G2: pop-up bar, §3.5 / §3.6; Luna: boxes,
// §3.9 / §3.10).
import type { Bi } from '../base';

/** Ideal ascent rate table (IDEAL_ASCENT, G2 §3.7, Luna §3.10.1). */
export const IDEAL: Bi = {
  fr: 'La vitesse idéale dépend de la profondeur : de 10 m/min au fond à 3 m/min près de la surface (7 m/min vers 6 m).',
  en: 'The ideal rate depends on the depth: from 10 m/min deep down to 3 m/min near the surface (7 m/min around 6 m).',
};

/** SOS lock (G2 §1.6, Luna §3.11). */
export const SOS: Bi = {
  fr: 'Plus de 3 min au-dessus de 0,8 m sans avoir fait un palier obligatoire : mode SOS, verrouillage 24 h (profondimètre seulement, compte à rebours « SOS » en surface).',
  en: 'More than 3 min above 0.8 m without making a mandatory stop: SOS mode, 24 h lock (gauge only, “SOS” countdown at the surface).',
};

/** MB levels / GF stage stops, which are not mandatory (common.ts). */
export const STAGE: Bi = {
  fr: 'Les paliers d’un niveau MB plus prudent que L0 (ou de GF plus prudents que 100/100 sur le Luna) ne sont pas obligatoires : les ignorer de plus de 1,5 m ramène le niveau vers L0 (ou augmente les GF).',
  en: 'The stops of an MB level more conservative than L0 (or of GF more conservative than 100/100 on the Luna) are not mandatory: ignoring them by more than 1.5 m brings the level down towards L0 (or raises the GF).',
};

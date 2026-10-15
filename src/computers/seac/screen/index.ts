import type { SettingDef } from '../../base';
import { SeacDevice, seacSettings } from '../common';

/** SEAC Screen (owner's manual, 2021), SCUBA mode: wrist computer, two buttons L and R, two mixes. */
export class SeacScreen extends SeacDevice {
  readonly id = 'seac-screen';
  readonly name = 'SEAC Screen';
  protected readonly mixes = 2;
  protected readonly frame = 'sc-wrist';
  readonly settingDefs: SettingDef[] = seacSettings(2);
  readonly notes = {
    fr: 'Bühlmann ZHL-16C « non modifié » avec facteurs de gradient : 6 niveaux de protection (0 à 5, 0 par défaut) dont le manuel ne donne pas les GF ; valeurs reprises du SEAC Guru (93/93, 90/90, 80/80, 75/75, 30/90, 20/89), NON VÉRIFIÉES pour le Screen. Mode SCUBA (Gauge et Free non simulés). Écran à segments des figures : durée, flèches de vitesse, profondeur ; NDL, ou palier de sécurité (SFT STOP), deep stop ou TTS / palier / durée ; en bas, R fait défiler MIX % et MAX, MIX % et PO2, température et AVG, CNS et heure (défilement déduit des figures). Vitesse : 1 à 3 flèches (3, 6, 9, 12 m/min), au-delà de 12 m/min flèches clignotantes et alarme. MOD dépassée et palier non respecté (à 0,5 m) : la profondeur clignote et l’alarme sonne. Points de pénalité (5 ou 10 toutes les 5 s à plus de 1 ou 2 m au-dessus du palier) ; à 150, « WARNING DECO VLT » et SCUBA verrouillé 18 h. Palier de sécurité réglable (3 min à 5 m par défaut) après 12 m, affiché sous 9 m, décompte à ±2 m, annulé au-dessus, remis à zéro sous 9 m. Deep stop facultatif (désactivé par défaut) : 2:30 à la moitié de la profondeur max. après 18 m sans déco. MIX 2 (désactivé par défaut) : le % d’O2 clignote quand le changement est possible, L ouvre « CHANGE MIX TO … » (déduit de la figure), R : YES, L : NO. TTS calculée à 9 m/min. Écran montre en surface (heure, interdiction de vol et désaturation) déduit, sans figure. Non simulés : modes Gauge et Free, chronomètre, planificateur, carnet, durée de 10 min avant la fin de plongée (le simulateur clôt la plongée après 3 min), altitude.',
    en: '“Unmodified” Bühlmann ZHL-16C with gradient factors: 6 protection levels (0 to 5, 0 by default) whose GF the manual does not give; values taken from the SEAC Guru (93/93, 90/90, 80/80, 75/75, 30/90, 20/89), NOT VERIFIED for the Screen. SCUBA mode (Gauge and Free not simulated). Segmented display of the figures: dive time, rate arrows, depth; NDL, or safety stop (SFT STOP), deep stop or TTS / stop / time; at the bottom, R steps through MIX % and MAX, MIX % and PO2, temperature and AVG, CNS and time (scrolling deduced from the figures). Rate: 1 to 3 arrows (3, 6, 9, 12 m/min), beyond 12 m/min flashing arrows and alarm. MOD exceeded and stop violated (at 0.5 m): the depth flashes and the alarm sounds. Penalty points (5 or 10 every 5 s more than 1 or 2 m above the stop); at 150, “WARNING DECO VLT” and SCUBA locked for 18 h. Settable safety stop (3 min at 5 m by default) after 12 m, shown within 9 m, counted within ±2 m, cancelled above, reset below 9 m. Optional deep stop (off by default): 2:30 at half the max depth after 18 m with no deco. MIX 2 (off by default): the O2 % flashes when the switch is possible, L opens “CHANGE MIX TO …” (deduced from the figure), R: YES, L: NO. TTS computed at 9 m/min. Surface watch screen (time, no-fly and desaturation) deduced, no figure. Not simulated: Gauge and Free modes, stopwatch, planner, logbook, 10 min before the dive ends (the simulator closes the dive after 3 min), altitude.',
  };

  constructor() {
    super();
    this.init();
  }
}

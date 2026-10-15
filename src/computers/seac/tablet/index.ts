import type { SettingDef } from '../../base';
import { SeacDevice, seacSettings } from '../common';

/**
 * SEAC Tablet (owner's manual, March 2025), SCUBA mode: the Screen's rules and display, three mixes and
 * the optional LED TANK PROBE ("Connecting to tanks (TANK)"), whose pressure is the second bottom field
 * (NDL Dive, Screen 2: "Oxygen percentage of the current mix – Tank pressure"). One probe per mix: the
 * simulator's transmitter is on the main tank, so another mix shows "----" ("If a mix has no probe
 * assigned it shows ----").
 */
export class SeacTablet extends SeacDevice {
  readonly id = 'seac-tablet';
  readonly name = 'SEAC Tablet';
  readonly transmitter = 'LED TANK PROBE';
  protected readonly mixes = 3;
  protected readonly frame = 'sc-tablet';
  readonly settingDefs: SettingDef[] = seacSettings(3);
  readonly notes = {
    fr: 'Mêmes règles que le SEAC Screen (chapitre Technical Characteristics identique) : Bühlmann ZHL-16C « non modifié » avec facteurs de gradient, 6 niveaux de protection (0 à 5, 0 par défaut) dont le manuel ne donne pas les GF ; valeurs reprises du SEAC Guru (93/93, 90/90, 80/80, 75/75, 30/90, 20/89), NON VÉRIFIÉES pour le Tablet. Mode SCUBA. Jusqu’à 3 mélanges (MIX 2 et MIX 3 désactivés par défaut). Avec la sonde LED TANK PROBE, R fait défiler : MIX % et MAX, MIX % et pression du bloc (« ---- » pour un mélange sans sonde ; la sonde est sur le bloc principal ici), MIX % et PO2, température et AVG, CNS et heure. Le manuel ne décrit aucune alarme de pression. Vitesse (flèches, alarme au-delà de 12 m/min), MOD, palier non respecté (0,5 m), points de pénalité et verrouillage de 18 h, palier de sécurité, deep stop et changement de mélange comme sur le Screen. Écran montre en surface déduit. Non simulés : modes Gauge, Free et OFF, chronomètre, planificateur, carnet, Bluetooth, fin de plongée après 10 min.',
    en: 'Same rules as the SEAC Screen (identical Technical Characteristics chapter): “unmodified” Bühlmann ZHL-16C with gradient factors, 6 protection levels (0 to 5, 0 by default) whose GF the manual does not give; values taken from the SEAC Guru (93/93, 90/90, 80/80, 75/75, 30/90, 20/89), NOT VERIFIED for the Tablet. SCUBA mode. Up to 3 mixes (MIX 2 and MIX 3 off by default). With the LED TANK PROBE, R steps through: MIX % and MAX, MIX % and tank pressure (“----” for a mix without a probe; the probe is on the main tank here), MIX % and PO2, temperature and AVG, CNS and time. The manual describes no pressure alarm. Rate (arrows, alarm beyond 12 m/min), MOD, stop violated (0.5 m), penalty points and 18 h lock, safety stop, deep stop and mix change as on the Screen. Surface watch screen deduced. Not simulated: Gauge, Free and OFF modes, stopwatch, planner, logbook, Bluetooth, dive end after 10 min.',
  };

  constructor() {
    super();
    this.init();
  }
}

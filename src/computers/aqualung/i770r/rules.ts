import { COMPARTMENTS, type DecoParams, type TissueVariant } from '../../../engine/buhlmann';
import { residualGas } from '../../base/tissues';
import type { DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import type { ComputerView, SettingDef } from '../../base';
import { type PelagicAlarm, PelagicRules, pelagicSettings } from '../common';
import { pressureSetting, pressureValue } from '../../common/tank';

/**
 * Z+ ("Bühlmann ZHL-16C based") is not published: approximated by Bühlmann ZHL-16C with a single
 * gradient factor, calibrated (npm run calib) on the manual's "Z+ algorithm NDLs" table at sea
 * level: 18 m 50 min, 21 m 36, 24 m 27, 27 m 20, 30 m 16, 33 m 13 (GF 95 gives 53, 36, 25, 18, 14, 11;
 * shallower it is too long: 15 m 81 min instead of 68). Conservative ON "will be reduced to the
 * values available at the altitude level that is 915 m (3,000 ft) higher": 15 m 55, 18 m 39, 21 m 28,
 * 24 m 20, 30 m 12 → GF 85 (68, 42, 28, 19, 11).
 */
export const Z_PLUS_GF: Record<string, number> = { off: 0.95, on: 0.85 };

/**
 * Stops and repetitive dives of Z+, calibrated on the Deeply Safe Labs chamber tests of two other
 * Aqua Lung computers running Pelagic Z+, the i100 and the i300C (fr.deeplysafelabs.com, Conservatism
 * Factor off, deep stops off; not the i770R itself): 30 m / 30 min twice, 90 min apart: no-stop time
 * 15-16 then 14-15 min, stops 6 m 1-2 + 3 m 19-22 min, then 6 m 3-4 + 3 m 35-37 min; 30 m / 16 min six
 * times, 75 min apart: no stop on the first dive, then a no-stop time of 12 min and 3 to 5 min at 3 m.
 * With the GF of the NDL table alone the stops would be 8 then 24 min, and no stop at all on the six
 * dives. Reproduced (15/22 then 14/40 min, then 12-14 min and 2-3 min at 3 m) by tissues off-gassing
 * 2.5 times more slowly than they load in the water and 1.25 times at the surface, and, on a repetitive
 * dive, the two fastest compartments losing 0.2 times the residual gas left (share of the room up to
 * the surface M-value) from their gradient factor. Not measured: other depths, nitrox, Conservative ON.
 */
const Z_PLUS_WATER = 2.5;
const Z_PLUS_SURFACE = 1.25;
const Z_PLUS_REPETITIVE = 0.2;

/**
 * Aqua Lung i770R, Dive mode (Air / Nitrox). Rules follow the i770R Dive Computer Owner's Manual
 * (Doc. 12-7892-r01, 4/24/18, firmware 1A01; the later French r02 and German r05 have the same
 * firmware and page count).
 */
export abstract class I770rRules extends PelagicRules {
  readonly id = 'i770r';
  readonly name = 'Aqualung i770R';
  readonly algorithm = 'Pelagic Z+';
  readonly exact = false;
  readonly decoCalibrated = true;
  readonly calibration = {
    fr: [
      'Temps sans palier : table « Z+ algorithm NDLs » du manuel (GF équivalent de 95 % ; 85 % avec Conservative ON).',
      'Paliers et plongées successives : essais en caisson de Deeply Safe Labs (fr.deeplysafelabs.com) de deux autres Aqua Lung en Pelagic Z+, l’i100 et l’i300C (pas l’i770R) : 30 m / 30 min deux fois à 90 min d’intervalle (paliers de 20 à 24 puis 38 à 41 min) ; 30 m / 16 min six fois à 75 min d’intervalle (12 min sans palier et 3 à 5 min à 3 m à partir de la 2e).',
      'Modèle : tissus qui dégazent 2,5 fois plus lentement qu’ils ne se chargent dans l’eau et 1,25 fois en surface ; en plongée successive, les deux compartiments les plus rapides perdent 0,2 fois l’azote résiduel de leur GF.',
      'Écart restant : paliers à 2,5 min près sur les deux plongées de 30 min ; sur les plongées de 16 min, 1,5 à 3,5 min à 3 m au lieu de 3 à 5.',
      'Non vérifié : autres profondeurs, nitrox, Conservative ON.',
    ],
    en: [
      'No-stop times: the manual\'s "Z+ algorithm NDLs" table (GF equivalent of 95 %; 85 % with Conservative ON).',
      'Stops and repetitive dives: Deeply Safe Labs chamber tests (fr.deeplysafelabs.com) of two other Aqua Lung computers running Pelagic Z+, the i100 and the i300C (not the i770R): 30 m / 30 min twice 90 minutes apart (stops of 20 to 24 then 38 to 41 min); 30 m / 16 min six times 75 minutes apart (12 min no-stop time and 3 to 5 min at 3 m from the second).',
      'Model: tissues off-gassing 2.5 times more slowly than they load in the water and 1.25 times at the surface; on a repetitive dive, the two fastest compartments lose 0.2 times the residual nitrogen from their GF.',
      'Remaining gap: stops within 2.5 min on the two 30-minute dives; on the 16-minute dives, 1.5 to 3.5 min at 3 m instead of 3 to 5.',
      'Not checked: other depths, nitrox, Conservative ON.',
    ],
  };
  readonly transmitter = 'TMT';
  readonly gasTimeName = 'GTR';
  readonly ackButton = 'select'; // "acknowledged and silenced by pressing the SELECT button"
  readonly fastRate = 9.2; // ASC bar graph: 5 segments "> 9.2 (> 30)", "all segments flash"

  /** Alarm banners of the figures (index.ts). */
  protected alarmScreen(k: PelagicAlarm): string {
    const t: Partial<Record<PelagicAlarm, string>> = {
      violation: 'VIOLATION', 'too-deep': 'TOO DEEP', 'down-to-stop': 'DOWN TO STOP', 'deco-entry': 'DECO ENTRY', 'high-po2': 'ALARM',
      'o2-alarm': 'ALARM', 'o2-warning': 'WARNING', 'too-fast': 'TOO FAST', depth: 'DEPTH', 'dive-t': 'DIVE TIME', turn: 'TURN PRESSURE',
      end: 'END PRESSURE', n2bar: 'NITROGEN', dtr: 'NO DECO TIME / O2 TIME',
    };
    return t[k] ?? '';
  }

  /** Set Gas: "OFF for Gas 2, 3, and 4": four gases. */
  get maxGases(): number {
    return 4;
  }

  /** Gas Switch Warning: "If the gas switch is not confirmed within 30 seconds, no switch will be made." */
  protected readonly switchWarnTimeout = 30;
  readonly notes = {
    fr: "Mode Dive (Air ou Nitrox ; Gauge, Free et boussole non simulés). Gaz 1 à 4 (bloc principal puis gaz de déco de la page ; alarme PO2 des autres gaz : 1,40 supposé, comme la figure) : ▼ : menu de plongée, GAS SWITCH (SELECT), liste des gaz avec la PO2 et la MOD du gaz en surbrillance (▲ / ▼), SELECT : changement ; PO2 au-delà de 1,6 : DO NOT SWITCH TO GAS n HIGH PO2, SELECT force le changement ; appui long sur SELECT : retour, appui long sur ▼ : écran principal. Près de la zone de palier, avertissement SWITCH TO si un meilleur gaz est disponible, à confirmer par SELECT en 30 s. Calcul de la décompression avec le gaz respiré seulement (supposé). Z+ est propriétaire (« basé sur Bühlmann ZHL-16C ») : approximation par Bühlmann ZHL-16C avec un GF unique, calibré sur la table des NDL du manuel (GF 95, CONSERVATIVE ON : GF 85 ; NDL trop longs au-dessus de 18 m). Conforme au manuel : DTR = le plus petit de NO-DECO et O2 TIME, barres ASC et N2, TOO FAST au-delà de 9,2 m/min, palier de sécurité (ON, OFF ou SET : 3 ou 5 min à 3–6 m) au-delà de 9 m, deep stop (ON), DECO ENTRY, DOWN TO STOP (pas de désaturation au-dessus du palier, 1,5 min de pénalité par minute), DV1 au-delà de 5 min puis Violation Gauge Mode, VGM si un palier à plus de 21 m est requis (24 h), alarmes PO2, O2 SAT, profondeur, durée, pression de demi-tour et de fin (émetteur TMT 1 sur le gaz 1 seulement : zone pression vide, sans GTR ni alarme de pression sur un autre gaz), barre N2 et DTR (10 bips, acquittées par SELECT). Bouton ▲ : More Dive Data (en surface : More Data et Last Dive Data) ; SELECT : acquittement ; ▼ : menu (non simulé), appui long : repère (EARMARK APPLIED). Supposés : définition du GTR (temps jusqu'à la réserve, remontée à 9 m/min), pression de fin = réserve, palier ON = 3 min à 5 m, valeurs par défaut des alarmes, pas de 3 m.",
    en: 'Dive mode (Air or Nitrox; Gauge, Free and compass not simulated). Gases 1 to 4 (the main tank, then the deco gases set on the page; PO2 alarm of the other gases: 1.40 assumed, as the figure): ▼: dive menu, GAS SWITCH (SELECT), list of the gases with the PO2 and MOD of the highlighted one (▲ / ▼), SELECT: switch; PO2 above 1.6: DO NOT SWITCH TO GAS n HIGH PO2, SELECT forces the switch; SELECT hold: back, ▼ hold: main screen. Near the stop zone, SWITCH TO warning when a better gas is available, to be confirmed with SELECT within 30 s. Decompression computed with the gas breathed only (assumed). Z+ is proprietary ("Bühlmann ZHL-16C based"): approximated by Bühlmann ZHL-16C with a single GF, calibrated on the manual\'s NDL table (GF 95, CONSERVATIVE ON: GF 85; NDLs too long shallower than 18 m). As per the manual: DTR = the least of NO-DECO and O2 TIME, ASC and N2 bar graphs, TOO FAST above 9.2 m/min, safety stop (ON, OFF or SET: 3 or 5 min at 3–6 m) beyond 9 m, deep stop (ON), DECO ENTRY, DOWN TO STOP (no off-gassing credit above the stop, 1.5 min penalty per minute), DV1 beyond 5 min then Violation Gauge Mode, VGM when a stop deeper than 21 m is required (24 h), PO2, O2 SAT, depth, dive time, turn and end pressure (TMT 1 on gas 1 only: blank pressure area, no GTR and no pressure alarm on another gas), N2 bar and DTR alarms (10 beeps, acknowledged with SELECT). ▲ button: More Dive Data (on the surface: More Data and Last Dive Data); SELECT: acknowledge; ▼: menu (not simulated), hold: earmark (EARMARK APPLIED). Assumed: GTR definition (time to the reserve, ascent at 9 m/min), end pressure = reserve, safety stop ON = 3 min at 5 m, alarm defaults, 3 m stop step.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // "Add PO2/MOD" (Display menu): third field of the bottom bar, "Maximum Operating Depth, current
      // PO2 value, or blank". Default not given: MOD, as on the Dive Main figures.
      key: 'field',
      essential: true,
      label: { fr: 'Barre (Add PO2/MOD)', en: 'Bar (Add PO2/MOD)' },
      options: [{ value: 'mod', label: 'MOD' }, { value: 'po2', label: 'PO2' }, { value: 'off', label: 'OFF' }],
      default: 'mod',
    },
    {
      key: 'cf',
      label: { fr: 'CONSERV FACTOR', en: 'Conservative factor' },
      options: [{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }],
      default: 'off', // default not given: OFF assumed
    },
    ...pelagicSettings(),
    // Set Alarms, 4. Turn Press: "OFF or 70 to 205 BAR (1000 to 3000 PSI)", TURN PRESSURE when triggered.
    // Default not given: OFF assumed; step: 5 bar offered.
    pressureSetting('turnAl', { fr: 'Alarme de demi-tour (TURN PRESS)', en: 'Turn pressure alarm (TURN PRESS)' }, 70, 205, 5, 'off', 'OFF'),
    // Set Alarms, 5. End Press: 20 to 105 BAR (300 to 1500 PSI)", always on; it is also the pressure GTR counts down
    // to (assumed). Default not given: 50 bar assumed; step: 5 bar offered.
    pressureSetting('reserve', { fr: 'Alarme de fin (END PRESS)', en: 'End pressure alarm (END PRESS)' }, 20, 105, 5, 50),
  ];

  constructor() {
    super();
    this.init();
  }

  /** Z+ tissues (see Z_PLUS_WATER): in the water or at the surface, with the repetitive-dive penalty. */
  tissueVariant(): TissueVariant {
    const offgas = this.zInWater ? Z_PLUS_WATER : Z_PLUS_SURFACE;
    if (this.zVariant?.offgas !== offgas) {
      const pen = this.zInWater ? this.zPenalty : 0;
      this.zVariant = { offgas, gfShift: pen > 0 ? Array.from({ length: COMPARTMENTS }, (_, i) => (i < 2 ? pen : 0)) : undefined };
    }
    return this.zVariant;
  }

  private zVariant: TissueVariant | null = null;
  /** In a dive at the last step (tissue model in the water). */
  private zInWater = false;
  /** Repetitive-dive penalty of the dive in progress (see Z_PLUS_REPETITIVE). */
  private zPenalty = 0;

  onDiveStart(s: DiveSession): void {
    this.zPenalty = Z_PLUS_REPETITIVE * residualGas(s.tissues);
    this.zInWater = true;
    this.zVariant = null;
    super.onDiveStart(s);
  }

  onDiveEnd(s: DiveSession): void {
    this.zInWater = false;
    this.zPenalty = 0;
    this.zVariant = null;
    super.onDiveEnd(s);
  }

  tick(s: DiveSession, dt: number): void {
    if (this.zInWater !== s.inDive) {
      this.zInWater = s.inDive;
      this.zVariant = null;
    }
    super.tick(s, dt);
  }

  baseParams(): DecoParams {
    const g = Z_PLUS_GF[this.settings.cf] ?? Z_PLUS_GF.off;
    // A single GF (Z+ deco stops are not described): 3 m steps, last stop 3 m assumed.
    return { gfLow: g, gfHigh: g, lastStop: 3, stopStep: 3, ascentRate: 9 };
  }

  /**
   * Gas Switch: "GAS (& TRANSMITTER) SWITCH", each gas reading its own transmitter (TMT/Gas #) and
   * "If the TMT is set OFF for the active gas, the section of the Main Screen that normally displays
   * pressure will be blank" (Transmitters menu). Only TMT 1 (the main tank) is simulated: on another
   * gas, no pressure, no GTR and no pressure alarm ("Turn Alarm (TMT 1 only)", "Press Alarm (TMT in use)").
   */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** "End Press" setting (bar). */
  endPressure(): number {
    return this.reservePressure();
  }

  /**
   * GTR ("Gas Time Remaining", 0 - 99 min): not defined in the manual. Assumed: minutes at the current
   * depth until a direct ascent at 9 m/min would surface with the end (reserve) pressure.
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.endPressure(),
      sacBar, rate: () => 9, deco: null,
    });
  }

  protected alarmConditions(s: DiveSession, v: ComputerView): PelagicAlarm[] {
    const a = super.alarmConditions(s, v);
    if (v.tank.ai) {
      const turn = pressureValue(this.settings, 'turnAl');
      if (turn !== null && s.tankPressure <= turn) a.push('turn');
      if (s.tankPressure <= this.endPressure()) a.push('end');
    }
    return a;
  }
}

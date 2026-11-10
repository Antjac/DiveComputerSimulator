// Rules shared by the Scubapro computers (G2, Luna 2.0 AI), from their manuals which describe them
// in the same terms: depth-dependent ideal ascent rate, microbubble (MB) levels, PDIS, SOS lock, RBT.
import { COMPARTMENTS, DecoParams, N2_A, N2_B, SURFACE_PRESSURE, type TissueVariant, Tissues, WATER_VAPOUR, ceilingDepth, equilibriumDepth, stopDepthFor, updateAnchor } from '../../engine/buhlmann';
import { remainingTime } from '../../engine/gas';
import type { DiveSession } from '../../engine/session';
import { ComputerView, DiveComputer, type SettingDef } from '../base';
import { pressureSetting } from '../common/tank';
import { compartmentLoad, residualGas } from '../base/tissues';

/** Ideal ascent rate by depth (G2 manual §3.7, Luna 2.0 AI manual §3.10.1: same table), in m/min. */
export const IDEAL_ASCENT: [number, number][] = [
  [0, 3], [2.5, 5.5], [6, 7], [12, 7.7], [18, 8.2], [23, 8.6], [31, 8.9], [35, 9.1], [39, 9.4], [44, 9.6], [50, 9.8], [120, 10],
];

export function idealAscent(depth: number): number {
  let v = IDEAL_ASCENT[0][1];
  for (const [d, r] of IDEAL_ASCENT) if (depth >= d) v = r;
  return v;
}

// Calibration of the Scubapro algorithms, which Scubapro does not publish (approximation). Sources:
//  - Deeply Safe Labs chamber tests (fr.deeplysafelabs.com, scripts/dslData.ts, `npm run dsl`): G2 and
//    Luna 2.0 at MB L0, Luna 2.0 in ZH-L16C+GF 30/70; 2 x 30 m / 30 min (90 min apart) and
//    6 x 30 m / 16 min (75 min apart).
//  - divetable.info, "Galileo G2 Version 2.0" (G2 firmware 1.6 / 2.0 and G2 TEK planners): air NDL from
//    9 to 66 m, TTS of 9 schedules at L0 and with the G2 TEK at GF 100/100, TTS at L0 to L3 (42 m / 25 min).
// What they show, and how it is reproduced:
//  - The stops are much longer than ZH-L16C's, even those of the G2 TEK at GF 100/100 (TTS 32 min instead
//    of 25 for 42 m / 25 min): the Scubapro tissues off-gas more slowly than they load (SCUBAPRO_OFFGAS),
//    for every Scubapro algorithm (the Luna 2.0 in GF 30/70: 36 min of stops for 30 m / 30 min, 28 with
//    ZH-L16C; 34 simulated).
//  - ZH-L16 ADT MB at L0: no-stop times of ZH-L16C at about 100 % of the M-values for the fast
//    compartments (16-17 min at 30 m) but shorter in shallow water (121 min at 12 m instead of 197): the
//    slower compartments get a lower gradient factor (ADT_GF_SHIFT). Once in deco, the stops are
//    computed with a lower gradient factor (ADT_DECO_GF). Each MB level lowers both by 5 % (TTS at L1,
//    L2, L3 close to the G2 TEK's at GF 85, 80, 75 %).
//  - Repetitive dives at L0: no-stop time down from 17 to 8-10 min after 75-90 min at the surface, longer
//    stops from dive to dive: the two fastest compartments lose a share of their gradient factor equal
//    to the residual inert gas left by the previous dives (REPETITIVE_PENALTY; how it fades over a longer
//    interval is not measured: it follows the residual gas, about 5 % after 24 h).
//  - ZH-L16C+GF (Luna, G3): repetitive dives start with the faster compartments raised to the load of the
//    slowest loaded one (liftToSlowestLoaded): the no-stop time stays the same, the stops grow.
//  - Stops every metre from 6 m to 3 m (6, 5, 4 m stops seen in the chamber tests).
//  - The planner TTS are taken as including the 3-minute safety stop (deduced: 6 min for 18 m / 60 min
//    without deco at GF 100/100).
// Fitted values: tests at 30 m within 2 min (first dive) and 4 min (second dive) of the stop times, planner
// TTS within 15 %, no-stop times within 1 min from 18 to 48 m (12 m: 100 min, 15 m: 77 min). Not
// reproduced: the deco gets longer from dive to dive less than measured (6 x 30 m: 14 min of stops at
// the 6th dive instead of 18 at L0, 15 instead of 40 in GF 30/70). Not checked against any measurement:
// MB levels L1-L5 beyond the planner's 42 m / 25 min, other depths for repetitive dives, nitrox, the G3
// (ZH-L16D ADT MB, given the same calibration).
/** Calibration items of the details dialog (sources and fit, see above), for each Scubapro model. */
export function scubaproCalibration(model: 'g2' | 'luna' | 'g3'): { fr: string[]; en: string[] } {
  const fr = [
    'Mesures sur appareils réels : essais en caisson de Deeply Safe Labs (fr.deeplysafelabs.com) du G2 et du Luna 2.0 en ZH-L16 ADT MB L0, et du Luna 2.0 en ZH-L16C+GF 30/70 : deux plongées de 30 min à 30 m à 90 min d’intervalle, six plongées de 16 min à 30 m à 75 min d’intervalle.',
    'Planificateur du G2 (firmware 2.0) et du G2 TEK comparés par divetable.info (« Galileo G2 Version 2.0 ») : temps sans palier de 9 à 66 m, durée de remontée de 9 profils, niveaux MB L0 à L3.',
    'Modèle : Bühlmann ZHL-16C avec des tissus qui dégazent 1,25 fois plus lentement qu’ils ne se chargent ; en ADT MB, GF de 100 % pour le temps sans palier (moins pour les compartiments lents), de 94 % une fois en déco, 5 % de moins par niveau MB, pénalité des plongées successives sur les deux compartiments les plus rapides selon l’azote résiduel ; paliers de mètre en mètre de 6 à 3 m.',
    'Écart restant : paliers à 2 min près (1re plongée) et 4 min près (2e plongée) sur les essais à 30 m, durée de remontée du planificateur à 15 % près ; sur six plongées successives, la déco s’allonge moins que mesuré.',
    'Non vérifié : niveaux MB au-delà de L3, plongées successives à d’autres profondeurs, nitrox.',
  ];
  const en = [
    'Measurements on real computers: Deeply Safe Labs chamber tests (fr.deeplysafelabs.com) of the G2 and the Luna 2.0 in ZH-L16 ADT MB L0, and of the Luna 2.0 in ZH-L16C+GF 30/70: two 30-minute dives to 30 m 90 minutes apart, six 16-minute dives to 30 m 75 minutes apart.',
    'G2 (firmware 2.0) and G2 TEK planners compared by divetable.info ("Galileo G2 Version 2.0"): no-stop times from 9 to 66 m, ascent time of 9 schedules, MB levels L0 to L3.',
    'Model: Bühlmann ZHL-16C with tissues off-gassing 1.25 times more slowly than they load; in ADT MB, GF 100 % for the no-stop time (less for the slow compartments), 94 % once in deco, 5 % less per MB level, repetitive-dive penalty on the two fastest compartments from the residual nitrogen; stops every metre from 6 to 3 m.',
    'Remaining gap: stops within 2 min (first dive) and 4 min (second dive) on the 30 m tests, planner ascent times within 15 %; over six repetitive dives, the deco grows less than measured.',
    'Not checked: MB levels beyond L3, repetitive dives at other depths, nitrox.',
  ];
  if (model !== 'g2') {
    fr.splice(3, 0, 'En ZH-L16C+GF : plongée successive commencée avec les compartiments plus rapides remontés à la charge du plus lent encore chargé (hypothèse de l’utilisateur, vérifiée sur les essais du Luna 2.0 : la déco s’allonge et le temps sans palier ne bouge pas, environ moitié moins que mesuré sur six plongées) ; 2 × 30 m / 30 min : 34 et 55 min de paliers (mesuré : 36 et 59).');
    en.splice(3, 0, 'In ZH-L16C+GF: a repetitive dive starts with the faster compartments raised to the load of the slowest one still loaded (user\'s hypothesis, checked against the Luna 2.0 tests: the deco grows and the no-stop time does not change, about half as much as measured over six dives); 2 × 30 m / 30 min: 34 and 55 min of stops (measured: 36 and 59).');
  }
  if (model === 'g3') {
    fr.push('G3 (ZH-L16D ADT MB) : calage du G2 et du Luna 2.0 repris, non vérifié sur le G3 lui-même.');
    en.push('G3 (ZH-L16D ADT MB): the G2 and Luna 2.0 calibration is reused, not checked on the G3 itself.');
  }
  return { fr, en };
}

/** Off-gassing of the Scubapro tissues: half-times this many times longer than on-gassing. */
export const SCUBAPRO_OFFGAS = 1.25;
/** ZH-L16 ADT MB at L0: gradient factor of the no-stop time, and of the stops once in deco. */
const ADT_NDL_GF = 1.0;
const ADT_DECO_GF = 0.94;
/** ZH-L16 ADT MB: amount taken off the gradient factor of each compartment (fast to slow). */
const ADT_GF_SHIFT = [0, 0.02, 0.07, 0.08, 0.11, 0.12, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15];
/** Gradient factor taken off by each MB level. */
const MB_STEP = 0.05;
/** Repetitive dives (ADT MB): share of the residual gas taken off the GF of the REPETITIVE_FAST fastest compartments. */
const REPETITIVE_PENALTY = 1.0;
const REPETITIVE_FAST = 2;

/** Microbubble level → gradient factors (approximation, see above): no-stop phase, or once in deco. */
export function levelParams(level: number, deco = true): DecoParams {
  const g = (deco ? ADT_DECO_GF : ADT_NDL_GF) - MB_STEP * level;
  return { gfLow: g, gfHigh: g, lastStop: 3, stopStep: 3, fineStopsBelow: 6, ascentRate: 10 };
}

/** Scubapro ZH-L16C+GF (Luna, G3 GF algorithm): gradient factors in %, on the Scubapro tissues. */
export function gfParams(lo: number, hi: number): DecoParams {
  return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, fineStopsBelow: 6, ascentRate: 10 };
}

/**
 * Start of a repetitive dive with the Scubapro ZH-L16C+GF algorithm (approximation, user's hypothesis
 * checked against the Deeply Safe Labs tests of the Luna 2.0 in GF 30/70): every compartment faster
 * than the slowest one still loaded (load above 1 %) is raised to at least that compartment's load.
 * The no-stop time hardly changes from dive to dive while the stops grow, as measured (about half as
 * much as measured over six dives).
 */
export function liftToSlowestLoaded(t: Tissues): void {
  let j = COMPARTMENTS - 1;
  while (j >= 0 && compartmentLoad(t, j) <= 0.01) j--;
  if (j <= 0) return;
  const level = compartmentLoad(t, j);
  const eq = (SURFACE_PRESSURE - WATER_VAPOUR) * 0.7902;
  for (let i = 0; i < j; i++) {
    const target = eq + level * (N2_A[i] + SURFACE_PRESSURE / N2_B[i] - eq);
    const total = t.n2[i] + t.he[i];
    if (total < target) t.n2[i] += target - total;
  }
}


/**
 * Tank reserve (G2 §2.8.2.1, Luna 2.0 AI §2.3.6): "from 20 to 120bar in 5-bar increments"; reaching it
 * triggers an alarm and it is the empty tank of the RBT. Default not given by the manuals (their figures
 * show 40 bar): 50 bar, as confirmed by the user.
 */
export const reserveSetting: SettingDef = pressureSetting('reserve', { fr: 'Réserve du bloc (Tank reserve)', en: 'Tank reserve' }, 20, 120, 5, 50);

export type PdisState = 'none' | 'shown' | 'active' | 'ok' | 'no';

/**
 * Scubapro rules. The decompression obligation (deco stops, MISSED DECO) follows the base algorithm;
 * a stricter "stage" chosen by the diver (MB level above L0, or on the Luna a GF other than 100/100)
 * adds stops that are not mandatory: ignoring them by more than 1.5 m relaxes the stage (MB level
 * reduced, GF increased).
 */
export abstract class ScubaproRules extends DiveComputer {
  activeLevel = 0;
  levelAnchor = 0;
  levelReducedAt = -1e9;
  pdisState: PdisState = 'none';
  pdisDepth = 0;
  pdisRemaining = 120;
  /** SOS lock: seconds spent above 0.8 m with a pending obligation. */
  protected sosSec = 0;
  /** ADT MB: the base algorithm (L0) and the MB level have gone into deco during this dive (stops at their deco GF). */
  baseDeco = false;
  stageDeco = false;
  /** ADT MB: repetitive-dive penalty of this dive on the fastest compartments' GF (see REPETITIVE_PENALTY). */
  repetitivePenalty = 0;
  private variant: TissueVariant | null = null;

  /** ZH-L16 ADT MB is in use (not the ZH-L16C+GF algorithm of the Luna and the G3). */
  get adt(): boolean {
    return true;
  }

  /** The Scubapro tissues (see SCUBAPRO_OFFGAS), with the gradient factor shifts of ADT MB. */
  tissueVariant(): TissueVariant {
    // Before the first dive, or after a change of algorithm at the surface (Luna, G3).
    if (!this.variant || !!this.variant.gfShift !== this.adt) {
      this.variant = { offgas: SCUBAPRO_OFFGAS, gfShift: this.adt ? ADT_GF_SHIFT.map((g, i) => g + (i < REPETITIVE_FAST ? this.repetitivePenalty : 0)) : undefined };
    }
    return this.variant;
  }

  /** Parameters of the extra stops of the chosen stage; null when there is none (L0, 100/100). */
  stageParams(): DecoParams | null {
    return this.activeLevel > 0 ? levelParams(this.activeLevel, this.stageDeco) : null;
  }

  /** The stage chosen before the dive (from the settings). */
  protected resetStage(): void {
    this.activeLevel = Number(this.settings.level);
  }

  /** Stops of the stage ignored by more than 1.5 m: the MB level is reduced to the next possible one (Luna §3.9.16). */
  protected relaxStage(s: DiveSession): void {
    let l = this.activeLevel - 1;
    while (l > 0 && ceilingDepth(s.tissues, 0, levelParams(l, this.stageDeco)) > s.depth + 1.5) l--;
    this.activeLevel = l;
  }

  /** Pressure (bar) of the tank pressure / half tank warning, null when it is off. */
  tankWarnPressure(): number | null {
    return null;
  }

  /** PDIS is offered (setting on). */
  protected pdisEnabled(): boolean {
    return this.settings.pdis === 'on';
  }

  /**
   * RBT (G2 manual §2.8.3; Luna 2.0 AI §3.10.4, the reserve defining the empty tank): time at the current depth that still leaves enough gas for a safe ascent at the ideal ascent
   * rate, including decompression, reaching the surface with the tank reserve.
   */
  gasTime(s: DiveSession, p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: idealAscent, deco: p, anchor: this.anchor,
    });
  }

  onDiveStart(s: DiveSession): void {
    // Repetitive dive (ADT MB): penalty set from the residual gas of the Scubapro tissues at the start.
    this.repetitivePenalty = this.adt ? REPETITIVE_PENALTY * residualGas(s.tissues) : 0;
    this.variant = {
      offgas: SCUBAPRO_OFFGAS,
      gfShift: this.adt ? ADT_GF_SHIFT.map((g, i) => g + (i < REPETITIVE_FAST ? this.repetitivePenalty : 0)) : undefined,
    };
    // ZH-L16C+GF: repetitive dive with the faster compartments raised to the load of the slowest one.
    if (!this.adt) liftToSlowestLoaded(s.tissues);
    this.baseDeco = this.stageDeco = false;
    super.onDiveStart(s);
    this.resetStage();
    this.levelAnchor = 0;
    this.pdisState = 'none';
    this.pdisDepth = 0;
    this.pdisRemaining = 120;
    this.screen = 0;
    this.sosSec = 0;
  }

  /**
   * SOS mode (G2 manual §1.6, Luna 2.0 AI §3.11): above 0.8 m for more than 3 minutes without observing a mandatory decompression stop,
   * the computer locks for 24 hours (then dives in Gauge mode, no decompression information). The
   * dive closes after 3 minutes at the surface, so an obligation still pending then also locks.
   */
  onDiveEnd(s: DiveSession): void {
    // The repetitive-dive penalty lasts for the dive (set again at the next one from the residual gas).
    this.repetitivePenalty = 0;
    this.variant = null;
    super.onDiveEnd(s);
    if (this.sosSec > 0 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    // ADT MB: once the no-stop time of L0 (or of the MB level) is used up, its stops are computed with
    // the deco gradient factor until the end of the dive (see ADT_DECO_GF).
    if (s.inDive && this.adt) {
      if (!this.baseDeco && !s.tissues.tolerates(SURFACE_PRESSURE, levelParams(0, false).gfHigh)) this.baseDeco = true;
      if (!this.stageDeco && this.activeLevel > 0 && !s.tissues.tolerates(SURFACE_PRESSURE, levelParams(this.activeLevel, false).gfHigh)) this.stageDeco = true;
    }
    super.tick(s, dt);
    if (!s.inDive) {
      this.resetStage();
      return;
    }
    if (s.depth < 0.8 && !s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) {
      this.sosSec += dt;
      if (this.sosSec > 180) this.lock(s);
    } else {
      this.sosSec = 0;
    }
    const lp = this.stageParams();
    if (lp) {
      this.levelAnchor = updateAnchor(this.levelAnchor, s.tissues, lp);
      const lc = ceilingDepth(s.tissues, this.levelAnchor, lp);
      const deepestStop = stopDepthFor(lc, lp);
      if (deepestStop > 0 && s.depth < deepestStop - 1.5) {
        this.relaxStage(s);
        this.levelAnchor = 0;
        this.levelReducedAt = s.clock;
      }
    }
    this.tickPdis(s, dt);
  }

  /** PDIS (G2 manual, Luna 2.0 AI §3.15): 2-minute stop within 3 m above the depth where the leading compartment starts off-gassing. */
  protected tickPdis(s: DiveSession, dt: number): void {
    if (!this.pdisEnabled() || this.pdisState === 'ok' || this.pdisState === 'no') return;
    if (this.pdisState !== 'active') {
      const d = this.computePdis(s);
      this.pdisDepth = d;
      this.pdisState = d > 8 ? 'shown' : 'none';
    }
    if (this.pdisState === 'none') return;
    const d = this.pdisDepth;
    if (s.depth <= d && s.depth >= d - 3) {
      this.pdisState = 'active';
      this.pdisRemaining -= dt;
      if (this.pdisRemaining <= 0) this.pdisState = 'ok';
    } else if (s.depth > d + 0.5) {
      this.pdisState = 'shown';
      this.pdisRemaining = 120;
    } else if (s.depth < d - 3 && this.pdisState === 'active') {
      this.pdisState = 'no';
    }
  }

  protected computePdis(s: DiveSession): number {
    // The 4 fastest compartments are not considered.
    const g = s.tissues.gradientPercents(1.01325);
    let lead = 4;
    for (let i = 5; i < COMPARTMENTS; i++) if (g[i] > g[lead]) lead = i;
    const d = equilibriumDepth(s.tissues, lead, s.gas);
    return d > 8 && d < s.maxDepth ? Math.round(d) : 0;
  }

  /** Label of the active stage for the comparison table ("L3", "GF 30/70"…), or null. */
  protected stageLabel(): string | null {
    return this.activeLevel > 0 ? `L${this.activeLevel}` : null;
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const b = super.summary(v);
    const label = this.stageLabel();
    return label ? { ...b, ndl: `${b.ndl} (${label})` } : b;
  }
}

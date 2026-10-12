import { ceilingDepth, type DecoParams, ndl, planAscent, pressureToDepth } from '../../../engine/buhlmann';
import { GasPrompt } from '../../common/gasSwitch';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, type AlertExplain, type Bi, ComputerView, SettingDef } from '../../base';
import { IDEAL, SOS } from '../alerts';
import { ScubaproRules, idealAscent, levelParams, reserveSetting } from '../common';
import { pressureSetting, pressureValue } from '../../common/tank';
import { ppo2Setting } from '../../common/ppo2';

/**
 * §2.5 / §3.6 warnings (yellow pop-up), in the manual's order (§2.5 table: 5.1 to 5.13; the level
 * warnings depend on the algorithm, MB with ZH-L16D ADT MB PMG, GF with ZH-L16C+GF PMG).
 */
export type G3Warning =
  | 'depth' | 'cns75' | 'nostop' | 'deco' | 'time' | 'turn' | 'tank' | 'rbt3'
  | 'levelStops' | 'levelIgnored' | 'levelChanged' | 'baseNostop' | 'baseDeco' | 'rbt0';
const WARNING_ORDER: G3Warning[] = ['depth', 'cns75', 'nostop', 'deco', 'time', 'turn', 'tank', 'rbt3', 'levelStops', 'levelIgnored', 'levelChanged', 'baseNostop', 'baseDeco', 'rbt0'];
/**
 * Warnings shown while their condition lasts (§3.6.3: CNS O2 75 % "jusqu'à ce que la valeur revienne
 * au-dessous de 75 %"; no-stop and RBT counters, level stop ignored: deduced, as on the G2); the
 * others are events, shown for 12 s like NO PRESSURE SIGNAL (§3.6.9, the only duration the manual
 * gives: assumed for all).
 */
const LASTING: G3Warning[] = ['cns75', 'nostop', 'rbt3', 'levelIgnored', 'baseNostop', 'rbt0'];
export const WARNING_SECONDS = 12;

/** §2.5: "Both, audible, visual, off" (figures). */
function warnSetting(key: string, fr: string, en: string, def: 'both' | 'audible' | 'visual' | 'off', showIf?: (s: Record<string, string>) => boolean): SettingDef {
  return {
    key,
    label: { fr, en },
    options: [{ value: 'both', label: 'Both' }, { value: 'audible', label: 'Audible' }, { value: 'visual', label: 'Visual' }, { value: 'off', label: 'Off' }],
    default: def,
    showIf,
  };
}
const on = (key: string) => (s: Record<string, string>) => s[key] !== 'off';
const isAdt = (s: Record<string, string>) => s.algo !== 'gf';
const isGf = (s: Record<string, string>) => s.algo === 'gf';

/**
 * §2.5 Warning settings. Factory values are not given in the text: those of the §2.5 figures are used
 * (for the maximum depth, the first figure shows "Off", then "Visual" once changed; the dive time and
 * tank pressure figures show "Visual" with 60 min and 100 bar).
 */
const G3_WARNING_SETTINGS: SettingDef[] = [
  warnSetting('wDepth', 'Avertissement de profondeur max (5.1)', 'Maximum depth warning (5.1)', 'off'),
  // §2.5.1: "entre 5 et 100 mètres (20 à 330 pieds), par incréments de 1 m" (5 m steps offered); 40.0 m on the figure.
  { key: 'wDepthM', label: { fr: 'Profondeur de l’avertissement', en: 'Warning depth' }, options: Array.from({ length: 20 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` })), default: '40', showIf: on('wDepth') },
  warnSetting('wCns', 'Avertissement CNS O2 = 75 % (5.2)', 'CNS O2 = 75% warning (5.2)', 'off'),
  warnSetting('wNostop', 'Avertissement no-stop = 2 min (5.3)', 'No-stop = 2 min warning (5.3)', 'off'),
  warnSetting('wDeco', 'Avertissement d’entrée en déco (5.4)', 'Entering deco warning (5.4)', 'off'),
  warnSetting('wTime', 'Avertissement de durée de plongée (5.5)', 'Dive time warning (5.5)', 'visual'),
  // §2.5.5: "entre 5 et 995 minutes, par incréments de 1 minute" (5 min steps up to 180 offered); 60 min on the figure.
  { key: 'wTimeMin', label: { fr: 'Durée de l’avertissement', en: 'Warning time' }, options: Array.from({ length: 36 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} min` })), default: '60', showIf: on('wTime') },
  // §2.5.6: "de 50 à 200 bars"; Visual, 100 bar on the figure.
  warnSetting('tankWarn', 'Avertissement de pression du bloc (5.6)', 'Tank pressure warning (5.6)', 'visual'),
  { ...pressureSetting('tankWarnP', { fr: 'Pression de l’avertissement', en: 'Warning pressure' }, 50, 200, 10, 100), showIf: on('tankWarn') },
  warnSetting('wRbt', 'Avertissement RBT = 3 min (5.7)', 'RBT = 3 min warning (5.7)', 'both'),
  // §2.5.8 Pressure signal (Both on the figure): the transmitter signal is never lost in the simulator.
  warnSetting('wLevelStops', 'Avertissement d’entrée en paliers MB (5.9)', 'Entering level stops warning (5.9)', 'off', isAdt),
  warnSetting('wGfStops', 'Avertissement d’entrée en paliers GF (5.9)', 'Entering GF stops warning (5.9)', 'off', isGf),
  warnSetting('wMbIgnored', 'Avertissement de palier MB ignoré (5.10)', 'MB stop ignored warning (5.10)', 'both', isAdt),
  warnSetting('wGfIgnored', 'Avertissement de palier GF ignoré (5.10)', 'GF stop ignored warning (5.10)', 'both', isGf),
  warnSetting('wMbReduced', 'Avertissement de niveau MB réduit (5.11)', 'MB level reduced warning (5.11)', 'both', isAdt),
  warnSetting('wGfIncreased', 'Avertissement de GF augmenté (5.11)', 'GF increased warning (5.11)', 'both', isGf),
  warnSetting('wL0Nostop', 'Avertissement no-stop L0 = 2 min (5.12)', 'L0 no-stop = 2 min warning (5.12)', 'off', isAdt),
  warnSetting('w100Nostop', 'Avertissement no-stop 100/100 = 2 min (5.12)', '100/100 no-stop = 2 min warning (5.12)', 'off', isGf),
  warnSetting('wL0Deco', 'Avertissement d’entrée en déco à L0 (5.13)', 'Entering deco at L0 warning (5.13)', 'off', isAdt),
  warnSetting('w100Deco', 'Avertissement d’entrée en déco 100/100 (5.13)', 'Enter 100/100 deco warning (5.13)', 'off', isGf),
];

/** Setting behind each warning (the level warnings: the one of the algorithm in use). */
function warningKey(k: G3Warning, gf: boolean): string {
  switch (k) {
    case 'depth': return 'wDepth';
    case 'cns75': return 'wCns';
    case 'nostop': return 'wNostop';
    case 'deco': return 'wDeco';
    case 'time': case 'turn': return 'wTime';
    case 'tank': return 'tankWarn';
    case 'rbt3': return 'wRbt';
    case 'levelStops': return gf ? 'wGfStops' : 'wLevelStops';
    case 'levelIgnored': return gf ? 'wGfIgnored' : 'wMbIgnored';
    case 'levelChanged': return gf ? 'wGfIncreased' : 'wMbReduced';
    case 'baseNostop': return gf ? 'w100Nostop' : 'wL0Nostop';
    case 'baseDeco': return gf ? 'w100Deco' : 'wL0Deco';
    case 'rbt0': return 'rbt0';
  }
}

/** No-stop time and first stop of the active level (MB level above L0, or GF other than 100/100). */
export interface LevelInfo {
  ndl: number;
  stop: { depth: number; min: number } | null;
  tat: number;
}

/** §2.2.1: "le FG bas peut être réglé de 5 à 100, et le FG haut de 50 à 100" (5 steps offered). */
const GF_LOW = Array.from({ length: 20 }, (_, i) => String(5 + i * 5));
const GF_HIGH = Array.from({ length: 11 }, (_, i) => String(50 + i * 5));

/**
 * Scubapro Galileo 3 (G3), Scuba mode. Rules follow the Galileo 3 user manual (French edition,
 * 2023, whose figures show the English screens): choice of algorithm (§2.2.8), MB levels or gradient
 * factors (§2.2.1, §3.9, §3.10), Light / Classic screens (§3.8.1), §3.6 warnings and §3.7 alarms,
 * ideal ascent rate table (§3.7.1), safety stop timer (§2.2.3, §3.8.4), PDIS (§3.11), PMG (§3.5.2),
 * SOS (§1.11). ZH-L16D ADT MB has unpublished adjustments: approximated; ZH-L16C+GF is reproduced.
 */
export abstract class G3Rules extends ScubaproRules {
  readonly id = 'g3';
  readonly name = 'Scubapro G3';
  readonly transmitter = 'Smart';
  readonly gasTimeName = 'RBT';

  /** §2.2.8: ZH-L16D ADT MB PMG (factory) or ZH-L16C+GF PMG. */
  get algorithm(): string {
    return this.gfMode ? 'ZH-L16C + GF' : 'ZH-L16D ADT MB (≈)';
  }

  get exact(): boolean {
    return this.gfMode;
  }

  get notes(): { fr: string; en: string } {
    return {
      fr: 'Deux algorithmes (§2.2.8) : ZH-L16D ADT MB PMG d’usine (ajustements non publiés : approximation, niveaux MB L0 à L9, PDIS) ou ZH-L16C+GF PMG (Bühlmann avec gradient factors : reproduit ; comme sur le Luna, la décompression obligatoire est celle de 100/100 et les paliers GF s’y ajoutent ; ignorés de plus de 1,5 m, les GF augmentent de 10 (bas) et 5 (haut), §2.5.14). Écran Light d’usine (Classic automatique dès qu’il y a des paliers) ou Classic (§3.8.1) ; les fenêtres d’informations défilent avec les flèches dans l’ordre du tableau du §3.8.1.2. Vitesse de remontée idéale selon la profondeur (jaune au-delà de 110 %, REMONTÉE TROP RAPIDE au-delà de 140 %) ; palier de sécurité de 3 min dès 5 m après 10 m (automatique, manuel ou désactivé, §2.2.3) ; PALIER DÉCO IGNORÉ 0,5 m au-dessus du palier ; SOS 24 h (§1.11). Boutons (§3.2) : en haut à gauche rétroéclairage (appui long : boussole, non simulée) ; en bas à gauche BOOK : repère, relance du palier de sécurité ou remise à zéro du chronomètre affiché (appui long : changement de gaz PMG) ; flèches à droite : fenêtre d’informations suivante / précédente (appui long : résumé des gaz, résumé de déco, profil, saturation). Avertissements du §3.6 en Off / Visual / Audible / Both, valeurs par défaut des figures du §2.5 (texte muet) ; RBT = 0 min en alarme d’usine (§2.6.2.2). Multigaz PMG (§3.5.2, désactivé d’usine supposé) : jusqu’à 8 gaz ; SWITCH TO GAS T2 au MOD pendant la remontée, SAVE confirme, flèche : autre gaz ; sans réponse en 30 s, EXCLUDING GAS T2. Non simulés : fréquence cardiaque, température cutanée, effort, altitude, eau douce, paliers superficiels (§2.2.9), Trimix, Sidemount, CCR, profondimètre, apnée, boussole, images, batterie (valeur fictive), perte du signal de l’émetteur, couleur d’affichage (vert).',
      en: 'Two algorithms (§2.2.8): ZH-L16D ADT MB PMG from the factory (unpublished adjustments: approximation, MB levels L0 to L9, PDIS) or ZH-L16C+GF PMG (Bühlmann with gradient factors: reproduced; as on the Luna, the mandatory decompression is the 100/100 one and the GF stops come on top of it; ignored by more than 1.5 m, the GF rise by 10 (low) and 5 (high), §2.5.14). Light screen from the factory (Classic automatically once stops are needed) or Classic (§3.8.1); the information windows scroll with the arrows in the order of the §3.8.1.2 table. Depth-dependent ideal ascent rate (yellow above 110 %, ASCENT TOO FAST above 140 %); 3-min safety stop from 5 m after 10 m (automatic, manual or off, §2.2.3); MISSED DECO STOP 0.5 m above the stop; 24 h SOS (§1.11). Buttons (§3.2): upper left backlight (hold: compass, not simulated); lower left BOOK: bookmark, safety stop restart or reset of the stopwatch on display (hold: PMG gas switch); right arrows: next / previous information window (hold: gas summary, deco summary, profile, saturation). §3.6 warnings set to Off / Visual / Audible / Both, defaults of the §2.5 figures (the text gives none); RBT = 0 min is an alarm from the factory (§2.6.2.2). PMG multi-gas (§3.5.2, off from the factory assumed): up to 8 gases; SWITCH TO GAS T2 at the MOD during the ascent, SAVE confirms, arrow: another gas; no answer within 30 s: EXCLUDING GAS T2. Not simulated: heart rate, skin temperature, workload, altitude, fresh water, shallow stops (§2.2.9), Trimix, Sidemount, CCR, gauge, apnea, compass, pictures, battery (fictitious value), transmitter signal loss, display colour (green).',
    };
  }

  readonly settingDefs: SettingDef[] = [
    {
      // §2.2.8: "Le Galileo 3 est réglé en usine sur l'algorithme ZH-L16D ADT MB PMG" (changing it needs the code 313).
      key: 'algo',
      label: { fr: 'Algorithme (Algo. deco, 2.8)', en: 'Algorithm (Deco algorithm, 2.8)' },
      options: [
        { value: 'adt', label: 'ZH-L16D ADT MB PMG' },
        { value: 'gf', label: 'ZH-L16C+GF PMG' },
      ],
      default: 'adt',
    },
    {
      // §2.2.1: "MB level: L0..L9" (figure: L0).
      key: 'level',
      label: { fr: 'Niveau MB (2.1)', en: 'MB level (2.1)' },
      options: Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: `L${i}` })),
      default: '0',
      showIf: isAdt,
    },
    // §2.2.1: GF low 5..100, GF high 50..100; 30/70 on the figure.
    { key: 'gfLow', label: { fr: 'GF bas (GF level, 2.1)', en: 'GF low (GF level, 2.1)' }, options: GF_LOW.map((v) => ({ value: v, label: v })), default: '30', showIf: isGf },
    { key: 'gfHigh', label: { fr: 'GF haut (GF level, 2.1)', en: 'GF high (GF level, 2.1)' }, options: GF_HIGH.map((v) => ({ value: v, label: v })), default: '70', showIf: isGf },
    {
      // §2.2.16 PDIS (default not given: on assumed, as on the G2).
      key: 'pdis',
      label: { fr: 'PDIS (2.16)', en: 'PDIS (2.16)' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    {
      // §2.7.1 / §3.8.1.1: "La configuration d'écran Light est proposée par défaut."
      key: 'screen',
      essential: true,
      label: { fr: 'Format écran (7.1)', en: 'Screen configuration (7.1)' },
      options: [
        { value: 'light', label: 'Light' },
        { value: 'classic', label: 'Classic' },
      ],
      default: 'light',
    },
    {
      // §2.2.3 figure: "Timer: autom., manual, off", "Duration: 3 min" (other durations not shown).
      key: 'ssTimer',
      label: { fr: 'Palier de sécurité (Safety stop timer, 2.3)', en: 'Safety stop timer (2.3)' },
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'manual', label: 'Manual' },
        { value: 'off', label: 'Off' },
      ],
      default: 'auto',
    },
    {
      // §2.2.12: "Avec les réglages d'usine, le mode de désactivation des sons est désactivé."
      key: 'sound',
      label: { fr: 'Son (All-silent mode, 2.12)', en: 'Sound (All-silent mode, 2.12)' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'on',
    },
    // §2.1.1: "Le paramètre d'usine est de 1,40 bar"; §2.2.4 figure: "ppO2max: 1.2..1.6bar, off" (off not offered).
    ppo2Setting(1.2, 1.6, 1.4, 'PPO2max'),
    {
      // §2.2.17 PMG: "jusqu'à 8 bouteilles"; §2.1.1: one-tank diving is the factory setting (off assumed).
      key: 'pmg',
      label: { fr: 'Multigaz PMG (2.17)', en: 'PMG multi-gas (2.17)' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §2.1.2: "Vous pouvez indiquer une valeur de ppO2 différente pour les gaz de décompression"
      // (value not given: 1.6 bar assumed); §3.5.2: fixed at 1.6 bar from 80 % O2.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max gaz de déco', en: 'Deco gas ppO2max' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
      showIf: (s) => s.pmg === 'on',
    },
    ...G3_WARNING_SETTINGS,
    // §2.6.2.1: "Tank reserve: 20..120bar" (40 bar on the figure; 50 bar as on the other Scubapro).
    reserveSetting,
    {
      // §2.6.2.2 figure: "RBT = 0min: alarm, warning", Alarm shown.
      key: 'rbt0',
      label: { fr: 'RBT = 0 min (6.2.2)', en: 'RBT = 0 min (6.2.2)' },
      options: [{ value: 'alarm', label: 'Alarm' }, { value: 'warning', label: 'Warning' }],
      default: 'alarm',
    },
  ];

  constructor() {
    super();
    // §3.8.4: after 10 m, the countdown starts at 5 m; it disappears below 6.5 m and starts again at 5 m.
    this.safetyStop = { trigger: 10, start: 5, top: 2, bottom: 6.5, reset: 6.5 };
    this.ceilingMargin = 0.5; // §3.7.6: MISSED DECO STOP more than 0.5 m above the stop
    this.stopWindow = 1.5;
    // §3.8: "Le temps restant sans palier maximal affiché est de 99 minutes", but the figures of §3.6
    // and §3.7 show 199: and 149: (the figures are followed).
    this.ndlCap = 199;
    this.screenTimeout = 0;
    this.init();
  }

  get gfMode(): boolean {
    return this.settings.algo === 'gf';
  }

  /** The mandatory decompression: L0 (ADT MB) or ZH-L16C 100/100 (GF, §3.6.19). */
  baseParams(): DecoParams {
    return this.gfMode ? { gfLow: 1, gfHigh: 1, lastStop: 3, stopStep: 3, ascentRate: 10 } : levelParams(0);
  }

  /** GF values in force during the dive (increased when GF stops are ignored, §2.5.14). */
  activeGf: [number, number] = [30, 70];

  stageParams(): DecoParams | null {
    if (!this.gfMode) return this.activeLevel > 0 ? levelParams(this.activeLevel) : null;
    const [lo, hi] = this.activeGf;
    return lo >= 100 && hi >= 100 ? null : { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  protected resetStage(): void {
    this.activeLevel = this.gfMode ? 0 : Number(this.settings.level);
    const hi = Number(this.settings.gfHigh) || 70;
    this.activeGf = [Math.min(Number(this.settings.gfLow) || 30, hi), hi];
  }

  /**
   * §2.5.14: "le Galileo 3 augmente vos réglages de FG bas et haut jusqu'au niveau possible suivant,
   * par incréments de 10 pour le FG bas et de 5 pour le FG haut" (repeated until the diver is no
   * longer more than 1.5 m above that stage's stop: deduced from "niveau possible").
   */
  protected relaxStage(s: DiveSession): void {
    if (!this.gfMode) {
      super.relaxStage(s);
      return;
    }
    let [lo, hi] = this.activeGf;
    do {
      lo = Math.min(100, lo + 10);
      hi = Math.min(100, hi + 5);
    } while ((lo < 100 || hi < 100) && ceilingDepth(s.tissues, 0, { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 }) > s.depth + 1.5);
    this.activeGf = [lo, hi];
  }

  protected stageLabel(): string | null {
    if (this.gfMode) return this.stageParams() ? `GF ${this.activeGf.join('/')}` : null;
    return super.stageLabel();
  }

  /** The active level is more conservative than the base one (MB level > L0, GF other than 100/100). */
  get hasStage(): boolean {
    return this.stageParams() !== null;
  }

  /** The active level differs from the one set before the dive (reduced MB level, increased GF). */
  get stageChanged(): boolean {
    if (!this.gfMode) return this.activeLevel !== Number(this.settings.level);
    const hi = Number(this.settings.gfHigh) || 70;
    return this.activeGf[0] !== Math.min(Number(this.settings.gfLow) || 30, hi) || this.activeGf[1] !== hi;
  }

  /** §3.5.2: up to 8 gases once PMG is enabled (§2.2.17). */
  get maxGases(): number {
    return this.settings.pmg === 'on' ? 8 : 1;
  }

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §3.5.2: "La MOD des gaz 2 à 8 est la profondeur de passage de ces gaz"; 1.6 bar from 80 % O2. */
  decoMod(o2: number): number {
    return Math.max(0, pressureToDepth((o2 >= 0.8 ? 1.6 : this.decoPpo2()) / o2));
  }

  /** §3.5.2.3: a gas whose switch was not confirmed within 30 s leaves the calculation. */
  planGases(s: DiveSession) {
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** Only T1 has a Smart transmitter here (figure of §3.5.2.1: "TANK2 BAR NO P"). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** §3.5.2.1: SWITCH TO GAS T2 at its MOD during the ascent, 30 s to answer. */
  prompt = new GasPrompt(true);
  /** Gas just excluded (EXCLUDING GAS T2 in the pop-up), and when. */
  excluded: { gas: number; at: number } | null = null;

  /** §2.2.3 "Manual": the countdown only runs once started with BOOK (§3.8.4 note). */
  private ssArmed = false;

  get hasSafetyStop(): boolean {
    return this.settings.ssTimer === 'auto' || (this.settings.ssTimer === 'manual' && this.ssArmed);
  }

  /**
   * §3.8.4 note: "si la profondeur maximale de votre plongée n'a pas dépassé 10 m, vous pouvez encore
   * activer le compte à rebours de palier de sécurité en appuyant sur le bouton TIMER" (also the
   * Manual mode, deduced). Returns true when the countdown was started.
   */
  protected startSafetyStop(s: DiveSession): boolean {
    if (this.settings.ssTimer === 'off' || this.safetyState !== 'none' || s.depth > this.safetyStop.bottom) return false;
    this.ssArmed = true;
    this.safetyState = 'pending';
    this.safetyRemaining = this.safetyTotal = this.safetySeconds(s);
    return true;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    // A manual countdown is not restarted by the base rules once it is over.
    if (!this.hasSafetyStop && this.safetyState !== 'done') this.safetyState = 'none';
    if (!s.inDive || this.locked || this.maxGases < 2) return;
    // §3.5.2.1: "Vous avez 30 secondes pour répondre à ce message, faute de quoi [...] GAZ T2 EXCLU".
    const { expired } = this.prompt.update(s, this.gasMods(s), 30);
    if (expired !== null) this.excluded = { gas: expired, at: s.clock };
  }

  /** §3.7.1: yellow above 110 % of the ideal rate, ASCENT TOO FAST above 140 %. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const pct = rate / idealAscent(depth);
    return pct > 1.4 ? 2 : pct > 1.1 ? 1 : 0;
  }

  /** §2.5.6: pressure of the tank pressure warning (null when set to OFF). */
  tankWarnPressure(): number | null {
    return this.settings.tankWarn === 'off' ? null : pressureValue(this.settings, 'tankWarnP');
  }

  /** RBT = 0 min is an alarm (§3.7.7, factory setting) rather than a warning. */
  get rbt0Alarm(): boolean {
    return this.settings.rbt0 !== 'warning';
  }

  /** No-stop time and stops at the active level (the base algorithm's without one). */
  levelInfo(v: ComputerView, s: DiveSession): LevelInfo {
    const info: LevelInfo = { ndl: v.ndl, stop: null, tat: v.tts };
    const sp = v.inDive ? this.stageParams() : null;
    if (sp && !v.inDeco) {
      const lp = { ...sp, gases: this.planGases(s) };
      info.ndl = ndl(s.tissues, v.depth, s.gas, lp.gfHigh);
      if (info.ndl === 0) {
        const lplan = planAscent(s.tissues, v.depth, s.gas, lp, this.levelAnchor);
        if (lplan.stops[0]) info.stop = { depth: lplan.stops[0].depth, min: Math.ceil(lplan.stops[0].minutes) };
        info.tat = lplan.tts;
      }
    }
    return info;
  }

  /** Clock (s) at which each warning's condition started, while it lasts. */
  private warnSince = new Map<G3Warning, number>();
  /** Warnings whose condition holds now (for the sounds), with the clock at which each started. */
  private activeWarnings: [G3Warning, number][] = [];

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.warnSince.clear();
    this.activeWarnings = [];
    this.prompt.reset();
    this.excluded = null;
    this.ssArmed = false;
  }

  /** Conditions of the §3.6 warnings switched on, from the view and the level information. */
  private warningConditions(v: ComputerView, lv: LevelInfo, s: DiveSession): G3Warning[] {
    if (!v.inDive || v.locked) return [];
    const set = (k: G3Warning) => k === 'rbt0' ? !this.rbt0Alarm : this.settings[warningKey(k, this.gfMode)] !== 'off';
    const c: G3Warning[] = [];
    const stage = this.hasStage;
    if (set('depth') && v.depth >= Number(this.settings.wDepthM)) c.push('depth');
    if (set('cns75') && v.cns >= 75 && v.cns < 100) c.push('cns75');
    // §3.6.4: "Cela s'applique à la fois aux temps sans palier de L0 et de MB/FG" (the one on display).
    if (set('nostop') && !v.inDeco && !lv.stop && lv.ndl <= 2 && lv.ndl > 0) c.push('nostop');
    // §3.6.5: "lorsque le premier palier de décompression devient obligatoire".
    if (set('deco') && v.inDeco) c.push('deco');
    const min = v.diveTime / 60;
    const limit = Number(this.settings.wTimeMin);
    if (set('time') && min >= limit) c.push('time');
    else if (set('turn') && min >= limit / 2) c.push('turn'); // §3.6.6: "la moitié du temps de l'avertissement"
    const warnP = this.tankWarnPressure();
    if (v.tank.ai && warnP !== null && v.tank.pressure <= warnP) c.push('tank');
    if (set('rbt3') && v.tank.ai && v.tank.gasTime !== null && v.tank.gasTime <= 3 && v.tank.gasTime > 0) c.push('rbt3');
    // §3.6.10 / §3.6.11: no longer in the no-stop phase of the active level.
    if (set('levelStops') && stage && lv.stop) c.push('levelStops');
    // §3.6.12 / §3.6.13: "une profondeur plus faible que le palier de niveau le plus profond qui soit requis".
    if (set('levelIgnored') && stage && lv.stop && v.depth < lv.stop.depth - 0.1) c.push('levelIgnored');
    if (set('levelChanged') && s.clock - this.levelReducedAt < WARNING_SECONDS) c.push('levelChanged');
    // §3.6.16 to §3.6.19: the underlying L0 (100/100) no-stop time and deco, with an active level.
    if (set('baseNostop') && stage && !v.inDeco && v.ndl <= 2 && v.ndl > 0) c.push('baseNostop');
    if (set('baseDeco') && stage && v.inDeco) c.push('baseDeco');
    // §2.6.2.2: RBT = 0 min set as a warning.
    if (set('rbt0') && v.tank.ai && v.tank.gasTime === 0) c.push('rbt0');
    return c;
  }

  /**
   * Updates the warnings from the view (called when the screen is drawn) and returns those shown in
   * the pop-up (VISUAL or BOTH), in the manual's order.
   */
  updateWarnings(v: ComputerView, lv: LevelInfo, s: DiveSession): G3Warning[] {
    const now = new Set(this.warningConditions(v, lv, s));
    for (const k of [...this.warnSince.keys()]) if (!now.has(k)) this.warnSince.delete(k);
    for (const k of now) if (!this.warnSince.has(k)) this.warnSince.set(k, s.clock);
    this.activeWarnings = WARNING_ORDER.filter((k) => now.has(k)).map((k) => [k, this.warnSince.get(k)!]);
    return this.activeWarnings
      .filter(([k, since]) => LASTING.includes(k) || s.clock - since < WARNING_SECONDS)
      .filter(([k]) => k === 'rbt0' || ['visual', 'both'].includes(this.settings[warningKey(k, this.gfMode)]))
      .map(([k]) => k);
  }

  /** Pop-up texts of the §3.6 warnings, as on the figures ("ENTERING DECO" and the others: §3.6 figures). */
  warningText(k: G3Warning, tankText: string): string {
    const gf = this.gfMode;
    switch (k) {
      case 'depth': return 'MAX DEPTH REACHED'; // no figure: the G2 wording (deduced)
      case 'cns75': return 'CNS O2 = 75%'; // no figure: the G2 wording (deduced)
      case 'nostop': return 'NO STOP = 2 MINUTES';
      case 'deco': return 'ENTERING DECO';
      case 'time': return 'TIME LIMIT REACHED';
      case 'turn': return 'TURN-AROUND TIME';
      case 'tank': return `${tankText} REACHED`; // §3.6.7 figure: "135BAR REACHED"
      case 'rbt3': return 'RBT = 3 MINUTES';
      case 'levelStops': return gf ? 'ENTERING GF STOPS' : 'ENTERING LEVEL STOPS';
      case 'levelIgnored': return gf ? 'GF STOP IGNORED' : 'MB STOP IGNORED';
      case 'levelChanged': return gf ? 'GF INCREASED' : 'MB LEVEL REDUCED';
      case 'baseNostop': return gf ? '100/100 ND = 2MIN' : 'L0 NO-STOP = 2MIN';
      case 'baseDeco': return gf ? 'ENTER 100/100 DECO' : 'ENTERING DECO AT L0';
      case 'rbt0': return 'RBT = 0 MINUTES';
    }
  }

  /**
   * Alert bubble (app/alertHelp.ts): §3.7 alarms (red pop-up), §3.6 warnings (yellow pop-up, OFF /
   * VISUAL / AUDIBLE / BOTH), §1.11 SOS, §3.5.2 gas switch. `msg:` keys: the pop-up on display (see
   * screenAlerts), the others the alert cues.
   */
  alertExplain(key: string): AlertExplain | null {
    const msg = key.startsWith('msg:') ? key.slice(4) : null;
    const w = key.startsWith('w-') ? key.split('-')[1] : null;
    const warn = (fr: string, en: string): Bi => ({ fr: `${fr} Avertissement (bandeau jaune 12 s, fenêtre concernée en jaune), réglable sur OFF, VISUAL, AUDIBLE ou BOTH.`, en: `${en} Warning (yellow pop-up for 12 s, related window in yellow), settable to OFF, VISUAL, AUDIBLE or BOTH.` });
    const gf = this.gfMode;
    // §3.7.1: the 'ascent' cue also beeps below the alarm (yellow, > 110 %): only the red pop-up is explained here.
    if (msg === 'ASCENT TOO FAST!') {
      return { screen: 'ASCENT TOO FAST!', code: 'ASCENT', what: { fr: `La fenêtre SPEED % donne la vitesse en % de la vitesse idéale : jaune au-delà de 110 %, alarme rouge au-delà de 140 % ; les bips augmentent avec l’excès (§3.7.1). ${IDEAL.fr}`, en: `The SPEED % window gives the rate as a % of the ideal rate: yellow beyond 110 %, red alarm beyond 140 %; the beeps grow with the excess (§3.7.1). ${IDEAL.en}` } };
    }
    if (key === 'missed-stop' || msg === 'MISSED DECO STOP!') {
      return { id: 'missed-stop', screen: 'MISSED DECO STOP!', code: 'CEILING', what: { fr: `Alarme rouge et série de bips à 0,5 m ou plus au-dessus du palier (§3.7.6). ${SOS.fr}`, en: `Red alarm and a series of beeps 0.5 m or more above the stop (§3.7.6). ${SOS.en}` } };
    }
    if (key === 'LOCKED') return { screen: 'SOS', what: SOS };
    if (key === 'mod' || msg === 'MOD EXCEEDED') return { id: 'mod', screen: 'MOD EXCEEDED', code: 'PPO2_HIGH', what: { fr: 'Alarme rouge : la profondeur devient rouge et clignote, la MOD s’affiche dans une fenêtre secondaire ; bip continu tant que vous êtes sous la MOD (§3.7.2).', en: 'Red alarm: the depth turns red and flashes, the MOD shows in a secondary window; continuous beep while you are below the MOD (§3.7.2).' } };
    if (key === 'cns' || msg === 'CNS O2 = 100%!') return { id: 'cns', screen: 'CNS O2 = 100%!', code: 'CNS', what: { fr: 'Alarme rouge : bips pendant 12 s, puis 5 s chaque minute ; la valeur du CNS devient rouge (§3.7.4).', en: 'Red alarm: beeps for 12 s, then 5 s every minute; the CNS value turns red (§3.7.4).' }, todo: { fr: 'Terminez la plongée.', en: 'End the dive.' } };
    if (key === 'reserve' || msg === 'TANK RESERVE REACHED') return { id: 'reserve', screen: 'TANK RESERVE REACHED', code: 'LOW_GAS', what: { fr: 'Alarme rouge : la pression atteint la réserve réglée (de 20 à 120 bar, 50 bar ici), qui est aussi le « bloc vide » du calcul du RBT (§3.7.5).', en: 'Red alarm: the pressure reaches the set reserve (20 to 120 bar, 50 bar here), which is also the “empty tank” of the RBT calculation (§3.7.5).' } };
    if (key === 'rbt0' || msg === 'RBT = 0 MINUTES' || w === 'rbt0') {
      const alarm = this.rbt0Alarm;
      return { id: 'rbt0', screen: 'RBT = 0 MINUTES', code: 'LOW_GAS', what: { fr: `${alarm ? 'Alarme rouge' : 'Avertissement jaune (réglage RBT = 0 min sur Warning)'} : le temps restant (RBT, temps à cette profondeur qui laisse assez de gaz pour remonter à la vitesse idéale, paliers compris, avec la réserve) est épuisé (§2.6.2.2, §3.7.7).`, en: `${alarm ? 'Red alarm' : 'Yellow warning (RBT = 0 min set to Warning)'}: the remaining time (RBT, time at this depth that leaves enough gas to ascend at the ideal rate, stops included, with the reserve) has run out (§2.6.2.2, §3.7.7).` }, todo: { fr: 'Remontez maintenant.', en: 'Ascend now.' } };
    }
    if (key.startsWith('switch-')) {
      return { id: 'switch', screen: 'SWITCH TO GAS T2', what: { fr: 'Multigaz PMG (à activer) : au MOD d’un autre gaz pendant la remontée, une séquence sonore et « SWITCH TO GAS T2 » (§3.5.2.1).', en: 'PMG multi-gas (to be turned on): at the MOD of another gas during the ascent, an audible sequence and “SWITCH TO GAS T2” (§3.5.2.1).' }, todo: { fr: 'SAVE (en bas à gauche) confirme ; la flèche propose un autre gaz. Sans réponse en 30 s : « EXCLUDING GAS T2 », le gaz sort du calcul.', en: 'SAVE (lower left) confirms; the arrow offers another gas. No answer within 30 s: “EXCLUDING GAS T2”, the gas leaves the calculation.' } };
    }
    if (msg?.startsWith('EXCLUDING GAS')) return { id: 'excluding', screen: 'EXCLUDING GAS T…', what: { fr: 'Changement de gaz non confirmé en 30 s : le gaz sort du calcul pour le reste de la plongée, sauf si vous y passez à la main (BOOK maintenu, §3.5.2.3).', en: 'Gas switch not confirmed within 30 s: the gas leaves the calculation for the rest of the dive, unless you switch to it by hand (BOOK held, §3.5.2.3).' } };
    const kind = w ?? (msg ? WARNING_ORDER.find((k) => this.warningText(k, '') === msg) ?? (msg.endsWith(' REACHED') && /^\d/.test(msg) ? 'tank' : null) : null);
    const lvl = gf ? { fr: 'GF', en: 'GF' } : { fr: 'niveau MB', en: 'MB level' };
    const base = gf ? '100/100' : 'L0';
    switch (kind) {
      case 'depth': return { id: 'w-depth', screen: 'MAX DEPTH REACHED', what: warn('Vous avez atteint la profondeur réglée (§3.6.2 ; texte sans figure, repris du G2).', 'You reached the set depth (§3.6.2; wording without a figure, taken from the G2).'), todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' } };
      case 'cns75': return { id: 'w-cns75', screen: 'CNS O2 = 75%', code: 'CNS', what: warn('Le CNS atteint 75 % ; l’avertissement dure tant qu’il ne redescend pas sous 75 % (§3.6.3 ; texte sans figure, repris du G2).', 'The CNS reaches 75 %; the warning lasts until it drops below 75 % (§3.6.3; wording without a figure, taken from the G2).') };
      case 'nostop': return { id: 'w-nostop', screen: 'NO STOP = 2 MINUTES', code: 'NDL_LOW', what: warn(`Il reste 2 min de temps sans palier (celui affiché : ${base} ou ${lvl.fr} actif, §3.6.4).`, `2 minutes of no-stop time are left (the one on display: ${base} or the active ${lvl.en}, §3.6.4).`) };
      case 'deco': return { id: 'w-deco', screen: 'ENTERING DECO', code: 'DECO', what: warn('Le premier palier de décompression devient obligatoire : une remontée directe n’est plus possible (§3.6.5).', 'The first decompression stop becomes mandatory: a direct ascent is no longer possible (§3.6.5).') };
      case 'time': return { id: 'w-time', screen: 'TIME LIMIT REACHED', what: warn('La durée réglée est atteinte (§3.6.6).', 'The set dive time is reached (§3.6.6).'), todo: { fr: 'Remontez.', en: 'Ascend.' } };
      case 'turn': return { id: 'w-turn', screen: 'TURN-AROUND TIME', what: warn('La moitié de la durée réglée est écoulée (§3.6.6).', 'Half the set dive time has elapsed (§3.6.6).'), todo: { fr: 'Faites demi-tour.', en: 'Turn the dive around.' } };
      case 'tank': return { id: 'w-tank', screen: '100BAR REACHED', what: warn('Avec l’émetteur : la pression atteint la valeur réglée, par exemple la moitié du bloc (§3.6.7).', 'With the transmitter: the pressure reaches the set value, for instance half the tank (§3.6.7).'), todo: { fr: 'Repère classique pour commencer à remonter.', en: 'The usual cue to start ascending.' } };
      case 'rbt3': return { id: 'w-rbt3', screen: 'RBT = 3 MINUTES', code: 'LOW_GAS', what: warn('Il ne reste que 3 min de temps au fond avant de devoir remonter avec la réserve (RBT, §3.6.8).', 'Only 3 minutes of bottom time are left before you must ascend to keep the reserve (RBT, §3.6.8).'), todo: { fr: 'Commencez à remonter (§3.6.8).', en: 'Start ascending (§3.6.8).' } };
      case 'levelStops': return { id: 'w-levelStops', screen: gf ? 'ENTERING GF STOPS' : 'ENTERING LEVEL STOPS', what: warn(`Le ${lvl.fr} actif demande des paliers, qui ne sont pas obligatoires (§3.6.10, §3.6.11).`, `The active ${lvl.en} requires stops, which are not mandatory (§3.6.10, §3.6.11).`) };
      case 'levelIgnored': return { id: 'w-levelIgnored', screen: gf ? 'GF STOP IGNORED' : 'MB STOP IGNORED', what: warn(`Vous êtes au-dessus du palier le plus profond du ${lvl.fr} actif ; à plus de 1,5 m au-dessus, ${gf ? 'les GF augmentent' : 'le niveau MB est réduit'} (§3.6.12, §3.6.13).`, `You are above the deepest stop of the active ${lvl.en}; more than 1.5 m above, ${gf ? 'the GF are raised' : 'the MB level is reduced'} (§3.6.12, §3.6.13).`) };
      case 'levelChanged': return { id: 'w-levelChanged', screen: gf ? 'GF INCREASED' : 'MB LEVEL REDUCED', what: warn(gf ? 'Palier GF ignoré de plus de 1,5 m : les GF actifs ont été augmentés (+10 pour le GF bas, +5 pour le GF haut, §2.5.14) ; la nouvelle valeur s’affiche.' : 'Palier MB ignoré de plus de 1,5 m : le niveau MB actif a été réduit au niveau possible suivant ; il s’affiche (§3.6.14).', gf ? 'GF stop ignored by more than 1.5 m: the active GF have been raised (+10 for GF low, +5 for GF high, §2.5.14); the new value is shown.' : 'MB stop ignored by more than 1.5 m: the active MB level has been reduced to the next possible one; it is shown (§3.6.14).') };
      case 'baseNostop': return { id: 'w-baseNostop', screen: gf ? '100/100 ND = 2MIN' : 'L0 NO-STOP = 2MIN', code: 'NDL_LOW', what: warn(`Avec un ${lvl.fr} actif : il reste 2 min avant la décompression obligatoire (${base}, §3.6.16, §3.6.17).`, `With an active ${lvl.en}: 2 minutes are left before mandatory decompression (${base}, §3.6.16, §3.6.17).`) };
      case 'baseDeco': return { id: 'w-baseDeco', screen: gf ? 'ENTER 100/100 DECO' : 'ENTERING DECO AT L0', code: 'DECO', what: warn(`Avec un ${lvl.fr} actif : la décompression obligatoire (${base}) commence (§3.6.18, §3.6.19).`, `With an active ${lvl.en}: mandatory decompression (${base}) begins (§3.6.18, §3.6.19).`) };
      default: return null;
    }
  }

  /**
   * Audible alarms (§3.7): ascent above 110 % of the ideal rate, "l'intensité de l'alarme augmente
   * proportionnellement au degré de dépassement"; MOD exceeded, "émet continuellement un bip"; missed
   * deco stop, "une série de bips"; CNS O2 100 %, beeps for 12 s, then 5 s in 1-minute intervals; tank
   * reserve, "une alarme se déclenche" (pattern not described: one alarm, assumed). Warnings set to
   * AUDIBLE or BOTH beep once when they occur (pattern not described). Silenced by the all-silent mode
   * (§2.2.12).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.sound === 'off') || !v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.ascentLevel >= 1) {
      const excess = v.ascentRate / idealAscent(v.depth) - 1.1;
      cues.push({ key: 'ascent', kind: 'beep', level: v.ascentLevel >= 2 ? 'alarm' : 'warning', until: 'clear', every: Math.max(0.6, 2.5 - excess * 4) });
    }
    if (v.depth > v.mod) cues.push({ key: 'mod', kind: 'beep', level: 'alarm', until: 'clear', every: 1 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'missed-stop', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (v.cns >= 100) cues.push({ key: 'cns', kind: 'beep', level: 'warning', until: 'clear', first: 12, every: 60, repeat: 5 });
    if (v.tank.ai && v.tank.pressure < v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'alarm', until: 'once' });
    // §3.7.7 with RBT = 0 min set as an alarm (pattern not described: one alarm, assumed).
    if (this.rbt0Alarm && v.tank.ai && v.tank.gasTime === 0) cues.push({ key: 'rbt0', kind: 'beep', level: 'alarm', until: 'once' });
    // §3.5.2.1: "Une séquence sonore se déclenche" with SWITCH TO GAS T2.
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    for (const [k, since] of this.activeWarnings) {
      const key = warningKey(k, this.gfMode);
      if (k === 'rbt0' || all || ['audible', 'both'].includes(this.settings[key])) cues.push({ key: `w-${k}-${since}`, kind: 'beep', level: 'warning', until: 'once' });
    }
    return cues;
  }
}

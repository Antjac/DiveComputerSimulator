import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import { MAX_DECO_GASES, type DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import { type AlertCue, type AlertExplain, type Bi, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { shearwaterExplain } from '../alerts';
import { Notices } from '../../common/notices';
import { pressureSetting } from '../../common/tank';
import { OC_DECO_PPO2, gasIsOff, turnGasOn } from '../multigas';

/**
 * §15.1 warnings, highest priority first (the table's order; LOW BATTERY, TISSUES CLEAR, T1 LOW BATT and
 * the transmitter communication warnings cannot occur in the simulator).
 */
export type TericWarning =
  | 'low-ppo2' | 'high-ppo2' | 'missed-stop' | 'fast-ascent' | 'very-high-cns' | 'high-cns'
  | 'critical-pres' | 'low-pres' | 'deco-needed' | 'low-ndl';
const WARNINGS: TericWarning[] = ['low-ppo2', 'high-ppo2', 'missed-stop', 'fast-ascent', 'very-high-cns', 'high-cns', 'critical-pres', 'low-pres', 'deco-needed', 'low-ndl'];

/** §3.8 dive events (INFO), shown 4 s or until a button press: "Dive Started", "Safety Stop", "Deco Clear". */
export type TericEvent = 'dive-started' | 'safety-stop' | 'deco-clear';

/** §11.2 GF Conserv.: Low 45/95, Med 40/85, High 35/75, or Custom. */
export const GF_PRESETS: Record<string, [number, number]> = { low: [45, 95], med: [40, 85], high: [35, 75] };

/** Custom GF: range and step not given by the manual (10 to 100 % by 5 offered, as on the Perdix 2). */
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const isTec = (s: Record<string, string>) => s.mode === 'octec';
const notTec = (s: Record<string, string>) => s.mode !== 'octec';
const gfOptions = [
  { value: 'low', label: 'Low (45/95)' },
  { value: 'med', label: 'Med (40/85)' },
  { value: 'high', label: 'High (35/75)' },
  { value: 'custom', label: 'Custom' },
];

/** §3.7 Deco row right slot options (OC Rec mode). */
export const DECO_RIGHT_OPTIONS = [
  { value: 'tts', label: 'TTS' },
  { value: 't1', label: { fr: 'Pression T1 (AI)', en: 'T1 pressure (AI)' } },
  { value: 'gtr', label: { fr: 'GTR (AI)', en: 'GTR (AI)' } },
  { value: 'gf99', label: 'GF99' },
  { value: 'surfgf', label: 'SurfGF' },
  { value: 'cns', label: 'CNS %' },
  { value: 'max', label: { fr: 'Profondeur max', en: 'Max Depth' } },
  { value: 'avg', label: { fr: 'Profondeur moyenne', en: 'Avg. Depth' } },
  { value: 'at5', label: '@+5' },
  { value: 'clock', label: { fr: 'Heure (TIME)', en: 'Clock (TIME)' } },
];

/** §3.7 Home Screen Customization Options for the Info row. */
export const TERIC_HOME_OPTIONS = [
  { value: 'none', label: { fr: 'Vide', en: 'Empty' } },
  { value: 'gas', label: { fr: 'Gaz (O2 / O2-He)', en: 'Gas (O2 / O2-He)' } },
  { value: 'ppo2', label: 'PPO2' },
  { value: 't1', label: { fr: 'Pression T1 (AI)', en: 'T1 pressure (AI)' } },
  { value: 'gtr', label: { fr: 'GTR (AI)', en: 'GTR (AI)' } },
  { value: 'sac', label: { fr: 'SAC (Consommation AI)', en: 'SAC (AI)' } },
  { value: 'max', label: { fr: 'Profondeur max', en: 'Max Depth' } },
  { value: 'avg', label: { fr: 'Profondeur moyenne', en: 'Avg. Depth' } },
  { value: 'cns', label: 'CNS %' },
  { value: 'mod', label: 'MOD' },
  { value: 'density', label: { fr: 'Densité du gaz', en: 'Gas Density' } },
  { value: 'gf99', label: 'GF99' },
  { value: 'surfgf', label: 'Surface GF' },
  { value: 'ceil', label: { fr: 'Plafond (Ceil)', en: 'Ceiling' } },
  { value: 'at5', label: '@+5' },
  { value: 'd5', label: 'Δ+5' },
  { value: 'tts', label: 'TTS' },
  { value: 'temp', label: { fr: 'Température', en: 'Temperature' } },
  { value: 'clock', label: { fr: 'Heure (TIME)', en: 'Clock (TIME)' } },
  { value: 'det', label: { fr: 'Fin de plongée (EOD)', en: 'End of dive (EOD)' } },
];

/** §11.1 Alerts (per dive mode, for warnings and dive events): Visual only, Beep, Vibrate, Beep & Vibrate. */
function alertSetting(key: string, fr: string, en: string, def: string): SettingDef {
  return {
    key,
    label: { fr, en },
    options: [
      { value: 'visual', label: 'Visual only' },
      { value: 'beep', label: 'Beep' },
      { value: 'vib', label: 'Vibrate' },
      { value: 'both', label: 'Beep & Vib' },
    ],
    default: def,
  };
}

/**
 * Shearwater Teric, Open Circuit Recreational (OC Rec) and Technical (OC Tec) modes. Rules follow the
 * Teric Operating Instructions (Doc. 15001-SI-RevH, 2024-09-09).
 */
export abstract class TericRules extends DiveComputer {
  readonly id = 'teric';
  readonly name = 'Shearwater Teric';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Swift';
  readonly gasTimeName = 'GTR';
  readonly notes = {
    fr: 'Modes OC Rec (par défaut, Nitrox, palier de sécurité) et OC Tec (Trimix, pas de palier de sécurité, compteur CLEAR) ; CC/BO, profondimètre et apnée non simulés (§3.2). Dispositions Big (OC Rec) et Standard (OC Tec) (§3.3) : rangées du haut (profondeur, vitesse de remontée), Déco (NDL / TTS, palier, palier de sécurité ; emplacement droit réglable en OC Rec, §3.7), Info (Big : rangée Déco sur la 1re page ; Standard : réglable avec 1 à 3 zones parmi les options du §3.7, ou pré-réglages Gaz/PPO2, AI ou Déco ; gaz reporté en bas si la ligne Info ne le contient pas, §3.4), du bas (durée de plongée, gaz). INFO fait défiler les écrans d’info dans la rangée Info (§3.5 : dernière plongée en surface, émetteur, MAX / AVG, CNS / MOD / PPO2, GF / GF99 / SurfGF, CEIL / @+5 / Δ+5, tissus, TEMP / BATTERY, mBar, TIME / EOD ; retour après 10 s sauf émetteur et tissus en Standard) ; MENU : menu principal (LIGHT monte, MENU descend, FUNC sélectionne, INFO revient ; Select Gas simulé, les autres entrées non), ou liste des avertissements persistants si « ! » est affiché (§3.8) ; FUNC (raccourci réglable, §2.5) : Select Gas supposé. Bühlmann ZHL-16C + GF : Med 40/85 en OC Rec, Custom 30/70 en OC Tec (§5, §11.2), dernier palier 3 ou 6 m, remontée supposée à 10 m/min. Vitesse de remontée : 1 flèche par 3 m/min, blanc jusqu’à 9 m/min, jaune jusqu’à 18, rouge clignotant au-delà (§3.4). Palier de sécurité OC Rec (§4.1) : requis au-delà de 11 m, décompte au-dessus de 6 m, de 2,4 à 8,3 m, en pause (jaune) hors de cette plage, remis à zéro sous 11 m ; 3, 4, 5 min, Adapt (5 min si plus de 30 m ou NDL < 5 min), Count Up, Off. Avertissements du §15.1 (fond jaune dans la rangée Info, « CLEAR » à droite), acquittés par un bouton : LOW / HIGH PPO2 (limites PPO2 du §11.1 franchies plus de 30 s), MISSED STOP, FAST ASCENT (plus de 10 m/min), VERY HIGH CNS (150 %), HIGH CNS (90 %), T1 CRITICAL (plus grande valeur entre 21 bar et la moitié de la réserve), T1 LOW PRESS (réserve), DECO NEEDED et LOW NDL (NDL < 5 min, OC Rec seulement). Évènements INFO (fond cyan, 4 s) : Dive Started, Safety Stop, Deco Clear. Aucun verrouillage (§4.2). Non simulés : eau EN13319 (réglage d’usine ; le simulateur calcule en eau salée), boussole, outils de plongée, Edit Gases et réglages du menu (les gaz se règlent dans les réglages ; le simulateur ne porte que 3 gaz, le gaz de fond et 2 gaz de déco, sur les 5 du §11.3), batterie (valeur fictive), perte de communication de l’émetteur, plusieurs émetteurs.',
    en: 'OC Rec (default, Nitrox, safety stop) and OC Tec (Trimix, no safety stop, CLEAR counter) modes; CC/BO, gauge and freedive not simulated (§3.2). Big (OC Rec) and Standard (OC Tec) layouts (§3.3): top row (depth, ascent rate), Deco (NDL / TTS, stop, safety stop; settable right slot in OC Rec, §3.7), Info row (Big: Deco row on 1st page; Standard: customizable with 1 to 3 items among §3.7 options, or presets Gas/PPO2, AI or Deco; gas shown at bottom if not in Info row, §3.4), bottom row (dive time, gas). INFO steps through the info screens in the Info row (§3.5: last dive at the surface, transmitter, MAX / AVG, CNS / MOD / PPO2, GF / GF99 / SurfGF, CEIL / @+5 / Δ+5, tissues, TEMP / BATTERY, mBar, TIME / EOD; back after 10 s except the transmitter and tissues in Standard); MENU: main menu (LIGHT up, MENU down, FUNC select, INFO back; Select Gas simulated, the other items not), or the persistent warnings list when “!” is shown (§3.8); FUNC (custom shortcut, §2.5): Select Gas assumed. Bühlmann ZHL-16C + GF: Med 40/85 in OC Rec, Custom 30/70 in OC Tec (§5, §11.2), last stop 3 or 6 m, ascent assumed at 10 m/min. Ascent rate: 1 arrow per 3 m/min, white up to 9 m/min, yellow up to 18, flashing red beyond (§3.4). OC Rec safety stop (§4.1): required beyond 11 m, countdown above 6 m, from 2.4 to 8.3 m, paused (yellow) outside that range, reset below 11 m; 3, 4, 5 min, Adapt (5 min beyond 30 m or NDL < 5 min), Count Up, Off. §15.1 warnings (yellow background in the Info row, “CLEAR” on the right), dismissed with a button: LOW / HIGH PPO2 (§11.1 PPO2 limits crossed for more than 30 s), MISSED STOP, FAST ASCENT (faster than 10 m/min), VERY HIGH CNS (150 %), HIGH CNS (90 %), T1 CRITICAL (larger of 21 bar or half the reserve), T1 LOW PRESS (reserve), DECO NEEDED and LOW NDL (NDL < 5 min, OC Rec only). INFO events (cyan background, 4 s): Dive Started, Safety Stop, Deco Clear. No lock-out (§4.2). Not simulated: EN13319 water (factory setting; the simulator computes in salt water), compass, dive tools, Edit Gases and the menu settings (gases are set in the settings; the simulator carries only 3 gases, the bottom gas and 2 deco gases, of the 5 of §11.3), battery (fictitious value), transmitter communication loss, several transmitters.',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §11.1 Dive Mode: OC Rec (default), OC Tec, CC/BO, Gauge, Freedive (the last three not simulated).
      key: 'mode',
      label: { fr: 'Mode de plongée', en: 'Dive mode' },
      options: [
        { value: 'ocrec', label: 'OC Rec' },
        { value: 'octec', label: 'OC Tec' },
      ],
      default: 'ocrec',
      group: 'deco',
    },
    {
      // §3.3 / §11.1 Layout: "The Big screen layout is the default layout for OC Rec"; "The Standard
      // screen layout is the default layout for OC Tec" (switched with the mode, see settingChanged).
      key: 'layout',
      essential: true,
      label: { fr: 'Disposition (Layout)', en: 'Layout' },
      options: [
        { value: 'big', label: 'Big' },
        { value: 'std', label: 'Standard' },
      ],
      default: 'big',
    },
    {
      // §3.7: In OC Rec mode (Big and Standard layouts), the right slot of the Deco row is customizable.
      // Factory default: TTS.
      key: 'decoRight',
      showIf: notTec,
      label: { fr: 'Ligne Déco / Grand écran : droite (§3.7)', en: 'Deco / Big row: right (§3.7)' },
      options: DECO_RIGHT_OPTIONS,
      default: 'tts',
      group: 'display',
    },
    {
      // §3.7: In Standard layout, the Home screen Info Row is customizable with 1, 2, or 3 items.
      key: 'infoRow',
      showIf: (s) => s.layout === 'std',
      essential: true,
      label: { fr: 'Ligne Info (Standard, §3.7)', en: 'Info row (Standard, §3.7)' },
      options: [
        { value: 'default', label: { fr: 'Défaut (Gaz & PPO2)', en: 'Default (Gas & PPO2)' } },
        { value: 'ai', label: { fr: 'T1, SAC & GTR (AI)', en: 'T1, SAC & GTR (AI)' } },
        { value: 'deco', label: { fr: 'GF99, SurGF & Plafond', en: 'GF99, SurGF & Ceiling' } },
        { value: 'custom', label: { fr: 'Personnalisée (3 zones)', en: 'Custom (3 slots)' } },
      ],
      default: 'default',
    },
    ...(['infoL', 'infoC', 'infoR'] as const).map((key) => ({
      key,
      essential: true,
      label: key === 'infoL'
        ? { fr: 'Ligne Info : gauche (§3.7)', en: 'Info row: left (§3.7)' }
        : key === 'infoC'
          ? { fr: 'Ligne Info : centre (§3.7)', en: 'Info row: center (§3.7)' }
          : { fr: 'Ligne Info : droite (§3.7)', en: 'Info row: right (§3.7)' },
      options: TERIC_HOME_OPTIONS,
      default: key === 'infoL' ? 'gas' : key === 'infoC' ? 'none' : 'ppo2',
      showIf: (s: Record<string, string>) => s.layout === 'std' && s.infoRow === 'custom',
      group: 'display' as const,
    })),
    // §11.2 GF Conserv.: "Medium conservatism is the default setting for OC Rec mode"; "A custom GF
    // option is also available in every dive mode"; "OC Tec and CC/BO modes have a custom default of 30/70".
    { key: 'gf', showIf: notTec, label: { fr: 'Conservatisme (GF Conserv.)', en: 'GF Conserv.' }, options: gfOptions, default: 'med' },
    { key: 'gfLow', label: { fr: 'GF bas (Custom)', en: 'GF low (Custom)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '40', showIf: (s) => notTec(s) && s.gf === 'custom' },
    { key: 'gfHigh', label: { fr: 'GF haut (Custom)', en: 'GF high (Custom)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '85', showIf: (s) => notTec(s) && s.gf === 'custom' },
    { key: 'tecGf', showIf: isTec, label: { fr: 'Conservatisme OC Tec (GF Conserv.)', en: 'OC Tec GF Conserv.' }, options: gfOptions, default: 'custom' },
    { key: 'tecGfLow', label: { fr: 'GF bas (Custom, OC Tec)', en: 'GF low (Custom, OC Tec)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '30', showIf: (s) => isTec(s) && s.tecGf === 'custom' },
    { key: 'tecGfHigh', label: { fr: 'GF haut (Custom, OC Tec)', en: 'GF high (Custom, OC Tec)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '70', showIf: (s) => isTec(s) && s.tecGf === 'custom' },
    {
      // §3.4 / §11.2 Last Stop: "By default the Teric uses a 3m (10ft) last deco stop depth"; 3 m or 6 m.
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last Stop)', en: 'Last Stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
    {
      // §11.2 Safety Stop (OC Rec only): Off, 3, 4, 5 minutes, Adapt, Count Up. Default not given in the
      // text (the example dive of §6.1 uses Adapt "set" by the diver): 3 min assumed.
      key: 'safety',
      showIf: notTec,
      label: { fr: 'Palier de sécurité (Safety Stop)', en: 'Safety Stop' },
      options: [
        { value: 'off', label: 'Off' },
        { value: '3', label: '3 min' },
        { value: '4', label: '4 min' },
        { value: '5', label: '5 min' },
        { value: 'adapt', label: 'Adapt' },
        { value: 'cntup', label: 'Count Up' },
      ],
      default: '3',
    },
    {
      // §11.2 Clear Counter (OC Tec): "By default, the clear counter will count up from zero once
      // decompression obligation has been cleared [...]. It can be turned off here."
      key: 'clearCntr',
      showIf: isTec,
      label: { fr: 'Compteur CLEAR (Clear Counter)', en: 'Clear Counter' },
      options: [{ value: 'on', label: 'Count Up' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // §11.1 PPO2 Limits (ATA): OC Low PPO2 (default 0.18), OC MOD PPO2 (default 1.4), OC Deco PPO2
    // (default 1.61). Ranges not given: those offered are assumed.
    {
      key: 'lowPpo2',
      label: { fr: 'OC Low PPO2', en: 'OC Low PPO2' },
      options: [0.16, 0.17, 0.18, 0.19, 0.2, 0.21].map((v) => ({ value: v.toFixed(2), label: v.toFixed(2) })),
      default: '0.18',
      group: 'deco',
    },
    {
      key: 'ppo2',
      label: { fr: 'OC MOD PPO2', en: 'OC MOD PPO2' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: v.toFixed(2) })),
      default: '1.40',
    },
    {
      key: 'decoPpo2',
      label: { fr: 'OC Deco PPO2', en: 'OC Deco PPO2' },
      options: [1.4, 1.5, 1.55, 1.6, 1.61, 1.65].map((v) => ({ value: v.toFixed(2), label: v.toFixed(2) })),
      default: OC_DECO_PPO2.toFixed(2),
      group: 'deco',
    },
    // §11.3 Gases: 5 gases in OC Rec and OC Tec, each turned on or off (Edit Gases). The simulator carries
    // at most 1 + MAX_DECO_GASES gases: only those are offered, and only when carried.
    ...Array.from({ length: MAX_DECO_GASES }, (_, i) => i + 2).map((n): SettingDef => ({
      key: `gas${n}`,
      // Named after the page's deco gas it is (gas 2 = deco gas 1), with the device's gas number and menu.
      label: { fr: `Gaz de déco ${n - 1} (gaz ${n}, Edit Gases)`, en: `Deco gas ${n - 1} (gas ${n}, Edit Gases)` },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
      group: 'deco',
      gas: n,
    })),
    {
      // §10 Alerts (top-level, overrides the dive mode settings): Silent, Beep Only, Vibrate Only, Beep and
      // Vibrate. Default not given (the OC Rec example dive of §6.1 shows "sound and vibrate").
      key: 'alerts',
      label: { fr: 'Alertes (Alerts)', en: 'Alerts' },
      options: [
        { value: 'both', label: 'Beep + Vib.' },
        { value: 'beep', label: 'Beep Only' },
        { value: 'vib', label: 'Vib. Only' },
        { value: 'off', label: 'Silent' },
      ],
      default: 'both',
    },
    // §11.1 Alerts of the dive mode, for warnings and dive events (figure: Warnings Vibrate, Dive Events
    // Beep & Vib; factory values not given in the text).
    alertSetting('warnAlerts', 'Avertissements (Alerts › Warnings)', 'Warnings (Alerts › Warnings)', 'vib'),
    alertSetting('eventAlerts', 'Évènements (Alerts › Dive Events)', 'Dive events (Alerts › Dive Events)', 'both'),
    // §11.5 AI, Reserve Pressure: "The valid range is 28 to 137 bar"; 48 bar on the figure (default not
    // given in the text).
    pressureSetting('reserve', { fr: 'Pression de réserve (Reserve Pressure)', en: 'Reserve Pressure' }, 30, 135, 5, 48),
  ];

  /** Seconds with the PPO2 beyond its limits and with an ascent faster than 10 m/min. */
  protected highPpo2Sec = 0;
  protected lowPpo2Sec = 0;
  /** §15.1 warnings shown until a button press, highest priority first. */
  notices = new Notices<TericWarning>(WARNINGS);
  /** §3.8 dive event on display and the session clock it appeared at. */
  event: { key: TericEvent; at: number } | null = null;
  protected adaptLong = false;
  protected hadDeco = false;
  /** Session clock when deco stops cleared (CLEAR counter in OC Tec), null before. */
  clearedAt: number | null = null;
  /** Session clock at which the Count Up safety stop started counting. */
  countUpFrom: number | null = null;

  constructor() {
    super();
    // §4.1: required once deeper than 11 m; countdown begins shallower than 6 m; continues from 2.4 to
    // 8.3 m; reset if deeper than 11 m again.
    this.safetyStop = { trigger: 11, start: 6, top: 2.4, bottom: 8.3, reset: 11 };
    this.stopWindow = 1.5;
    // §4.2: shallower than the stop but deeper than the ceiling, the stop only shows in yellow; shallower
    // than the ceiling, it flashes red (the violation).
    this.violationRef = 'ceiling';
    this.ascentAlarmDelay = 10;
    this.ceilingMargin = 0;
    this.screenTimeout = 10_000; // §3.5: info screens time out after 10 s
    this.init();
  }

  get mode(): 'ocrec' | 'octec' {
    return this.settings.mode === 'octec' ? 'octec' : 'ocrec';
  }

  settingChanged(key: string, previous: string): void {
    // §3.3: each dive mode keeps its own layout, Big for OC Rec and Standard for OC Tec by default.
    if (key === 'mode') this.settings.layout = this.settings.mode === 'octec' ? 'std' : 'big';
    // Custom starts from the preset in use (not described in the manual).
    for (const [k, lo, hi] of [['gf', 'gfLow', 'gfHigh'], ['tecGf', 'tecGfLow', 'tecGfHigh']]) {
      const preset = GF_PRESETS[previous];
      if (key === k && this.settings[k] === 'custom' && preset) [this.settings[lo], this.settings[hi]] = preset.map(String);
    }
  }

  /** GF low / high in force (preset or custom of the dive mode). */
  get gf(): [number, number] {
    const tec = this.mode === 'octec';
    const choice = this.settings[tec ? 'tecGf' : 'gf'];
    const [lo, hi] = choice === 'custom'
      ? [Number(this.settings[tec ? 'tecGfLow' : 'gfLow']), Number(this.settings[tec ? 'tecGfHigh' : 'gfHigh'])]
      : GF_PRESETS[choice] ?? GF_PRESETS.med;
    return [Math.min(lo, hi), hi];
  }

  baseParams(): DecoParams {
    const [lo, hi] = this.gf;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop) || 3, stopStep: 3, ascentRate: 10 };
  }

  /** §11.3: 5 programmable gases in OC Rec and OC Tec. */
  get maxGases(): number {
    return 5;
  }

  gasOff(i: number): boolean {
    return gasIsOff(this.settings, i);
  }

  planGases(s: DiveSession) {
    return super.planGases(s).filter((g) => !this.gasOff(s.allGases.indexOf(g.gas)));
  }

  decoPpo2(): number {
    return Number(this.settings.decoPpo2) || OC_DECO_PPO2;
  }

  get lowPpo2(): number {
    return Number(this.settings.lowPpo2) || 0.18;
  }

  /**
   * §11.1: "When not in deco: The least oxygen rich mix that is turned on and all mixes with 40% O2 [or
   * less] are assumed to be bottom gases [...]. When in deco: Only the least oxygen rich mix is assumed
   * to be a bottom gas."
   */
  isBottomGas(s: DiveSession, inDeco: boolean): boolean {
    const on = this.knownGases(s).filter((_, i) => !this.gasOff(i));
    const leanest = Math.min(...on.map((g) => g.o2));
    return s.gas.o2 <= leanest + 1e-9 || (!inDeco && s.gas.o2 <= 0.4 + 1e-9);
  }

  /** PPO2 limit of the gas breathed: OC MOD PPO2 for a bottom gas, OC Deco PPO2 for a deco gas (§11.1). */
  ppo2Limit(s: DiveSession, inDeco: boolean): number {
    return this.isBottomGas(s, inDeco) ? this.modPpo2 : this.decoPpo2();
  }

  /** §3.4: 1 arrow per 3 m/min; white up to 9 m/min, yellow up to 18 m/min, flashing red beyond. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 18 ? 2 : rate > 9 ? 1 : 0;
  }

  /**
   * The ascent alarm is the §15.1 FAST ASCENT warning: "The ascent was sustained as faster than 10m/min"
   * (duration not given: 10 s assumed, see ascentAlarmDelay).
   */
  ascentAlarmCondition(rate: number): boolean {
    return rate > 10;
  }

  /** §11.5: "the larger of 21 bar (300 PSI) or half the reserve pressure". */
  criticalPressure(): number {
    return Math.max(21, this.reservePressure() / 2);
  }

  /**
   * GTR (§11.5): "the time in minutes that can be spent at the current depth and SAC rate until a direct
   * ascent to the surface at a rate of 10 m/min (33 feet/min) would result in surfacing with the reserve
   * pressure".
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: () => 10, deco: null,
    });
  }

  /** §11.2 Adapt: "a 3 minute safety stop will be used, unless the dive exceeds 30m (100ft) or the NDL falls below 5 minutes". Count Up: no end. */
  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adapt') return this.adaptLong ? 300 : 180;
    if (v === 'cntup') return 24 * 3600;
    return Number(v) * 60 || 180;
  }

  /** §4.1: safety stops in OC Rec mode only ("No Safety stops" in OC Tec, §3.2). */
  get hasSafetyStop(): boolean {
    return this.mode === 'ocrec' && this.settings.safety !== 'off';
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.adaptLong = false;
    this.hadDeco = false;
    this.highPpo2Sec = this.lowPpo2Sec = 0;
    this.notices.clear();
    this.clearedAt = null;
    this.countUpFrom = null;
    // §3.8 figure: "INFO Dive Started".
    this.event = { key: 'dive-started', at: s.clock };
  }

  tick(s: DiveSession, dt: number): void {
    // Select Gas turns a gas on when it is selected, and the active gas cannot be off (multigas.ts).
    turnGasOn(this.settings, s.breathing);
    const now: TericWarning[] = [];
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      const n = ndl(s.tissues, s.depth, s.gas, gfHigh);
      if (!this.adaptLong && (s.depth > 30 || n < 5)) this.adaptLong = true;
      const inDeco = !s.tissues.tolerates(SURFACE_PRESSURE, gfHigh);
      if (inDeco) {
        this.hadDeco = true;
        this.clearedAt = null;
      } else if (this.hadDeco && this.clearedAt === null) {
        this.clearedAt = s.clock;
        // §4.2: "In OC Tec mode, once all decompression stops are complete, a "Deco Clear" dive info event".
        if (this.mode === 'octec') this.event = { key: 'deco-clear', at: s.clock };
      }
      // §11.1: "a "Low PPO2" or "High PPO2" alert is displayed when the limits are violated for more than
      // 30 seconds"; the high limit is 0.03 above the MOD or Deco PPO2 of the gas.
      this.highPpo2Sec = s.ppO2 > this.ppo2Limit(s, inDeco) + 0.03 ? this.highPpo2Sec + dt : 0;
      this.lowPpo2Sec = s.ppO2 < this.lowPpo2 ? this.lowPpo2Sec + dt : 0;

      if (this.lowPpo2Sec > 30) now.push('low-ppo2');
      if (this.highPpo2Sec > 30) now.push('high-ppo2');
      // §4.2: "Significant stop violations will result in a "MISSED STOP" alert" (10 s above the ceiling assumed).
      if (this.ceilingViolationSec >= 10) now.push('missed-stop');
      if (this.ascentAlarm) now.push('fast-ascent');
      if (s.oxygen.cns > 150) now.push('very-high-cns');
      if (s.oxygen.cns > 90) now.push('high-cns');
      if (this.airIntegrated(s)) {
        if (s.tankPressure < this.criticalPressure()) now.push('critical-pres');
        else if (s.tankPressure < this.reservePressure()) now.push('low-pres');
      }
      // §15.1: DECO NEEDED ("Decompression stops are required. OC Rec mode only") and LOW NDL ("NDL is
      // less than 5 minutes. OC Rec mode only").
      if (this.mode === 'ocrec' && inDeco) now.push('deco-needed');
      if (this.mode === 'ocrec' && !inDeco && n < 5 && s.depth > 1) now.push('low-ndl');
    }
    const before = this.safetyState;
    super.tick(s, dt);
    if (!this.hasSafetyStop) this.safetyState = 'none';
    // §4.1: "An alert will occur when in the safety stop depth range, shallower than 6m" (INFO Safety Stop).
    if (s.inDive && before === 'pending' && this.safetyState === 'active') this.event = { key: 'safety-stop', at: s.clock };
    if (this.settings.safety === 'cntup' && this.safetyState === 'active' && this.countUpFrom === null) this.countUpFrom = s.clock;
    this.notices.update(now);
  }

  /** Dive event on display: §3.8 "Dive Events time out after 4 seconds or can be cleared by pressing any button". */
  currentEvent(s: DiveSession): TericEvent | null {
    if (this.event && s.clock - this.event.at > 4) this.event = null;
    return this.event?.key ?? null;
  }

  /**
   * §3.8 Persistent Alerts: the alert indicator stays "until the condition that caused the warning is
   * resolved" (which warnings persist is not listed: those of a lasting condition, deduced).
   */
  persistentAlerts(s: DiveSession, v: ComputerView): string[] {
    if (!s.inDive) return [];
    const list: string[] = [];
    if (s.ppO2 < this.lowPpo2) list.push('LOW PPO2');
    if (s.ppO2 > this.ppo2Limit(s, v.inDeco) + 0.03) list.push('HIGH PPO2');
    if (v.ceilingViolation === 2) list.push('MISSED STOP');
    if (s.oxygen.cns > 150) list.push('VERY HIGH CNS');
    else if (s.oxygen.cns > 90) list.push('HIGH CNS');
    if (this.airIntegrated(s) && s.tankPressure < this.criticalPressure()) list.push('T1 CRITICAL');
    else if (this.airIntegrated(s) && s.tankPressure < this.reservePressure()) list.push('T1 LOW PRESS');
    return list;
  }

  /** §10 Alerts (top level) overrides the dive mode settings: beep, vibration, both or silent. */
  private cueKind(dive: string): AlertCue['kind'] | null {
    const top = this.settings.alerts;
    if (top === 'off') return null;
    const beep = (top === 'both' || top === 'beep') && (dive === 'beep' || dive === 'both');
    const vib = (top === 'both' || top === 'vib') && (dive === 'vib' || dive === 'both');
    return beep ? 'beep' : vib ? 'buzz' : null;
  }

  get soundKind(): AlertCue['kind'] {
    return this.cueKind(this.settings.warnAlerts) ?? 'buzz';
  }

  /** The screen dismisses the warning itself (any button, see press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  /**
   * §3.8 / §10 / §11.1: warnings and dive events beep and / or vibrate as set (top-level Alerts setting
   * overriding the dive mode's Warnings / Dive Events settings; patterns not described: one signal when
   * an event appears, a warning repeated every 10 s until dismissed, as on the Perdix 2, assumed).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive) return [];
    const warnKind = all ? 'buzz' : this.cueKind(this.settings.warnAlerts);
    const eventKind = all ? 'buzz' : this.cueKind(this.settings.eventAlerts);
    const cues: AlertCue[] = [];
    if (eventKind && this.event) cues.push({ key: `${this.event.key}-${this.event.at}`, kind: eventKind, level: 'info', until: 'once' });
    if (warnKind) for (const key of this.notices.all) cues.push({ key, kind: warnKind, level: 'warning', until: 'ack', every: 10 });
    return cues;
  }

  alertExplain(key: string): AlertExplain | null {
    const dismiss: Bi = { fr: 'Avertissement sur fond jaune dans la rangée Info, jusqu’à l’appui sur un bouton (§3.8).', en: 'Warning on a yellow background in the Info row, until a button is pressed (§3.8).' };
    const ev = (fr: string, en: string): AlertExplain => ({ what: { fr: `${fr} Évènement INFO (fond cyan), 4 s ou jusqu’à l’appui sur un bouton (§3.8).`, en: `${en} INFO event (cyan background), 4 s or until a button is pressed (§3.8).` } });
    const k = key.replace(/-\d+(\.\d+)?$/, '');
    switch (k) {
      case 'dive-started': return { id: 'dive-started', screen: 'Dive Started', ...ev('La plongée a commencé.', 'The dive has started.') };
      case 'safety-stop': return { id: 'safety-stop', screen: 'Safety Stop', ...ev('Vous êtes dans la zone du palier de sécurité (au-dessus de 6 m après être passé sous 11 m) : le décompte commence (§4.1).', 'You are in the safety stop range (above 6 m after going below 11 m): the countdown starts (§4.1).'), todo: { fr: 'Restez entre 2,4 et 8,3 m jusqu’à « CLEAR ».', en: 'Stay between 2.4 and 8.3 m until “CLEAR”.' } };
      case 'deco-clear': return { id: 'deco-clear', screen: 'Deco Clear', ...ev('OC Tec : tous les paliers sont faits ; le compteur CLEAR compte depuis (§4.2).', 'OC Tec: every stop is done; the CLEAR counter counts from then (§4.2).') };
      case 'low-ppo2': return { screen: 'LOW PPO2', what: { fr: `La PPO2 est restée plus de 30 s sous la limite OC Low PPO2 (0,18 par défaut, §11.1) ; PPO2 et gaz clignotent en rouge. ${dismiss.fr}`, en: `The PPO2 stayed below the OC Low PPO2 limit (0.18 by default, §11.1) for more than 30 s; PPO2 and gas flash red. ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz adapté à cette profondeur.', en: 'Switch to a gas safe for this depth.' } };
      case 'high-ppo2': return { id: 'high-ppo2', screen: 'HIGH PPO2', code: 'PPO2_HIGH', what: { fr: `La PPO2 est restée plus de 30 s à plus de 0,03 au-dessus de la limite du gaz (OC MOD PPO2 1,4 pour un gaz fond, OC Deco PPO2 1,61 pour un gaz déco, §11.1) ; PPO2 et gaz clignotent en rouge. ${dismiss.fr}`, en: `The PPO2 stayed more than 0.03 above the gas limit (OC MOD PPO2 1.4 for a bottom gas, OC Deco PPO2 1.61 for a deco gas, §11.1) for more than 30 s; PPO2 and gas flash red. ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz adapté ou remontez (plafond permettant).', en: 'Switch to a suitable gas or ascend (ceiling allowing).' } };
      case 'missed-stop': return { id: 'missed-stop', screen: 'MISSED STOP', code: 'CEILING', what: { fr: `Au-dessus du palier mais sous le plafond, le palier s’affiche en jaune ; au-dessus du plafond, il clignote en rouge ; une violation importante (10 s supposées) déclenche MISSED STOP. Pas de verrouillage (§4.2). ${dismiss.fr}`, en: `Above the stop but below the ceiling, the stop shows in yellow; above the ceiling, it flashes red; a significant violation (10 s assumed) triggers MISSED STOP. No lock-out (§4.2). ${dismiss.en}` } };
      case 'fast-ascent': return { screen: 'FAST ASCENT', code: 'ASCENT', what: { fr: `Remontée plus rapide que 10 m/min de façon soutenue (durée non précisée : 10 s supposées). 1 flèche par 3 m/min : blanches jusqu’à 9 m/min, jaunes jusqu’à 18, rouges clignotantes au-delà (§3.4). ${dismiss.fr}`, en: `Ascent sustained faster than 10 m/min (duration not given: 10 s assumed). 1 arrow per 3 m/min: white up to 9 m/min, yellow up to 18, flashing red beyond (§3.4). ${dismiss.en}` } };
      case 'very-high-cns': return { screen: 'VERY HIGH CNS', code: 'CNS', what: { fr: `Le CNS dépasse 150 % (§15.1). ${dismiss.fr}`, en: `The CNS exceeds 150 % (§15.1). ${dismiss.en}` } };
      case 'high-cns': return { screen: 'HIGH CNS', code: 'CNS', what: { fr: `Le CNS dépasse 90 % ; il s’affiche en jaune, en rouge au-delà de 150 % (§3.6, §15.1). ${dismiss.fr}`, en: `The CNS exceeds 90 %; it shows in yellow, red beyond 150 % (§3.6, §15.1). ${dismiss.en}` } };
      case 'critical-pres': return { id: 'critical-pres', screen: 'T1 CRITICAL', code: 'LOW_GAS', what: { fr: `La pression passe sous la plus grande valeur entre 21 bar et la moitié de la réserve (§11.5) ; la pression s’affiche sur fond rouge. ${dismiss.fr}`, en: `The pressure drops below the larger of 21 bar or half the reserve (§11.5); the pressure shows on a red background. ${dismiss.en}` }, todo: { fr: 'Terminez la plongée et remontez de façon contrôlée.', en: 'End the dive with a controlled ascent.' } };
      case 'low-pres': return { id: 'low-pres', screen: 'T1 LOW PRESS', code: 'LOW_GAS', what: { fr: `La pression passe sous la réserve réglée (48 bar ici, §11.5) ; la pression s’affiche sur fond jaune. ${dismiss.fr}`, en: `The pressure drops below the set reserve (48 bar here, §11.5); the pressure shows on a yellow background. ${dismiss.en}` }, todo: { fr: 'Commencez à terminer la plongée.', en: 'Begin to end your dive.' } };
      case 'deco-needed': return { id: 'deco-needed', screen: 'DECO NEEDED', code: 'DECO', what: { fr: `OC Rec : des paliers de décompression sont nécessaires ; l’étiquette DECO est en rouge, la déco étant une situation d’urgence en plongée loisir (§4.2, §15.1 ; le §4.2 la montre en INFO cyan, le §15.1 en WARNING : tableau suivi). ${dismiss.fr}`, en: `OC Rec: decompression stops are required; the DECO label is red, deco being an emergency in recreational diving (§4.2, §15.1; §4.2 shows it as a cyan INFO, §15.1 as a WARNING: the table is followed). ${dismiss.en}` }, todo: { fr: 'Faites les paliers indiqués.', en: 'Perform the stops as directed.' } };
      case 'low-ndl': return { id: 'low-ndl', screen: 'LOW NDL', code: 'NDL_LOW', what: { fr: `OC Rec : le NDL est inférieur à 5 min ; il s’affiche en jaune (§3.4, §15.1). ${dismiss.fr}`, en: `OC Rec: the NDL is less than 5 minutes; it shows in yellow (§3.4, §15.1). ${dismiss.en}` }, todo: { fr: 'Remontez bientôt pour éviter la décompression.', en: 'Ascend soon to avoid decompression.' } };
    }
    // Common texts (DECO…) shared with the other Shearwater models.
    return shearwaterExplain(key, {
      dismiss: { fr: 'n’importe quel bouton', en: 'any button' },
      safetyBottom: 8.3,
      ppo2Limit: { fr: '1,43', en: '1.43' },
      arrows: { fr: '1 flèche par 3 m/min : blanches jusqu’à 9 m/min, jaunes jusqu’à 18, rouges clignotantes au-delà.', en: '1 arrow per 3 m/min: white up to 9 m/min, yellow up to 18, flashing red beyond.' },
      missedWhen: { fr: 'après une violation importante du palier', en: 'after a significant stop violation' },
    });
  }
}

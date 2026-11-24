import { type DecoParams, ndl, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import { MAX_DECO_GASES, type DiveSession } from '../../../engine/session';
import { remainingTime } from '../../../engine/gas';
import { type AlertCue, type AlertExplain, type Bi, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { shearwaterExplain } from '../alerts';
import { Notices } from '../../common/notices';
import { pressureSetting } from '../../common/tank';
import { OC_DECO_PPO2, gasIsOff, turnGasOn } from '../multigas';

/** §13.1 Dive Mode: Air, Nitrox, 3 GasNx, OC Tec (CC/BO, Gauge and Freedive not simulated). */
export type P3Mode = 'air' | 'nitrox' | '3gasnx' | 'octec';

/**
 * §4.11 primary notifications (warnings), highest priority first, in the table's order. LOW BATTERY,
 * TISSUES CLEARED, AI LOST COMMS, AI LOW BATTERY and the system errors cannot occur in the simulator.
 */
export type P3Warning =
  | 'low-ppo2' | 'high-ppo2' | 'missed-stop' | 'fast-ascent' | 'very-high-cns' | 'high-cns'
  | 'low-ndl' | 'depth-alert' | 'time-alert' | 'critical-pres';
const WARNINGS: P3Warning[] = ['low-ppo2', 'high-ppo2', 'missed-stop', 'fast-ascent', 'very-high-cns', 'high-cns', 'low-ndl', 'depth-alert', 'time-alert', 'critical-pres'];

/** §4.9 dive events (INFO), shown 4 s or until a button press: only "Dive Started" is shown by the manual. */
export type P3Event = 'dive-started';

/** §13.2 GF Conserv.: Low 50/95, Med 50/85, High 50/75, or Custom. */
export const GF_PRESETS: Record<string, [number, number]> = { low: [50, 95], med: [50, 85], high: [50, 75] };

/** Custom GF: range and step not given by the manual (10 to 100 % by 5 offered, as on the Perdix 2). */
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const isTec = (s: Record<string, string>) => s.mode === 'octec';
const notTec = (s: Record<string, string>) => s.mode !== 'octec';
const multi = (s: Record<string, string>) => s.mode === '3gasnx' || s.mode === 'octec';
const gfOptions = [
  { value: 'low', label: 'Low (50/95)' },
  { value: 'med', label: 'Med (50/85)' },
  { value: 'high', label: 'High (50/75)' },
  { value: 'custom', label: 'Custom' },
];

/**
 * §4.7 Screen Element Descriptions: the values a configurable position can show (compass, stopwatch,
 * CC values and the mini displays are not simulated).
 */
export const P3_SLOT_OPTIONS = [
  { value: 'none', label: { fr: 'Vide', en: 'Empty' } },
  { value: 'gas', label: { fr: 'Gaz (O2 / O2-He)', en: 'Gas (O2 / O2-He)' } },
  { value: 'ppo2', label: 'PPO2' },
  { value: 't1', label: { fr: 'Pression T1 (AI)', en: 'T1 pressure (AI)' } },
  { value: 'gtr', label: { fr: 'GTR (AI)', en: 'GTR (AI)' } },
  { value: 'sac', label: { fr: 'SAC (AI)', en: 'SAC (AI)' } },
  { value: 'max', label: { fr: 'Profondeur max', en: 'Max Depth' } },
  { value: 'avg', label: { fr: 'Profondeur moyenne', en: 'Avg. Depth' } },
  { value: 'avgatm', label: 'AvgATM' },
  { value: 'temp', label: { fr: 'Température', en: 'Temperature' } },
  { value: 'mod', label: 'MOD' },
  { value: 'cns', label: 'CNS %' },
  { value: 'rate', label: { fr: 'Vitesse (Rate)', en: 'Rate' } },
  { value: 'tts', label: 'TTS' },
  { value: 'at5', label: '@+5' },
  { value: 'd5', label: 'Δ+5' },
  { value: 'ceil', label: { fr: 'Plafond (CEIL)', en: 'Ceiling (CEIL)' } },
  { value: 'gf', label: { fr: 'Conservatisme (GF)', en: 'Conservatism (GF)' } },
  { value: 'gf99', label: 'GF99' },
  { value: 'surfgf', label: 'SurfGF' },
  { value: 'sgf5', label: 'SGF +5' },
  { value: 'det', label: { fr: 'Fin de plongée (EOD)', en: 'End of dive (EOD)' } },
  { value: 'density', label: { fr: 'Densité du gaz', en: 'Gas Density' } },
  { value: 'clock', label: { fr: 'Heure (CLOCK)', en: 'Time of day (CLOCK)' } },
  { value: 'battery', label: { fr: 'Batterie', en: 'Battery' } },
];

/**
 * Home screen of each dive mode (§13.1 Edit Home Screen: "Every Dive mode has its own home screen
 * customization", §4.3). Air and Nitrox: §4.1 "AIR Mode Default Display" (CLOCK, MAX, TEMP). 3 GasNx and
 * OC Tec in Big / Standard: those of the 3 GasNx example dive (§7.2: TTS, MAX, SurfGF), deduced. Tec
 * layout: §4.5 "In the OC Tec Mode the center row displays gas PPO2 by default", bottom row O2/He and TTS
 * (§7.3 figures); the same assumed in the other modes.
 */
export function homeDefaults(mode: string): Record<string, string> {
  const rec = mode === 'air' || mode === 'nitrox';
  return {
    slot: rec ? 'clock' : 'tts',
    infoC: 'max',
    infoR: rec ? 'temp' : 'surfgf',
    tecL: 'none',
    tecC: 'ppo2',
    tecR: 'none',
    tecB1: 'gas',
    tecB2: 'tts',
  };
}

/** §4.3 / §13.1 Layout: Big for Air and Nitrox, Tec for OC Tec; Standard for 3 GasNx (§7.2 example, deduced). */
export function defaultLayout(mode: string): string {
  return mode === 'octec' ? 'tec' : mode === '3gasnx' ? 'std' : 'big';
}

const slotSetting = (key: string, fr: string, en: string, showIf: (s: Record<string, string>) => boolean): SettingDef => ({
  key,
  essential: true,
  label: { fr, en },
  options: P3_SLOT_OPTIONS,
  default: homeDefaults('air')[key],
  showIf,
  group: 'display',
});
const bigStd = (s: Record<string, string>) => s.layout !== 'tec';
const tecLayout = (s: Record<string, string>) => s.layout === 'tec';

/**
 * Shearwater Perdix 3, open circuit modes (Air, Nitrox, 3 GasNx, OC Tec). Rules follow the Perdix 3
 * Operating Instructions (rev. B, firmware V39). The Perdix 3 runs the Teric / Tern firmware (release
 * notes V38: "built on the same proven firmware platform used across our Teric and Tern").
 */
export abstract class Perdix3Rules extends DiveComputer {
  readonly id = 'perdix3';
  readonly name = 'Shearwater Perdix 3';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Swift';
  readonly gasTimeName = 'GTR';
  readonly notes = {
    fr: 'Modes Air (par défaut), Nitrox (un gaz), 3 GasNx (3 gaz nitrox) et OC Tec (5 gaz trimix, pas de palier de sécurité, compteur CLEAR) ; CC/BO, profondimètre et apnée non simulés (§4.2). En mode Air, le simulateur calcule sur le gaz respiré : choisissez de l’air. Trois mises en page dans chaque mode (§4.3) : Big (Air et Nitrox), Standard (3 GasNx, d’après l’exemple du §7.2, déduit) et Tec (OC Tec). Big / Standard : profondeur, vitesse de remontée et durée à gauche ; NDL, palier, palier de sécurité ou compteur CLEAR et barre d’azote en haut à droite ; un emplacement réglable dessous ; ligne Info en bas (gaz et mode, deux emplacements réglables). Tec : rangée du haut DEPTH TIME NDL/DECO, rangée centrale (3 emplacements, PPO2 au centre par défaut), rangée du bas (mode, 2 emplacements, O2/He et TTS par défaut). Emplacements réglés par mode (§13.1 Edit Home Screen) ; mini-affichages, boussole et chronomètre non simulés. SELECT (droite) : écrans d’info dans la ligne du bas (§4.6 : dernière plongée en surface, émetteur, MAX / AVG, CNS / MOD / PPO2, GF / GF99 / TTS, tissus, TEMP / BATTERY, PRESSURE mBar, DATE / CLOCK ; retour après 10 s sauf tissus et émetteur) ; MENU (gauche) : retour à l’écran principal, menu (MENU : élément suivant, SELECT : choisit ; Select Gas simulé, les autres entrées non), ou liste des avertissements persistants si « ! » est affiché (§4.9). Bühlmann ZHL-16C + GF : Low 50/95, Med 50/85 (défaut), High 50/75 ou Custom en Air, Nitrox et 3 GasNx ; Custom 50/70 en OC Tec (§6, §13.2) ; dernier palier 3 ou 6 m ; remontée supposée à 10 m/min. La TTS ne compte pas le palier de sécurité : le manuel du Perdix 3 dit « ascent plus all required deco stops » (§4.7), contrairement à celui du Teric. Vitesse de remontée : 1 flèche par 3 m/min, blanc jusqu’à 9 m/min, jaune jusqu’à 18, rouge clignotant au-delà (§4.4). Palier de sécurité en Air, Nitrox et 3 GasNx (§5.1) : requis au-delà de 11 m, décompte au-dessus de 6 m, de 2,4 à 8,3 m, en pause (jaune) hors de cette plage, remis à zéro sous 11 m ; Off, 3, 4, 5 min, Adapt (5 min si plus de 30 m ou NDL < 5 min), Count Up (3 min supposé par défaut : non précisé). Avertissements du §4.11 dans la ligne du bas (WARNING en jaune), effacés par un bouton : LOW / HIGH PPO2 (limites du §13.1 franchies plus de 30 s), MISSED DECO STOP, FAST ASCENT (plus de 10 m/min), VERY HIGH CNS (150 %), HIGH CNS (90 %), LOW NDL ALERT (5 min), DEPTH ALERT (40 m), TIME ALERT (60 min, désactivée par défaut) (§4.10), T1 CRITICAL PRES. Évènement INFO « Dive Started » (4 s). Alertes par vibration seulement (§4.9). Aucun verrouillage (§5.2). Non simulés : eau EN13319 (réglage d’usine ; le simulateur calcule en eau salée), jeux de réglages (Sets), boussole, outils de plongée, Edit Gases et réglages du menu (les gaz se règlent dans les réglages ; le simulateur porte au plus 3 gaz), batterie (valeur fictive), perte de communication de l’émetteur, plusieurs émetteurs.',
    en: 'Air (default), Nitrox (single gas), 3 GasNx (3 nitrox gases) and OC Tec (5 trimix gases, no safety stop, CLEAR counter) modes; CC/BO, gauge and freedive not simulated (§4.2). In Air mode the simulator computes with the gas breathed: choose air. Three layouts in every mode (§4.3): Big (Air and Nitrox), Standard (3 GasNx, after the §7.2 example, deduced) and Tec (OC Tec). Big / Standard: depth, ascent rate and dive time on the left; NDL, stop, safety stop or CLEAR counter and nitrogen bar top right; one configurable slot below; Info row at the bottom (gas and mode, two configurable positions). Tec: top row DEPTH TIME NDL/DECO, centre row (3 positions, PPO2 in the middle by default), bottom row (mode, 2 positions, O2/He and TTS by default). Positions set per mode (§13.1 Edit Home Screen); mini displays, compass and stopwatch not simulated. SELECT (right): info screens in the bottom row (§4.6: last dive at the surface, transmitter, MAX / AVG, CNS / MOD / PPO2, GF / GF99 / TTS, tissues, TEMP / BATTERY, PRESSURE mBar, DATE / CLOCK; back after 10 s except tissues and transmitter); MENU (left): back to the main screen, menu (MENU: next item, SELECT: selects; Select Gas simulated, the other items not), or the persistent warnings list when “!” is shown (§4.9). Bühlmann ZHL-16C + GF: Low 50/95, Med 50/85 (default), High 50/75 or Custom in Air, Nitrox and 3 GasNx; Custom 50/70 in OC Tec (§6, §13.2); last stop 3 or 6 m; ascent assumed at 10 m/min. The TTS does not include the safety stop: the Perdix 3 manual says “ascent plus all required deco stops” (§4.7), unlike the Teric’s. Ascent rate: 1 arrow per 3 m/min, white up to 9 m/min, yellow up to 18, flashing red beyond (§4.4). Safety stop in Air, Nitrox and 3 GasNx (§5.1): required beyond 11 m, countdown above 6 m, from 2.4 to 8.3 m, paused (yellow) outside that range, reset below 11 m; Off, 3, 4, 5 min, Adapt (5 min beyond 30 m or NDL < 5 min), Count Up (3 min assumed by default: not given). §4.11 warnings in the bottom row (yellow WARNING), cleared with a button: LOW / HIGH PPO2 (§13.1 limits crossed for more than 30 s), MISSED DECO STOP, FAST ASCENT (faster than 10 m/min), VERY HIGH CNS (150 %), HIGH CNS (90 %), LOW NDL ALERT (5 min), DEPTH ALERT (40 m), TIME ALERT (60 min, off by default) (§4.10), T1 CRITICAL PRES. INFO event “Dive Started” (4 s). Vibration alerts only (§4.9). No lock-out (§5.2). Not simulated: EN13319 water (factory setting; the simulator computes in salt water), setting sets, compass, dive tools, Edit Gases and the menu settings (gases are set in the settings; the simulator carries at most 3 gases), battery (fictitious value), transmitter communication loss, several transmitters.',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §13.1 Dive Mode (7 modes; CC/BO, Gauge and Freedive not simulated). §4.1: "The default dive mode is
      // single gas air".
      key: 'mode',
      label: { fr: 'Mode de plongée', en: 'Dive mode' },
      options: [
        { value: 'air', label: 'Air' },
        { value: 'nitrox', label: 'Nitrox' },
        { value: '3gasnx', label: '3 GasNx' },
        { value: 'octec', label: 'OC Tec' },
      ],
      default: 'air',
      group: 'deco',
    },
    {
      // §4.3 / §13.1 Layout: Big, Standard or Tec in every mode ("isolated to the dive mode in which it was
      // set"; switched with the mode, see settingChanged).
      key: 'layout',
      essential: true,
      label: { fr: 'Mise en page (Layout)', en: 'Layout' },
      options: [
        { value: 'big', label: 'Big' },
        { value: 'std', label: 'Standard' },
        { value: 'tec', label: 'Tec' },
      ],
      default: 'big',
    },
    // §4.3 Configurable Positions (Big and Standard): the slot under the deco info and the centre and right
    // positions of the Info row. §4.5 (Tec): the three positions of the centre row and two of the bottom row.
    slotSetting('slot', 'Emplacement réglable (sous la déco)', 'Configurable slot (below the deco info)', bigStd),
    slotSetting('infoC', 'Ligne Info : centre', 'Info row: centre', bigStd),
    slotSetting('infoR', 'Ligne Info : droite', 'Info row: right', bigStd),
    slotSetting('tecL', 'Rangée centrale : gauche', 'Centre row: left', tecLayout),
    slotSetting('tecC', 'Rangée centrale : centre', 'Centre row: centre', tecLayout),
    slotSetting('tecR', 'Rangée centrale : droite', 'Centre row: right', tecLayout),
    slotSetting('tecB1', 'Rangée du bas : centre', 'Bottom row: centre', tecLayout),
    slotSetting('tecB2', 'Rangée du bas : droite', 'Bottom row: right', tecLayout),
    // §13.2 GF Conserv.: "Air, Nitrox, and 3GasNX share a set of gradient factors [...]. Similarly, OC Tec
    // and CC/BO share a set"; "Medium conservatism is the default setting for recreational modes"; "OC Tec
    // and CC/BO modes have a custom default of 50/70".
    { key: 'gf', showIf: notTec, label: { fr: 'Conservatisme (GF Conserv.)', en: 'GF Conserv.' }, options: gfOptions, default: 'med' },
    { key: 'gfLow', label: { fr: 'GF bas (Custom)', en: 'GF low (Custom)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '50', showIf: (s) => notTec(s) && s.gf === 'custom' },
    { key: 'gfHigh', label: { fr: 'GF haut (Custom)', en: 'GF high (Custom)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '85', showIf: (s) => notTec(s) && s.gf === 'custom' },
    { key: 'tecGf', showIf: isTec, label: { fr: 'Conservatisme OC Tec (GF Conserv.)', en: 'OC Tec GF Conserv.' }, options: gfOptions, default: 'custom' },
    { key: 'tecGfLow', label: { fr: 'GF bas (Custom, OC Tec)', en: 'GF low (Custom, OC Tec)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '50', showIf: (s) => isTec(s) && s.tecGf === 'custom' },
    { key: 'tecGfHigh', label: { fr: 'GF haut (Custom, OC Tec)', en: 'GF high (Custom, OC Tec)' }, options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })), default: '70', showIf: (s) => isTec(s) && s.tecGf === 'custom' },
    {
      // §4.4 / §13.2 Last Stop: "By default the Perdix uses a 3m (10ft) last deco stop depth"; 3 m or 6 m.
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last Stop)', en: 'Last Stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
    {
      // §13.2 Safety Stops ("only present in recreational modes"): Off, 3, 4, 5 minutes, Adapt, Count Up.
      // Default not given (the §7.1 example uses Adapt, the §7.2 one Count Up): 3 min assumed.
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
      // §13.2 Clear Counter (OC Tec and CC/BO): "By default, the clear counter will count up from zero once
      // decompression obligation has been cleared [...]. It can be turned off here."
      key: 'clearCntr',
      showIf: isTec,
      label: { fr: 'Compteur CLEAR (Clear Counter)', en: 'Clear Counter' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // §13.1 PPO2 Limits (ATA): OC Low PPO2 0.18, OC MOD PPO2 1.40, OC Deco PPO2 1.61 by default (ranges not
    // given: those offered are assumed).
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
      showIf: multi,
    },
    // §13.3 Gases: 3 in 3 GasNx, 5 in OC Tec, each turned on or off. The simulator carries at most
    // 1 + MAX_DECO_GASES gases: only those are offered, and only when carried.
    ...Array.from({ length: MAX_DECO_GASES }, (_, i) => i + 2).map((n): SettingDef => ({
      key: `gas${n}`,
      label: { fr: `Gaz de déco ${n - 1} (gaz ${n}, Gases)`, en: `Deco gas ${n - 1} (gas ${n}, Gases)` },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
      group: 'deco',
      gas: n,
      showIf: multi,
    })),
    // §4.10 / §13.1 Alerts: "By default the depth alert is set to 40 meters"; "the dive time alert is set to
    // 60 minutes, but is turned off"; "the low NDL alert is set to 5 minutes". Ranges not given.
    {
      key: 'depthAlert',
      label: { fr: 'Alerte de profondeur (Depth)', en: 'Depth alert' },
      options: [{ value: 'off', label: 'Off' }, ...[20, 25, 30, 35, 40, 45, 50, 60].map((m) => ({ value: String(m), label: `${m} m` }))],
      default: '40',
    },
    {
      key: 'timeAlert',
      label: { fr: 'Alerte de durée (Dive Time)', en: 'Dive time alert' },
      options: [{ value: 'off', label: 'Off' }, ...[30, 40, 50, 60, 70, 80, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
    },
    {
      key: 'ndlAlert',
      label: { fr: 'Alerte NDL faible (Low NDL)', en: 'Low NDL alert' },
      options: [{ value: 'off', label: 'Off' }, ...[2, 3, 4, 5, 6, 8, 10, 15].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: '5',
    },
    {
      // §4.9 Vibration Alerts: "can be toggled on or off in the Settings > Utilities menu" (default not
      // given: on assumed).
      key: 'vibration',
      label: { fr: 'Vibreur (Utilities › Vibration)', en: 'Vibration (Utilities)' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
    },
    // §11.2 Tx Setup figure: Reserve 050 BAR (range not given).
    pressureSetting('reserve', { fr: 'Pression de réserve (Reserve)', en: 'Reserve pressure' }, 30, 135, 5, 50),
  ];

  /** Seconds with the PPO2 beyond its limits. */
  protected highPpo2Sec = 0;
  protected lowPpo2Sec = 0;
  /** §4.11 warnings shown until a button press, highest priority first. */
  notices = new Notices<P3Warning>(WARNINGS);
  /** §4.9 dive event on display and the session clock it appeared at. */
  event: { key: P3Event; at: number } | null = null;
  protected adaptLong = false;
  protected hadDeco = false;
  /** Session clock when deco stops cleared (CLEAR counter), null before. */
  clearedAt: number | null = null;
  /** Session clock at which the Count Up safety stop started counting. */
  countUpFrom: number | null = null;
  /** §4.10 armed alerts: low NDL and depth wait for their reset margin; the time alert fires once. */
  protected ndlArmed = true;
  protected depthArmed = true;
  protected timeFired = false;

  constructor() {
    super();
    // §5.1: required once deeper than 11 m; countdown begins shallower than 6 m; continues from 2.4 to
    // 8.3 m; reset if deeper than 11 m again.
    this.safetyStop = { trigger: 11, start: 6, top: 2.4, bottom: 8.3, reset: 11 };
    this.stopWindow = 1.5;
    // §5.2: "If you ascend shallower than your current stop, the decompression information will flash red";
    // §7.2 (10): "If you ascend shallower than the decompression ceiling the Deco information will flash
    // red". The ceiling is taken as the reference, as on the Teric.
    this.violationRef = 'ceiling';
    this.ascentAlarmDelay = 10;
    this.ceilingMargin = 0;
    this.screenTimeout = 10_000; // §4.6: info screens time out after 10 s
    this.init();
  }

  get mode(): P3Mode {
    const m = this.settings.mode;
    return m === 'nitrox' || m === '3gasnx' || m === 'octec' ? m : 'air';
  }

  /** Recreational modes (Air, Nitrox, 3 GasNx): safety stop, rec GF set. */
  get rec(): boolean {
    return this.mode !== 'octec';
  }

  settingChanged(key: string, previous: string): void {
    // §13.1: layout and home screen are "isolated to the dive mode in which they were set": the mode's own
    // defaults are restored when it changes (the simulator keeps one set).
    if (key === 'mode') {
      this.settings.layout = defaultLayout(this.settings.mode);
      Object.assign(this.settings, homeDefaults(this.settings.mode));
    }
    // Custom starts from the preset in use (not described in the manual).
    for (const [k, lo, hi] of [['gf', 'gfLow', 'gfHigh'], ['tecGf', 'tecGfLow', 'tecGfHigh']]) {
      const preset = GF_PRESETS[previous];
      if (key === k && this.settings[k] === 'custom' && preset) [this.settings[lo], this.settings[hi]] = preset.map(String);
    }
  }

  /** GF low / high in force (preset or custom of the dive mode's set). */
  get gf(): [number, number] {
    const tec = !this.rec;
    const choice = this.settings[tec ? 'tecGf' : 'gf'];
    const [lo, hi] = choice === 'custom'
      ? [Number(this.settings[tec ? 'tecGfLow' : 'gfLow']), Number(this.settings[tec ? 'tecGfHigh' : 'gfHigh'])]
      : GF_PRESETS[choice] ?? GF_PRESETS.med;
    return [Math.min(lo, hi), hi];
  }

  baseParams(): DecoParams {
    const [lo, hi] = this.gf;
    // §6.1: "It is assumed that the diver's ascent rate is 10m/min"; §5.2: stops at 3 m intervals.
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop) || 3, stopStep: 3, ascentRate: 10 };
  }

  /** §4.2 / §13.3: Air and Nitrox single gas, 3 gases in 3 GasNx, 5 in OC Tec. */
  get maxGases(): number {
    return this.mode === 'octec' ? 5 : this.mode === '3gasnx' ? 3 : 1;
  }

  gasOff(i: number): boolean {
    return this.maxGases > 1 && gasIsOff(this.settings, i);
  }

  /** §6.1: the plan assumes the diver "plans to use every gas that is currently turned on". */
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
   * §13.1: "When not in deco: The least oxygen rich mix that is turned on and all mixes with 40% O2 are
   * assumed to be bottom gases [...]. When in deco: Only the least oxygen rich mix is assumed to be a
   * bottom gas."
   */
  isBottomGas(s: DiveSession, inDeco: boolean): boolean {
    const on = this.knownGases(s).filter((_, i) => !this.gasOff(i));
    if (!on.length) return true;
    const leanest = Math.min(...on.map((g) => g.o2));
    return s.gas.o2 <= leanest + 1e-9 || (!inDeco && s.gas.o2 <= 0.4 + 1e-9);
  }

  /** PPO2 limit of the gas breathed: OC MOD PPO2 for a bottom gas, OC Deco PPO2 for a deco gas (§13.1). */
  ppo2Limit(s: DiveSession, inDeco: boolean): number {
    return this.isBottomGas(s, inDeco) ? this.modPpo2 : this.decoPpo2();
  }

  /** §4.4: 1 arrow per 3 m/min; white up to 9 m/min, yellow up to 18 m/min, flashing red beyond. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 18 ? 2 : rate > 9 ? 1 : 0;
  }

  /** §4.11 FAST ASCENT: "The ascent was sustained as faster than 10m/min" (duration not given: 10 s assumed). */
  ascentAlarmCondition(rate: number): boolean {
    return rate > 10;
  }

  /**
   * Critical pressure (§4.11 T1 CRITICAL PRES, "below the critical pressure"): not defined in the Perdix 3
   * manual; the larger of 21 bar or half the reserve, as on the Teric and Perdix 2 (assumed).
   */
  criticalPressure(): number {
    return Math.max(21, this.reservePressure() / 2);
  }

  /**
   * §11.3 GTR: "the time, in minutes, that you could stay at the current depth until a direct ascent to
   * the surface at a speed of [...] 10 m/min would result in surfacing with the reserve gas pressure".
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({
      tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: this.reservePressure(),
      sacBar, rate: () => 10, deco: null,
    });
  }

  /** §13.2 Adapt: "a 3 minute safety stop will be used, unless the dive exceeds 30m (100ft) or the NDL falls below 5 minutes". Count Up: no end. */
  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adapt') return this.adaptLong ? 300 : 180;
    if (v === 'cntup') return 24 * 3600;
    return Number(v) * 60 || 180;
  }

  /** §5: "There are no Safety Stops in technical diving modes." */
  get hasSafetyStop(): boolean {
    return this.rec && this.settings.safety !== 'off';
  }

  /** §4.10 alert thresholds (null when off). */
  alertValue(key: 'ndlAlert' | 'depthAlert' | 'timeAlert'): number | null {
    const v = this.settings[key];
    return !v || v === 'off' ? null : Number(v);
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.adaptLong = false;
    this.hadDeco = false;
    this.highPpo2Sec = this.lowPpo2Sec = 0;
    this.notices.clear();
    this.clearedAt = null;
    this.countUpFrom = null;
    this.ndlArmed = this.depthArmed = true;
    this.timeFired = false;
    // §4.9 figure: "INFO Dive Started".
    this.event = { key: 'dive-started', at: s.clock };
  }

  tick(s: DiveSession, dt: number): void {
    // §12.1 Select Gas: a gas that is off "will be turned on automatically if it is selected".
    turnGasOn(this.settings, s.breathing);
    const now: P3Warning[] = [];
    if (s.inDive) {
      const gfHigh = this.decoParams(s).gfHigh;
      const n = ndl(s.tissues, s.depth, s.gas, gfHigh);
      if (!this.adaptLong && (s.depth > 30 || n < 5)) this.adaptLong = true;
      const inDeco = !s.tissues.tolerates(SURFACE_PRESSURE, gfHigh);
      if (inDeco) {
        this.hadDeco = true;
        this.clearedAt = null;
      } else if (this.hadDeco && this.clearedAt === null) this.clearedAt = s.clock;
      // §13.1: "a "Low PPO2" or "High PPO2" alert is displayed when the limits are violated for more than
      // 30 seconds"; the high limit is 0.03 above the MOD or Deco PPO2 of the gas.
      this.highPpo2Sec = s.ppO2 > this.ppo2Limit(s, inDeco) + 0.03 ? this.highPpo2Sec + dt : 0;
      this.lowPpo2Sec = s.ppO2 < this.lowPpo2 ? this.lowPpo2Sec + dt : 0;
      if (this.lowPpo2Sec > 30) now.push('low-ppo2');
      if (this.highPpo2Sec > 30) now.push('high-ppo2');
      // §5.2: "Significant decompression stop violations will result in a "MISSED STOP" notification"
      // (10 s above the ceiling assumed).
      if (this.ceilingViolationSec >= 10) now.push('missed-stop');
      if (this.ascentAlarm) now.push('fast-ascent');
      if (s.oxygen.cns > 150) now.push('very-high-cns');
      if (s.oxygen.cns > 90) now.push('high-cns');
      // §4.10 Low NDL: "at or below the Alert value"; "will reset if the NDL goes above the NDL alert value
      // by 3 minutes".
      const ndlA = this.alertValue('ndlAlert');
      if (ndlA !== null) {
        if (n > ndlA + 3 - 1e-9) this.ndlArmed = true;
        if (this.ndlArmed && !inDeco && n <= ndlA && s.depth > 1) {
          now.push('low-ndl');
          this.ndlArmed = false;
        }
      }
      // §4.10 Depth: "will reset if the depth goes 2m shallower than the alert depth".
      const depthA = this.alertValue('depthAlert');
      if (depthA !== null) {
        if (s.depth < depthA - 2) this.depthArmed = true;
        if (this.depthArmed && s.depth > depthA) {
          now.push('depth-alert');
          this.depthArmed = false;
        }
      }
      // §4.10 Time: "The time alert will only fire once per dive."
      const timeA = this.alertValue('timeAlert');
      if (timeA !== null && !this.timeFired && s.diveTime > timeA * 60) {
        now.push('time-alert');
        this.timeFired = true;
      }
      if (this.airIntegrated(s) && s.tankPressure < this.criticalPressure()) now.push('critical-pres');
    }
    super.tick(s, dt);
    if (!this.hasSafetyStop) this.safetyState = 'none';
    if (this.settings.safety === 'cntup' && this.safetyState === 'active' && this.countUpFrom === null) this.countUpFrom = s.clock;
    // The low NDL, depth and time alerts are raised once (re-armed as above); every notice stays until dismissed.
    this.notices.update(now);
  }

  /** Dive event on display: §4.9 "Dive Events time out after 4 seconds or can be cleared by pressing any button". */
  currentEvent(s: DiveSession): P3Event | null {
    if (this.event && s.clock - this.event.at > 4) this.event = null;
    return this.event?.key ?? null;
  }

  /**
   * §4.9 Persistent Notifications: the alert indicator stays "until the condition that caused the warning
   * is resolved" (which warnings persist is not listed: those of a lasting condition, deduced; figure of
   * §4.9: "HIGH PPO2", "MISSED STOP").
   */
  persistentAlerts(s: DiveSession, v: ComputerView): string[] {
    if (!s.inDive) return [];
    const list: string[] = [];
    if (s.ppO2 < this.lowPpo2) list.push('LOW PPO2');
    if (s.ppO2 > this.ppo2Limit(s, v.inDeco) + 0.03) list.push('HIGH PPO2');
    if (v.ceilingViolation === 2) list.push('MISSED STOP');
    if (s.oxygen.cns > 150) list.push('VERY HIGH CNS');
    else if (s.oxygen.cns > 90) list.push('HIGH CNS');
    if (this.airIntegrated(s) && s.tankPressure < this.criticalPressure()) list.push('T1 CRITICAL PRES');
    return list;
  }

  get soundKind(): AlertCue['kind'] {
    return 'buzz';
  }

  /** The screen dismisses the warning itself (any button, see press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  /**
   * §4.9 Vibration Alerts: "attention vibration alerts occur when a safety stop starts, pauses, or is
   * completed. Vibration alerts also occur any time a primary notification is triggered and every 10
   * seconds until warnings are acknowledged. [...] some persistent conditions, such as low PPO2 [...] will
   * cause vibration to continue until the condition is resolved." No sound (vibration only).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive || (!all && this.settings.vibration === 'off')) return [];
    const cues: AlertCue[] = [];
    if (this.event) cues.push({ key: `${this.event.key}-${this.event.at}`, kind: 'buzz', level: 'info', until: 'once' });
    if (this.hasSafetyStop && v.safety.state !== 'none' && v.safety.state !== 'pending') {
      cues.push({ key: `safety-${v.safety.state}`, kind: 'buzz', level: 'info', until: 'once' });
    }
    for (const key of this.notices.all) cues.push({ key, kind: 'buzz', level: 'warning', until: 'ack', every: 10 });
    if (v.depth > 0 && this.lowPpo2Sec > 30) cues.push({ key: 'low-ppo2-cond', kind: 'buzz', level: 'warning', until: 'clear', every: 10 });
    return cues;
  }

  alertExplain(key: string): AlertExplain | null {
    const dismiss: Bi = { fr: 'Avertissement « WARNING » en jaune dans la ligne du bas, jusqu’à l’appui sur un bouton (§4.9).', en: '“WARNING” in yellow in the bottom row, until a button is pressed (§4.9).' };
    const k = key.replace(/-\d+(\.\d+)?$/, '');
    switch (k) {
      case 'dive-started': return { id: 'dive-started', screen: 'Dive Started', what: { fr: 'La plongée a commencé. Évènement INFO (cyan), 4 s ou jusqu’à l’appui sur un bouton (§4.9).', en: 'The dive has started. INFO event (cyan), 4 s or until a button is pressed (§4.9).' } };
      case 'safety-active': return { id: 'safety-active', title: { fr: 'Palier de sécurité : décompte', en: 'Safety stop: countdown' }, what: { fr: 'Vibration au début du palier de sécurité : au-dessus de 6 m après être passé sous 11 m ; SAFETY sur fond vert (§4.9, §5.1).', en: 'Vibration when the safety stop starts: above 6 m after going below 11 m; SAFETY on green (§4.9, §5.1).' }, todo: { fr: 'Restez entre 2,4 et 8,3 m jusqu’à « CLEAR ».', en: 'Stay between 2.4 and 8.3 m until “CLEAR”.' } };
      case 'safety-paused': return { id: 'safety-paused', title: { fr: 'Palier de sécurité en pause', en: 'Safety stop paused' }, what: { fr: 'Vibration quand le décompte s’arrête : hors de la plage 2,4 – 8,3 m, le temps restant passe en jaune (PAUSED) (§4.9, §5.1).', en: 'Vibration when the countdown pauses: outside 2.4 – 8.3 m, the remaining time turns yellow (PAUSED) (§4.9, §5.1).' }, todo: { fr: 'Revenez entre 2,4 et 8,3 m.', en: 'Go back between 2.4 and 8.3 m.' } };
      case 'safety-done': return { id: 'safety-done', title: { fr: 'Palier de sécurité terminé', en: 'Safety stop complete' }, what: { fr: 'Vibration à la fin du décompte : « CLEAR », vous pouvez remonter (§4.9, §5.1).', en: 'Vibration at the end of the countdown: “CLEAR”, you may ascend (§4.9, §5.1).' } };
      case 'low-ppo2':
      case 'low-ppo2-cond': return { id: 'low-ppo2', screen: 'LOW PPO2', what: { fr: `La PPO2 est restée plus de 30 s sous la limite OC Low PPO2 (0,18 par défaut, §13.1) ; PPO2 et gaz clignotent en rouge ; la vibration continue tant que la PPO2 reste basse (§4.9). ${dismiss.fr}`, en: `The PPO2 stayed below the OC Low PPO2 limit (0.18 by default, §13.1) for more than 30 s; PPO2 and gas flash red; vibration goes on while the PPO2 stays low (§4.9). ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz adapté à cette profondeur.', en: 'Change to a gas safe for this depth.' }, critical: true };
      case 'high-ppo2': return { id: 'high-ppo2', screen: 'HIGH PPO2', code: 'PPO2_HIGH', what: { fr: `La PPO2 est restée plus de 30 s à plus de 0,03 au-dessus de la limite du gaz (OC MOD PPO2 1,40 pour un gaz fond, OC Deco PPO2 1,61 pour un gaz déco, §13.1) ; PPO2 et gaz clignotent en rouge. ${dismiss.fr}`, en: `The PPO2 stayed more than 0.03 above the gas limit (OC MOD PPO2 1.40 for a bottom gas, OC Deco PPO2 1.61 for a deco gas, §13.1) for more than 30 s; PPO2 and gas flash red. ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz adapté à cette profondeur.', en: 'Change to a gas safe for this depth.' } };
      case 'missed-stop': return { id: 'missed-stop', screen: 'MISSED DECO STOP', code: 'CEILING', what: { fr: `Au-dessus du plafond, le palier clignote en rouge ; une violation importante (10 s supposées) déclenche MISSED DECO STOP (texte du tableau du §4.11 ; « MISSED STOP » sur les figures des §5.2 et §7.2). Pas de verrouillage (§5.2). ${dismiss.fr}`, en: `Above the ceiling, the stop flashes red; a significant violation (10 s assumed) triggers MISSED DECO STOP (text of the §4.11 table; “MISSED STOP” on the §5.2 and §7.2 figures). No lock-out (§5.2). ${dismiss.en}` }, todo: { fr: 'Redescendez sous la profondeur du palier ; surveillez les symptômes d’ADD.', en: 'Descend deeper than the stop depth; monitor for symptoms of DCS.' } };
      case 'fast-ascent': return { id: 'fast-ascent', screen: 'FAST ASCENT', code: 'ASCENT', what: { fr: `Remontée plus rapide que 10 m/min de façon soutenue (durée non précisée : 10 s supposées). 1 flèche par 3 m/min : blanches jusqu’à 9 m/min, jaunes jusqu’à 18, rouges clignotantes au-delà (§4.4). ${dismiss.fr}`, en: `Ascent sustained faster than 10 m/min (duration not given: 10 s assumed). 1 arrow per 3 m/min: white up to 9 m/min, yellow up to 18, flashing red beyond (§4.4). ${dismiss.en}` }, todo: { fr: 'Ralentissez la remontée.', en: 'Use a slow ascent rate.' } };
      case 'very-high-cns': return { id: 'very-high-cns', screen: 'VERY HIGH CNS', code: 'CNS', what: { fr: `Le CNS dépasse 150 % ; il s’affiche en rouge (§4.7, §4.11). ${dismiss.fr}`, en: `The CNS exceeds 150 %; it shows in red (§4.7, §4.11). ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz moins riche en O2 ou remontez (plafond permettant).', en: 'Switch to a gas with a lower PPO2 or ascend (ceiling allowing).' } };
      case 'high-cns': return { id: 'high-cns', screen: 'HIGH CNS', code: 'CNS', what: { fr: `Le CNS dépasse 90 % ; il s’affiche en jaune (§4.7, §4.11). ${dismiss.fr}`, en: `The CNS exceeds 90 %; it shows in yellow (§4.7, §4.11). ${dismiss.en}` }, todo: { fr: 'Passez sur un gaz moins riche en O2 ou remontez (plafond permettant).', en: 'Switch to a gas with a lower PPO2 or ascend (ceiling allowing).' } };
      case 'low-ndl': return { id: 'low-ndl', screen: 'LOW NDL ALERT', code: 'NDL_LOW', what: { fr: `Le NDL est au niveau de l’alerte réglée (5 min par défaut) ou en dessous ; il s’affiche en jaune ; l’alerte se réarme quand le NDL repasse 3 min au-dessus (§4.10). ${dismiss.fr}`, en: `The NDL is at or below the set alert (5 min by default); it shows in yellow; the alert resets once the NDL is 3 minutes above it (§4.10). ${dismiss.en}` }, todo: { fr: 'Remontez bientôt pour éviter la décompression.', en: 'Ascend soon to avoid a decompression obligation.' } };
      case 'depth-alert': return { id: 'depth-alert', screen: 'DEPTH ALERT', what: { fr: `Plus profond que l’alerte réglée (40 m par défaut) ; la profondeur passe en jaune ; l’alerte se réarme 2 m au-dessus (§4.10). ${dismiss.fr}`, en: `Deeper than the set alert (40 m by default); the depth turns yellow; the alert resets 2 m shallower (§4.10). ${dismiss.en}` }, todo: { fr: 'Remontez au-dessus de la limite.', en: 'Ascend above the depth limit.' } };
      case 'time-alert': return { id: 'time-alert', screen: 'TIME ALERT', what: { fr: `La durée de plongée dépasse l’alerte réglée (60 min, désactivée par défaut) ; la durée passe en jaune ; une seule fois par plongée (§4.10). ${dismiss.fr}`, en: `The dive time exceeds the set alert (60 min, off by default); the time turns yellow; once per dive (§4.10). ${dismiss.en}` }, todo: { fr: 'Terminez la plongée en sécurité.', en: 'End the dive safely.' } };
      case 'critical-pres': return { id: 'critical-pres', screen: 'T1 CRITICAL PRES', code: 'LOW_GAS', what: { fr: `La pression du bloc est passée sous la pression critique (non définie par le manuel du Perdix 3 : plus grande valeur entre 21 bar et la moitié de la réserve, supposée) ; la pression s’affiche sur fond rouge, sur fond jaune sous la réserve (§11.3, §4.11 : libellé lu dans le texte de la figure, dont l’image montre « AI LOW BATTERY »). ${dismiss.fr}`, en: `The tank pressure dropped below the critical pressure (not defined by the Perdix 3 manual: the larger of 21 bar or half the reserve, assumed); the pressure shows on red, on yellow below the reserve (§11.3, §4.11: label read in the figure's text, whose image shows “AI LOW BATTERY”). ${dismiss.en}` }, todo: { fr: 'Commencez à terminer la plongée et remontez de façon contrôlée.', en: 'Begin to end your dive and perform a controlled ascent.' } };
    }
    return shearwaterExplain(key, {
      dismiss: { fr: 'n’importe quel bouton', en: 'any button' },
      safetyBottom: 8.3,
      ppo2Limit: { fr: '1,43', en: '1.43' },
      arrows: { fr: '1 flèche par 3 m/min : blanches jusqu’à 9 m/min, jaunes jusqu’à 18, rouges clignotantes au-delà.', en: '1 arrow per 3 m/min: white up to 9 m/min, yellow up to 18, flashing red beyond.' },
      missedWhen: { fr: 'après une violation importante du palier', en: 'after a significant stop violation' },
    });
  }
}

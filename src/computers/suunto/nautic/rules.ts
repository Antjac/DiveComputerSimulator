import { type DecoParams, ceilingDepth, ndl } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { remainingTime, sacBarPerMin } from '../../../engine/gas';
import { type AlertCue, type ComputerView, DiveComputer, type SettingDef, type AlertExplain } from '../../base';
import { desaturationTime } from '../../base/tissues';
import { GasPrompt } from '../../common/gasSwitch';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting, pressureValue } from '../../common/tank';

/** §8.2 conservatism presets (GF low / GF high). */
export const PRESETS: Record<string, [number, number]> = { low: [45, 95], medium: [40, 85], high: [35, 75] };

// §8.2: "Select from the preset levels or set your own custom level". Range and step not given: 10 to
// 100 % by 5 assumed (not verified).
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const customGf = (s: Record<string, string>) => s.gf === 'custom';

/**
 * Events that stay until a button is pressed (§7.1: "Acknowledge the first alarm by pressing any button
 * and the next one will appear"; §7.2: user alarms are cleared "by pressing any button"). Mandatory
 * alarms first, in the order of the §7.1 table, then the user configurable alarms of §7.2.
 */
export type NauticNotice =
  | 'po2-max' | 'po2-gas' | 'cns-100' | 'cns-80' | 'otu-300' | 'otu-250' | 'tank-50'
  | 'u-tank' | 'u-depth' | 'u-time' | 'u-ndl' | 'u-gastime';

const NOTICE_ORDER: NauticNotice[] = ['po2-max', 'po2-gas', 'cns-100', 'cns-80', 'otu-300', 'otu-250', 'tank-50', 'u-tank', 'u-depth', 'u-time', 'u-ndl', 'u-gastime'];

const off = { fr: 'Désactivée', en: 'Off' };

/**
 * Suunto Nautic, Single gas and Multigas scuba modes. Rules follow the Suunto Nautic user guide
 * (2026-01-22): Suunto Bühlmann 16 GF (ZHL-16C + gradient factors, §8.1), stepped or continuous deco
 * profile (§8.3), safety stop (§8.4, §9.1), deco window, safe margin and algorithm deviation (§9.2),
 * mandatory and user alarms (§7), gases (§5), Tank POD and gas time (§6).
 */
export abstract class NauticRules extends DiveComputer {
  readonly id = 'nautic';
  readonly name = 'Suunto Nautic';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;
  readonly transmitter = 'Tank POD';
  readonly gasTimeName = 'Gas time';
  readonly notes = {
    fr: 'Suunto Bühlmann 16 GF (§8.1) : Bühlmann ZHL-16C avec facteurs de gradient, Low 45/95, Medium 40/85 (par défaut), High 35/75 ou Custom (bornes non données : 10 à 100 % par 5 supposés ; 50/75 proposé d’après la figure du §8.2). Profil de déco (§8.3) Stepped (paliers de 3 m, minuterie en minutes et secondes dans la fenêtre de déco de 3 m, d’après le texte du §4.5 ; les figures ne montrent que les minutes) ou Continuous (plafond continu, dernier plafond toujours 3 m) ; le réglage par défaut n’est pas indiqué : Stepped supposé (celui des exemples). Vitesse de remontée du calcul 10 m/min. Au-dessus du plafond : marge de 0,6 m (flèche jaune), au-delà flèches rouges, alarme et calcul de déco suspendu ; après 3 min, « ALGORITHM DEVIATION! » (§9.2) : pas de verrouillage, le plan d’origine reste affiché, avertissement rouge jusqu’à la fin des paliers, interdiction de vol de 48 h. Palier de sécurité (§8.4, §9.1) de 3, 4 ou 5 min, Always OFF ou Adjusted, compté entre 2,4 et 6 m, alarme au-dessus de 2,4 m, sans pénalité ; en Adjusted, la réduction après la déco n’est pas décrite : un quart du temps passé entre 2,4 et 6 m pendant la déco est déduit (déduit de l’exemple du §9.6, 1\'30 après les paliers à 6 m), et le temps prévu est compté dans le TTS. Vitesse de remontée (§4.5) : barre à 5 crans de 2 m/min, grise, verte, jaune au-delà de 8, rouge à 10, surlignée en rouge au-delà de 10 m/min pendant 5 s ; aucune pénalité. Alarmes obligatoires du §7.1 (ppO2 au-dessus du réglage du gaz en jaune, au-dessus de 1,6 en rouge, CNS 80/100 %, OTU 250/300, bloc sous 50 bar, fenêtre du palier de sécurité, NDL ≤ 5 min, plafond, vitesse, déviation) : la valeur concernée s’affiche dans la fenêtre de droite jusqu’à l’appui sur un bouton (déduit de la note du §4.6), le son et la vibration se répètent jusqu’à l’appui (intervalle non indiqué : 5 s supposé). Alarmes réglables du §7.2 (pression du bloc 51–360 bar, profondeur, durée, NDL, temps de gaz ; aucune par défaut, aspect Notify cyan ou Caution jaune). Fenêtre de droite (switch window, §4.6) : les vues sont personnalisables sur l’appareil ; seules les vues 1 et 2 apparaissent dans le manuel, les suivantes sont une liste supposée. Bouton OK : vue suivante ; Back : chronomètre (vue Stopwatch) ; Up : luminosité (appui long : lampe) ; Down : menu de plongée (appui long : verrouillage des boutons). Disposition des boutons déduite de la photo du §2 (Up et Back en haut, Down et OK en bas). Mode Multigas (§4.3, §5.2) : jusqu’à 5 gaz, tous comptés dans le calcul, invite « SWITCH GAS » dans la fenêtre de droite en remontant au MOD d’un meilleur gaz ; n’importe quel bouton ouvre la liste (gaz recommandé en premier), OK confirme, Back ignore la proposition (le manuel cite un « bouton du milieu » que le Nautic n’a pas : OK supposé). ppO2 de chaque gaz 1,4 bar par défaut (§5.1 ; l’exemple du §5.2 règle 1,6 pour les gaz de déco). Interdiction de vol (§11.1) : au moins 12 h, la désaturation au-delà, rien sous 75 min de désaturation, 48 h après une déviation ; visible seulement dans l’historique (non affichée ici). Valeurs fictives : batterie. Non simulés : altitude, type d’eau, algorithme désactivé, boussole, GPS, cardiofréquencemètre, sidemount, fin de plongée réglable (5 min), carnet, planificateur, widgets.',
    en: 'Suunto Bühlmann 16 GF (§8.1): Bühlmann ZHL-16C with gradient factors, Low 45/95, Medium 40/85 (default), High 35/75 or Custom (range not given: 10 to 100 % by 5 assumed; 50/75 offered after the §8.2 figure). Deco profile (§8.3) Stepped (3 m stops, timer in minutes and seconds in the 3 m deco window, after the §4.5 text; the figures show minutes only) or Continuous (continuous ceiling, last ceiling always 3 m); the default is not given: Stepped assumed (the one of the examples). Ascent rate of the calculation 10 m/min. Above the ceiling: 0.6 m safe margin (yellow arrow), beyond it red arrows, alarm and deco calculation paused; after 3 min, "ALGORITHM DEVIATION!" (§9.2): no lock, the original plan stays on screen, red warning until the stops are cleared, 48 h no-fly time. Safety stop (§8.4, §9.1) of 3, 4 or 5 min, Always OFF or Adjusted, counted between 2.4 and 6 m, alarm above 2.4 m, no penalty; with Adjusted, the reduction after deco is not described: a quarter of the time spent between 2.4 and 6 m during deco is taken off (deduced from the §9.6 example, 1\'30 after the 6 m stops), and the predicted time is counted in TTS. Ascent rate (§4.5): bar of 5 steps of 2 m/min, gray, green, yellow above 8, red at 10, highlighted red above 10 m/min for 5 s; no penalty. Mandatory alarms of §7.1 (ppO2 above the gas setting in yellow, above 1.6 in red, CNS 80/100 %, OTU 250/300, tank below 50 bar, safety stop window, NDL ≤ 5 min, ceiling, ascent rate, deviation): the value concerned shows in the right window until a button is pressed (deduced from the §4.6 note), tone and vibration repeat until a button is pressed (interval not given: 5 s assumed). User alarms of §7.2 (tank pressure 51–360 bar, depth, dive time, NDL, gas time; none by default, Notify cyan or Caution yellow look). Right window (switch window, §4.6): the views are customised on the device; only views 1 and 2 appear in the manual, the next ones are an assumed list. OK button: next view; Back: stopwatch (Stopwatch view); Up: brightness (hold: flashlight); Down: dive menu (hold: button lock). Button positions deduced from the §2 photo (Up and Back on top, Down and OK at the bottom). Multigas mode (§4.3, §5.2): up to 5 gases, all counted in the calculation, "SWITCH GAS" prompt in the right window when ascending to the MOD of a better gas; any button opens the list (recommended gas first), OK confirms, Back dismisses the suggestion (the manual mentions a "middle button" the Nautic does not have: OK assumed). ppO2 of each gas 1.4 bar by default (§5.1; the §5.2 example sets 1.6 for the deco gases). No-fly time (§11.1): at least 12 h, the desaturation time beyond, none below 75 min of desaturation, 48 h after a deviation; shown in the dive history only (not displayed here). Fictitious values: battery. Not simulated: altitude, water type, algorithm off, compass, GPS, heart rate, sidemount, settable dive end time (5 min), logbook, planner, widgets.',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §4.3: "Suunto Nautic has two scuba dive modes". Default not given: Single gas assumed (listed first).
      key: 'multigas',
      label: { fr: 'Mode de plongée', en: 'Dive mode' },
      options: [{ value: 'off', label: 'Single gas' }, { value: 'on', label: 'Multigas' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §4.5 note: "You can customize this field to show both NDL and TTS value at the same time".
      key: 'decoField',
      essential: true,
      label: { fr: 'Champ de décompression', en: 'Decompression field' },
      options: [{ value: 'ndl', label: 'NDL' }, { value: 'ndltts', label: 'NDL + TTS' }],
      default: 'ndl',
    },
    {
      key: 'gf',
      label: { fr: 'Conservatisme', en: 'Conservatism' },
      options: [
        { value: 'low', label: 'Low (45/95)' },
        { value: 'medium', label: 'Medium (40/85)' },
        { value: 'high', label: 'High (35/75)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'medium',
      group: 'deco',
    },
    {
      key: 'gfLow',
      label: { fr: 'GF bas (Custom)', en: 'GF low (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '50',
      showIf: customGf,
      group: 'deco',
    },
    {
      key: 'gfHigh',
      label: { fr: 'GF haut (Custom)', en: 'GF high (Custom)' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '75',
      showIf: customGf,
      group: 'deco',
    },
    {
      // §8.3 Deco profile. Default not given: Stepped assumed (the §4.5 and §9.6 figures).
      key: 'profile',
      label: { fr: 'Profil de déco (Deco profile)', en: 'Deco profile' },
      options: [{ value: 'stepped', label: 'Stepped' }, { value: 'continuous', label: 'Continuous' }],
      default: 'stepped',
      group: 'deco',
    },
    {
      // §8.4: 3, 4 or 5 min, Always OFF, Adjusted; "the default length is 3 minutes" (§4.5).
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [
        { value: '3', label: '3 min' },
        { value: '4', label: '4 min' },
        { value: '5', label: '5 min' },
        { value: 'off', label: 'Always OFF' },
        { value: 'adjusted', label: 'Adjusted' },
      ],
      default: '3',
      group: 'deco',
    },
    {
      // §8.5: 3 m or 6 m, 3 m by default.
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last deco stop)', en: 'Last deco stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
      group: 'deco',
    },
    // §5.1: "You can set ppO₂ to 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, or 1.6 bar", 1.4 bar by default.
    { ...ppo2Setting(1.0, 1.6, 1.4, 'ppO2'), group: 'deco' },
    {
      // §5.1: each gas has its own ppO2 (1.4 bar by default; the §5.2 example uses 1.6 for deco gases).
      key: 'po2Deco',
      label: { fr: 'ppO2 des gaz de déco', en: 'Deco gas ppO2' },
      options: [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.40',
      group: 'deco',
      showIf: (s) => s.multigas === 'on',
    },
    // §7.2 user configurable alarms: none set by default (assumed: "If set", §9.5). Ranges: tank pressure
    // 51–360 bar, depth 3.0–199.0 m, dive time up to 99 min; NDL and gas time ranges not given.
    pressureSetting('tankAlarm', { fr: 'Alarme de pression du bloc', en: 'Tank pressure alarm' }, 60, 300, 10, 'off', off),
    {
      key: 'depthAlarm',
      label: { fr: 'Alarme de profondeur', en: 'Depth alarm' },
      options: [{ value: 'off', label: off }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      key: 'timeAlarm',
      label: { fr: 'Alarme de durée de plongée', en: 'Dive time alarm' },
      options: [{ value: 'off', label: off }, ...Array.from({ length: 19 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} min` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      key: 'ndlAlarm',
      label: { fr: 'Alarme de NDL', en: 'NDL alarm' },
      options: [{ value: 'off', label: off }, ...[6, 8, 10, 15, 20].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      key: 'gasTimeAlarm',
      label: { fr: 'Alarme de temps de gaz', en: 'Gas time alarm' },
      options: [{ value: 'off', label: off }, ...[5, 10, 15, 20, 30].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      // §7.2: "two different appearance options: Notify (cyan) or Caution (yellow)", chosen per alarm
      // (one choice for all here). Default not given: Notify assumed (first in the menu figure).
      key: 'alarmLook',
      label: { fr: 'Aspect des alarmes réglables', en: 'User alarm appearance' },
      options: [{ value: 'notify', label: 'Notify' }, { value: 'caution', label: 'Caution' }],
      default: 'notify',
      group: 'alerts',
    },
    {
      // §7: "Mute all audio" / "Mute all vibration" (Alarms menu). Default not given: off assumed.
      key: 'muteAudio',
      label: { fr: 'Couper tous les sons (Mute all audio)', en: 'Mute all audio' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
      group: 'sound',
    },
    {
      key: 'muteVibration',
      label: { fr: 'Couper toutes les vibrations (Mute all vibration)', en: 'Mute all vibration' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
      group: 'sound',
    },
  ];

  /** §9.2: the ceiling broken for more than 3 min during this dive. */
  deviation = false;
  /** Clock of the end of the last dive with an algorithm deviation (48 h no-fly, §11.1). */
  deviationEnd: number | null = null;
  /** The algorithm deviation alert has been confirmed with a button. */
  deviationAcked = false;
  /** Seconds spent in the safety stop window (2.4–6 m) during deco stops (Adjusted safety stop). */
  protected shallowDeco = 0;
  /** Seconds since the diver came shallower than the dive start depth during the dive (§4.5 Surface time). */
  protected surfacedSec = 0;
  /** The deco obligation of the previous tick (§4.5 Deco time alarm when it starts). */
  protected wasDeco = false;
  /** §4.5 Deco time: "An alarm is also triggered that can be confirmed by pressing any button". */
  protected decoAcked = true;

  protected notices = new Notices<NauticNotice>(NOTICE_ORDER);
  /** §5.2: "When ascending, you are always notified to change gas when a better gas is available." */
  protected prompt = new GasPrompt();

  constructor() {
    super();
    // §9.1: stop for every dive over 10 m, counted between 2.4 and 6 m. Going back below 10 m restarting
    // it is not described (assumed, as on the other Suunto models).
    this.safetyStop = { trigger: 10, start: 6, top: 2.4, bottom: 6, reset: 10 };
    this.ascentAlarmDelay = 5; // §7.1: "for five seconds or more"
    this.ceilingMargin = 0.6; // §9.2: "safe margin area, equalling to the ceiling depth minus 0.6 meters"
    this.lockAfter = null; // §9.2: "Suunto Nautic does not lock"
    this.stopWindow = 3; // §9.2: "a decompression window at 3 m (9.8 ft) between the decompression floor and decompression ceiling"
    this.ndlCap = 100; // §4.5: "If NDL time is above 99 minutes, it is displayed as >99"
    this.screenTimeout = 0;
    this.init();
    this.syncProfile();
  }

  /** §8.3: the stepped profile guards the next 3 m step, the continuous one the ceiling itself. */
  protected syncProfile(): void {
    this.violationRef = this.settings.profile === 'continuous' ? 'ceiling' : 'stop';
  }

  settingChanged(key: string, previous: string): void {
    this.syncProfile();
    // Custom starts from the preset in use (not described in the manual).
    const preset = PRESETS[previous];
    if (key === 'gf' && this.settings.gf === 'custom' && preset) [this.settings.gfLow, this.settings.gfHigh] = preset.map(String);
  }

  get continuous(): boolean {
    return this.settings.profile === 'continuous';
  }

  baseParams(): DecoParams {
    let [lo, hi] = this.settings.gf === 'custom'
      ? [Number(this.settings.gfLow), Number(this.settings.gfHigh)]
      : PRESETS[this.settings.gf] ?? PRESETS.medium;
    lo = Math.min(lo, hi); // a GF low above the GF high is not meaningful (the device's check is not described)
    // §8.5: "This setting does not affect the ceiling depth on a decompression dive. The last ceiling
    // depth is always 3 m": the 6 m last stop applies to the stepped profile only.
    const lastStop = this.continuous ? 3 : Number(this.settings.lastStop);
    // §9.2 warning: the ascent time assumes 10 m/min ("ascend slower than 10 m/min").
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop, stopStep: 3, ascentRate: 10 };
  }

  /** §4.3, §5.2: Multigas mode, "Up to five enabled and disabled gases"; Single gas: one active gas. */
  get maxGases(): number {
    return this.settings.multigas === 'on' ? 5 : 1;
  }

  /** §5.1: each gas has its own ppO2 (its MOD). */
  decoPpo2(): number {
    return Number(this.settings.po2Deco) || 1.4;
  }

  /** MOD of each gas (its own ppO2), where the Switch gas notification is given. */
  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** §6.1: the Tank POD is linked to a gas; here only the main tank has one. */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /** §4.5: "Gray … less than 2 m/min, Green … 4 to 8, Yellow … over 8, Red … 10 m/min". */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : rate > 8 ? 1 : 0;
  }

  /** §7.1: "Ascent speed exceeds safe speed of 10 m (33 ft) per minute for five seconds or more". */
  ascentAlarmCondition(rate: number): boolean {
    return rate > 10;
  }

  get hasSafetyStop(): boolean {
    return this.settings.safety !== 'off';
  }

  /**
   * §8.4: 3, 4 or 5 min ("Ascent speed violation during dive does not make the safety stop time
   * longer"). Adjusted: 3 min after decompression, "shorter if the time is spent in the shallow"; the
   * rule is not given: a quarter of the time spent between 2.4 and 6 m during the deco stops is taken
   * off (deduced from the §9.6 example: the countdown starts at 1'30 after the stops at 6 m).
   */
  safetySeconds(): number {
    const v = this.settings.safety;
    if (v === 'adjusted') return Math.max(0, Math.round(180 - this.shallowDeco / 4));
    return (Number(v) || 3) * 60;
  }

  /**
   * §6.4: "the maximum time (in minutes) you can stay at the current depth and ascend to the surface (at
   * an ascent rate of 10 m/min) with an end pressure of 35 bar"; "Safety stops and decompression stops
   * are not included".
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return remainingTime({ tissues: s.tissues, depth: s.depth, gas: s.gas, tankPressure: s.tankPressure, reserve: 35, sacBar, rate: () => 10, deco: null, max: 599 });
  }

  /** §7.2: the configurable tank pressure alarm (bar), null when not set. */
  tankAlarm(): number | null {
    return pressureValue(this.settings, 'tankAlarm');
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deviation = false;
    this.deviationAcked = false;
    this.shallowDeco = 0;
    this.surfacedSec = 0;
    this.wasDeco = false;
    this.notices.clear();
    this.prompt.reset();
  }

  onDiveEnd(s: DiveSession): void {
    if (this.deviation) this.deviationEnd = s.lastDiveEnd;
  }

  /** User alarm on: Caution (yellow) or Notify (cyan). */
  get userLook(): 'notify' | 'caution' {
    return this.settings.alarmLook === 'caution' ? 'caution' : 'notify';
  }

  private updateNotices(s: DiveSession, inDeco: boolean): void {
    const now: NauticNotice[] = [];
    // §7.1: "Partial pressure of oxygen exceeds the maximum level (>1.6)" / "exceeds the set level for the gas".
    const setLevel = s.breathing > 0 && this.maxGases > 1 ? this.decoPpo2() : this.modPpo2;
    if (s.ppO2 > 1.6) now.push('po2-max');
    else if (s.ppO2 > setLevel + 0.005) now.push('po2-gas');
    // §4.6 OTU CNS: "alarms you when CNS% reaches 80% (caution) and when the 100% limit (warning) is
    // exceeded"; OTU "250 (caution) and 300 (warning)".
    if (s.oxygen.cns >= 100) now.push('cns-100');
    else if (s.oxygen.cns >= 80) now.push('cns-80');
    if (s.oxygen.otu >= 300) now.push('otu-300');
    else if (s.oxygen.otu >= 250) now.push('otu-250');
    const ai = this.airIntegrated(s);
    // §7.1: "Tank pressure is below 50 bar (725 psi)".
    if (ai && s.tankPressure < 50) now.push('tank-50');
    const tank = this.tankAlarm();
    if (ai && tank !== null && s.tankPressure < tank) now.push('u-tank');
    const depthAl = Number(this.settings.depthAlarm);
    if (depthAl > 0 && s.depth >= depthAl) now.push('u-depth');
    const timeAl = Number(this.settings.timeAlarm);
    if (timeAl > 0 && s.diveTime >= timeAl * 60) now.push('u-time');
    const ndlAl = Number(this.settings.ndlAlarm);
    if (ndlAl > 0 && !inDeco && s.depth > 1.2 && ndl(s.tissues, s.depth, s.gas, this.decoParams(s).gfHigh, this.ndlCap) <= ndlAl) now.push('u-ndl');
    const gtAl = Number(this.settings.gasTimeAlarm);
    if (gtAl > 0 && ai) {
      const gt = this.gasTime(s, this.decoParams(s), sacBarPerMin(s.rmv, s.tank.volume));
      if (gt !== null && gt < gtAl) now.push('u-gastime');
    }
    this.notices.update(now);
  }

  tick(s: DiveSession, dt: number): void {
    this.syncProfile();
    super.tick(s, dt);
    if (!s.inDive) return;
    // §9.2: "If you ignore the alarm and stay above the safe margin for three minutes, the stop is
    // considered missed and an algorithm violation notification will appear."
    if (this.ceilingViolationSec >= 180 && !this.deviation) {
      this.deviation = true;
      this.deviationAcked = false;
    }
    const inDeco = ceilingDepth(s.tissues, this.anchor, this.decoParams(s)) > 0;
    if (inDeco && s.depth >= this.safetyStop.top && s.depth <= this.safetyStop.bottom) this.shallowDeco += dt;
    this.surfacedSec = s.depth < 1.2 ? this.surfacedSec + dt : 0;
    if (inDeco && !this.wasDeco) this.decoAcked = false;
    this.wasDeco = inDeco;
    this.updateNotices(s, inDeco);
    if (this.maxGases > 1) this.prompt.update(s, this.gasMods(s), null);
  }

  /** §8.5: "The last ceiling depth is always 3 m": the continuous ceiling does not rise above 3 m before it clears. */
  protected violationDepth(ceil: number, p: DecoParams): number {
    if (this.continuous) return ceil > 0 ? Math.max(ceil, 3) : 0;
    return super.violationDepth(ceil, p);
  }

  compute(s: DiveSession): ComputerView {
    this.syncProfile();
    const v = super.compute(s);
    if (this.continuous && v.inDeco) v.ceiling = Math.max(v.ceiling, 3);
    // §8.4 Adjusted: "The predicted time is included in TTS"; the fixed safety stops are not.
    if (s.inDive && this.settings.safety === 'adjusted' && ['pending', 'active', 'paused'].includes(this.safetyState)) {
      v.tts += Math.ceil(this.safetyRemaining / 60);
    }
    if (!s.inDive && s.lastDiveEnd !== null) {
      // §11.1: "always at least 12 hours and equals desaturation time when it is more than 12 hours. For
      // desaturation times shorter than 75 minutes, no-fly time is not displayed. If an algorithm
      // deviation has occurred during the dive, the no-fly time is always 48 hours."
      const since = (s.clock - s.lastDiveEnd) / 60;
      const desat = desaturationTime(s.tissues);
      v.noFly = desat < 75 ? 0 : Math.max(12 * 60 - since, desat, 0);
      if (this.deviationEnd !== null && this.deviationEnd === s.lastDiveEnd) v.noFly = Math.max(0, 48 * 60 - since);
    }
    return v;
  }

  /** §7: tones and vibration, unless muted. */
  get soundKind(): AlertCue['kind'] {
    const audio = this.settings.muteAudio !== 'on';
    const vib = this.settings.muteVibration !== 'on';
    return audio && vib ? 'both' : audio ? 'beep' : 'buzz';
  }

  /**
   * §7: warnings "are shown prominently on the display with an audible and vibration alarm unless the
   * audio or vibration is muted"; "You can dismiss the audio and vibration but the warning will stay red
   * until the situation has been resolved". §7.2: user alarms with their own tone and vibration (one
   * sound assumed, cleared by any button).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive || (!all && this.settings.muteAudio === 'on' && this.settings.muteVibration === 'on')) return [];
    const kind = this.soundKind;
    const cues: AlertCue[] = [];
    const warn = (key: string, level: AlertCue['level']) => cues.push({ key, kind, level, until: 'ack', every: 5 });
    if (v.alarms.includes('ASCENT')) warn('ascent', 'alarm');
    if (v.ceilingViolation === 2) warn('ceiling', 'alarm');
    if (this.deviation && !this.deviationAcked) warn('deviation', 'alarm');
    if (v.inDeco && !this.decoAcked) warn('deco', 'warning');
    if (!v.inDeco && v.ndl <= 5 && v.depth > 1.2) warn('ndl-5', 'warning');
    if (this.safetyBroken(v)) warn('safety', 'warning');
    for (const k of this.notices.all) {
      if (k.startsWith('u-')) cues.push({ key: k, kind, level: this.userLook === 'caution' ? 'warning' : 'info', until: 'once' });
      else warn(k, k === 'po2-max' || k === 'cns-100' || k === 'otu-300' || k === 'tank-50' ? 'alarm' : 'warning');
    }
    if (this.prompt.offer !== null) cues.push({ key: `gas-${this.prompt.offer}`, kind, level: 'info', until: 'once' });
    return cues;
  }

  /**
   * Alert bubble (app/alertHelp.ts): §7.1 alarm table (ascent, ceiling, ppO2, CNS / OTU, tank,
   * safety stop window), §9.2 decompression (window, safe margin, algorithm deviation, no lock),
   * §4.5 ascent bar, §4.6 ppO2 / CNS / OTU, §7.2 user alarms, §5.2 gas switch, §11.1 no-fly.
   */
  alertExplain(key: string): AlertExplain | null {
    const ack = { fr: 'Un bouton coupe le son et la vibration ; l’alerte reste en rouge tant que la situation dure.', en: 'A button silences the sound and vibration; the alert stays red while the situation lasts.' };
    const user = { fr: 'Alarme utilisateur (réglée dans l’application Suunto, aucune par défaut), avec son propre son ; un bouton l’efface.', en: 'User alarm (set in the Suunto app, none by default), with its own tone; a button clears it.' };
    if (key.startsWith('gas-')) {
      return {
        id: 'gas', screen: 'SWITCH GAS',
        what: { fr: 'En remontant, le gaz suivant devient respirable (sa MOD est atteinte) : grand cadre cyan « SWITCH GAS » avec le gaz proposé.', en: 'While ascending, the next gas becomes breathable (its MOD is reached): large cyan “SWITCH GAS” field with the suggested gas.' },
        todo: { fr: 'Un bouton ouvre la liste des gaz, le gaz conseillé en premier ; OK pour confirmer, Back pour refuser.', en: 'A button opens the gas list, the suggested gas first; OK to confirm, Back to decline.' },
      };
    }
    switch (key) {
      case 'ascent':
        return {
          code: 'ASCENT',
          what: { fr: `Alarme quand la remontée dépasse 10 m/min pendant 5 s ou plus. La barre de vitesse compte un cran par 2 m/min : verte, jaune au-delà de 8 m/min, rouge à 10. ${ack.fr}`, en: `Alarm when the ascent exceeds 10 m/min for 5 s or more. The rate bar has one step per 2 m/min: green, yellow beyond 8 m/min, red at 10. ${ack.en}` },
        };
      case 'ceiling':
        return {
          code: 'CEILING',
          what: { fr: `Alarme au-delà de la marge de sécurité, 0,6 m au-dessus du plafond ; la fenêtre de déco va du plafond à 3 m plus profond. Après 3 min au-delà, le palier est considéré comme manqué : « ALGORITHM DEVIATION! ». ${ack.fr}`, en: `Alarm beyond the safe margin, 0.6 m above the ceiling; the deco window runs from the ceiling to 3 m deeper. After 3 min beyond it, the stop counts as missed: “ALGORITHM DEVIATION!”. ${ack.en}` },
        };
      case 'deviation':
        return {
          screen: 'ALGORITHM DEVIATION!', critical: true,
          what: { fr: 'Palier manqué : plus de 3 min au-delà de la marge de sécurité. Grand cadre rouge « ALGORITHM DEVIATION! SURPASSED THE DECO CEILING », puis « ALGORITHM DEVIATION! » jusqu’à la fin des paliers. Le Nautic ne se verrouille pas, mais l’interdiction de vol passe à 48 h.', en: 'Missed stop: more than 3 min beyond the safe margin. Large red “ALGORITHM DEVIATION! SURPASSED THE DECO CEILING” field, then “ALGORITHM DEVIATION!” until the stops are cleared. The Nautic does not lock, but the no-fly time becomes 48 h.' },
          todo: { fr: 'Redescendez sous le plafond et terminez les paliers, puis surveillez l’apparition de symptômes. Un bouton acquitte l’alerte.', en: 'Go back below the ceiling and complete the stops, then watch for symptoms. A button acknowledges the alert.' },
        };
      case 'deco':
        return {
          code: 'DECO',
          what: { fr: `Badge « DECO » orange à la place de « NO DECO », TTS (supposant une remontée à 10 m/min) et palier (paliers de 3 m, ou plafond continu selon le réglage Deco profile). ${ack.fr}`, en: `Orange “DECO” badge in place of “NO DECO”, TTS (assuming a 10 m/min ascent) and stop (3 m steps, or a continuous ceiling with the Deco profile setting). ${ack.en}` },
        };
      case 'ndl-5':
        return { code: 'NDL_LOW', what: { fr: `Avertissement à 5 min de NDL ou moins ; la jauge de NDL passe en hachuré. ${ack.fr}`, en: `Warning at 5 minutes of NDL or less; the NDL bar turns hatched. ${ack.en}` } };
      case 'safety':
        return {
          title: { fr: 'Hors de la fenêtre du palier de sécurité', en: 'Not inside the safety stop window' },
          what: { fr: `Avertissement : vous êtes remonté au-dessus de 2,4 m avant la fin du palier de sécurité (compté entre 2,4 et 6 m). ${ack.fr}`, en: `Warning: you went above 2.4 m before the safety stop was complete (counted between 2.4 and 6 m). ${ack.en}` },
          todo: { fr: 'Redescendez entre 3 et 6 m pour le terminer.', en: 'Go back down to 3–6 m to finish it.' },
        };
      case 'po2-max':
        return { code: 'PPO2_HIGH', what: { fr: `Alarme : la ppO₂ dépasse 1,6 ; la fenêtre ppO₂ / MOD passe au rouge. ${ack.fr}`, en: `Alarm: the ppO₂ exceeds 1.6; the ppO₂ / MOD window turns red. ${ack.en}` } };
      case 'po2-gas':
        return {
          title: { fr: 'ppO₂ au-dessus de la limite du gaz', en: 'ppO₂ above the gas limit' },
          what: { fr: `Avertissement : la ppO₂ dépasse la limite réglée pour ce gaz (sans atteindre 1,6) ; la fenêtre ppO₂ / MOD passe au jaune. ${ack.fr}`, en: `Warning: the ppO₂ exceeds the limit set for this gas (below 1.6); the ppO₂ / MOD window turns yellow. ${ack.en}` },
          todo: { fr: 'Remontez au-dessus de la MOD affichée.', en: 'Ascend above the displayed MOD.' },
        };
      case 'cns-100':
        return { code: 'CNS', what: { fr: `Avertissement : le CNS dépasse la limite de 100 %. ${ack.fr}`, en: `Warning: the CNS exceeds the 100 % limit. ${ack.en}` }, todo: { fr: 'Terminez la plongée.', en: 'End the dive.' } };
      case 'cns-80':
        return { code: 'CNS', what: { fr: `Mise en garde : le CNS atteint 80 %. ${ack.fr}`, en: `Caution: the CNS reaches 80 %. ${ack.en}` } };
      case 'otu-300':
        return { screen: 'OTU 300', what: { fr: `Avertissement : 300 OTU (exposition des poumons à l’oxygène). ${ack.fr}`, en: `Warning: 300 OTU (the lungs’ oxygen exposure). ${ack.en}` }, todo: { fr: 'Terminez la plongée et limitez l’oxygène pour la journée.', en: 'End the dive and limit oxygen for the day.' } };
      case 'otu-250':
        return { screen: 'OTU 250', what: { fr: `Mise en garde : 250 OTU. ${ack.fr}`, en: `Caution: 250 OTU. ${ack.en}` } };
      case 'tank-50':
        return { screen: 'TANK PRESSURE', code: 'LOW_GAS', what: { fr: `Alarme : la pression du bloc (Tank POD) passe sous 50 bar ; grand cadre rouge avec la pression. ${ack.fr}`, en: `Alarm: the tank pressure (Tank POD) drops below 50 bar; large red field with the pressure. ${ack.en}` } };
      case 'u-tank':
        return { screen: 'TANK PRESSURE', code: 'LOW_GAS', what: { fr: `${user.fr} La pression passe sous la valeur choisie.`, en: `${user.en} The pressure drops below the chosen value.` } };
      case 'u-depth':
        return { title: { fr: 'Alarme de profondeur', en: 'Depth alarm' }, what: { fr: `${user.fr} Vous avez atteint la profondeur choisie.`, en: `${user.en} You reached the chosen depth.` }, todo: { fr: 'Vérifiez la profondeur prévue.', en: 'Check the planned depth.' } };
      case 'u-time':
        return { title: { fr: 'Alarme de durée', en: 'Dive time alarm' }, what: { fr: `${user.fr} La durée de plongée a atteint la valeur choisie.`, en: `${user.en} The dive time reached the chosen value.` }, todo: { fr: 'Préparez la remontée.', en: 'Get ready to ascend.' } };
      case 'u-ndl':
        return { code: 'NDL_LOW', what: { fr: `${user.fr} Le NDL est descendu à la valeur choisie.`, en: `${user.en} The NDL dropped to the chosen value.` } };
      case 'u-gastime':
        return { screen: 'GAS TIME', code: 'LOW_GAS', what: { fr: `${user.fr} Le temps de gaz restant passe sous la valeur choisie.`, en: `${user.en} The remaining gas time drops below the chosen value.` } };
      default:
        return null;
    }
  }

  /** §7.1 "Not inside the safety stop window": shallower than 2.4 m before the stop is done (§9.1). */
  safetyBroken(v: ComputerView): boolean {
    const st = this.safetyState;
    return v.inDive && !v.inDeco && this.hasSafetyStop && (st === 'active' || st === 'paused') && v.depth < this.safetyStop.top && v.depth >= 1.2;
  }

  /** The press acknowledges the alarm cues (the screen handles its own notices, see press()). */
  acknowledgeAlerts(): boolean {
    this.decoAcked = true;
    return false;
  }
}

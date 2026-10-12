import type { DecoParams } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { depthToPressure } from '../../../engine/buhlmann';
import { sacBarPerMin } from '../../../engine/gas';
import { type AlertCue, type AlertExplain, type ComputerView, DiveComputer, type SettingDef } from '../../base';
import { desaturationTime } from '../../base/tissues';
import { GasPrompt } from '../../common/gasSwitch';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting, pressureValue } from '../../common/tank';
import { PERSONAL } from '../d5/rules';

/**
 * §4.1 pop-ups, acknowledged with a button: alarms with a pop-up (pO2 high / low, figures), warnings,
 * then notifications, each in the order of its table. `ceiling-broken` is the Bühlmann 16 GF warning
 * of §4.6.2, approved with the middle button only.
 */
export type EonNotice =
  | 'po2-high' | 'po2-low' | 'ceiling-broken'
  | 'cns-100' | 'otu-300' | 'depth' | 'dive-time' | 'gas-time' | 'safety-broken' | 'tank-50' | 'tank-alarm'
  | 'cns-80' | 'otu-250' | 'change-gas';

const NOTICE_ORDER: EonNotice[] = ['po2-high', 'po2-low', 'ceiling-broken', 'cns-100', 'otu-300', 'depth', 'dive-time', 'gas-time', 'safety-broken', 'tank-50', 'tank-alarm', 'cns-80', 'otu-250', 'change-gas'];

export interface DeepStop {
  target: number;
  remaining: number;
  state: 'pending' | 'active' | 'done';
}

// §4.10.2.1: "The default setting of Suunto's Bühlmann 16 GF dive algorithm is 30/70." Range and step
// not given: 10 to 100 % by 5 assumed (not verified).
const GF_VALUES = Array.from({ length: 19 }, (_, i) => String(10 + i * 5));
const buhlmannOn = (s: Record<string, string>) => s.algo === 'buhlmann';
const off = { fr: 'Désactivée', en: 'Off' };

/**
 * Suunto EON Core, Air/Nitrox mode. Rules follow the Suunto EON Core user guide 4.0 (2025-02-06):
 * two algorithms (§4.10), Suunto Fused RGBM 2 (proprietary: approximated with Bühlmann + personal
 * setting + penalties, like the D5 which runs the same algorithm) or Suunto Bühlmann 16 GF (ZHL-16C
 * + GF, reproduced); decompression window, safe margin and algorithm lock (§4.6, §4.11), deco profile
 * (§4.12), safety stops and deepstops (§4.27), alarms, warnings and notifications (§4.1).
 */
export abstract class EonCoreRules extends DiveComputer {
  readonly id = 'eoncore';
  readonly name = 'Suunto EON Core';
  readonly transmitter = 'Tank POD';
  readonly gasTimeName = 'gas time';

  /** §4.10: "Choose the appropriate algorithm for your dive under Dive settings » Parameters » Algorithm". */
  get buhlmann(): boolean {
    return this.settings.algo === 'buhlmann';
  }

  get algorithm(): string {
    return this.buhlmann ? 'Bühlmann ZHL-16C + GF' : 'Suunto Fused RGBM 2 (≈)';
  }

  get exact(): boolean {
    return this.buhlmann;
  }

  readonly notes = {
    fr: 'Deux algorithmes (§4.10, réglage Algorithm) : Suunto Fused RGBM 2, propriétaire (approximation : Bühlmann + réglage personnel −2 à +2 calibré sur les NDL publiées pour cet algorithme, pénalités en successives et après remontée rapide), algorithme par défaut d’après le §4.16 ; ou Suunto Bühlmann 16 GF (ZHL-16C avec facteurs de gradient, reproduit), 30/70 par défaut, valeurs réglables (bornes non indiquées : 10 à 100 % par 5 supposés). Profil de déco (§4.12) Continuous (plafond continu, dernier plafond toujours 3 m) ou Stepped (paliers de 3 m) ; valeur par défaut non indiquée : Continuous supposé. Vitesse de remontée du calcul 10 m/min (§4.11). Fenêtre de déco du plafond à 3 m plus profond (flèches blanches), marge de 0,6 m (flèche et plafond jaunes), au-delà flèche rouge, alarme et calcul suspendu ; Fused RGBM 2 : verrouillage de 48 h après 3 min (« Locked », interdiction de vol 48 h, relancée par une plongée verrouillée) ; Bühlmann 16 GF : pas de verrouillage, avertissement « WARNING: Ceiling broken » (approuvé avec le bouton du milieu) puis bandeau rouge CEILING BROKEN à gauche jusqu’à la fin de la plongée ; le délai de déclenchement n’est pas indiqué : 3 min au-delà de la marge supposées, comme le verrouillage. Deepstops (§4.27, activés par défaut, Fused RGBM 2) : à mi-profondeur au-delà de 20 m, un second à la moitié du premier, 2 min chacun (durée du premier non indiquée : 2 min supposées), comptés de la cible + 0,5 m à la cible − 3 m ; avec Bühlmann 16 GF, le manuel ne dit pas s’ils restent : non supposé (le GF bas en tient lieu, §4.10.2.1). Palier de sécurité de 3, 4 ou 5 min, compté entre 2,4 et 6 m, obligatoire (rouge) après une remontée trop rapide et allongé à chaque violation (allongement non indiqué : 30 s par violation supposées) ; « Safety stop broken » au-dessus de 2,4 m (plafond de 3,0 m moins 0,6 m, déduit). Barre de remontée : un cran par 2 m/min, verte, jaune de 8 à 10, rouge au-delà, alarme après 5 s. Écran : style Prominent par défaut (§4.16), d’après les figures ; vue No deco (jauge No deco graduée de 0 à 100 min, d’après les figures) ; avec le réglage « Vues personnalisées », vues Tank pressure et Timer (§4.16.1) ; la vue Compass n’est pas simulée. Fenêtre en bas à droite (bouton bas) : profondeur max., gaz, pression et temps de gaz avec Tank POD, chronomètre ; le contenu par défaut n’est pas listé dans le manuel (déduit des figures). Alarmes du §4.1 : pO2 high (au-dessus du pO2 réglé, 1,6 par défaut) et pO2 low (< 0,18) en fenêtre surgissante, CNS 80/100 %, OTU 250/300, Depth, Dive time, Gas time, Safety stop broken, Tank pressure (alarme fixe à 50 bar et alarme réglable, désactivée par défaut supposé), Change gas ; acquittées par n’importe quel bouton, la valeur concernée reste en bas à droite tant que la situation dure. CNS et OTU s’affichent à partir de 80 % (§4.24). Interdiction de vol (§4.30) : au moins 12 h, non affichée sous 75 min de désaturation, 72 h au plus, 48 h après un verrouillage. Plusieurs gaz (§4.20, option Multiple gases désactivée par défaut) : tous comptés dans le temps de remontée, notification Change gas à la MOD, appui long sur le bouton du milieu : liste des gaz. Valeurs fictives : autonomie de la batterie (16 h), date. Non simulés : altitude, mode Gauge, trimix, recycleur, boussole, modification des gaz en plongée, styles Graphical et Classic, planificateur, carnet, pénalité d’un deepstop ou d’un palier de sécurité obligatoire omis (§4.3, §4.27 : la plongée suivante est plus conservatrice, sans valeur publiée).',
    en: 'Two algorithms (§4.10, Algorithm setting): Suunto Fused RGBM 2, proprietary (approximation: Bühlmann + personal setting −2 to +2 calibrated on the NDLs published for this algorithm, penalties for repetitive dives and fast ascents), the default algorithm after §4.16; or Suunto Bühlmann 16 GF (ZHL-16C with gradient factors, reproduced), 30/70 by default, settable values (range not given: 10 to 100 % by 5 assumed). Deco profile (§4.12) Continuous (continuous ceiling, last ceiling always 3 m) or Stepped (3 m stops); default not given: Continuous assumed. Ascent rate of the calculation 10 m/min (§4.11). Deco window from the ceiling to 3 m deeper (white arrows), 0.6 m safe margin (yellow arrow and ceiling), beyond it a red arrow, alarm and calculation paused; Fused RGBM 2: 48 h lock after 3 min ("Locked", 48 h no-fly time, restarted by a locked dive); Bühlmann 16 GF: no lock, "WARNING: Ceiling broken" warning (approved with the middle button) then a red CEILING BROKEN band on the left until the end of the dive; its delay is not given: 3 min beyond the margin assumed, as for the lock. Deepstops (§4.27, on by default, Fused RGBM 2): halfway up beyond 20 m, a second one at half the first, 2 min each (length of the first not given: 2 min assumed), counted from target + 0.5 m to target − 3 m; with Bühlmann 16 GF the manual does not say whether they remain: not assumed (GF low plays that part, §4.10.2.1). Safety stop of 3, 4 or 5 min, counted between 2.4 and 6 m, mandatory (red) after a fast ascent and longer after each violation (extra time not given: 30 s per violation assumed); "Safety stop broken" above 2.4 m (3.0 m ceiling minus 0.6 m, deduced). Ascent bar: one step per 2 m/min, green, yellow from 8 to 10, red beyond, alarm after 5 s. Screen: Prominent style by default (§4.16), after the figures; No deco view (No deco gauge graduated 0 to 100 min, after the figures); with the "Custom views" setting, Tank pressure and Timer views (§4.16.1); the Compass view is not simulated. Bottom-right window (lower button): max depth, gas, pressure and gas time with a Tank POD, timer; the default content is not listed in the manual (deduced from the figures). §4.1 alarms: pO2 high (above the set pO2, 1.6 by default) and pO2 low (< 0.18) as pop-ups, CNS 80/100 %, OTU 250/300, Depth, Dive time, Gas time, Safety stop broken, Tank pressure (fixed 50 bar alarm and settable alarm, off by default assumed), Change gas; acknowledged with any button, the value concerned stays at the bottom right while the situation lasts. CNS and OTU are shown from 80 % (§4.24). No-fly time (§4.30): at least 12 h, not shown below 75 min of desaturation, 72 h at most, 48 h after a lock. Multiple gases (§4.20, Multiple gases option off by default): all counted in the ascent time, Change gas notification at the MOD, middle button held: list of gases. Fictitious values: battery time (16 h), date. Not simulated: altitude, Gauge mode, trimix, rebreather, compass, modifying gases during the dive, Graphical and Classic styles, planner, logbook, penalty of an omitted deepstop or mandatory safety stop (§4.3, §4.27: the next dive is more conservative, no published value).',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §4.16.1, §5.7: "No deco (Default), Compass, Tank pressure and Timer views"; Tank pressure and
      // Timer "After customizing in Suunto app". The Compass view is not simulated.
      key: 'views',
      essential: true,
      label: { fr: 'Vues (application Suunto)', en: 'Views (Suunto app)' },
      options: [
        { value: 'default', label: { fr: 'Par défaut (No deco)', en: 'Default (No deco)' } },
        { value: 'custom', label: { fr: 'Personnalisées (No deco, Tank pressure, Timer)', en: 'Custom (No deco, Tank pressure, Timer)' } },
      ],
      default: 'default',
    },
    {
      // §4.10 Dive settings » Parameters » Algorithm. Default not given: Fused RGBM 2 assumed (§4.16:
      // "The decompression algorithm used in Suunto EON Core is Suunto Fused RGBM 2").
      key: 'algo',
      label: { fr: 'Algorithme', en: 'Algorithm' },
      options: [
        { value: 'rgbm', label: 'Suunto Fused RGBM 2' },
        { value: 'buhlmann', label: 'Bühlmann 16 GF' },
      ],
      default: 'rgbm',
      group: 'deco',
    },
    {
      // §4.25: five personal settings, 0 by default (Fused RGBM 2 only).
      key: 'personal',
      label: { fr: 'Réglage personnel (Personal)', en: 'Personal setting' },
      options: [
        { value: '-2', label: '-2 (More aggressive)' },
        { value: '-1', label: '-1 (Aggressive)' },
        { value: '0', label: '0 (Default)' },
        { value: '+1', label: '+1 (Conservative)' },
        { value: '+2', label: '+2 (More conservative)' },
      ],
      default: '0',
      group: 'deco',
      showIf: (s) => !buhlmannOn(s),
    },
    {
      key: 'gfLow',
      label: { fr: 'GF bas (GF Low)', en: 'GF Low' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '30',
      group: 'deco',
      showIf: buhlmannOn,
    },
    {
      key: 'gfHigh',
      label: { fr: 'GF haut (GF High)', en: 'GF High' },
      options: GF_VALUES.map((v) => ({ value: v, label: `${v} %` })),
      default: '70',
      group: 'deco',
      showIf: buhlmannOn,
    },
    {
      // §4.12 Dive settings » Parameters » Deco profile. Default not given: Continuous assumed (the
      // "working assumption" of Fused RGBM 2, described first).
      key: 'profile',
      label: { fr: 'Profil de déco (Deco profile)', en: 'Deco profile' },
      options: [{ value: 'continuous', label: 'Continuous' }, { value: 'stepped', label: 'Stepped' }],
      default: 'continuous',
      group: 'deco',
    },
    {
      // §4.11: "turn deepstop on or off (it is on by default)".
      key: 'deepstop',
      label: { fr: 'Deepstop', en: 'Deepstop' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
      group: 'deco',
      showIf: (s) => !buhlmannOn(s),
    },
    {
      // §4.11: "adjust the safety stop time to be 3, 4 or 5 minutes (default is 3 minutes)".
      key: 'safety',
      label: { fr: 'Palier de sécurité', en: 'Safety stop' },
      options: [{ value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' }],
      default: '3',
      group: 'deco',
    },
    {
      // §4.11.1: 3 m or 6 m, 3 m by default.
      key: 'lastStop',
      label: { fr: 'Dernier palier (Last stop depth)', en: 'Last stop depth' },
      options: [{ value: '3', label: '3.0 m' }, { value: '6', label: '6.0 m' }],
      default: '3',
      group: 'deco',
    },
    // §4.16.1, §4.20: "oxygen partial pressure (pO2) setting is 1.6 bar" by default (1.4 recommended for
    // nitrox). Range not given: 1.0–1.6 assumed.
    { ...ppo2Setting(1.0, 1.6, 1.6, 'pO2'), group: 'deco' },
    {
      // §4.16.1, §4.20: "activate multigas diving under Dive settings » Parameters » Multiple gases"
      // ("Air/Nitrox dive mode has one active gas by default").
      key: 'multigas',
      label: { fr: 'Plusieurs gaz (Multiple gases)', en: 'Multiple gases' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §4.20: each gas has its pO2 (1.6 bar by default; the §4.20.1 example gives 1.6 to tx50/10).
      key: 'po2Deco',
      label: { fr: 'pO2 des gaz de déco', en: 'Deco gas pO2' },
      options: [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
      showIf: (s) => s.multigas === 'on',
    },
    // §4.1 Tank pressure: "a built in 50-bar alarm that cannot be changed. In addition to it there is a
    // configurable tank pressure alarm, you can set to any value". Default not given: off assumed (the
    // §4.33 example sets it to 100 bar).
    pressureSetting('tankAlarm', { fr: 'Alarme de pression du bloc', en: 'Tank pressure alarm' }, 60, 200, 10, 'off', off),
    // §4.1 warnings "Depth exceeds your depth alarm limit", "Dive time exceeds your dive time alarm
    // limit", "Gas time exceeds your gas time alarm limit". Ranges and defaults not given: off assumed.
    {
      key: 'depthAlarm',
      label: { fr: 'Alarme de profondeur', en: 'Depth alarm' },
      options: [{ value: 'off', label: off }, ...Array.from({ length: 20 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} m` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      key: 'timeAlarm',
      label: { fr: 'Alarme de durée de plongée', en: 'Dive time alarm' },
      options: [{ value: 'off', label: off }, ...Array.from({ length: 24 }, (_, i) => ({ value: String(5 + i * 5), label: `${5 + i * 5} min` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      key: 'gasTimeAlarm',
      label: { fr: 'Alarme de temps de gaz', en: 'Gas time alarm' },
      options: [{ value: 'off', label: off }, ...[5, 10, 15, 20, 25, 30].map((m) => ({ value: String(m), label: `${m} min` }))],
      default: 'off',
      group: 'alerts',
    },
    {
      // §4.1: "with an audible alarm (if tones are on)". Default not given: on assumed.
      key: 'tones',
      label: { fr: 'Sons (Tones)', en: 'Tones' },
      options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      default: 'on',
      group: 'sound',
    },
  ];

  /** GF points removed because of fast ascents during this dive (Fused RGBM 2 approximation). */
  ascentPenalty = 0;
  violations = 0;
  deepstops: DeepStop[] = [];
  /** §4.6.2: the ceiling was broken during this dive (Bühlmann 16 GF). */
  ceilingBroken = false;
  /** End (session clock) of the last dive made or ended with the algorithm locked (§4.30: 48 h no-fly). */
  lockedDiveEnd: number | null = null;
  /** The switch window jumped to CNS / OTU once (§4.24: the value "stays in the view"). */
  protected oxyShown = false;

  protected notices = new Notices<EonNotice>(NOTICE_ORDER);
  /** §4.20.1: "While ascending, you are notified to change gas [...] according to the maximum operating depth (MOD)". */
  protected prompt = new GasPrompt();

  constructor() {
    super();
    // §4.27: recommended "for every dive over 10 m", "calculated when you are between 2.4 and 6 m".
    // Going back below 10 m restarting it is not described (assumed, as on the other Suunto models).
    this.safetyStop = { trigger: 10, start: 6, top: 2.4, bottom: 6, reset: 10 };
    this.ascentAlarmDelay = 5; // §4.1, §4.3: "for five seconds or more"
    this.ceilingMargin = 0.6; // §4.11: "safe margin area, equaling to ceiling depth minus 0.6 m"
    this.lockHours = 48; // §4.6.1
    this.stopWindow = 3; // §4.11: deco window from the ceiling to the ceiling + 3.0 m
    this.ndlCap = 100; // §7.1: "No decompression time: 0 to 99 min (>99 above 99)"
    this.screenTimeout = 0;
    this.init();
    this.syncAlgo();
  }

  /**
   * §4.6.1: Fused RGBM 2 locks after 3 min above the safe margin; §4.6.2: Bühlmann 16 GF "will not be
   * locked". §4.12: the continuous profile guards the ceiling, the stepped one its 3 m step.
   */
  protected syncAlgo(): void {
    this.lockAfter = this.buhlmann ? null : 180;
    this.violationRef = this.continuous ? 'ceiling' : 'stop';
  }

  settingChanged(): void {
    this.syncAlgo();
  }

  get continuous(): boolean {
    return this.settings.profile !== 'stepped';
  }

  baseParams(): DecoParams {
    // §4.11.1 note: "This setting does not affect the ceiling depth on a decompression dive. The last
    // ceiling depth is always 3 m": the 6 m last stop applies to the stepped profile.
    const lastStop = this.continuous ? 3 : Number(this.settings.lastStop);
    // §4.11: ascent time "from depth at 10 m (33 ft) per minute".
    if (this.buhlmann) {
      const hi = Number(this.settings.gfHigh) / 100;
      const lo = Math.min(Number(this.settings.gfLow) / 100, hi); // GF low above GF high: device check not described
      return { gfLow: lo, gfHigh: hi, lastStop, stopStep: 3, ascentRate: 10 };
    }
    // Fused RGBM 2: the D5's calibration of the same algorithm (approximate GF high per personal setting).
    const hi = PERSONAL[this.settings.personal] ?? PERSONAL['0'];
    return { gfLow: hi - 0.1, gfHigh: hi, lastStop, stopStep: 3, ascentRate: 10 };
  }

  algoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    if (this.buhlmann) return p;
    // Fused RGBM 2 (§4.10): "Computing closely spaced repetitive diving", "Adapting to rapid ascents":
    // up to 8 GF points for a repetitive dive (fading with a ~2 h time constant), 2 per fast ascent.
    let rep = 0;
    if (s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      rep = 0.08 * Math.exp(-si / 120);
    }
    const drop = Math.min(0.15, rep + this.ascentPenalty);
    return { ...p, gfHigh: p.gfHigh - drop, gfLow: p.gfLow - drop };
  }

  /** §4.20: "If you need more than one gas, activate multi-gas option" (§4.33: up to twenty gases). */
  get maxGases(): number {
    return this.settings.multigas === 'on' ? 20 : 1;
  }

  /** §4.20: pO2 of each gas, "1.6 bar" by default. */
  decoPpo2(): number {
    return Number(this.settings.po2Deco) || 1.6;
  }

  /** MOD of each gas (its own pO2), the depth of the Change gas notification. */
  gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** §5.5: "only one tank pressure is shown and corresponds to the active gas": here only gas 1 has a Tank POD. */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  /**
   * §4.21: remaining gas "based on the tank pressure value and your current breathing rate", at the
   * current depth; §5.6: "calculated based on tank pressure at start minus 35 bar".
   */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    const perMin = sacBar * (depthToPressure(s.depth) / 1.01325);
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - 35) / perMin)));
  }

  /** §4.3: green below 8, yellow 8–10, red over 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  /**
   * §4.27: 3, 4 or 5 min; "The time may exceed three (3) minutes if you ascend too fast during dive. If
   * violations happened several times, the additional stop time is longer." (30 s each assumed).
   */
  safetySeconds(): number {
    return (Number(this.settings.safety) || 3) * 60 + this.violations * 30;
  }

  /** §4.27: "Safety stop is mandatory if ascent speed violation happened during the dive." */
  get mandatorySafety(): boolean {
    return this.violations > 0;
  }

  /** §4.1, §4.33: the configurable tank pressure alarm (bar), null when off. */
  tankAlarm(): number | null {
    return pressureValue(this.settings, 'tankAlarm');
  }

  /** §4.1 pO2 high: "exceeds safe level (>1.6)"; §4.10.4: "when pO2 value exceeds the preset limit". */
  po2Limit(s: DiveSession): number {
    return s.breathing > 0 && this.maxGases > 1 ? this.decoPpo2() : this.modPpo2;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.ascentPenalty = 0;
    this.violations = 0;
    this.deepstops = [];
    this.ceilingBroken = false;
    this.oxyShown = false;
    this.notices.clear();
    this.prompt.reset();
  }

  onDiveEnd(s: DiveSession): void {
    // §4.6.1: "Diving while the algorithm is locked resets the algorithm lock time back to 48 hours when
    // you surface"; "Decompression information is not available for the next 48 hours after surfacing".
    if (this.locked && s.lastDiveEnd !== null) {
      this.lockedUntil = s.lastDiveEnd + this.lockHours * 3600;
      this.lockedDiveEnd = s.lastDiveEnd;
    }
  }

  protected onAscentViolation(): void {
    this.violations += 1;
    if (!this.buhlmann) this.ascentPenalty = Math.min(0.08, this.ascentPenalty + 0.02);
  }

  /** The screen dismisses the pop-ups itself (see press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  private updateNotices(s: DiveSession): void {
    if (!s.inDive) return;
    const now: EonNotice[] = [];
    if (s.ppO2 > this.po2Limit(s) + 0.005) now.push('po2-high');
    if (s.ppO2 < 0.18) now.push('po2-low');
    if (this.ceilingBroken) now.push('ceiling-broken');
    // §4.10.4: "notification when CNS% reaches 80%, then warning when 100% limit is exceeded";
    // "Notification when OTU reaches 250 and then warning when 300 limit is exceeded".
    const cns = s.oxygen.cns;
    if (cns >= 100) now.push('cns-100');
    else if (cns >= 80) now.push('cns-80');
    const otu = s.oxygen.otu;
    if (otu >= 300) now.push('otu-300');
    else if (otu >= 250) now.push('otu-250');
    const depthAl = Number(this.settings.depthAlarm);
    if (depthAl > 0 && s.depth > depthAl) now.push('depth');
    const timeAl = Number(this.settings.timeAlarm);
    if (timeAl > 0 && s.diveTime / 60 > timeAl) now.push('dive-time');
    const ai = this.airIntegrated(s);
    // Gas time: "exceeds your gas time alarm limit, or tank pressure is below 35 bar (~510 psi), in
    // which case gas time is zero".
    const gasAl = Number(this.settings.gasTimeAlarm);
    const gt = ai ? this.gasTime(s, this.decoParams(s), sacBarPerMin(s.rmv, s.tank.volume)) : null;
    if (ai && (s.tankPressure < 35 || (gasAl > 0 && gt !== null && gt < gasAl))) now.push('gas-time');
    if (ai && s.tankPressure < 50) now.push('tank-50');
    const alarm = this.tankAlarm();
    if (ai && alarm !== null && s.tankPressure < alarm) now.push('tank-alarm');
    if (this.safetyBroken(s)) now.push('safety-broken');
    // "Change gas: On multi-gas dive when ascending, it is safe to switch to next available gas".
    if (this.maxGases > 1) {
      this.prompt.update(s, this.gasMods(s), null);
      if (this.prompt.offer !== null) now.push('change-gas');
    }
    this.notices.update(now);
  }

  /**
   * §4.1 "Safety stop ceiling broken by more than 0.6 m": the stop is at 3.0 m and counted from 2.4 m
   * down (§4.27), so shallower than 2.4 m before it is completed (deduced).
   */
  safetyBroken(s: { depth: number; inDive: boolean }): boolean {
    const st = this.safetyState;
    return s.inDive && (st === 'active' || st === 'paused') && s.depth < this.safetyStop.top && s.depth > 0.3;
  }

  tick(s: DiveSession, dt: number): void {
    this.syncAlgo();
    if (this.timerRunning) this.timerSec = Math.min(99 * 60 + 59, this.timerSec + dt); // §7.1: 0'00–99'59
    super.tick(s, dt);
    // §4.6.2 (Bühlmann 16 GF): the ceiling broken beyond the safe margin; when the warning is given is
    // not described: after 3 min, as the Fused RGBM 2 lock (assumed).
    if (s.inDive && this.buhlmann && this.ceilingViolationSec >= 180) this.ceilingBroken = true;
    this.updateNotices(s);
    if (!s.inDive || this.buhlmann || this.settings.deepstop !== 'on' || this.locked) return;
    // §4.27 Deepstops: "activate only when you dive deeper than 20 m", "when you are halfway up from your
    // maximum depth"; a second one at half the first ("if you dive to 42 m [...] the first deepstop is
    // prompted at 21 m and the second is at 10.5 m"; the second only when the first is 20 m or deeper,
    // deduced). "The second deepstop is 2 minutes long" (first one: 2 min assumed). "Calculation starts
    // at deepstop target depth plus 0.5 m. Calculation ends - 3 m away from deepstop depth."
    if (s.maxDepth > 20) {
      if (!this.deepstops.length) this.deepstops.push({ target: s.maxDepth / 2, remaining: 120, state: 'pending' });
      const first = this.deepstops[0];
      if (first.state === 'pending') first.target = Math.round((s.maxDepth / 2) * 10) / 10;
      if (first.target >= 20 && this.deepstops.length === 1) this.deepstops.push({ target: first.target / 2, remaining: 120, state: 'pending' });
      if (this.deepstops[1] && this.deepstops[1].state === 'pending') this.deepstops[1].target = Math.round((first.target / 2) * 10) / 10;
    }
    const cur = this.deepstops.find((d) => d.state !== 'done');
    if (!cur) return;
    if (s.depth <= cur.target + 0.5 && s.depth >= cur.target - 3) {
      cur.state = 'active';
      cur.remaining -= dt;
      if (cur.remaining <= 0) cur.state = 'done';
    } else if (s.depth < cur.target - 3) {
      cur.state = 'done';
    } else if (cur.state === 'active') {
      cur.state = 'pending';
    }
  }

  /** The deepstop counted down or ahead, if any. */
  currentDeepstop(): DeepStop | undefined {
    return this.deepstops.find((d) => d.state !== 'done');
  }

  /** §4.11: ascent time "includes time required for deepstops". */
  protected pendingDeepSeconds(): number {
    return this.deepstops.filter((d) => d.state !== 'done').reduce((a, d) => a + d.remaining, 0);
  }

  /**
   * §4.27 deepstop window ±1.5 m: 0 inside, 1 above the window ceiling (yellow arrow), 2 more than
   * 0.5 m above it (red arrow and alarm).
   */
  deepstopLevel(d: DeepStop, depth: number): 0 | 1 | 2 {
    if (depth >= d.target - 1.5) return 0;
    return depth >= d.target - 2 ? 1 : 2;
  }

  /** §4.12, §4.11.1: "The last ceiling depth is always 3 m": the continuous ceiling does not rise above 3 m before it clears. */
  protected violationDepth(ceil: number, p: DecoParams): number {
    if (this.continuous) return ceil > 0 ? Math.max(ceil, 3) : 0;
    return super.violationDepth(ceil, p);
  }

  compute(s: DiveSession): ComputerView {
    this.syncAlgo();
    const v = super.compute(s);
    if (v.inDeco) {
      // Displayed ceiling: the continuous ceiling (at least 3 m), or the 3 m step of the stepped profile.
      v.ceiling = this.continuous ? Math.max(v.ceiling, 3) : v.stopDepth;
      v.tts += Math.ceil(this.pendingDeepSeconds() / 60);
    }
    if (!s.inDive && s.lastDiveEnd !== null) {
      // §4.30: "always at least 12 hours. For desaturation times shorter than 75 minutes, no-fly time is
      // not displayed. Maximum no-fly time is 72 hours." "If decompression is omitted during a dive and
      // the dive algorithm is locked for 48 hours, the no-fly time is always 48 hours."
      const since = (s.clock - s.lastDiveEnd) / 60;
      const desat = desaturationTime(s.tissues);
      v.noFly = desat < 75 ? 0 : Math.min(72 * 60 - since, Math.max(v.noFly, 12 * 60 - since, 0));
      if (this.lockedDiveEnd !== null && this.lockedDiveEnd === s.lastDiveEnd) v.noFly = Math.max(0, 48 * 60 - since);
      v.noFly = Math.max(0, v.noFly);
    }
    return v;
  }

  /** §3.2 Upper button: timer start / stop (hold: reset); §4.34. */
  protected timerSec = 0;
  protected timerRunning = false;

  get soundKind(): AlertCue['kind'] {
    return 'beep';
  }

  /**
   * §4.1: alarms, warnings and notifications "are shown prominently on the display with an audible
   * alarm (if tones are on)" (no vibration). Alarms (ascent too fast, ceiling broken, pO2 high / low)
   * last until the situation is back to normal ("the alarm will stop automatically"); warnings and
   * notifications sound when they appear and stay on screen until a button is pressed. Deepstop:
   * "a downward pointing red arrow and an alarm" (§4.27).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.tones === 'off') || !v.inDive) return [];
    const cues: AlertCue[] = [];
    const alarm = (key: string) => cues.push({ key, kind: 'beep', level: 'alarm', until: 'clear', every: 3 });
    if (v.alarms.includes('ASCENT')) alarm('fast-ascent');
    if (v.ceilingViolation === 2 && !v.locked) alarm('ceiling');
    const d = this.currentDeepstop();
    if (d && d.state === 'active' && this.deepstopLevel(d, v.depth) === 2) alarm('deepstop');
    for (const key of this.notices.all) {
      const level: AlertCue['level'] = key === 'po2-high' || key === 'po2-low' ? 'alarm' : key === 'cns-80' || key === 'otu-250' || key === 'change-gas' ? 'info' : 'warning';
      cues.push({ key, kind: 'beep', level, until: 'once' });
    }
    return cues;
  }

  /**
   * Alert bubble (app/alertHelp.ts): §4.1 tables (alarms, warnings, notifications), §4.3 ascent rate,
   * §4.6 ceiling broken (lock, Bühlmann warning), §4.11 decompression window and safe margin, §4.27
   * safety stop and deepstop, §4.20.1 gas change, §4.33 tank pressure.
   */
  alertExplain(key: string): AlertExplain | null {
    const ack = { fr: 'La fenêtre surgissante disparaît à l’appui sur n’importe quel bouton.', en: 'The pop-up goes away when any button is pressed.' };
    switch (key) {
      case 'fast-ascent':
        return {
          code: 'ASCENT',
          what: {
            fr: 'Alarme quand la remontée dépasse 10 m/min pendant 5 s ou plus ; la barre de gauche (un cran par 2 m/min) est verte sous 8 m/min, jaune de 8 à 10, rouge au-delà. Chaque remontée trop rapide rend le palier de sécurité obligatoire (rouge) et l’allonge ; avec Fused RGBM 2, elle rend aussi le calcul plus prudent.',
            en: 'Alarm when the ascent exceeds 10 m/min for 5 s or more; the left bar (one step per 2 m/min) is green below 8 m/min, yellow from 8 to 10, red beyond. Each fast ascent makes the safety stop mandatory (red) and longer; with Fused RGBM 2, it also makes the calculation more conservative.',
          },
        };
      case 'ceiling':
        return {
          code: 'CEILING',
          what: {
            fr: `Fenêtre de déco du plafond à 3 m plus profond (flèches blanches ▼▲). Au-dessus du plafond, le plafond passe au jaune avec une flèche jaune ; à plus de 0,6 m au-dessus, flèche rouge, alarme, et le calcul de déco s’arrête jusqu’à ce que vous redescendiez. ${this.buhlmann ? 'Avec Bühlmann 16 GF, après 3 min l’EON Core affiche « WARNING: Ceiling broken » mais ne se verrouille pas.' : 'Après 3 min au-delà de cette marge, l’EON Core se verrouille pour 48 h (« Locked »).'}`,
            en: `Deco window from the ceiling to 3 m deeper (white ▼▲ arrows). Above the ceiling, the ceiling turns yellow with a yellow arrow; more than 0.6 m above it, a red arrow, an alarm, and the deco calculation halts until you go back down. ${this.buhlmann ? 'With Bühlmann 16 GF, after 3 min the EON Core shows “WARNING: Ceiling broken” but does not lock.' : 'After 3 min beyond that margin, the EON Core locks for 48 h (“Locked”).'}`,
          },
        };
      case 'deepstop':
        return {
          title: { fr: 'Deepstop : redescendre', en: 'Deepstop: descend' },
          what: {
            fr: 'Deepstop (Fused RGBM 2, plongée au-delà de 20 m) : fenêtre de ±1,5 m autour de la cible. Au-dessus de la fenêtre, flèche et profondeur jaunes ; 0,5 m plus haut, flèche rouge et alarme. Le décompte continue jusqu’à 3 m au-dessus de la cible, puis le deepstop est abandonné.',
            en: 'Deepstop (Fused RGBM 2, dive beyond 20 m): ±1.5 m window around the target. Above the window, yellow arrow and depth; 0.5 m higher, red arrow and alarm. The countdown goes on up to 3 m above the target, then the deepstop is dropped.',
          },
          todo: { fr: 'Redescendez à la profondeur du deepstop.', en: 'Go back down to the deepstop depth.' },
        };
      case 'LOCKED':
        return { what: { fr: 'Algorithme verrouillé pour 48 h (Fused RGBM 2) : « Locked » à la place des informations de déco, interdiction de vol de 48 h. Plonger verrouillé relance les 48 h à la sortie.', en: 'Algorithm locked for 48 h (Fused RGBM 2): “Locked” in place of the deco information, 48 h no-fly time. Diving while locked restarts the 48 h when you surface.' } };
      case 'DECO':
        return {
          what: {
            fr: '« DECO » orange au-dessus de la jauge, qui affiche « asc. time » (durée de remontée, deepstops compris, à 10 m/min). En haut, le plafond (« CEILING ») ; près du plafond, il s’affiche aussi en bas à droite (« ceiling, m »).',
            en: 'Orange “DECO” above the gauge, which shows “asc. time” (ascent time, deepstops included, at 10 m/min). At the top, the ceiling (“CEILING”); near the ceiling it also shows at the bottom right (“ceiling, m”).',
          },
        };
      case 'po2-high':
        return {
          screen: 'pO2 high', code: 'PPO2_HIGH',
          what: { fr: `Alarme : la pO₂ dépasse la limite réglée pour le gaz (1,6 par défaut). Fenêtre surgissante, la pO₂ reste en rouge en bas à droite tant qu’elle est trop haute. ${ack.fr}`, en: `Alarm: the pO₂ exceeds the limit set for the gas (1.6 by default). Pop-up; the pO₂ stays in red at the bottom right while too high. ${ack.en}` },
          todo: { fr: 'Remontez ou passez à un gaz moins riche en oxygène.', en: 'Ascend or switch to a gas with less oxygen.' },
        };
      case 'po2-low':
        return {
          screen: 'pO2 low',
          what: { fr: `Alarme : la pO₂ est sous 0,18. Fenêtre surgissante, la pO₂ reste en rouge en bas à droite. ${ack.fr}`, en: `Alarm: the pO₂ is below 0.18. Pop-up; the pO₂ stays in red at the bottom right. ${ack.en}` },
          todo: { fr: 'Redescendez ou passez à un gaz plus riche en oxygène.', en: 'Descend or switch to a gas with more oxygen.' },
        };
      case 'ceiling-broken':
        return {
          screen: 'WARNING: Ceiling broken', critical: true,
          what: { fr: 'Bühlmann 16 GF : le plafond a été dépassé (plus de 3 min au-delà de la marge de 0,6 m, délai supposé). L’EON Core ne se verrouille pas et garde le plan de déco ; après l’approbation, un bandeau rouge « CEILING BROKEN » reste à gauche de l’écran, et le carnet le signale.', en: 'Bühlmann 16 GF: the ceiling was broken (more than 3 min beyond the 0.6 m margin, assumed delay). The EON Core does not lock and keeps the deco plan; once approved, a red “CEILING BROKEN” band stays on the left of the screen, and the log records it.' },
          todo: { fr: 'Approuvez avec le bouton du milieu, redescendez sous le plafond et terminez les paliers.', en: 'Approve with the middle button, go back below the ceiling and complete the stops.' },
        };
      case 'cns-100':
        return { screen: 'CNS 100%', code: 'CNS', what: { fr: `Avertissement : le CNS atteint 100 % de la limite. ${ack.fr}`, en: `Warning: the CNS reaches 100 % of the limit. ${ack.en}` }, todo: { fr: 'Réduisez immédiatement l’exposition à l’oxygène : remontez, terminez la plongée.', en: 'Reduce oxygen exposure immediately: ascend, end the dive.' } };
      case 'cns-80':
        return { screen: 'CNS 80%', code: 'CNS', what: { fr: `Notification : le CNS atteint 80 % ; il reste ensuite affiché en bas à droite. ${ack.fr}`, en: `Notification: the CNS reaches 80 %; it then stays at the bottom right. ${ack.en}` } };
      case 'otu-300':
        return { screen: 'OTU 300', what: { fr: `Avertissement : 300 OTU, la limite quotidienne recommandée. ${ack.fr}`, en: `Warning: 300 OTU, the recommended daily limit. ${ack.en}` }, todo: { fr: 'Terminez la plongée et évitez de nouvelles expositions à l’oxygène aujourd’hui.', en: 'End the dive and avoid further oxygen exposure today.' } };
      case 'otu-250':
        return { screen: 'OTU 250', what: { fr: `Notification : 250 OTU, environ 80 % de la limite quotidienne ; la valeur reste ensuite affichée. ${ack.fr}`, en: `Notification: 250 OTU, about 80 % of the daily limit; the value then stays on screen. ${ack.en}` } };
      case 'depth':
        return { screen: 'Depth', what: { fr: `Avertissement : vous dépassez la profondeur d’alarme réglée. ${ack.fr}`, en: `Warning: you are deeper than the depth alarm set. ${ack.en}` }, todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' } };
      case 'dive-time':
        return { screen: 'Dive time', what: { fr: `Avertissement : la durée de plongée dépasse l’alarme réglée. ${ack.fr}`, en: `Warning: the dive time exceeds the alarm set. ${ack.en}` }, todo: { fr: 'Préparez la remontée.', en: 'Get ready to ascend.' } };
      case 'gas-time':
        return { screen: 'Gas time', code: 'LOW_GAS', what: { fr: `Avertissement : le temps de gaz (gaz restant à cette profondeur, jusqu’à 35 bar) passe sous l’alarme réglée, ou la pression est sous 35 bar (temps de gaz nul). ${ack.fr}`, en: `Warning: the gas time (gas left at this depth, down to 35 bar) is below the alarm set, or the pressure is below 35 bar (gas time zero). ${ack.en}` } };
      case 'tank-50':
        return { screen: 'Tank pressure', code: 'LOW_GAS', what: { fr: `Avertissement de l’alarme intégrée à 50 bar (non modifiable) : la pression s’affiche en rouge en bas à droite. ${ack.fr}`, en: `Warning from the built-in 50 bar alarm (cannot be changed): the pressure shows in red at the bottom right. ${ack.en}` } };
      case 'tank-alarm':
        return { screen: 'Tank pressure', code: 'LOW_GAS', what: { fr: `Avertissement : la pression passe sous l’alarme réglée ; elle s’affiche en jaune en bas à droite. ${ack.fr}`, en: `Warning: the pressure is below the alarm set; it shows in yellow at the bottom right. ${ack.en}` } };
      case 'safety-broken':
        return {
          screen: 'Safety stop broken',
          what: { fr: `Avertissement : vous êtes remonté plus de 0,6 m au-dessus du palier de sécurité (3,0 m, compté entre 2,4 et 6 m) avant sa fin. ${ack.fr}`, en: `Warning: you went more than 0.6 m above the safety stop (3.0 m, counted between 2.4 and 6 m) before it was complete. ${ack.en}` },
          todo: { fr: 'Redescendez entre 3 et 6 m pour terminer le palier.', en: 'Go back down to 3–6 m to finish the stop.' },
        };
      case 'change-gas':
        return {
          screen: 'Change gas',
          what: { fr: `Notification en plongée multigaz : en remontant, la MOD du gaz suivant est atteinte, vous pouvez en changer. Acquitter la notification ne change pas de gaz. ${ack.fr}`, en: `Notification on a multi-gas dive: while ascending, the next gas’s MOD is reached, you may switch to it. Acknowledging does not change the gas. ${ack.en}` },
          todo: { fr: 'Maintenez le bouton du milieu, choisissez le gaz (haut / bas), confirmez (milieu).', en: 'Hold the middle button, choose the gas (upper / lower), confirm (middle).' },
        };
      default:
        return null;
    }
  }
}

import { SURFACE_PRESSURE, ceilingDepth, pressureToDepth, stopDepthFor, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef, desaturationTime, type AlertExplain } from '../../base';
import { GasPrompt } from '../../common/gasSwitch';
import { divingDays, standardNoFly } from '../../common/dives';
import { surfGfAfter, ttsAfter } from '../../common/predict';
import { DeepStop, FastAscentZhl, GasSequence, MissedStop, PRESETS, maresCues, maresWarningSettings, quadAscentLimit } from '../common';
import { CNS100, ZHL_ASCENT, ZHL_MISSED, gasSwitch, zhlUncontrolled } from '../alerts';
import { ppo2Setting } from '../../common/ppo2';

const onOff = [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }];

/**
 * Mares Quad 2 (instruction manual 07/2026, "QUAD 2 Dive Computer Instruction Manual CEIL-CON").
 * Unmodified Bühlmann ZH-L16C with gradient factors (§2.2, §12.1), reproduced: GF sets R0–T3, alternate
 * GF, optional repetitive dive and multiday conservatism, depth-dependent ascent rates, missed stop →
 * ALT GF → violation, uncontrolled ascent lock (48 h), CEIL-CON, SAFETY STOP +, deep stop, up to three
 * nitrox gases. Segmented monochrome LCD (§12.1 "LCD segment display") drawn after the manual's
 * figures; no tank module (the manual mentions none).
 */
export abstract class Quad2Rules extends DiveComputer {
  readonly id = 'quad2';
  readonly name = 'Mares Quad 2';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly notes = {
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors (§2.2) : reproduit (R0 85/85, R3 50/60, T0 30/85 et T3 25/40 d’après le manuel ; R1, R2, T1, T2 repris des autres Mares). Successives (REP : −8 à la sortie puis +1 par 15 min) et multi-jours (−2 par jour, max −6) en option, désactivées (figures du §2.2). Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min, SLOW) ; plus de 120 % sur plus de 20 m = verrouillage 48 h (ASCENT VIOLATION, désactivable). Palier manqué (§7.3.4) : profondeur et palier clignotants à plus de 0,3 m au-dessus ; moins de 1 m pendant 3 min ou plus de 1 m pendant 1 min : passage aux GF alternatifs (ALT clignotant en haut à droite jusqu’à l’appui sur un bouton) ; si la profondeur ne leur convient pas (ou si le palier ALT est manqué à son tour) : symbole de violation et profondimètre seul pendant 48 h. GF alternatifs à la main : BR long avec MAIN GF affiché, calculs MAIN et ALT alternés 10 s, TR long les active (§8.3, une seule fois). CEIL-CON (§2.14, désactivé) : on peut remonter jusqu’au plafond (affiché en haut à droite à moins de 3 m du palier le plus profond) jusqu’à 6 m ; au-dessus du plafond, CEILING clignote, GF alternatifs après 1 min (jusqu’à 0,3 m) ou aussitôt (au-delà). DECO STOP 3 / 4,5 / 6 m (§2.9). Palier de sécurité 3 min (mm:ss) avec GF @SURF / GF @+3, puis ✓ et décompte ; SAFETY STOP + (§8.1.2) : palier supplémentaire jusqu’à ce que GF @SURF tombe sous 70 ou 75. Deep stop (§2.8, désactivé). TTS @+X (3 à 10 min, 5 par défaut). Multigaz (§10) : jusqu’à 3 gaz G1 à G3 ; au MOD d’un gaz plus riche pendant la remontée, bip et SWITCH + O2 % de G1 clignotants 20 s ; BR : gaz suivant (O2 % et MOD clignotants), BR long : confirmation ; BR long à tout moment (sauf sur MAIN GF) : changement manuel ; PREDICTIVE (calcul avec tous les gaz, par défaut ; gaz exclu si l’invite reste sans réponse ; supposé, non décrit par le manuel : aussi dès un retour à un gaz moins riche au-dessus de son MOD) et SWITCH BELOW MOD (par défaut). AIR : pas de MOD, CNS ni ppO2 affichés (§8 note), « AIR » en bas à droite. Avertissements (§2.4) : MAX DEPTH, DIVE TIME (moitié et limite), NO DECO 2 min, ENTERING DECO, GF @SURF (tous désactivés par défaut). Non simulés : trimix et héliox (§10.4), mode profondimètre choisi par l’utilisateur, durée du mode surfacing (3 min fixes ici), eau douce / EN13319, altitude, rétroéclairage (6 s ici), menus de surface, planificateur, carnet, batterie (toujours suffisante ici), affichage graphique de la vitesse de remontée sur la barre de gauche.',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors (§2.2): reproduced (R0 85/85, R3 50/60, T0 30/85 and T3 25/40 from the manual; R1, R2, T1, T2 taken from the other Mares). Optional repetitive dive (REP: −8 on surfacing, then +1 per 15 min) and multiday (−2 per day, max −6) conservatism, off (figures of §2.2). Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min, SLOW); more than 120 % over more than 20 m = 48 h lock (ASCENT VIOLATION, can be turned off). Missed stop (§7.3.4): depth and stop blinking more than 0.3 m above; less than 1 m for 3 min or more than 1 m for 1 min: switch to the alternate GF (ALT blinking top right until a button is pressed); if the depth does not suit them (or the ALT stop is missed in turn): violation symbol and bottom timer only for 48 h. Alternate GF by hand: BR hold with MAIN GF shown, MAIN and ALT calculations alternating for 10 s, TR hold activates them (§8.3, once). CEIL-CON (§2.14, off): ascend up to the ceiling (shown top right within 3 m of the deepest stop) down to 6 m; above the ceiling, CEILING blinks, alternate GF after 1 min (up to 0.3 m) or at once (beyond). DECO STOP 3 / 4.5 / 6 m (§2.9). Safety stop 3 min (mm:ss) with GF @SURF / GF @+3, then ✓ and a count-up; SAFETY STOP + (§8.1.2): an extra stop until GF @SURF drops below 70 or 75. Deep stop (§2.8, off). TTS @+X (3 to 10 min, 5 by default). Multigas (§10): up to 3 gases G1 to G3; at the MOD of a richer gas during the ascent, a beep and SWITCH + the O2 % of G1 blinking for 20 s; BR: next gas (O2 % and MOD blinking), BR hold: confirm; BR hold at any time (except on MAIN GF): manual switch; PREDICTIVE (all gases in the calculation, by default; a gas is excluded when the prompt goes unanswered; assumed, not described by the manual: also as soon as the diver goes back to a leaner gas above its MOD) and SWITCH BELOW MOD (by default). AIR: no MOD, CNS or ppO2 shown (§8 note), "AIR" bottom right. Warnings (§2.4): MAX DEPTH, DIVE TIME (half and limit), NO DECO 2 min, ENTERING DECO, GF @SURF (all off by default). Not simulated: trimix and heliox (§10.4), bottom timer mode chosen by the user, surfacing mode duration (fixed 3 min here), fresh water / EN13319, altitude, backlight (6 s here), surface menus, planner, logbook, battery (always sufficient here), graphical ascent rate on the left bar.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // §8: BL-LP hides / shows the seconds of the dive time (shown in every dive figure: "29:46").
      key: 'seconds',
      essential: true,
      label: { fr: 'Secondes du temps de plongée', en: 'Dive time seconds' },
      options: [{ value: 'on', label: { fr: 'Affichées', en: 'Shown' } }, { value: 'off', label: { fr: 'Masquées', en: 'Hidden' } }],
      default: 'on',
    },
    {
      // §2.2.1 MAIN GF: "The default value is R0 (85/85)." (CUSTOM not offered here.)
      key: 'gf',
      label: { fr: 'Gradient factors (MAIN GF)', en: 'Gradient factors (MAIN GF)' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
    },
    {
      // §2.2.2 ALTERNATE GF: never more conservative than the main set; "The default value is R0 (85/85)."
      key: 'altGf',
      label: { fr: 'GF alternatifs (ALT GF)', en: 'Alternate GF (ALT GF)' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
      group: 'deco',
    },
    {
      // §2.2.3 REP: −8 on surfacing, +1 every 15 min. Default not stated: OFF in the figure of §2.2.3.
      key: 'repetitive',
      label: { fr: 'Successives (REP)', en: 'Repetitive dives (REP)' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.2.4 MULTIDAY: −2 per day, up to −6. Default not stated: OFF in the figure of §2.2.4.
      key: 'multiday',
      label: { fr: 'Multi-jours (MULTIDAY)', en: 'Multiday' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.3 SAFETY STOP +: 70, 75 or off. Default not stated: 70 in the figure of §2.3.
      key: 'safetyPlus',
      label: { fr: 'SAFETY STOP + (GF @SURF visé)', en: 'SAFETY STOP + (GF @SURF target)' },
      options: [{ value: '70', label: '70' }, { value: '75', label: '75' }, { value: 'off', label: 'OFF' }],
      default: '70',
      group: 'deco',
    },
    {
      // §2.9 DECO STOP: shallowest stop 3, 4.5 or 6 m (only with PREDICTIVE ON, a gas of at least 36 % and
      // the switch made, else 3 m). Default not stated (the figure shows 4.5 as an example): 3 m assumed.
      key: 'decoStop',
      label: { fr: 'Dernier palier (DECO STOP)', en: 'Shallowest stop (DECO STOP)' },
      options: [
        { value: '3', label: { fr: '3 m / 10 ft', en: '3 m / 10 ft' } },
        { value: '4.5', label: { fr: '4,5 m / 15 ft', en: '4.5 m / 15 ft' } },
        { value: '6', label: { fr: '6 m / 20 ft', en: '6 m / 20 ft' } },
      ],
      default: '3',
      group: 'deco',
    },
    {
      // §2.14 CEIL-CON DECO: OFF in the figure of §2.14 (and "If you have any doubts about CEIL-CON, do not activate it").
      key: 'ceilCon',
      label: { fr: 'CEIL-CON DECO', en: 'CEIL-CON DECO' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.8 DEEP STOP: "The default setting is OFF."
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.6 / §8.2 note: TTS @+X between 3 and 10 minutes (5 in the figures).
      key: 'future',
      label: { fr: 'FUTURE DECO (TTS @+X)', en: 'FUTURE DECO (TTS @+X)' },
      options: [3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ value: String(x), label: `+${x}` })),
      default: '5',
      group: 'deco',
    },
    {
      // §2.12 ASCENT VIOLATION: the uncontrolled ascent lock can be turned off (ON in the figure).
      key: 'ascviol',
      label: { fr: 'Verrou remontée (ASCNT VIOL)', en: 'Ascent violation lock' },
      options: onOff,
      default: 'on',
    },
    {
      // §2.11 ALL SILENT: OFF in the figure of §2.11.
      key: 'silent',
      label: { fr: 'Silence (ALL SILENT)', en: 'All silent' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // §7.1: ppO2max 1.4 bar from the factory, adjustable between 1.2 and 1.6 bar (step not given: 0.1;
    // the figures show 1.50 and 1.60).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §10.1: each gas has its own ppO2max (1.2 to 1.6 bar, §12.1). Value of G2 / G3 not given: 1.6 assumed.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max G2 / G3', en: 'ppO2max G2 / G3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §10.1 NOTE: from 80 % O2 the ppO2max is set to 1.6 bar automatically, adjustable from 1.6 to 1.8 bar.
      key: 'ppo2Rich',
      label: { fr: 'ppO2max des gaz ≥ 80 % O2', en: 'ppO2max of gases ≥ 80% O2' },
      options: [1.6, 1.7, 1.8].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §2.5.1 PREDICTIVE: "The default value is ON."
      key: 'predictive',
      label: { fr: 'Multigaz PREDICTIVE', en: 'PREDICTIVE multigas' },
      options: onOff,
      default: 'on',
      group: 'deco',
    },
    {
      // §2.5.2 SWITCH BELOW MOD: "The default value is ON."
      key: 'belowMod',
      label: { fr: 'Switch sous la MOD (BELOW MOD)', en: 'Switch below MOD' },
      options: onOff,
      default: 'on',
      group: 'deco',
    },
    // §2.4.1–2.4.4: same words as the Quad Ci; NO DECO and ENTERING DECO are OFF in the figures of §2.4.3
    // and §2.4.4 (defaults not stated).
    ...maresWarningSettings('NO DECO').map((d) => (d.key === 'wNoDeco' || d.key === 'wDeco' ? { ...d, default: 'off' } : d)),
    {
      // §2.4.5 GF @SURF: "The value can be set between 50 and 250. The default setting is OFF." (step not given: 5).
      key: 'wGfSurf',
      label: { fr: 'Avertissement GF @SURF', en: 'GF @SURF warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 41 }, (_, i) => ({ value: String(50 + i * 5), label: String(50 + i * 5) }))],
      default: 'off',
    },
  ];

  protected fast = new FastAscentZhl();
  protected missed = new MissedStop('zhl');
  /** CEIL-CON (§7.3.4.2.1): seconds spent above the ceiling by up to 0.3 m. */
  protected ceilAbove = 0;
  /** Violation of the dive (§11.1), shown by its symbol; the computer locks after surfacing. */
  protected violation: 'deco' | 'ascent' | null = null;
  /** Violation that locked the computer, shown continuously in bottom timer mode (§11.1). */
  protected lockCause: 'deco' | 'ascent' | null = null;
  /** ALT GF switched on by the computer after a missed stop: ALT blinks until a button is pressed (§7.3.4.2). */
  protected altBySystem = false;
  /** ALT GF in use (§8.3 by hand, §7.3.4.2 after a missed stop). */
  protected altActive = false;
  protected hadDeco = false;
  protected repetitiveDive = false;
  protected desatUntil = -Infinity;
  protected longNoFly = false;
  /** GF @SURF at the end of the last dive (condensed log of the POST DIVE screen, §9). */
  protected lastSurfGf = 0;
  protected lastView: ComputerView | null = null;
  protected deep = new DeepStop();
  /** §10.2: gas switch prompt (SWITCH + O2 % of G1 blinking, 20 s) and the switch sequence. */
  protected prompt = new GasPrompt();
  protected seq = new GasSequence();
  /** SAFETY STOP + (§8.1.2): state after the regular safety stop, and seconds left. */
  protected plus: 'none' | 'active' | 'done' = 'none';
  protected plusRemaining = 0;
  /** Count-up after the safety stop (§8.1.1), seconds. */
  protected countUp = 0;
  private plusCheckAt = -Infinity;
  private lastBreathing = 0;
  /** Gas breathed before the last switch and when (session clock), for the 20 s of §10.2 with PREDICTIVE OFF. */
  private switched: { from: number; to: number; at: number } | null = null;

  /** §10: up to three gas mixtures (air and nitrox), G1 to G3. */
  get maxGases(): number {
    return 3;
  }

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §10.1 NOTE: gases of 80 % O2 or more have their own ppO2max, 1.6 to 1.8 bar. */
  decoMod(o2: number): number {
    const ppo2 = o2 >= 0.8 - 1e-9 ? Number(this.settings.ppo2Rich) || 1.6 : this.decoPpo2();
    return Math.max(0, pressureToDepth(ppo2 / o2));
  }

  /** MOD of each programmed gas: "The MOD for G2 and G3 is the switch depth for the corresponding gas" (§10.1). */
  protected gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /** Gases offered by the switch sequence: SWITCH BELOW MOD ON offers every gas at any depth (§2.5.2, §10.2). */
  protected seqMods(s: DiveSession): number[] {
    return this.settings.belowMod === 'off' ? this.gasMods(s) : this.gasMods(s).map(() => Infinity);
  }

  /**
   * §2.5.1 PREDICTIVE ON: all gases, switched at their MOD, except one not switched to when prompted
   * (§10.2 NOTE: excluded, then included again below its MOD); OFF: the gas breathed only.
   */
  planGases(s: DiveSession) {
    if (this.settings.predictive === 'off') return [];
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  constructor() {
    super();
    // §8.1: safety stop on dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // §7.3.4: alarm more than 0.3 m above the stop
    this.lockAfter = null; // §7.3.4.2: handled in tick
    this.lockHours = 48; // §11.1
    this.stopWindow = 1; // not given by the manual (as the Quad Ci)
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /**
   * §2.9 DECO STOP: the chosen shallowest stop needs PREDICTIVE ON, a gas of at least 36 % and the
   * switch made when prompted; "If these conditions are not met, Quad 2 will recalculate the
   * decompression with a 3 m / 10 ft shallowest stop."
   */
  protected lastStop(s: DiveSession): number {
    const chosen = Number(this.settings.decoStop) || 3;
    const ok = this.settings.predictive !== 'off' && this.knownGases(s).some((g) => g.o2 >= 0.36 - 1e-9) && this.prompt.declined.size === 0;
    return ok ? chosen : 3;
  }

  /** MAIN GF with the repetitive (§2.2.3) and multiday (§2.2.4) reductions. */
  mainParams(s: DiveSession): DecoParams {
    const p = { ...this.baseParams(), lastStop: this.lastStop(s) };
    let drop = this.settings.multiday === 'on' ? Math.min(6, 2 * (divingDays(s) - 1)) : 0;
    if (this.settings.repetitive === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /** §2.2.2: the alternate set, never more conservative than the main one. */
  altParams(s: DiveSession): DecoParams {
    const main = this.mainParams(s);
    const [lo, hi] = PRESETS[this.settings.altGf] ?? PRESETS.R0;
    return { ...main, gfLow: Math.max(main.gfLow, lo / 100), gfHigh: Math.max(main.gfHigh, hi / 100) };
  }

  algoParams(s: DiveSession): DecoParams {
    return this.altActive ? this.altParams(s) : this.mainParams(s);
  }

  /** §8.3: the diver activates the alternate gradient factors (once). */
  activateAlt(): void {
    this.altActive = true;
  }

  /**
   * §2.14 CEIL-CON DECO: the diver may ascend to the ceiling "without incurring into a deco stop
   * violation" while it is deeper than 6.0 m; then the stops are made "in the standard way".
   */
  protected ceilCon(ceil: number): boolean {
    return this.settings.ceilCon === 'on' && ceil > 6;
  }

  protected violationDepth(ceil: number, p: DecoParams): number {
    if (ceil <= 0) return ceil;
    return this.ceilCon(ceil) ? ceil : stopDepthFor(ceil, p);
  }

  /** §7.3.1: SLOW above the limit for the current depth (no pre-warning described). */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    return rate > quadAscentLimit(depth) ? 2 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.ceilAbove = 0;
    this.violation = null;
    this.altActive = this.altBySystem = false;
    this.hadDeco = false;
    // §9: "Any dive started while there is remaining desaturation [...] is considered a repetitive dive".
    this.repetitiveDive = s.clock < this.desatUntil;
    this.deep.reset();
    this.prompt.reset();
    this.seq.cancel();
    this.switched = null;
    this.lastBreathing = s.breathing;
    this.plus = 'none';
    this.plusRemaining = 0;
    this.countUp = 0;
  }

  onDiveEnd(s: DiveSession): void {
    this.desatUntil = s.clock + desaturationTime(s.tissues) * 60;
    this.longNoFly = this.hadDeco || this.repetitiveDive;
    this.lastSurfGf = Math.max(0, s.tissues.maxGradientPercent(SURFACE_PRESSURE));
    // §11.1: after a violation, bottom timer only for 48 hours, the violation symbol shown.
    if (this.violation && !this.locked) {
      this.lockCause = this.violation;
      this.lock(s);
    }
  }

  /** §7.3.4.2: switch to ALT GF; a dive violation when the current depth does not suit them. */
  private toAlt(s: DiveSession): void {
    if (this.altActive) {
      this.violation = 'deco';
      return;
    }
    this.altActive = this.altBySystem = true;
    this.missed.reset();
    this.ceilAbove = 0;
    const ap = this.decoParams(s);
    const c = ceilingDepth(s.tissues, this.anchor, ap);
    // "Compatible with the current depth": no more than the alarm margin above the ALT GF stop (assumed).
    if (c > 0 && s.depth < this.violationDepth(c, ap) - this.ceilingMargin) this.violation = 'deco';
  }

  /**
   * §10.2: with PREDICTIVE OFF, "within 20 seconds of having switched gas, the decompression calculation
   * will be updated" (the full 20 s assumed): until then the data of the previous gas.
   */
  compute(s: DiveSession): ComputerView {
    const v = super.compute(s);
    const sw = this.switched;
    if (this.settings.predictive !== 'off' || !sw || !s.inDive || sw.to !== s.breathing || s.clock - sw.at >= 20) return v;
    const old = super.compute(this.breathingGas(s, sw.from));
    return { ...v, ndl: old.ndl, inDeco: old.inDeco, plan: old.plan, stopDepth: old.stopDepth, stopTime: old.stopTime, stopTimeSec: old.stopTimeSec, atStop: old.atStop, tts: old.tts };
  }

  tick(s: DiveSession, dt: number): void {
    if (this.lastBreathing !== s.breathing) this.switched = s.inDive ? { from: this.lastBreathing, to: s.breathing, at: s.clock } : null;
    this.lastBreathing = s.breathing;
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // §7.3.1 / §2.12: more than 120 % of the allowed rate over a depth change of more than 20 m.
    if (this.fast.update(s.ascentRate, s.depth) && this.settings.ascviol !== 'off') this.violation = this.violation ?? 'ascent';

    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      if (this.ceilCon(ceil)) {
        // §7.3.4.2.1: above the ceiling by up to 0.3 m for 1 minute or more, or by more than 0.3 m at once.
        const above = ceil - s.depth;
        this.missed.reset();
        if (above > 0.3) this.toAlt(s);
        else if (above > 0) {
          this.ceilAbove += dt;
          if (this.ceilAbove >= 60) this.toAlt(s);
        } else this.ceilAbove = 0;
      } else {
        // §7.3.4.2: above the stop by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
        this.ceilAbove = 0;
        if (this.missed.update(stopDepthFor(ceil, p) - s.depth, dt)) this.toAlt(s);
      }
    } else {
      this.missed.reset();
      this.ceilAbove = 0;
    }

    // §10.2: prompt at the MOD of a richer gas, 20 s; unanswered, the gas leaves the PREDICTIVE plan.
    const mods = this.gasMods(s);
    this.prompt.update(s, mods, 20);
    // Not in the manual (assumed, issue #19): back to a leaner gas above the MOD of the richer one, the
    // richer gas leaves the PREDICTIVE plan at once, as an unanswered prompt (§10.2 NOTE); the 20 s are
    // those of the prompt, and a switch to a richer gas is counted at once too.
    this.prompt.leave(s, mods, 0);
    // The sequence started by a button: time-out not given, 20 s assumed (as the prompt).
    this.seq.expire(s, 20);
    // §10.2 NOTE: a prompt answered by BR but whose switch is not confirmed (sequence ended, or another
    // gas chosen) counts as unanswered: the gas offered leaves the PREDICTIVE plan.
    this.prompt.settle(s, this.seq.gas !== null);

    // §2.8: deep stop for air and nitrox dives, as the no deco limit approaches (§8.1); optional.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');

    this.tickSafetyPlus(s, dt);
  }

  /**
   * §8.1.2 SAFETY STOP +: after the regular safety stop, an extra stop "so as to bring the GF @SURF at
   * the end of the stop to a level lower than" the set value (70 or 75); its time is that needed at the
   * current depth (recomputed as the diver goes, assumed), counting down within the safety stop range.
   * §8.1.1: "a countup timer starts as long as you stay shallower than 6 m", visible after SAFETY STOP +.
   */
  private tickSafetyPlus(s: DiveSession, dt: number): void {
    if (this.safetyState !== 'done') {
      this.plus = 'none';
      this.countUp = 0;
      return;
    }
    if (s.depth < 6) this.countUp += dt;
    const target = Number(this.settings.safetyPlus);
    if (this.plus === 'none') this.plus = target > 0 && s.tissues.maxGradientPercent(SURFACE_PRESSURE) > target ? 'active' : 'done';
    if (this.plus !== 'active') return;
    if (s.clock - this.plusCheckAt >= 5) {
      this.plusCheckAt = s.clock;
      this.plusRemaining = this.plusTime(s, Math.max(3, s.depth), target);
    } else if (s.depth >= this.safetyStop.top && s.depth <= this.safetyStop.bottom) {
      this.plusRemaining = Math.max(0, this.plusRemaining - dt);
    }
    if (this.plusRemaining <= 0) this.plus = 'done';
  }

  /** Seconds at `depth` until GF @SURF is at most `target` (10 s resolution, up to 30 min). */
  private plusTime(s: DiveSession, depth: number, target: number): number {
    if (s.tissues.maxGradientPercent(SURFACE_PRESSURE) <= target) return 0;
    let lo = 0;
    let hi = 30;
    if (surfGfAfter(s, depth, hi) > target) return hi * 60;
    while (hi - lo > 1 / 6) {
      const mid = (lo + hi) / 2;
      if (surfGfAfter(s, depth, mid) > target) lo = mid;
      else hi = mid;
    }
    return Math.ceil(hi * 6) * 10;
  }

  protected nitrox(s: DiveSession): boolean {
    return s.gas.o2 > 0.215 || this.knownGases(s).length > 1;
  }

  protected ttsPlus(v: ComputerView, s: DiveSession): number {
    return ttsAfter(s, v.depth, Number(this.settings.future) || 5, this.decoParams(s), this.anchor);
  }

  protected gfAt3(v: ComputerView, s: DiveSession): number {
    return Math.round(surfGfAfter(s, v.depth, 3));
  }

  protected hasDesat(s: DiveSession): boolean {
    return s.log.length > 0 && (s.clock < this.desatUntil || this.noFlyMin(s) > 0);
  }

  /** §9: standard 12 h (no-deco, non repetitive) or 24 h (deco and repetitive) countdown. */
  protected noFlyMin(s: DiveSession): number {
    return standardNoFly(this.longNoFly, s);
  }

  /**
   * §7.3 NOTE: "Alarms are both visual and audible": fast ascent, MOD and missed stop while they last,
   * CNS (100 %: 5 s per minute; 75 %: once, assumed); the gas switch prompt "sounds an audible signal"
   * (§10.2). The warnings of §2.4 are not said to sound: a single beep assumed. §2.11 ALL SILENT turns
   * them off.
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.silent === 'on') || !v.inDive || this.locked) return [];
    const cues = maresCues(v);
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns-75', kind: 'beep', level: 'info', until: 'once' });
    for (const w of this.activeWarnings(v)) cues.push({ key: `warn-${w}`, kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }

  /**
   * Alert bubble (app/alertHelp.ts): §7.3 alarms (ascent SLOW, MOD §7.3.2, CNS §7.3.3, missed stop and
   * ALT GF §7.3.4.2, CEIL-CON §7.3.4.2.1, violation symbols and 48 h lock §11.1), §2.12 ascent violation,
   * §2.4 warnings, §2.8 deep stop, §8.1.2 SAFETY STOP +, §10.2 gas switch; `msg:` keys: what the screen
   * shows with no sound of its own (see screenAlerts).
   */
  alertExplain(key: string): AlertExplain | null {
    const untilBtn = { fr: 'L’avertissement clignote jusqu’à l’appui sur un bouton.', en: 'The warning blinks until a button is pressed.' };
    switch (key) {
      case 'fast-ascent':
        return {
          screen: 'SLOW', code: 'ASCENT',
          what: { fr: `« SLOW » et la vitesse clignotent au-delà de la vitesse permise. ${ZHL_ASCENT.fr} ${zhlUncontrolled(48).fr} (réglage ASCENT VIOLATION, désactivable)`, en: `“SLOW” and the rate blink beyond the allowed rate. ${ZHL_ASCENT.en} ${zhlUncontrolled(48).en} (ASCENT VIOLATION setting, can be turned off)` },
        };
      case 'missed-stop':
        return {
          code: 'CEILING',
          what: { fr: `La profondeur et le palier clignotent à plus de 0,3 m au-dessus du palier. ${ZHL_MISSED.fr} L’ordinateur passe alors aux gradient factors de secours (« ALt » clignote en haut à droite) ; si leur palier ne convient pas à votre profondeur, ou si vous le manquez à son tour : symbole de violation et profondimètre seulement pendant 48 h. Avec CEIL-CON, c’est le plafond qui compte : « CEILING » clignote au-dessus, ALT GF après 1 min (jusqu’à 0,3 m) ou tout de suite (au-delà).`, en: `The depth and the stop blink more than 0.3 m above the stop. ${ZHL_MISSED.en} The computer then switches to the alternate gradient factors (“ALt” blinks top right); if their stop does not suit your depth, or you miss it in turn: violation symbol and depth gauge only for 48 h. With CEIL-CON, the ceiling is what counts: “CEILING” blinks above it, ALT GF after 1 min (up to 0.3 m) or at once (beyond).` },
        };
      case 'msg:ALt':
        return {
          screen: 'ALt',
          what: { fr: `Palier manqué : l’ordinateur calcule désormais avec les gradient factors de secours (ALT GF), ce qui raccourcit les paliers et peut éviter la violation. ${untilBtn.fr}`, en: `Missed stop: the computer now computes with the alternate gradient factors (ALT GF), which shortens the stops and may avoid a violation. ${untilBtn.en}` },
          todo: { fr: 'Redescendez au palier affiché (celui des ALT GF) et terminez-le : le manquer à son tour est une violation.', en: 'Go back to the displayed stop (the ALT GF one) and complete it: missing it in turn is a violation.' },
        };
      case 'msg:violation-deco':
        return {
          title: { fr: 'Violation : palier manqué', en: 'Violation: missed stop' }, critical: true,
          what: { fr: 'Symbole de palier manqué (clignotant jusqu’à l’appui sur un bouton) : à la fin de la plongée, profondimètre seulement pendant 48 h.', en: 'Missed stop symbol (blinking until a button is pressed): at the end of the dive, depth gauge only for 48 h.' },
          todo: { fr: 'Terminez les paliers autant que possible, remontez lentement et surveillez les symptômes.', en: 'Complete the stops as far as you can, ascend slowly and watch for symptoms.' },
        };
      case 'msg:violation-ascent':
        return {
          title: { fr: 'Violation : remontée incontrôlée', en: 'Violation: uncontrolled ascent' }, critical: true,
          what: { fr: 'Symbole de remontée rapide (clignotant jusqu’à l’appui sur un bouton) : plus de 120 % de la vitesse permise sur plus de 20 m. À la fin de la plongée, profondimètre seulement pendant 48 h.', en: 'Fast ascent symbol (blinking until a button is pressed): more than 120 % of the allowed rate over more than 20 m. At the end of the dive, depth gauge only for 48 h.' },
          todo: { fr: 'Ralentissez, faites un palier de prudence et surveillez les symptômes.', en: 'Slow down, make a precautionary stop and watch for symptoms.' },
        };
      case 'LOCKED':
        return { what: { fr: 'Profondimètre seulement pendant 48 h après une violation (le symbole de la violation reste affiché).', en: 'Depth gauge only for 48 h after a violation (the violation symbol stays on).' } };
      case 'mod':
        return { code: 'PPO2_HIGH', what: { fr: 'Alarme sonore ; la MOD s’affiche en haut à droite et clignote.', en: 'Audible alarm; the MOD is shown top right and blinks.' } };
      case 'cns-75':
        return { code: 'CNS', what: { fr: 'Au-delà de 75 % de CNS, un signal sonore ; le CNS reste affiché en bas à droite (les autres valeurs ne restent que 4 s).', en: 'Beyond 75 % CNS, one audible signal; the CNS stays shown bottom right (other values only stay 4 s).' } };
      case 'cns-100':
        return CNS100;
      case 'warn-max':
        return { title: { fr: 'Alarme de profondeur (MAX DEPTH)', en: 'Depth warning (MAX DEPTH)' }, what: { fr: `Vous avez atteint la profondeur réglée (désactivée par défaut). ${untilBtn.fr}`, en: `You reached the set depth (off by default). ${untilBtn.en}` }, todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' } };
      case 'warn-half':
        return { title: { fr: 'Mi-durée (DIVE TIME)', en: 'Half time (DIVE TIME)' }, what: { fr: `La moitié de la durée réglée est écoulée (désactivée par défaut). ${untilBtn.fr}`, en: `Half the set dive time has elapsed (off by default). ${untilBtn.en}` }, todo: { fr: 'Faites demi-tour.', en: 'Turn the dive around.' } };
      case 'warn-time':
        return { title: { fr: 'Durée atteinte (DIVE TIME)', en: 'Time reached (DIVE TIME)' }, what: { fr: `La durée de plongée réglée est atteinte. ${untilBtn.fr}`, en: `The set dive time is reached. ${untilBtn.en}` }, todo: { fr: 'Remontez.', en: 'Ascend.' } };
      case 'warn-nodeco':
        return { code: 'NDL_LOW', what: { fr: `Avertissement NO DECO à 2 min de la limite (désactivé par défaut). ${untilBtn.fr}`, en: `NO DECO warning 2 minutes before the limit (off by default). ${untilBtn.en}` } };
      case 'warn-deco':
        return { code: 'DECO', what: { fr: `Avertissement à l’entrée en décompression (désactivé par défaut). ${untilBtn.fr}`, en: `Warning when decompression begins (off by default). ${untilBtn.en}` } };
      case 'warn-gfsurf':
        return { title: { fr: 'GF @SURF', en: 'GF @SURF' }, what: { fr: `GF @SURF (la sursaturation qu’auraient vos tissus en surface) atteint la valeur réglée (désactivée par défaut) et clignote en bas à droite. ${untilBtn.fr}`, en: `GF @SURF (the supersaturation your tissues would have at the surface) reaches the set value (off by default) and blinks bottom right. ${untilBtn.en}` } };
      case 'msg:DEEP':
        return { screen: 'DEEP', what: { fr: 'Palier profond facultatif (désactivé par défaut, air et nitrox) : à la profondeur où le 5e compartiment (27 min) cesse de se charger, proposé à l’approche de la limite sans palier, 2 min, affiché en haut à droite.', en: 'Optional deep stop (off by default, air and nitrox): at the depth where the 5th compartment (27 min) stops loading, suggested as the no-deco limit approaches, 2 minutes, shown top right.' }, todo: { fr: 'Restez à ±1,5 m de cette profondeur pendant le décompte, ou continuez la remontée.', en: 'Stay within ±1.5 m of that depth during the countdown, or carry on ascending.' } };
      case 'msg:SAFETY STOP +':
        return { screen: 'SAFETY STOP +', what: { fr: 'Après le palier de sécurité, un palier supplémentaire (réglage SAFETY STOP +) jusqu’à ce que GF @SURF passe sous la valeur choisie (70 ou 75).', en: 'After the safety stop, an extra stop (SAFETY STOP + setting) until GF @SURF drops below the chosen value (70 or 75).' }, todo: { fr: 'Restez entre 3 et 6 m jusqu’à la fin du décompte.', en: 'Stay between 3 and 6 m until the countdown ends.' } };
      default:
        if (key.startsWith('switch-')) {
          return gasSwitch('SWITCH', { fr: '« SWITCH » et l’O2 % de G1 clignotent 20 s. BR : gaz suivant (O2 % et MOD clignotants), BR long : confirmer. Sans réponse, le gaz sort du calcul PREDICTIVE.', en: '“SWITCH” and the O2 % of G1 blink for 20 s. BR: next gas (O2 % and MOD blinking), BR hold: confirm. Without an answer, the gas leaves the PREDICTIVE calculation.' });
        }
        return null;
    }
  }

  /** Warnings of §2.4 whose condition is on (each one blinks until a button is pressed). */
  protected activeWarnings(v: ComputerView): string[] {
    const w: string[] = [];
    const maxDepth = Number(this.settings.wMaxDepth);
    if (maxDepth > 0 && v.depth >= maxDepth) w.push('max');
    const t = Number(this.settings.wTime);
    if (t > 0 && v.diveTime >= t * 60) w.push('time');
    else if (t > 0 && v.diveTime >= t * 30) w.push('half');
    if (this.settings.wNoDeco === 'on' && !v.inDeco && v.ndl <= 2 && v.depth > 1.2) w.push('nodeco');
    if (this.settings.wDeco === 'on' && v.inDeco) w.push('deco');
    const gs = Number(this.settings.wGfSurf);
    if (gs > 0 && v.surfGf >= gs) w.push('gfsurf');
    return w;
  }
}

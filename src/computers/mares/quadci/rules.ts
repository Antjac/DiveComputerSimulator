import { ceilingDepth, depthToPressure, pressureToDepth, stopDepthFor, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef, desaturationTime, type AlertExplain } from '../../base';
import { GasPrompt } from '../../common/gasSwitch';
import { divingDays } from '../../common/dives';
import { DeepStop, FastAscentZhl, GasMessages, MissedStop, PRESETS, maresCues, maresWarningSettings, quadAscentLimit } from '../common';
import { CNS100, ZHL_ASCENT, ZHL_MISSED, gasSwitch, zhlUncontrolled } from '../alerts';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';

const atm = (d: number) => depthToPressure(d) / 1.01325;

/**
 * Mares Quad Ci. Unmodified Bühlmann ZH-L16C with gradient factors (the model this simulator uses),
 * with the rules of the Quad Ci manual: depth-dependent ascent rate, multiday and optional
 * repetitive-dive conservatism, missed deco stop and uncontrolled ascent lock (48 h), TTR with the
 * LED tank module, E-Z / FULL / profile / tissue / stops screens. The E-Z layout and the look (white
 * figures on blue, "45:" minutes, button names printed on the case) follow footage of the device.
 */
export abstract class QuadCiRules extends DiveComputer {
  readonly id = 'quadci';
  readonly name = 'Mares Quad Ci';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly transmitter = 'LED Tank Module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Bühlmann ZH-L16C non modifié avec gradient factors : reproduit (R1, R2, T1, T2 interpolés, le manuel ne donnant que R0 85/85, R3 50/60, T0 30/85 et T3 25/40). Conservatisme multi-jours (−2 par jour, max −6) et, en option, en successives (−8 à la sortie, +1 par 15 min). Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min) ; plus de 120 % sur plus de 20 m = verrouillage 48 h ; palier manqué (§10.3.4.2) : passage aux GF alternatifs (ALT GF, R0 par défaut, jamais plus bas que les MAIN GF) avec MAIN GF > ALT GF, puis DECO VIOLATION! et verrouillage 48 h si la profondeur ne convient pas ou si le palier ALT GF est manqué à son tour ; BR long avec MAIN GF affiché : calculs MAIN et ALT côte à côte 10 s, TR active ALT GF (§11.6) ; dernier palier DECO STOP 3 / 4,5 / 6 m (§2.5 : avec PREDICTIVE, un gaz d’au moins 36 % et le changement fait, sinon 3 m ; 3 m par défaut supposé). TTR = temps jusqu’à la réserve. BL : écrans E-Z / FULL / profil / tissus / paliers ; TR / BR : champs du FULL ; TR long : rétroéclairage ; TL : chronomètre. Multigaz (§13) : jusqu’à 3 gaz G1 à G3 (gaz du bloc principal puis gaz de déco de la page), invite SWITCH TO G2 au MOD du gaz pendant la remontée (TR ou BR : GAS SWITCH OK ; TL ou BL ou 30 s : GAS NOT SWITCHED, puis EXCLUDING G2 si PREDICTIVE ; supposé, non décrit par le manuel : aussi dès un retour à un gaz moins riche au-dessus de son MOD), tableau des gaz par BR long ; PREDICTIVE (calcul avec tous les gaz, par défaut) et SWITCH BELOW MOD réglables ; ppO2max des gaz de déco 1,6 bar supposé, 1,6 à 1,8 bar pour les gaz à 80 % d’O2 ou plus (§13.1). Deep stop facultatif (§4.5, désactivé par défaut) : à la profondeur où le 5e tissu (27 min) passe de la saturation à la désaturation, proposé à l’approche de la limite sans palier, 2 min. Boussole et menu sous l’eau non simulés. Émetteur : HALF TANK (100 bar par défaut, désactivable) et TANK RESERVE (50 bar par défaut), jusqu’à l’appui sur un bouton. Avertissements du §3.2 : MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (désactivés par défaut), GF @SURF clignotant (désactivé par défaut), NO DECO 2 min et entrée en déco (activés supposé ; textes non donnés : « NO DECO 2 MIN » et « ENTERING DECO » déduits).',
    en: 'Unmodified Bühlmann ZH-L16C with gradient factors: reproduced (R1, R2, T1, T2 interpolated, the manual only giving R0 85/85, R3 50/60, T0 30/85 and T3 25/40). Multiday conservatism (−2 per day, max −6) and, optionally, repetitive-dive conservatism (−8 on surfacing, +1 per 15 min). Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min); more than 120 % over more than 20 m = 48 h lock; missed stop (§10.3.4.2): switch to the alternate GF (ALT GF, R0 by default, never below the MAIN GF) with MAIN GF > ALT GF, then DECO VIOLATION! and a 48 h lock if the depth does not suit them or the ALT GF stop is missed in turn; BR hold with MAIN GF shown: MAIN and ALT calculations side by side for 10 s, TR activates ALT GF (§11.6); shallowest stop DECO STOP 3 / 4.5 / 6 m (§2.5: with PREDICTIVE, a gas of at least 36 % and the switch made, else 3 m; 3 m by default assumed). TTR = time to reserve. BL: E-Z / FULL / profile / tissue / stops screens; TR / BR: FULL fields; TR hold: backlight; TL: stopwatch. Multigas (§13): up to 3 gases G1 to G3 (the main tank gas, then the deco gases set on the page), SWITCH TO G2 prompt at the gas MOD during the ascent (TR or BR: GAS SWITCH OK; TL or BL or 30 s: GAS NOT SWITCHED, then EXCLUDING G2 with PREDICTIVE; assumed, not described by the manual: also as soon as the diver goes back to a leaner gas above its MOD), gas table with a BR hold; PREDICTIVE (all gases in the calculation, by default) and SWITCH BELOW MOD settable; ppO2max of the deco gases 1.6 bar assumed, 1.6 to 1.8 bar for gases of 80 % O2 or more (§13.1). Optional deep stop (§4.5, off by default): at the depth where the 5th tissue (27 min) switches from ongassing to offgassing, suggested as the no deco limit approaches, 2 min. Compass and underwater menu are not simulated. Transmitter: HALF TANK (100 bar by default, can be turned off) and TANK RESERVE (50 bar by default), until a button is pressed. §3.2 warnings: MAX DEPTH REACHED, TURN AROUND / TIME LIMIT (off by default), blinking GF @SURF (off by default), NO DECO 2 min and entering deco (on assumed; texts not given: "NO DECO 2 MIN" and "ENTERING DECO" deduced).',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'gf',
      label: { fr: 'Gradient factors', en: 'Gradient factors' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
    },
    {
      // §2.2.2 ALTERNATE GF: "an alternate set of gradient factors, to use when you need to cut your
      // decompression short in case of an emergency. The set of alternate gradient factors cannot be more
      // conservative (i.e. lower) than the main set of GF values. The default value is R0 (85/85)."
      key: 'altGf',
      label: { fr: 'GF alternatifs (ALT GF)', en: 'Alternate GF (ALT GF)' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
      group: 'deco',
    },
    {
      // §2.5 DECO STOP: "the depth of the shallowest stop among 3m/10ft, 4.5m/15ft and 6m/20ft"; active only
      // with PREDICTIVE ON, a gas of at least 36 % O2 and the gas switch carried out when prompted, else
      // 3 m. Default not given: 3 m assumed.
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
      key: 'display',
      essential: true,
      label: { fr: 'Écran de plongée', en: 'Dive screen' },
      options: [{ value: 'ez', label: 'E-Z' }, { value: 'full', label: 'FULL' }],
      default: 'ez',
    },
    {
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
    {
      key: 'repetitive',
      label: { fr: 'Marge successives', en: 'Repetitive conserv.' }, // short: one line in the settings grid
      options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
      default: 'off',
    },
    {
      // §3.3 ALL SILENT turns the audible alarms off (off by default, assumed).
      key: 'silent',
      label: { fr: 'Silence (ALL SILENT)', en: 'All silent' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // Manual: ppO2max 1.4 bar from the factory, adjustable up to 1.6 bar (from 1.2, step 0.1: assumed as on the other Mares).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §13.1: each gas has its own ppO2max (§10.3.2: "from 1.2 to 1.6bar"). Value of G2 / G3 not given:
      // 1.6 bar assumed.
      key: 'ppo2Deco',
      label: { fr: 'ppO2max G2 / G3', en: 'ppO2max G2 / G3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §13.1 NOTE: "When setting an oxygen concentration of 80% or higher, Quad Ci automatically sets the
      // ppO2max to 1.6 bar"; "For gases with oxygen concentration 80% or higher, the ppO2 can be set
      // between 1.6 bar and 1.8 bar."
      key: 'ppo2Rich',
      label: { fr: 'ppO2max des gaz ≥ 80 % O2', en: 'ppO2max of gases ≥ 80% O2' },
      options: [1.6, 1.7, 1.8].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §2.4.1 PREDICTIVE: "When set to ON, Quad Ci will consider all gases in the decompression
      // calculation, with switches carried out at the MOD of each gas. [...] The default value is ON."
      key: 'predictive',
      label: { fr: 'Multigaz PREDICTIVE', en: 'PREDICTIVE multigas' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
      group: 'deco',
    },
    {
      // §2.4.2 SWITCH BELOW MOD: "When set to ON, Quad Ci will allow a switch to a gas at a depth deeper
      // than the MOD of the gas (resulting in an immediate MOD alarm). The default value is ON."
      key: 'belowMod',
      label: { fr: 'Switch sous la MOD', en: 'Switch below MOD' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
      group: 'deco',
    },
    {
      // §3.2.5 HALF TANK: "This allows you to turn off the half tank warning described at 4.1" (on unless
      // turned off: ON assumed by default).
      key: 'halfWarn',
      label: { fr: 'Avertissement de demi-bloc (HALF TANK)', en: 'Half tank warning' },
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
      default: 'on',
    },
    // §4.1: "HALF TANK, is the value at which Quad Ci triggers a half tank warning [...] Default values are
    // 100bar"; "TANK RESERVE, is the value at which an alarm is triggered [...] Default values are 50bar".
    // Ranges not given: 5 bar steps offered.
    { ...pressureSetting('halfTank', { fr: 'Pression du demi-bloc (HALF TANK)', en: 'Half tank pressure' }, 60, 200, 5, 100), showIf: (s) => s.halfWarn !== 'off' },
    pressureSetting('reserve', { fr: 'Réserve (TANK RESERVE)', en: 'Tank reserve' }, 20, 100, 5, 50),
    ...maresWarningSettings('NO DECO'),
    {
      // §3.2.6 GF @SURF: "The value can be set between 50 and 250. The default setting is OFF." (step not given: 10).
      key: 'wGfSurf',
      label: { fr: 'Avertissement GF @SURF', en: 'GF @SURF warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 21 }, (_, i) => ({ value: String(50 + i * 10), label: String(50 + i * 10) }))],
      default: 'off',
    },
  ];

  /** ALT GF switched on after a missed stop: MAIN GF > ALT GF shown until a button is pressed. */
  protected altBySystem = false;
  protected fast = new FastAscentZhl();
  protected missed = new MissedStop('zhl');
  protected violation: 'deco' | 'ascent' | null = null;
  protected hadDeco = false;
  protected repetitiveDive = false;
  /** Session clock until which the last dive still desaturates (repetitive dive detection). */
  protected desatUntil = -Infinity;
  /** The last dive needs the 24 h no-fly time (decompression or repetitive dive). */
  protected longNoFly = false;
  protected lastView: ComputerView | null = null;
  protected deep = new DeepStop();
  /** §13.2: gas switch prompt (SWITCH TO G2 / G3). */
  protected prompt = new GasPrompt();
  /** §13.2 messages shown briefly (GAS SWITCH OK, GAS NOT SWITCHED, EXCLUDING G2, INCLUDING G2 AGAIN). */
  protected gasMsgs = new GasMessages();

  /** §13: up to three gases, G1 to G3. */
  get maxGases(): number {
    return 3;
  }

  /** §13.1: ppO2max of G2 / G3 (1.6 bar at least from 80 % O2). */
  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §13.1: gases of 80 % O2 or more have their own ppO2max, 1.6 to 1.8 bar (1.6 by default). */
  decoMod(o2: number): number {
    const ppo2 = o2 >= 0.8 - 1e-9 ? Number(this.settings.ppo2Rich) || 1.6 : this.decoPpo2();
    return Math.max(0, pressureToDepth(ppo2 / o2));
  }

  /**
   * §2.4.1 PREDICTIVE ON: all active gases, switched at their MOD, except those excluded after a
   * declined switch (§13.2 EXCLUDING G2); OFF: the gas breathed only.
   */
  planGases(s: DiveSession) {
    if (this.settings.predictive === 'off') return [];
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  /** §13 NOTE: a gas without a paired transmitter uses the dive display without tank pressure (only T1 has one here). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // DECO STOP! when 0.3 m above the stop
    this.lockAfter = null; // handled in tick
    this.lockHours = 48;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /** ALT GF in use: switched by hand (§11.6) or after a missed stop (§10.3.4.2). */
  protected altActive = false;

  /**
   * §2.2.2: the alternate gradient factors, never lower than the main ones (each value taken at least
   * at the main one). The personalization, repetitive and multiday reductions only apply to the MAIN GF
   * (glossary, GF SET): not applied to them (assumed).
   */
  altParams(s: DiveSession): DecoParams {
    const main = this.mainParams(s);
    const [lo, hi] = PRESETS[this.settings.altGf] ?? PRESETS.R0;
    return { ...main, gfLow: Math.max(main.gfLow, lo / 100), gfHigh: Math.max(main.gfHigh, hi / 100) };
  }

  algoParams(s: DiveSession): DecoParams {
    return this.altActive ? this.altParams(s) : this.mainParams(s);
  }

  /**
   * §2.5 DECO STOP: the shallowest stop chosen applies when "predictive multigas is ON", "at least one
   * gas is set to an oxygen percentage of at least 36%" and "when prompted to do so, the gas switch is
   * carried out"; "If these conditions are not met, Quad Ci will recalculate the decompression with a
   * 3 m / 10 ft shallowest stop."
   */
  protected lastStop(s: DiveSession): number {
    const chosen = Number(this.settings.decoStop) || 3;
    const ok = this.settings.predictive !== 'off' && this.knownGases(s).some((g) => g.o2 >= 0.36 - 1e-9) && this.prompt.declined.size === 0;
    return ok ? chosen : 3;
  }

  /** MAIN GF with the personalization, repetitive and multiday reductions. */
  mainParams(s: DiveSession): DecoParams {
    const p = { ...this.baseParams(), lastStop: this.lastStop(s) };
    let drop = Math.min(6, 2 * (divingDays(s) - 1));
    if (this.settings.repetitive === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /** SLOW! above the limit for the current depth, warning from 80 % of it. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const lim = quadAscentLimit(depth);
    return rate > lim ? 2 : rate > lim * 0.8 ? 1 : 0;
  }

  /** TTR: minutes until the reserve at the current depth and breathing rate. */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - this.reservePressure()) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.violation = null;
    this.hadDeco = false;
    this.repetitiveDive = s.clock < this.desatUntil;
    this.deep.reset();
    this.prompt.reset();
    this.gasMsgs.clear();
    this.altActive = false;
  }

  /** §11.6: the diver activates the alternate gradient factors. */
  activateAlt(): void {
    this.altActive = true;
  }

  onDiveEnd(s: DiveSession): void {
    this.desatUntil = s.clock + desaturationTime(s.tissues) * 60;
    this.longNoFly = this.hadDeco || this.repetitiveDive;
    // Violations lock the computer after surfacing: bottom timer for 48 hours.
    if (this.violation) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // Uncontrolled ascent: more than 120 % of the allowed rate over more than 20 m.
    if (this.fast.update(s.ascentRate, s.depth)) this.violation = this.violation ?? 'ascent';

    // Missed stop: above it by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      const stop = stopDepthFor(ceil, p);
      if (this.missed.update(stop - s.depth, dt)) {
        // §10.3.4.2: "Quad Ci will automatically switch to the alternate gradient factors, display the
        // messagge MAIN GF > ALT GF, and, if compatible with the current depth, keep you out of a dive
        // violation" ("If the alternate gradient factors are not compatible with the current depth, Quad
        // Ci considers this a dive violation"). Compatible: no deeper than 0.3 m above the ALT GF stop
        // (the DECO STOP! margin, assumed); missing the ALT GF stop in turn is a violation.
        if (this.altActive) this.violation = 'deco';
        else {
          this.altActive = true;
          this.altBySystem = true;
          this.missed.reset();
          const ap = this.decoParams(s);
          const altStop = stopDepthFor(ceilingDepth(s.tissues, this.anchor, ap), ap);
          if (altStop > 0 && s.depth < altStop - 0.3) this.violation = 'deco';
        }
      }
    } else {
      this.missed.reset();
    }

    // §13.2: SWITCH TO G2 when reaching its MOD during the ascent; 30 s without an answer: GAS NOT
    // SWITCHED (and, PREDICTIVE ON, EXCLUDING G2); back below its MOD: INCLUDING G2 AGAIN.
    const known = this.knownGases(s);
    const mods = known.map((g) => this.decoMod(g.o2));
    const { expired, included } = this.prompt.update(s, mods, 30);
    if (expired !== null) this.notSwitched(expired);
    if (included.length && this.settings.predictive !== 'off') this.say(`INCLUDING G${included[0] + 1} AGAIN`);
    // Not in the manual (§13.3.1 only says "The decompression calculation will reflect the switch";
    // assumed, issue #19): back to a leaner gas above the MOD of the richer one, the richer gas is
    // excluded at once (the 30 s are those of the prompt; a switch to a richer gas is counted at once
    // too), with the message of §13.2.
    const left = this.prompt.leave(s, mods, 0);
    if (left !== null && this.settings.predictive !== 'off') this.say(`EXCLUDING G${left + 1}`);

    // Deep stop (manual §4.5): depth at which the 5th tissue (27 min) switches from ongassing to
    // offgassing, suggested as the no deco limit approaches; optional, not part of the TTS.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');
  }


  /**
   * Alert bubble (app/alertHelp.ts): alarms and warnings of the manual (§10.3 alarms: ascent, MOD,
   * missed stop and ALT GF §10.3.4.2, CNS, tank §4.1; §3.2 warnings; §4.5 deep stop; §13.2 gas switch),
   * as the screen words them (`msg:` keys, see screenAlerts) and as the alert cues name them.
   */
  alertExplain(key: string): AlertExplain | null {
    const msg = key.startsWith('msg:') ? key.slice(4) : null;
    const untilBtn = { fr: 'Le message reste affiché jusqu’à l’appui sur un bouton.', en: 'The message stays until a button is pressed.' };
    if (key === 'fast-ascent' || msg === 'SLOW!') {
      return {
        id: 'slow', screen: 'SLOW!', code: 'ASCENT',
        what: { fr: `« SLOW! » en rouge avec la vitesse (SPEED) au-delà de la vitesse permise ; avertissement dès 80 % de celle-ci. ${ZHL_ASCENT.fr} ${zhlUncontrolled(48).fr}`, en: `Red “SLOW!” with the rate (SPEED) beyond the allowed rate; warning from 80 % of it. ${ZHL_ASCENT.en} ${zhlUncontrolled(48).en}` },
      };
    }
    if (key === 'missed-stop' || msg === 'DECO STOP!') {
      return {
        id: 'missed-stop', screen: 'DECO STOP!', code: 'CEILING',
        what: { fr: `« DECO STOP! » en rouge à plus de 0,3 m au-dessus du palier. ${ZHL_MISSED.fr} L’ordinateur passe alors aux gradient factors de secours (ALT GF, « MAIN GF > ALT GF ») ; si leur palier ne convient pas à votre profondeur, ou si vous le manquez à son tour : « DECO VIOLATION! » et verrouillage 48 h.`, en: `Red “DECO STOP!” more than 0.3 m above the stop. ${ZHL_MISSED.en} The computer then switches to the alternate gradient factors (ALT GF, “MAIN GF > ALT GF”); if their stop does not suit your depth, or you miss it in turn: “DECO VIOLATION!” and a 48 h lock.` },
      };
    }
    if (msg === 'MAIN GF > ALT GF') {
      return {
        screen: msg,
        what: { fr: `Palier manqué : l’ordinateur calcule désormais avec les gradient factors de secours (ALT GF, R0 par défaut, jamais plus bas que les MAIN GF), ce qui raccourcit les paliers et peut vous éviter la violation. ${untilBtn.fr}`, en: `Missed stop: the computer now computes with the alternate gradient factors (ALT GF, R0 by default, never lower than the MAIN GF), which shortens the stops and may keep you out of a violation. ${untilBtn.en}` },
        todo: { fr: 'Redescendez au palier affiché (celui des ALT GF) et terminez-le : le manquer à son tour est une violation.', en: 'Go back to the displayed stop (the ALT GF one) and complete it: missing it in turn is a violation.' },
      };
    }
    if (msg === 'DECO VIOLATION!') {
      return {
        screen: msg, critical: true,
        what: { fr: 'Violation de décompression : palier manqué alors que les ALT GF étaient déjà actifs, ou ALT GF incompatibles avec votre profondeur. L’ordinateur se verrouille 48 h.', en: 'Decompression violation: stop missed while the ALT GF were already in use, or ALT GF not suited to your depth. The computer locks for 48 h.' },
        todo: { fr: 'Remontez lentement en faisant des paliers de prudence, ne replongez pas avant la fin du verrouillage et surveillez les symptômes.', en: 'Ascend slowly with precautionary stops, do not dive again before the lock ends and watch for symptoms.' },
      };
    }
    if (key === 'LOCKED') {
      return { what: { fr: 'Verrouillage de 48 h après une violation (remontée incontrôlée ou palier manqué) : profondimètre seulement.', en: '48 h lock after a violation (uncontrolled ascent or missed stop): depth gauge only.' } };
    }
    if (key === 'mod' || msg === 'MOD EXCEEDED!') {
      return {
        id: 'mod', screen: 'MOD EXCEEDED!', code: 'PPO2_HIGH',
        what: { fr: 'Alarme sonore et « MOD EXCEEDED! » en rouge sous la MOD du gaz (ppO₂max réglable de 1,2 à 1,6 bar).', en: 'Audible alarm and red “MOD EXCEEDED!” below the gas MOD (ppO₂max settable from 1.2 to 1.6 bar).' },
      };
    }
    if (msg === 'MAX DEPTH REACHED') {
      return {
        screen: msg,
        what: { fr: 'Alarme de profondeur (WARNINGS > MAX DEPTH, désactivée par défaut) : vous avez atteint la profondeur choisie. Elle se comporte comme l’alarme de MOD.', en: 'Depth alarm (WARNINGS > MAX DEPTH, off by default): you reached the chosen depth. It behaves like the MOD alarm.' },
        todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' },
      };
    }
    if (key === 'cns-75' || msg === 'CNS > 75%') {
      return { id: 'cns-75', screen: 'CNS > 75%', code: 'CNS', what: { fr: `Le CNS dépasse 75 % : message rouge et un signal sonore. ${untilBtn.fr}`, en: `The CNS exceeds 75 %: red message and one audible signal. ${untilBtn.en}` } };
    }
    if (key === 'cns-100') return CNS100;
    if (msg === 'LOW TANK PRESSURE') {
      return {
        screen: msg, code: 'LOW_GAS',
        what: { fr: 'Avec l’émetteur, en décompression : le temps restant avant la réserve (TTR) est plus court que la durée de remontée (TTS).', en: 'With the transmitter, in decompression: the time left before the reserve (TTR) is shorter than the ascent time (TTS).' },
        todo: { fr: 'Commencez la remontée tout de suite et prévenez votre binôme : le gaz ne suffit pas pour tous les paliers en restant ici.', en: 'Start the ascent at once and tell your buddy: staying here, the gas is not enough for all the stops.' },
      };
    }
    if (key === 'reserve' || msg === 'TANK RESERVE') {
      return { id: 'reserve', screen: 'TANK RESERVE', code: 'LOW_GAS', what: { fr: `Avec l’émetteur : la pression atteint la réserve réglée (50 bar par défaut). Message rouge et alarme sonore. ${untilBtn.fr}`, en: `With the transmitter: the pressure reaches the set reserve (50 bar by default). Red message and audible alarm. ${untilBtn.en}` } };
    }
    if (key === 'half' || msg === 'HALF TANK') {
      return {
        id: 'half', screen: 'HALF TANK',
        what: { fr: `Avec l’émetteur : la moitié du bloc est consommée (100 bar par défaut, désactivable). Message jaune. ${untilBtn.fr}`, en: `With the transmitter: half the tank is used (100 bar by default, can be turned off). Yellow message. ${untilBtn.en}` },
        todo: { fr: 'Repère classique pour faire demi-tour.', en: 'The usual cue to turn the dive around.' },
      };
    }
    if (msg === 'TURN AROUND' || msg === 'TIME LIMIT') {
      const limit = msg === 'TIME LIMIT';
      return {
        screen: msg,
        what: limit
          ? { fr: `La durée de plongée atteint la limite réglée (WARNINGS > DIVE TIME, désactivée par défaut). ${untilBtn.fr}`, en: `The dive time reaches the set limit (WARNINGS > DIVE TIME, off by default). ${untilBtn.en}` }
          : { fr: `La moitié de la durée réglée (WARNINGS > DIVE TIME) est écoulée. ${untilBtn.fr}`, en: `Half the set dive time (WARNINGS > DIVE TIME) has elapsed. ${untilBtn.en}` },
        todo: limit ? { fr: 'Remontez.', en: 'Ascend.' } : { fr: 'Faites demi-tour.', en: 'Turn the dive around.' },
      };
    }
    if (msg === 'ENTERING DECO') {
      return { screen: msg, code: 'DECO', what: { fr: `Avertissement à l’entrée en décompression (texte non donné par le manuel, déduit). ${untilBtn.fr}`, en: `Warning when decompression begins (wording not given by the manual, deduced). ${untilBtn.en}` } };
    }
    if (msg === 'NO DECO 2 MIN') {
      return { screen: msg, code: 'NDL_LOW', what: { fr: `Avertissement à 2 min de la limite sans palier (texte non donné par le manuel, déduit). ${untilBtn.fr}`, en: `Warning 2 minutes before the no-deco limit (wording not given by the manual, deduced). ${untilBtn.en}` } };
    }
    if (msg === 'GF @SURF') {
      return {
        title: { fr: 'GF @SURF clignotant', en: 'Blinking GF @SURF' },
        what: { fr: 'GF @SURF (la sursaturation qu’auraient vos tissus en surface) atteint la valeur d’alerte réglée (désactivée par défaut) ; elle clignote jusqu’à l’appui sur un bouton.', en: 'GF @SURF (the supersaturation your tissues would have at the surface) reaches the set warning value (off by default); it blinks until a button is pressed.' },
        todo: { fr: 'Au-delà de 100, une remontée directe dépasserait la limite : faites les paliers indiqués.', en: 'Above 100, a direct ascent would exceed the limit: make the indicated stops.' },
      };
    }
    if (msg === 'DEEP STOP') {
      return {
        screen: msg,
        what: { fr: 'Palier profond facultatif (désactivé par défaut) : à la profondeur où le 5e compartiment (27 min) cesse de se charger, proposé à l’approche de la limite sans palier, 2 min.', en: 'Optional deep stop (off by default): at the depth where the 5th compartment (27 min) stops loading, suggested as the no-deco limit approaches, 2 minutes.' },
        todo: { fr: 'Restez à ±1,5 m de cette profondeur pendant le décompte, ou continuez la remontée.', en: 'Stay within ±1.5 m of that depth during the countdown, or carry on ascending.' },
      };
    }
    if (key.startsWith('switch-')) {
      return gasSwitch('SWITCH TO G2', { fr: 'TR ou BR : changer (GAS SWITCH OK) ; TL ou BL, ou 30 s sans réponse : GAS NOT SWITCHED, et avec PREDICTIVE le gaz sort du calcul (EXCLUDING G2).', en: 'TR or BR: switch (GAS SWITCH OK); TL or BL, or 30 s without an answer: GAS NOT SWITCHED, and with PREDICTIVE the gas leaves the calculation (EXCLUDING G2).' });
    }
    if (msg?.startsWith('EXCLUDING')) {
      return { id: 'excluding', screen: 'EXCLUDING G…', what: { fr: 'Avec PREDICTIVE : le gaz non pris sort du calcul ; paliers et TTS s’allongent.', en: 'With PREDICTIVE: the gas not taken leaves the calculation; stops and TTS get longer.' } };
    }
    if (msg?.startsWith('INCLUDING')) {
      return { id: 'including', screen: 'INCLUDING G… AGAIN', what: { fr: 'Redescendu sous sa MOD, le gaz exclu revient dans le calcul.', en: 'Back below its MOD, the excluded gas is counted again.' } };
    }
    if (msg === 'GAS NOT SWITCHED') {
      return { screen: msg, what: { fr: 'Changement de gaz refusé ou invite restée sans réponse 30 s.', en: 'Gas switch declined or prompt unanswered for 30 s.' } };
    }
    return null;
  }

  protected say(text: string): void {
    this.gasMsgs.say(text);
  }

  protected gasMessage(): string | null {
    return this.gasMsgs.current;
  }

  /** §13.2: GAS NOT SWITCHED, then, PREDICTIVE ON, EXCLUDING G2 before the calculation drops it. */
  protected notSwitched(gas: number): void {
    this.say('GAS NOT SWITCHED');
    if (this.settings.predictive !== 'off') this.say(`EXCLUDING G${gas + 1}`);
  }

  protected hasDesat(s: DiveSession): boolean {
    return s.log.length > 0 && s.clock < this.desatUntil;
  }

  /**
   * Audible alarms (instruction manual, alarms): fast ascent, MOD exceeded and missed deco stop sound while they last;
   * CNS 100 %: 5 s in one-minute intervals; CNS 75 %%, once. §3.3 ALL SILENT turns the audible alarms off (off by default, assumed).
   */
  /** §4.1 HALF TANK (bar): the half tank warning, and the limit of the blue / green and yellow ranges (§4.1.1). */
  halfTank(): number {
    return Number(this.settings.halfTank) || 100;
  }

  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.silent === 'on') || !v.inDive) return [];
    const cues = maresCues(v);
    // Gas switch prompt: "sounds an audible signal" (once).
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns-75', kind: 'beep', level: 'info', until: 'once' });
    // TANK RESERVE alarm (with a tank module; "alarms are both visual and audible"). How it is
    // acknowledged is not given: a button press, as on the Quad Air, assumed.
    if (v.tank.ai && v.tank.pressure <= v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'warning', until: 'ack', every: 3 });
    // HALF TANK (§10.3.4.2: shown until a button is pressed); its sound is not described, assumed alike.
    else if (v.tank.ai && this.settings.halfWarn !== 'off' && v.tank.pressure <= this.halfTank()) cues.push({ key: 'half', kind: 'beep', level: 'info', until: 'ack', every: 3 });
    return cues;
  }
}

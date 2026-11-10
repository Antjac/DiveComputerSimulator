import { SURFACE_PRESSURE, ceilingDepth, depthToPressure, pressureToDepth, stopDepthFor, type DecoParams } from '../../../engine/buhlmann';
import { type DiveSession } from '../../../engine/session';
import { type AlertCue, ComputerView, DiveComputer, SettingDef, desaturationTime, type AlertExplain } from '../../base';
import { GasPrompt } from '../../common/gasSwitch';
import { divingDays, standardNoFly } from '../../common/dives';
import { surfGfAfter, ttsAfter } from '../../common/predict';
import { DeepStop, FastAscentZhl, GasMessages, MissedStop, PRESETS, maresCues, maresWarningSettings, quadAscentLimit } from '../common';
import { CNS100, ZHL_ASCENT, ZHL_MISSED, gasSwitch, zhlUncontrolled } from '../alerts';
import { ppo2Setting } from '../../common/ppo2';
import { pressureSetting } from '../../common/tank';

const atm = (d: number) => depthToPressure(d) / 1.01325;
const onOff = [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }];
const LEVELS = [{ value: 'off', label: 'OFF' }, { value: '1', label: 'LOW' }, { value: '2', label: 'MEDIUM' }, { value: '3', label: 'HIGH' }];
/** §8.3.4.2: the EMERGENCY gradient factors, 95/95. */
const EMERGENCY = 0.95;

/**
 * Mares Sirius (instruction manual of 06/2026, firmware 1.05.00 and later; air and nitrox modes, up to
 * three gases). Unmodified Bühlmann ZH-L16C with gradient factors (§2.2), reproduced: MAIN GF R0–T3,
 * personalization (PHYSIO, DIVE, I TODAY), repetitive dive and multiday conservatism, EMERGENCY GF
 * 95/95 after a missed stop (§8.3.4.2), CEIL-CON (§2.15), SAFETY STOP + (§9.1.2), depth-dependent
 * ascent rates and the 48 h lock (§2.13, §12.1). Round colour display drawn after the manual's
 * figures (§8.3, §9, §10, §11): E-Z and COMPLICATIONS layouts, magenta / green N2 divider, tank
 * pressure divider in the pressure range colour, red alarm segment at the bottom.
 */
export abstract class SiriusRules extends DiveComputer {
  readonly id = 'sirius';
  readonly name = 'Mares Sirius';
  readonly algorithm = 'ZH-L16C + GF';
  readonly exact = true;
  readonly transmitter = 'Tank module';
  readonly gasTimeName = 'TTR';
  readonly notes = {
    fr: 'Manuel d’utilisation de 06/2026 (firmware 1.05.00 et suivants), modes AIR et NITROX. Le firmware 1.10.00 (09/2026) annonce une « nouvelle bibliothèque de plongée avec un calcul de NDL amélioré », non documentée : les temps sans palier de l’appareil peuvent s’écarter de ceux du simulateur. Bühlmann ZH-L16C non modifié avec gradient factors (§2.2) : reproduit (R0 85/85, R3 50/60, T0 30/85 et T3 25/40 d’après le manuel ; R1, R2, T1, T2 repris des autres Mares ; CUSTOM non proposé). Personnalisation (§2.2.2) : PHYSIO −10 par niveau (ADVANCED +5), DIVE −3, I TODAY −5 ; successives (−8 à la sortie, +1 par 15 min) et multi-jours (−2 par jour, max −6) en option, désactivées par défaut (défaut non donné, supposé). Vitesse maximale selon la profondeur (5 / 10 / 15 / 20 m/min, §8.3.1) : SLOW! et séparateurs rouges ; plus de 120 % sur plus de 20 m = verrouillage 48 h (ASCENT VIOL., désactivable). Palier manqué (§8.3.4) : DECO STOP! à plus de 0,3 m au-dessus ; moins de 1 m pendant 3 min ou plus de 1 m pendant 1 min : GF de secours 95/95 (MAIN GF=> GF 95/95 jusqu’à l’appui sur un bouton) ; si la profondeur ne leur convient pas : VIOLATION DECO! et profondimètre seul pendant 48 h (LOCKED BY PREVIOUS DIVE) ; palier des GF 95/95 manqué à son tour : violation (supposé, comme le Quad Ci). CEIL-CON (§2.15, désactivé supposé) : on peut remonter jusqu’au plafond tant qu’il est sous 6 m, plafond affiché en haut à droite à moins de 3 m du palier le plus profond, puis STOP et la profondeur du palier ; CEILING! au-dessus du plafond, GF 95/95 après 1 min (jusqu’à 0,3 m) ou aussitôt ; E-Z indisponible en déco. Dernier palier DECO STOP 3 / 4,5 / 6 m (§2.10 : avec PREDICTIVE, un gaz d’au moins 36 % et le changement fait, sinon 3 m ; 3 m par défaut supposé). Palier de sécurité 3 min entre 6 et 3 m (§9.1) avec GF@SURF/@+3, puis OK et un décompte ; SAFETY STOP + (§9.1.2) : palier supplémentaire jusqu’à ce que GF @SURF tombe sous 70 ou 75 (70 par défaut supposé). Deep stop (§2.9, désactivé par défaut) : 2 min, facultatif. FUTURE DECO (§9.2) : TTS @+X (3 à 10 min, 5 par défaut) et RUNAWAY DECO (2 à 4 fois X, ×2 par défaut d’après « 10 minutes »). Écrans (§9) : E-Z et COMPLICATIONS ; TR / BR changent le champ en haut / en bas (2 s en E-Z ; 4 s en COMPLICATIONS avant le retour à MAX et TTR, durée donnée par le §8.3.3) ; BL : E-Z, COMPLICATIONS, tissus, profil, liste des paliers (retour à E-Z après 5 s), la mise en page atteinte (E-Z ou COMPLICATIONS) devenant le réglage « Écran de plongée », repris à la plongée suivante (supposé : le manuel n’a pas de menu pour la mise en page) ; TL : chronomètre ; TR long : rétroéclairage. Multigaz (§11) : jusqu’à 3 gaz G1 à G3 (bloc principal puis gaz de déco de la page) ; au MOD d’un gaz plus riche pendant la remontée, bip et SWITCH TO G2 (TR ou BR : GAS SWITCH OK ; TL ou BL ou 30 s : GAS NOT SWITCHED, puis EXCLUDING G2 si PREDICTIVE ; redescendu sous sa MOD : INCLUDING G2 AGAIN) ; tableau des gaz par BR long ; ppO2max des gaz de déco 1,6 bar supposé, 1,6 à 1,8 bar à partir de 80 % d’O2. Émetteur (§2.3) : HALF TANK (100 bar) et TANK RESERVE (50 bar) jusqu’à l’appui sur un bouton, LOW TANK PRESSURE si TTR < TTS en déco ; TTR absent les 2 premières minutes (manuel FW 1.02.00, absent de la révision 06/2026). Palier de sécurité, comportement incertain (le manuel n’en dit rien) : redescendu sous 6 m, l’écran revient à NO DECO (constaté sur un Quad) ; le décompte reprend là où il s’était arrêté entre 6 et 3 m et repart de zéro au-delà de 10 m (supposé). Non simulés : boussole, menu sous l’eau (DIVE se règle ici dans les réglages), carnet, planificateur, trimix et héliox (§11.4), FREEDIVE (§13), profondimètre choisi par l’utilisateur, durée du mode surfacing (3 min fixes ici), eau douce / EN13319, altitude, langue de l’appareil (anglais ici), luminosité, rétroéclairage permanent, batteries (toujours suffisantes ici ; valeurs affichées fictives), pression du binôme (G-B), tissu directeur à côté du plafond (format non donné), cadran ANALOG.',
    en: 'Instruction manual of 06/2026 (firmware 1.05.00 and later), AIR and NITROX modes. Firmware 1.10.00 (09/2026) announces a “new dive library with improved NDL calculation”, undocumented: the device’s no-deco times may differ from the simulator’s. Unmodified Bühlmann ZH-L16C with gradient factors (§2.2): reproduced (R0 85/85, R3 50/60, T0 30/85 and T3 25/40 from the manual; R1, R2, T1, T2 taken from the other Mares; CUSTOM not offered). Personalization (§2.2.2): PHYSIO −10 per level (ADVANCED +5), DIVE −3, I TODAY −5; optional repetitive dive (−8 on surfacing, +1 per 15 min) and multiday (−2 per day, max −6) conservatism, off by default (default not given, assumed). Depth-dependent maximum ascent rate (5 / 10 / 15 / 20 m/min, §8.3.1): SLOW! and red dividers; more than 120 % over more than 20 m = 48 h lock (ASCENT VIOL., can be turned off). Missed stop (§8.3.4): DECO STOP! more than 0.3 m above; less than 1 m for 3 min or more than 1 m for 1 min: EMERGENCY GF 95/95 (MAIN GF=> GF 95/95 until a button is pressed); if the depth does not suit them: VIOLATION DECO! and bottom timer only for 48 h (LOCKED BY PREVIOUS DIVE); 95/95 stop missed in turn: violation (assumed, as on the Quad Ci). CEIL-CON (§2.15, off assumed): ascend up to the ceiling while it is deeper than 6 m, ceiling shown top right within 3 m of the deepest stop, then STOP and the stop depth; CEILING! above the ceiling, GF 95/95 after 1 min (up to 0.3 m) or at once; E-Z unavailable in deco. Shallowest stop DECO STOP 3 / 4.5 / 6 m (§2.10: with PREDICTIVE, a gas of at least 36 % and the switch made, else 3 m; 3 m by default assumed). Safety stop 3 min between 6 and 3 m (§9.1) with GF@SURF/@+3, then OK and a count-up; SAFETY STOP + (§9.1.2): an extra stop until GF @SURF drops below 70 or 75 (70 by default assumed). Deep stop (§2.9, off by default): 2 min, optional. FUTURE DECO (§9.2): TTS @+X (3 to 10 min, 5 by default) and RUNAWAY DECO (2 to 4 times X, ×2 by default after “10 minutes”). Screens (§9): E-Z and COMPLICATIONS; TR / BR change the top / bottom field (2 s on E-Z; 4 s on COMPLICATIONS before going back to MAX and TTR, the time given in §8.3.3); BL: E-Z, COMPLICATIONS, tissue graph, profile, list of stops (back to E-Z after 5 s), the layout reached (E-Z or COMPLICATIONS) becoming the “Dive screen” setting, kept for the next dive (assumed: the manual has no menu for the layout); TL: stopwatch; TR hold: backlight. Multigas (§11): up to 3 gases G1 to G3 (the main tank, then the deco gases set on the page); at the MOD of a richer gas during the ascent, a beep and SWITCH TO G2 (TR or BR: GAS SWITCH OK; TL or BL or 30 s: GAS NOT SWITCHED, then EXCLUDING G2 with PREDICTIVE; back below its MOD: INCLUDING G2 AGAIN); gas table with a BR hold; ppO2max of the deco gases 1.6 bar assumed, 1.6 to 1.8 bar from 80 % O2. Transmitter (§2.3): HALF TANK (100 bar) and TANK RESERVE (50 bar) until a button is pressed, LOW TANK PRESSURE when TTR < TTS in deco; TTR not shown for the first 2 minutes (FW 1.02.00 manual, not in the 06/2026 revision). Safety stop, uncertain behaviour (the manual is silent): back deeper than 6 m, the display returns to NO DECO (reported on a Quad); the countdown resumes where it stopped between 6 and 3 m and restarts deeper than 10 m (assumed). Not simulated: compass, underwater menu (DIVE is set in the settings here), logbook, planner, trimix and heliox (§11.4), FREEDIVE (§13), bottom timer mode chosen by the user, surfacing mode duration (fixed 3 min here), fresh water / EN13319, altitude, device language (English here), brightness, push-on backlight, batteries (always sufficient here; values shown are fictitious), buddy pressure (G-B), leading tissue next to the ceiling (format not given), ANALOG watch face.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      // §9: E-Z or COMPLICATIONS (BL-SP switches between them during the dive). Factory layout not given: E-Z assumed.
      key: 'display',
      essential: true,
      label: { fr: 'Écran de plongée', en: 'Dive screen' },
      options: [{ value: 'ez', label: 'E-Z' }, { value: 'full', label: 'COMPLICATIONS' }],
      default: 'ez',
    },
    {
      // §2.2.1 MAIN GF: "The default value is R0 (85/85)." (CUSTOM not offered here.)
      key: 'gf',
      label: { fr: 'Gradient factors (MAIN GF)', en: 'Gradient factors (MAIN GF)' },
      options: Object.entries(PRESETS).map(([k, [lo, hi]]) => ({ value: k, label: `${k} (${lo}/${hi})` })),
      default: 'R0',
      group: 'deco',
    },
    {
      // §2.2.2 PHYSIO: −10 per step (LOW, MEDIUM, HIGH), ADVANCED +5 (up to 90/90). "The default value is OFF."
      key: 'physio',
      label: { fr: 'PHYSIO', en: 'PHYSIO' },
      options: [...LEVELS, { value: 'adv', label: 'ADVANCED' }],
      default: 'off',
      group: 'deco',
    },
    {
      // §2.2.2 DIVE: −3 per step. "The default value is OFF." (Editable during the dive via the UW menu.)
      key: 'dive',
      label: { fr: 'DIVE', en: 'DIVE' },
      options: LEVELS,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.2.2 I TODAY: −5 per step. "The default value is OFF."
      key: 'itoday',
      label: { fr: 'I TODAY', en: 'I TODAY' },
      options: LEVELS,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.2.3 REPETITIVE DIVES: −8 on surfacing, +1 every 15 min. Default not given: OFF assumed (the GF
      // TABLE figure of §2.2 shows ON, with DIVE −3: an example, not the factory settings).
      key: 'repetitive',
      label: { fr: 'Successives (REP DIVES)', en: 'Repetitive dives (REP DIVES)' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.2.4 MULTIDAY: −2 per day of diving, up to −6. Default not given: OFF assumed (as REP DIVES).
      key: 'multiday',
      label: { fr: 'Multi-jours (MULTIDAY)', en: 'Multiday' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.4 SAFETY STOP +: "You can choose between 70 or 75, or you can turn the feature off." Default not
      // given: 70 assumed.
      key: 'safetyPlus',
      label: { fr: 'SAFETY STOP + (GF @SURF visé)', en: 'SAFETY STOP + (GF @SURF target)' },
      options: [{ value: '70', label: '70' }, { value: '75', label: '75' }, { value: 'off', label: 'OFF' }],
      default: '70',
      group: 'deco',
    },
    {
      // §2.10 DECO STOP: shallowest stop 3, 4.5 or 6 m (only with PREDICTIVE ON, a gas of at least 36 % and
      // the switch made, else 3 m). Default not given: 3 m assumed.
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
      // §2.15 CEIL-CON DECO. Default not given: OFF assumed ("If you have any doubts about CEIL-CON, do not activate it").
      key: 'ceilCon',
      label: { fr: 'CEIL-CON DECO', en: 'CEIL-CON DECO' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.9 DEEP STOP: "The default setting is OFF."
      key: 'deepstop',
      label: { fr: 'Deep stop', en: 'Deep stop' },
      options: onOff,
      default: 'off',
      group: 'deco',
    },
    {
      // §2.7 / §9.2 NOTE: TTS @+X, X between 3 and 10 minutes (5 in the figures).
      key: 'future',
      label: { fr: 'FUTURE DECO (TTS @+X)', en: 'FUTURE DECO (TTS @+X)' },
      options: [3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ value: String(x), label: `+${x}` })),
      default: '5',
      group: 'deco',
    },
    {
      // §9.2 NOTE: RUNAWAY DECO "between 2 and 4 times the value of X" (×2 matches "greater than 10 minutes"
      // with X = 5).
      key: 'runaway',
      label: { fr: 'RUNAWAY DECO (× X)', en: 'RUNAWAY DECO (× X)' },
      options: [2, 3, 4].map((k) => ({ value: String(k), label: `×${k}` })),
      default: '2',
      group: 'deco',
    },
    {
      // §2.13 ASCENT VIOL.: the 48 h lock after an uncontrolled ascent can be turned off (ON by default:
      // the lock is described as the normal behaviour, §8.3.1).
      key: 'ascviol',
      label: { fr: 'Verrou remontée (ASCENT VIOL.)', en: 'Ascent violation lock' },
      options: onOff,
      default: 'on',
      group: 'deco',
    },
    {
      // §2.12 ALL SILENT: "you can disable audible alarms" (off by default, assumed).
      key: 'silent',
      label: { fr: 'Silence (ALL SILENT)', en: 'All silent' },
      options: [{ value: 'on', label: { fr: 'Activé', en: 'On' } }, { value: 'off', label: { fr: 'Désactivé', en: 'Off' } }],
      default: 'off',
    },
    // §8.1: "The default value of ppO2max from the factory is 1.4bar. This can be adjusted to your preference
    // between 1.2 and 1.6bar" (step not given: 0.1).
    ppo2Setting(1.2, 1.6, 1.4, 'ppO2max'),
    {
      // §2.1 / §11.1: each gas has its own ppO2max (1.2 to 1.6 bar, §8.3.2). Value of G2 / G3 not given: 1.6 assumed
      // (the G2 figure of §11.1 shows PPO2 1.60).
      key: 'ppo2Deco',
      label: { fr: 'ppO2max G2 / G3', en: 'ppO2max G2 / G3' },
      options: [1.2, 1.3, 1.4, 1.5, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §11.1 NOTE: from 80 % O2 the ppO2max is set to 1.6 bar automatically, adjustable from 1.6 to 1.8 bar.
      key: 'ppo2Rich',
      label: { fr: 'ppO2max des gaz ≥ 80 % O2', en: 'ppO2max of gases ≥ 80% O2' },
      options: [1.6, 1.7, 1.8].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(1)} bar` })),
      default: '1.60',
      group: 'deco',
    },
    {
      // §2.6.1 PREDICTIVE: "The default value is ON."
      key: 'predictive',
      label: { fr: 'Multigaz PREDICTIVE', en: 'PREDICTIVE multigas' },
      options: onOff,
      default: 'on',
      group: 'deco',
    },
    {
      // §2.6.2 SWITCH BELOW MOD: "The default value is ON."
      key: 'belowMod',
      label: { fr: 'Switch sous la MOD (SWITCH BELOW MOD)', en: 'Switch below MOD' },
      options: onOff,
      default: 'on',
      group: 'deco',
    },
    // §2.3: "HALF TANK, is the value at which Sirius triggers a half tank warning [...] Default values are
    // 100bar"; "TANK RESERVE [...] Default values are 50bar". Ranges not given: 5 bar steps offered.
    pressureSetting('halfTank', { fr: 'Demi-bloc (HALF TANK)', en: 'Half tank (HALF TANK)' }, 60, 200, 5, 100),
    pressureSetting('reserve', { fr: 'Réserve (TANK RESERVE)', en: 'Tank reserve' }, 20, 100, 5, 50),
    // §2.5.1–2.5.4: same words as the Quad Ci. NO DECO and ENTERING DECO defaults are not given: OFF assumed (the
    // SET DIVE table: WARNINGS "Allows you to define and activate certain warnings individually").
    ...maresWarningSettings('NO DECO').map((d) => (d.key === 'wNoDeco' || d.key === 'wDeco' ? { ...d, default: 'off' } : d)),
    {
      // §2.5.5 GF @SURF: "The value can be set between 50 and 250. The default setting is OFF." (step not given: 5).
      key: 'wGfSurf',
      label: { fr: 'Avertissement GF @SURF', en: 'GF @SURF warning' },
      options: [{ value: 'off', label: 'OFF' }, ...Array.from({ length: 41 }, (_, i) => ({ value: String(50 + i * 5), label: String(50 + i * 5) }))],
      default: 'off',
    },
  ];

  protected fast = new FastAscentZhl();
  protected missed = new MissedStop('zhl');
  /** CEIL-CON (§8.3.4.2.1): seconds spent above the ceiling by up to 0.3 m. */
  protected ceilAbove = 0;
  /** Violation of the dive (§12.1); the computer locks after surfacing. */
  protected violation: 'deco' | 'ascent' | null = null;
  /** EMERGENCY GF in use (§8.3.4.2), and its message not acknowledged yet. */
  protected emergency = false;
  protected emergencyMsg = false;
  protected hadDeco = false;
  protected repetitiveDive = false;
  /** Session clock until which the last dive still desaturates (repetitive dive detection). */
  protected desatUntil = -Infinity;
  /** The last dive needs the 24 h no-fly time (decompression or repetitive dive, §10). */
  protected longNoFly = false;
  protected lastView: ComputerView | null = null;
  protected deep = new DeepStop();
  /** §11.2: gas switch prompt (SWITCH TO G2 / G3). */
  protected prompt = new GasPrompt();
  /** §11.2 messages shown briefly (GAS SWITCH OK, GAS NOT SWITCHED, EXCLUDING G2, INCLUDING G2 AGAIN). */
  protected gasMsgs = new GasMessages();
  /** SAFETY STOP + (§9.1.2): state after the regular safety stop, and seconds left. */
  protected plus: 'none' | 'active' | 'done' = 'none';
  protected plusRemaining = 0;
  /** Count-up after the safety stop (§9.1.1), seconds. */
  protected countUp = 0;
  private plusCheckAt = -Infinity;

  /** §11: "up to three gas mixtures during the dive (air and Nitrox only)", G1 to G3. */
  get maxGases(): number {
    return 3;
  }

  decoPpo2(): number {
    return Number(this.settings.ppo2Deco) || 1.6;
  }

  /** §11.1 NOTE: gases of 80 % O2 or more have their own ppO2max, 1.6 to 1.8 bar (1.6 by default). */
  decoMod(o2: number): number {
    const ppo2 = o2 >= 0.8 - 1e-9 ? Number(this.settings.ppo2Rich) || 1.6 : this.decoPpo2();
    return Math.max(0, pressureToDepth(ppo2 / o2));
  }

  /** MOD of each programmed gas: "The MOD for G2 and G3 is the switch depth for the corresponding gas" (§11.1). */
  protected gasMods(s: DiveSession): number[] {
    return this.knownGases(s).map((g, i) => (i === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2)));
  }

  /**
   * §2.6.1 PREDICTIVE ON: all gases, switched at their MOD, except one not switched to when prompted
   * (§11.2: EXCLUDING G2, then INCLUDING G2 AGAIN below its MOD); OFF: the gas breathed only.
   */
  planGases(s: DiveSession) {
    if (this.settings.predictive === 'off') return [];
    return super.planGases(s).filter((g) => !this.prompt.declined.has(s.allGases.indexOf(g.gas)));
  }

  /** §11 NOTE: a gas without a paired transmitter uses the dive display without tank pressure (only G1 has one here). */
  airIntegrated(s: DiveSession): boolean {
    return super.airIntegrated(s) && s.breathing === 0;
  }

  constructor() {
    super();
    // §9.1: safety stop on dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // §8.3.4: DECO STOP! more than 0.3 m above the stop
    this.lockAfter = null; // §8.3.4.2: handled in tick
    this.lockHours = 48; // §2.13, §8.3.1, §12.1
    this.stopWindow = 1; // not given by the manual (as the Quad Ci)
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    const [lo, hi] = PRESETS[this.settings.gf] ?? PRESETS.R0;
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  /**
   * §2.10 DECO STOP: the chosen shallowest stop needs PREDICTIVE ON, a gas of at least 36 % and the
   * switch made when prompted; "If these conditions are not met, Sirius will recalculate the
   * decompression with a 3 m / 10 ft shallowest stop."
   */
  protected lastStop(s: DiveSession): number {
    const chosen = Number(this.settings.decoStop) || 3;
    const ok = this.settings.predictive !== 'off' && this.knownGases(s).some((g) => g.o2 >= 0.36 - 1e-9) && this.prompt.declined.size === 0;
    return ok ? chosen : 3;
  }

  /**
   * MAIN GF with the personalization (§2.2.2: PHYSIO −10 per step or ADVANCED +5, DIVE −3, I TODAY −5),
   * repetitive dive (§2.2.3) and multiday (§2.2.4) reductions.
   */
  mainParams(s: DiveSession): DecoParams {
    const p = { ...this.baseParams(), lastStop: this.lastStop(s) };
    const step = (k: string) => (this.settings[k] === 'off' ? 0 : Number(this.settings[k]) || 0);
    let drop = this.settings.physio === 'adv' ? -5 : 10 * step('physio');
    drop += 3 * step('dive') + 5 * step('itoday');
    if (this.settings.multiday === 'on') drop += Math.min(6, 2 * (divingDays(s) - 1));
    if (this.settings.repetitive === 'on' && s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += Math.max(0, 8 - Math.floor(si / 15));
    }
    return { ...p, gfLow: Math.max(0.1, p.gfLow - drop / 100), gfHigh: Math.max(0.2, p.gfHigh - drop / 100) };
  }

  /**
   * §8.3.4.2: the EMERGENCY gradient factors, 95/95. Glossary, GF SET: the MAIN GF "inclusive, if set, of
   * personalizations, rep dive and multiday, unless there was a switch to the EMERGENCY GF": none of these
   * reductions apply to them.
   */
  emergencyParams(s: DiveSession): DecoParams {
    return { ...this.mainParams(s), gfLow: EMERGENCY, gfHigh: EMERGENCY };
  }

  algoParams(s: DiveSession): DecoParams {
    return this.emergency ? this.emergencyParams(s) : this.mainParams(s);
  }

  /**
   * §2.15 CEIL-CON DECO: the diver may "ascend to the ceiling without incurring into a deco stop
   * violation" until "the ceiling has reached the value of 6.0 m"; then the stops are made "in the
   * standard way".
   */
  ceilCon(ceil: number): boolean {
    return this.settings.ceilCon === 'on' && ceil > 6;
  }

  protected violationDepth(ceil: number, p: DecoParams): number {
    if (ceil <= 0) return ceil;
    return this.ceilCon(ceil) ? ceil : stopDepthFor(ceil, p);
  }

  /** §8.3.1 / §9: SLOW! above the limit for the current depth; the E-Z bars turn yellow from 80 % of it. */
  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const lim = quadAscentLimit(depth);
    return rate > lim ? 2 : rate > lim * 0.8 ? 1 : 0;
  }

  /** TTR (glossary): "the time that a diver can spend at the current depth before reaching the tank reserve". */
  gasTime(s: DiveSession, _p: DecoParams, sacBar: number): number | null {
    return Math.max(0, Math.min(99, Math.floor((s.tankPressure - this.reservePressure()) / (sacBar * atm(s.depth)))));
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.fast.reset();
    this.missed.reset();
    this.ceilAbove = 0;
    this.violation = null;
    this.emergency = this.emergencyMsg = false;
    this.hadDeco = false;
    // §10: "Any dive started while there is remaining desaturation [...] is considered a repetitive dive".
    this.repetitiveDive = s.clock < this.desatUntil;
    this.deep.reset();
    this.prompt.reset();
    this.gasMsgs.clear();
    this.plus = 'none';
    this.plusRemaining = 0;
    this.countUp = 0;
  }

  onDiveEnd(s: DiveSession): void {
    this.desatUntil = s.clock + desaturationTime(s.tissues) * 60;
    this.longNoFly = this.hadDeco || this.repetitiveDive;
    // §12.1: after a violation, bottom timer only for 48 hours, LOCKED BY PREVIOUS DIVE.
    if (this.violation) this.lock(s);
  }

  /**
   * §8.3.4.2: switch to the EMERGENCY GF; "If the EMERGENCY gradient factors are not compatible with the
   * current depth, Sirius considers this a dive violation". Compatible: no more than the alarm margin
   * (0.3 m) above their stop (assumed). Already on them: missing their stop in turn is a violation
   * (assumed, as on the Quad Ci).
   */
  private toEmergency(s: DiveSession): void {
    if (this.emergency) {
      this.violation = 'deco';
      return;
    }
    this.emergency = this.emergencyMsg = true;
    this.missed.reset();
    this.ceilAbove = 0;
    const ep = this.decoParams(s);
    const c = ceilingDepth(s.tissues, this.anchor, ep);
    if (c > 0 && s.depth < this.violationDepth(c, ep) - this.ceilingMargin) this.violation = 'deco';
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;

    // §8.3.1 / §2.13: more than 120 % of the allowed rate over a depth change of more than 20 m.
    if (this.fast.update(s.ascentRate, s.depth) && this.settings.ascviol !== 'off') this.violation = this.violation ?? 'ascent';

    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    if (ceil > 0) {
      this.hadDeco = true;
      if (this.ceilCon(ceil)) {
        // §8.3.4.2.1: above the ceiling by up to 0.3 m for 1 minute or more, or by more than 0.3 m at once.
        const above = ceil - s.depth;
        this.missed.reset();
        if (above > 0.3) this.toEmergency(s);
        else if (above > 0) {
          this.ceilAbove += dt;
          if (this.ceilAbove >= 60) this.toEmergency(s);
        } else this.ceilAbove = 0;
      } else {
        // §8.3.4.2: above the stop by less than 1 m for more than 3 min, or by more than 1 m for more than 1 min.
        this.ceilAbove = 0;
        if (this.missed.update(stopDepthFor(ceil, p) - s.depth, dt)) this.toEmergency(s);
      }
    } else {
      this.missed.reset();
      this.ceilAbove = 0;
    }

    // §11.2: SWITCH TO G2 when reaching its MOD during the ascent; "If you don't perform any action within 30
    // seconds, Sirius shows GAS NOT SWITCHED" (and, PREDICTIVE ON, EXCLUDING G2); "If you drop again below
    // the MOD for G2, Sirius will show the message INCLUDING G2 AGAIN".
    const mods = this.gasMods(s);
    const { expired, included } = this.prompt.update(s, mods, 30);
    if (expired !== null) this.notSwitched(expired);
    if (included.length && this.settings.predictive !== 'off') this.say(`INCLUDING G${included[0] + 1} AGAIN`);
    // Not in the manual (§11.3.1 only says "The decompression calculation will reflect the switch"; assumed,
    // issue #19, as on the other Mares): back to a leaner gas above the MOD of the richer one, the richer gas
    // is excluded at once, with the message of §11.2.
    const left = this.prompt.leave(s, mods, 0);
    if (left !== null && this.settings.predictive !== 'off') this.say(`EXCLUDING G${left + 1}`);

    // §2.9: deep stop for air and nitrox dives, "generated as you approach the no deco limit" (§9.1); optional.
    this.deep.update(s, ceil, p, dt, this.settings.deepstop === 'on');

    this.tickSafetyPlus(s, dt);
  }

  /**
   * §9.1.2 SAFETY STOP +: after the regular safety stop, an extra stop "so as to bring the GF @SURF at the
   * end of the stop to a level lower than" the set value (§2.4: 70 or 75); its time is that needed at the
   * current depth (recomputed as the diver goes, assumed), counting down within the safety stop range.
   * §9.1.1: "OK appears and a countup timer starts as long as you stay shallower than 6 m", visible only
   * after SAFETY STOP + (§9.1.2).
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

  /** §9 NOTE: set to AIR, MOD, CNS and ppO2 are not displayed ("set Sirius to Nitrox 21%" to see them). */
  protected nitrox(s: DiveSession): boolean {
    return s.gas.o2 > 0.215 || this.knownGases(s).length > 1;
  }

  /** §9.2: TTS @+X. */
  protected ttsPlus(v: ComputerView, s: DiveSession): number {
    return ttsAfter(s, v.depth, this.futureX(), this.decoParams(s), this.anchor);
  }

  protected futureX(): number {
    return Number(this.settings.future) || 5;
  }

  /** §9.1.1 GF @+3: "the prediction of GF @SURF 3 minutes ahead". */
  protected gfAt3(v: ComputerView, s: DiveSession): number {
    return Math.round(surfGfAfter(s, v.depth, 3));
  }

  /** §10: the POST DIVE display lasts while there is remaining desaturation or no-fly time. */
  protected hasDesat(s: DiveSession): boolean {
    return s.log.length > 0 && (s.clock < this.desatUntil || this.noFlyMin(s) > 0);
  }

  /** §10: "a standard 12-hour (no-deco non-repetitive dives) or 24-hour (deco and repetitive dives) countdown". */
  protected noFlyMin(s: DiveSession): number {
    return standardNoFly(this.longNoFly, s);
  }

  /** §2.3 HALF TANK (bar): the half tank warning, and the limit of the blue / green and yellow ranges (§2.3.1). */
  halfTank(): number {
    return Number(this.settings.halfTank) || 100;
  }

  protected say(text: string): void {
    this.gasMsgs.say(text);
  }

  /** §11.2: GAS NOT SWITCHED, then, PREDICTIVE ON, EXCLUDING G2 before the calculation drops it. */
  protected notSwitched(gas: number): void {
    this.say('GAS NOT SWITCHED');
    if (this.settings.predictive !== 'off') this.say(`EXCLUDING G${gas + 1}`);
  }

  /**
   * §8.3 NOTE: "Alarms are both visual and audible": fast ascent, MOD and missed stop while they last, CNS
   * (100 %: 5 s per minute, as the other Mares; 75 %: once, assumed); the gas switch prompt "sounds an audible
   * signal" (§11.2); TANK RESERVE and HALF TANK until a button is pressed (§8.3.5; their sound is not described,
   * assumed as on the Quad Ci). §2.12 ALL SILENT turns them off.
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.silent === 'on') || !v.inDive || this.locked) return [];
    const cues = maresCues(v);
    if (this.prompt.offer !== null) cues.push({ key: `switch-${this.prompt.offer}`, kind: 'beep', level: 'info', until: 'once' });
    if (v.cns >= 75 && v.cns < 100) cues.push({ key: 'cns-75', kind: 'beep', level: 'info', until: 'once' });
    if (v.tank.ai && v.tank.pressure <= v.tank.reserve) cues.push({ key: 'reserve', kind: 'beep', level: 'warning', until: 'ack', every: 3 });
    else if (v.tank.ai && v.tank.pressure <= this.halfTank()) cues.push({ key: 'half', kind: 'beep', level: 'info', until: 'ack', every: 3 });
    return cues;
  }

  /**
   * Alert bubble (app/alertHelp.ts): §8.3 alarms (ascent SLOW! §8.3.1, MOD! §8.3.2, CNS §8.3.3, DECO STOP!
   * §8.3.4, CEILING! §8.3.4.1, EMERGENCY GF and VIOLATION DECO! §8.3.4.2, tank §8.3.5), §12.1 lock, §2.5
   * warnings, §2.9 deep stop, §9.1.2 SAFETY STOP +, §9.2 RUNAWAY DECO, §11.2 gas switch; `msg:` keys: the
   * messages on display (see screenAlerts).
   */
  alertExplain(key: string): AlertExplain | null {
    const msg = key.startsWith('msg:') ? key.slice(4) : null;
    const untilBtn = { fr: 'Le message reste affiché jusqu’à l’appui sur un bouton.', en: 'The message stays until a button is pressed.' };
    if (key === 'fast-ascent' || msg === 'SLOW!') {
      return {
        id: 'slow', screen: 'SLOW!', code: 'ASCENT',
        what: { fr: `Alarme sonore, séparateurs rouges clignotants, vitesse (SPEED) en rouge et « SLOW! » tant que la vitesse dépasse la limite (§8.3.1). ${ZHL_ASCENT.fr} ${zhlUncontrolled(48).fr} (désactivable : ASCENT VIOL.)`, en: `Audible alarm, blinking red dividers, red rate (SPEED) and “SLOW!” while the rate is above the limit (§8.3.1). ${ZHL_ASCENT.en} ${zhlUncontrolled(48).en} (can be turned off: ASCENT VIOL.)` },
      };
    }
    if (key === 'missed-stop' || msg === 'DECO STOP!') {
      return {
        id: 'missed-stop', screen: 'DECO STOP!', code: 'CEILING',
        what: { fr: `Alarme sonore et « DECO STOP! » à plus de 0,3 m au-dessus du palier, jusqu’au retour à la bonne profondeur (§8.3.4). ${ZHL_MISSED.fr} L’ordinateur passe alors aux gradient factors de secours 95/95 (« MAIN GF=> GF 95/95 ») ; si leur palier ne convient pas à votre profondeur : « VIOLATION DECO! » et verrouillage 48 h.`, en: `Audible alarm and “DECO STOP!” more than 0.3 m above the stop, until you are back at the right depth (§8.3.4). ${ZHL_MISSED.en} The computer then switches to the EMERGENCY gradient factors 95/95 (“MAIN GF=> GF 95/95”); if their stop does not suit your depth: “VIOLATION DECO!” and a 48 h lock.` },
        todo: { fr: 'Redescendez tout de suite à la profondeur du palier.', en: 'Go back down to the stop depth at once.' },
      };
    }
    if (msg === 'CEILING!') {
      return {
        screen: msg, code: 'CEILING',
        what: { fr: 'Avec CEIL-CON : vous êtes au-dessus du plafond (§8.3.4.1), la rangée du haut passe en rouge. Jusqu’à 0,3 m au-dessus pendant 1 min, ou aussitôt au-delà de 0,3 m : passage aux gradient factors de secours 95/95.', en: 'With CEIL-CON: you are above the ceiling (§8.3.4.1), the top row turns red. Up to 0.3 m above for 1 min, or at once beyond 0.3 m: switch to the EMERGENCY gradient factors 95/95.' },
        todo: { fr: 'Redescendez sous le plafond affiché en haut à droite.', en: 'Go back below the ceiling shown top right.' },
      };
    }
    if (msg === 'MAIN GF=> GF 95/95') {
      return {
        screen: msg,
        what: { fr: `Palier manqué : l’ordinateur calcule désormais avec les gradient factors de secours 95/95 (§8.3.4.2), plus conservateurs que Bühlmann d’origine mais moins que vos réglages ; les personnalisations ne s’appliquent plus. Cela raccourcit les paliers et peut vous éviter la violation. ${untilBtn.fr}`, en: `Missed stop: the computer now computes with the EMERGENCY gradient factors 95/95 (§8.3.4.2), more conservative than plain Bühlmann but less than your settings; the personalizations no longer apply. This shortens the stops and may keep you out of a violation. ${untilBtn.en}` },
        todo: { fr: 'Remontez en gardant GF NOW et GF @SURF aussi proches que possible de vos MAIN GF, dans la limite de votre gaz (§8.3.4.2 NOTE), et faites le palier affiché.', en: 'Ascend keeping GF NOW and GF @SURF as close as possible to your MAIN GF, within your gas supply (§8.3.4.2 NOTE), and make the displayed stop.' },
      };
    }
    if (msg === 'VIOLATION DECO!') {
      return {
        screen: msg, critical: true,
        what: { fr: 'Violation de décompression : les gradient factors de secours 95/95 ne conviennent pas à votre profondeur (§8.3.4.2). Après la plongée, l’ordinateur ne fonctionne plus qu’en profondimètre pendant 48 h (LOCKED BY PREVIOUS DIVE).', en: 'Decompression violation: the EMERGENCY gradient factors 95/95 do not suit your depth (§8.3.4.2). After the dive, the computer works as a bottom timer only for 48 h (LOCKED BY PREVIOUS DIVE).' },
        todo: { fr: 'Remontez lentement en faisant des paliers de prudence, ne replongez pas avant la fin du verrouillage et surveillez les symptômes.', en: 'Ascend slowly with precautionary stops, do not dive again before the lock ends and watch for symptoms.' },
      };
    }
    if (key === 'LOCKED' || msg === 'LOCKED BY PREVIOUS DIVE') {
      return { id: 'LOCKED', screen: 'LOCKED BY PREVIOUS DIVE', what: { fr: 'Verrouillage de 48 h après une violation (remontée incontrôlée ou palier manqué, §12.1) : profondimètre seulement, sans calcul de décompression.', en: '48 h lock after a violation (uncontrolled ascent or missed stop, §12.1): bottom timer only, no decompression calculation.' } };
    }
    if (key === 'mod' || msg === 'MOD!') {
      return {
        id: 'mod', screen: 'MOD!', code: 'PPO2_HIGH',
        what: { fr: `Alarme sonore, écran COMPLICATIONS, profondeur et MOD en rouge, « MOD! » en bas, sous la MOD du gaz (ppO₂max réglable de 1,2 à 1,6 bar, §8.3.2). ${untilBtn.fr} La profondeur et la MOD restent rouges tant que vous êtes trop profond.`, en: `Audible alarm, COMPLICATIONS display, depth and MOD in red, “MOD!” at the bottom, below the gas MOD (ppO₂max settable from 1.2 to 1.6 bar, §8.3.2). ${untilBtn.en} The depth and MOD stay red while you are too deep.` },
        todo: { fr: 'Remontez immédiatement jusqu’à l’arrêt de l’alarme.', en: 'Ascend immediately until the alarm stops.' },
      };
    }
    if (msg === 'MAX DEPTH REACHED') {
      return {
        screen: msg,
        what: { fr: 'Alarme de profondeur (WARNINGS > MAX DEPTH, désactivée par défaut, §2.5.1) : vous avez atteint la profondeur choisie. Elle se comporte comme l’alarme de MOD.', en: 'Depth alarm (WARNINGS > MAX DEPTH, off by default, §2.5.1): you reached the chosen depth. It behaves like the MOD alarm.' },
        todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' },
      };
    }
    if (key === 'cns-75' || msg === 'CNS > 75%') {
      return { id: 'cns-75', screen: 'CNS > 75%', code: 'CNS', what: { fr: `Le CNS dépasse 75 % (§8.3.3) : écran COMPLICATIONS, message et CNS en rouge en bas à droite (il y revient 4 s après l’affichage d’un autre champ). ${untilBtn.fr}`, en: `The CNS exceeds 75 % (§8.3.3): COMPLICATIONS display, message and red CNS bottom right (it comes back there 4 s after another field is shown). ${untilBtn.en}` }, todo: { fr: 'Remontez moins profond et envisagez de terminer la plongée.', en: 'Ascend shallower and consider ending the dive.' } };
    }
    if (key === 'cns-100') return CNS100;
    if (msg === 'RUNAWAY DECO') {
      return {
        screen: msg,
        what: { fr: `La décompression s’emballe (§9.2) : en restant X minutes de plus (TTS @+X, 5 min par défaut), la durée de remontée augmenterait d’au moins 2 fois X (réglage RUNAWAY DECO). La rangée du haut passe en rouge avec le TTS @+X. ${untilBtn.fr}`, en: `Decompression is running away (§9.2): staying X more minutes (TTS @+X, 5 min by default), the ascent time would grow by at least 2 times X (RUNAWAY DECO setting). The top row turns red with TTS @+X. ${untilBtn.en}` },
        todo: { fr: 'Commencez la remontée : chaque minute au fond allonge fortement les paliers.', en: 'Start the ascent: every minute at depth lengthens the stops a lot.' },
      };
    }
    if (msg === 'LOW TANK PRESSURE') {
      return {
        screen: msg, code: 'LOW_GAS',
        what: { fr: `Avec l’émetteur, en décompression : le temps restant avant la réserve (TTR) est plus court que la durée de remontée (§8.3.5). ${untilBtn.fr}`, en: `With the transmitter, in decompression: the time left before the reserve (TTR) is shorter than the ascent time (§8.3.5). ${untilBtn.en}` },
        todo: { fr: 'Commencez la remontée tout de suite et prévenez votre binôme : le gaz ne suffit pas pour tous les paliers en restant ici.', en: 'Start the ascent at once and tell your buddy: staying here, the gas is not enough for all the stops.' },
      };
    }
    if (key === 'reserve' || msg === 'TANK RESERVE') {
      return { id: 'reserve', screen: 'TANK RESERVE', code: 'LOW_GAS', what: { fr: `Avec l’émetteur : la pression atteint la réserve réglée (TANK RESERVE, 50 bar par défaut, §8.3.5). ${untilBtn.fr}`, en: `With the transmitter: the pressure reaches the set reserve (TANK RESERVE, 50 bar by default, §8.3.5). ${untilBtn.en}` } };
    }
    if (key === 'half' || msg === 'HALF TANK') {
      return {
        id: 'half', screen: 'HALF TANK',
        what: { fr: `Avec l’émetteur : la pression atteint HALF TANK (100 bar par défaut, §8.3.5). ${untilBtn.fr}`, en: `With the transmitter: the pressure reaches HALF TANK (100 bar by default, §8.3.5). ${untilBtn.en}` },
        todo: { fr: 'Repère classique pour faire demi-tour.', en: 'The usual cue to turn the dive around.' },
      };
    }
    if (msg === 'TURN AROUND' || msg === 'TIME LIMIT') {
      const limit = msg === 'TIME LIMIT';
      return {
        screen: msg,
        what: limit
          ? { fr: `La durée de plongée atteint la limite réglée (WARNINGS > DIVE TIME, désactivée par défaut, §2.5.2). ${untilBtn.fr}`, en: `The dive time reaches the set limit (WARNINGS > DIVE TIME, off by default, §2.5.2). ${untilBtn.en}` }
          : { fr: `La moitié de la durée réglée (WARNINGS > DIVE TIME, §2.5.2) est écoulée. ${untilBtn.fr}`, en: `Half the set dive time (WARNINGS > DIVE TIME, §2.5.2) has elapsed. ${untilBtn.en}` },
        todo: limit ? { fr: 'Remontez.', en: 'Ascend.' } : { fr: 'Faites demi-tour.', en: 'Turn the dive around.' },
      };
    }
    if (msg === 'ENTERING DECO') {
      return { screen: msg, code: 'DECO', what: { fr: `Avertissement à l’entrée en décompression (WARNINGS > ENTERING DECO, §2.5.4 ; texte non donné par le manuel, déduit). ${untilBtn.fr}`, en: `Warning when decompression begins (WARNINGS > ENTERING DECO, §2.5.4; wording not given by the manual, deduced). ${untilBtn.en}` } };
    }
    if (msg === 'NO DECO 2 MIN') {
      return { screen: msg, code: 'NDL_LOW', what: { fr: `Avertissement à 2 min de la limite sans palier (WARNINGS > NO DECO, §2.5.3 ; texte non donné par le manuel, déduit). ${untilBtn.fr}`, en: `Warning 2 minutes before the no-deco limit (WARNINGS > NO DECO, §2.5.3; wording not given by the manual, deduced). ${untilBtn.en}` } };
    }
    if (msg === 'GF @SURF') {
      return {
        title: { fr: 'GF @SURF clignotant', en: 'Blinking GF @SURF' },
        what: { fr: 'GF @SURF (la sursaturation qu’auraient vos tissus en surface) atteint la valeur d’alerte réglée (§2.5.5, désactivée par défaut) ; il clignote jusqu’à l’appui sur un bouton.', en: 'GF @SURF (the supersaturation your tissues would have at the surface) reaches the set warning value (§2.5.5, off by default); it blinks until a button is pressed.' },
        todo: { fr: 'Au-delà de 100, une remontée directe dépasserait la limite : faites les paliers indiqués.', en: 'Above 100, a direct ascent would exceed the limit: make the indicated stops.' },
      };
    }
    if (msg === 'DEEP STOP') {
      return {
        screen: msg,
        what: { fr: 'Palier profond facultatif (§2.9, désactivé par défaut) : à la profondeur où le 5e compartiment (27 min) cesse de se charger, proposé à l’approche de la limite sans palier, 2 min ; il n’entre pas dans le TTS et le sauter n’entraîne aucune pénalité.', en: 'Optional deep stop (§2.9, off by default): at the depth where the 5th compartment (27 min) stops loading, suggested as the no-deco limit approaches, 2 minutes; it is not part of the TTS and skipping it brings no penalty.' },
        todo: { fr: 'Marquez l’arrêt à cette profondeur pendant le décompte, ou continuez la remontée.', en: 'Stop at that depth during the countdown, or carry on ascending.' },
      };
    }
    if (msg === 'SAFETY STOP+') {
      return {
        screen: msg,
        what: { fr: 'SAFETY STOP + (§9.1.2) : après le palier de sécurité, un palier supplémentaire est recommandé jusqu’à ce que GF @SURF descende sous la valeur réglée (70 ou 75). Facultatif mais vivement recommandé.', en: 'SAFETY STOP + (§9.1.2): after the safety stop, an extra stop is recommended until GF @SURF drops below the set value (70 or 75). Optional but highly recommended.' },
        todo: { fr: 'Restez entre 6 et 3 m jusqu’à la fin du décompte.', en: 'Stay between 6 and 3 m until the countdown ends.' },
      };
    }
    if (key.startsWith('switch-')) {
      return gasSwitch('SWITCH TO G2', { fr: 'TR ou BR (OK) : changer (GAS SWITCH OK) ; TL ou BL (NO), ou 30 s sans réponse : GAS NOT SWITCHED, et avec PREDICTIVE le gaz sort du calcul (EXCLUDING G2).', en: 'TR or BR (OK): switch (GAS SWITCH OK); TL or BL (NO), or 30 s without an answer: GAS NOT SWITCHED, and with PREDICTIVE the gas leaves the calculation (EXCLUDING G2).' });
    }
    if (msg?.startsWith('EXCLUDING')) {
      return { id: 'excluding', screen: 'EXCLUDING G…', what: { fr: 'Avec PREDICTIVE : le gaz non pris sort du calcul ; paliers et TTS s’allongent (§11.2).', en: 'With PREDICTIVE: the gas not taken leaves the calculation; stops and TTS get longer (§11.2).' } };
    }
    if (msg?.startsWith('INCLUDING')) {
      return { id: 'including', screen: 'INCLUDING G… AGAIN', what: { fr: 'Redescendu sous sa MOD, le gaz exclu revient dans le calcul (§11.2).', en: 'Back below its MOD, the excluded gas is counted again (§11.2).' } };
    }
    if (msg === 'GAS NOT SWITCHED') {
      return { screen: msg, what: { fr: 'Changement de gaz refusé ou invite restée sans réponse 30 s (§11.2).', en: 'Gas switch declined or prompt unanswered for 30 s (§11.2).' } };
    }
    return null;
  }
}

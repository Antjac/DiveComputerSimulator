// SEAC Screen and Tablet: what both share. Their owner's manuals have the same Technical
// Characteristics chapter word for word (dive modes, algorithm, safety and deep stops, alarms, lock,
// no-fly time) and the same segmented LCD (SCUBA (OC) DIVE figures); the Tablet adds a third mix and
// the LED TANK PROBE. Rules here, cited by section; each model sets its gases, tank and case.
import { ceilingDepth, stopDepthFor, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import type { Lang } from '../../i18n';
import { depthInt, depthText, depthUnit, pressText, pressUnit, tempUnit, tempVal } from '../../units';
import { type AlertCue, type AlertExplain, type ButtonHelp, type ComputerView, DiveComputer, type SettingDef, clockOfDay, hmm } from '../base';
import { GasPrompt } from '../common/gasSwitch';

/**
 * Levels of Protection: "6 levels of protection (conservatism), from 0 to 5. Level 5 provides the
 * maximum protection", "based on Gradient Factor" (Application Software). The GF of each level is not
 * given by the Screen or Tablet manuals: assumed from the table of another SEAC computer, the Guru
 * (owner's manual 2.0: "0 = 93/93, 1 = 90/90 standard conservatism, 2 = 80/80, 3 = 75/75, 4 = 30/90
 * max linear conservatism, 5 = 20/89"), NOT VERIFIED for these models.
 */
export const SEAC_LEVELS: [number, number][] = [[93, 93], [90, 90], [80, 80], [75, 75], [30, 90], [20, 89]];

const onOff = (key: string, label: { fr: string; en: string }, def: 'on' | 'off'): SettingDef => ({
  key, label, default: def,
  options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
});

const ppo2Options = Array.from({ length: 9 }, (_, i) => (1.2 + i * 0.05).toFixed(2)).map((v) => ({ value: v, label: `${v} bar` }));

/** USER SETTINGS RANGE table (both manuals): ranges and factory defaults. */
export function seacSettings(mixes: 2 | 3): SettingDef[] {
  return [
    // DIVE SET > SFT LEVEL: 0–5, default 0.
    { key: 'level', label: { fr: 'Niveau de protection (SFT LEVEL)', en: 'Protection level (SFT LEVEL)' }, default: '0',
      options: SEAC_LEVELS.map(([lo, hi], i) => ({ value: String(i), label: `${i} (GF ${lo}/${hi} ?)` })) },
    // MIX 1 PPO2: 1.20–1.60 by 0.05, default 1.40.
    { key: 'ppo2', label: { fr: 'PPO2 du MIX 1', en: 'MIX 1 PPO2' }, default: '1.40', options: ppo2Options },
    // MIX 2 ON/OFF, default OFF (MIX 2 O2% default 50, set by the deco gas of the page here).
    onOff('multigas', { fr: 'MIX 2 (gaz de déco)', en: 'MIX 2 (deco gas)' }, 'off'),
    ...(mixes === 3 ? [onOff('mix3', { fr: 'MIX 3 (2e gaz de déco)', en: 'MIX 3 (2nd deco gas)' }, 'off')] : []),
    // MIX 2 (and 3) PPO2: 1.20–1.60, default 1.60.
    { key: 'decoPpo2', label: { fr: mixes === 3 ? 'PPO2 des MIX 2 et 3' : 'PPO2 du MIX 2', en: mixes === 3 ? 'MIX 2 and 3 PPO2' : 'MIX 2 PPO2' }, default: '1.60', options: ppo2Options },
    // S.S. TIME 0–5 min, default 3; S.S DPT 3–6 m, default 5.
    { key: 'ssTime', label: { fr: 'Palier de sécurité (S.S. TIME)', en: 'Safety stop (S.S. TIME)' }, default: '3',
      options: [0, 1, 2, 3, 4, 5].map((m) => ({ value: String(m), label: m ? `${m} min` : { fr: '0 (aucun)', en: '0 (none)' } })) },
    { key: 'ssDepth', label: { fr: 'Profondeur du palier de sécurité (S.S. DPT)', en: 'Safety stop depth (S.S. DPT)' }, default: '5',
      options: [3, 4, 5, 6].map((m) => ({ value: String(m), label: `${m} m` })) },
    // DEEP STP ON/OFF, default OFF.
    onOff('deepStop', { fr: 'Deep stop (DEEP STP)', en: 'Deep stop (DEEP STP)' }, 'off'),
    // ALARMS: DECO VLT, MOD VLT, ASC SPD, all ON: the audible part only ("The visual alarm cannot be disabled").
    onOff('alDeco', { fr: 'Alarme sonore DECO VLT', en: 'DECO VLT audible alarm' }, 'on'),
    onOff('alMod', { fr: 'Alarme sonore MOD VLT', en: 'MOD VLT audible alarm' }, 'on'),
    onOff('alAsc', { fr: 'Alarme sonore ASC SPD', en: 'ASC SPD audible alarm' }, 'on'),
  ];
}

/** Deep Stop state: depth (m), seconds left, and whether it is counting down. */
interface DeepStop { depth: number; left: number; state: 'shown' | 'counting' | 'suspended' | 'done' }

export abstract class SeacRules extends DiveComputer {
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  // The algorithm is public and "unmodified", but the GF of each level is not published: approximation.
  readonly exact = false;
  protected abstract readonly mixes: 2 | 3;

  constructor() {
    super();
    // Safety Stop NB a)–g): proposed if the maximum depth is greater than 12 m, shown within 9 m of the
    // surface, counted down within ±2 m of the set depth, reset when the diver goes back below 9 m.
    this.safetyStop = { trigger: 12, start: 9, top: 3, bottom: 7, reset: 9 };
    // Deco Violation Alarm: "less than (in absolute value) 0.5 meters/1.6 ft of the mandatory
    // decompression stop indicated" (the depth field flashes).
    this.ceilingMargin = 0.5;
    this.violationRef = 'stop';
    // Locking the Computer: penalty points, lock at 150 (see tick); SCUBA mode not available for 18 hours.
    this.lockAfter = null;
    this.lockHours = 18;
    this.stopWindow = 1.5;
    this.ndlCap = 99;
  }

  get maxGases(): number {
    if (this.settings.multigas !== 'on') return 1;
    return this.mixes === 3 && this.settings.mix3 === 'on' ? 3 : 2;
  }

  /** MIX 2/3 PPO2 (1.20–1.60, default 1.60). */
  decoPpo2(): number {
    return Number(this.settings.decoPpo2) || 1.6;
  }

  baseParams(): DecoParams {
    const [lo, hi] = SEAC_LEVELS[Number(this.settings.level)] ?? SEAC_LEVELS[0];
    // TTS: "the ascent time (calculated at a constant velocity of 9m/min - 30 ft/min)". Last stop 3 m
    // and 3 m steps: not given (the figures show a 3 m stop; assumed).
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 9 };
  }

  get hasSafetyStop(): boolean {
    return Number(this.settings.ssTime) > 0;
  }

  safetySeconds(): number {
    return Number(this.settings.ssTime) * 60;
  }

  /**
   * Ascent Speed Alarm: "≤ 3 m/min: No indication; ≤ 6: One arrow; ≤ 9: Two arrows; ≤ 12: Three
   * arrows; > 12 m/min: Three flashing arrows + Audible alarm."
   */
  arrows(rate: number): number {
    return rate <= 3 ? 0 : rate <= 6 ? 1 : rate <= 9 ? 2 : 3;
  }

  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > 12 ? 2 : rate > 9 ? 1 : 0;
  }

  // --- Safety stop (NB c: "if you go to a depth of less than 3 meters/10 ft, the stop is canceled") --

  /** The safety stop was cancelled by going above its window (not "done": nothing to show). */
  protected ssCancelled = false;

  protected tickSafetyStop(s: DiveSession, dt: number, inDeco: boolean): void {
    const d = Number(this.settings.ssDepth) || 5;
    this.safetyStop = { trigger: 12, start: 9, top: d - 2, bottom: d + 2, reset: 9 };
    if (s.depth > 9) this.ssCancelled = false;
    super.tickSafetyStop(s, dt, inDeco);
    if (!inDeco && (this.safetyState === 'active' || this.safetyState === 'paused') && s.depth < d - 2) {
      this.safetyState = 'done';
      this.ssCancelled = true;
    }
  }

  // --- Deep stop -----------------------------------------------------------------------------------

  protected deep: DeepStop | null = null;

  /**
   * Deep Stop: "a 2-minute-and-30-second stop at half the maximum depth reached if [...] Maximum depth
   * reached greater than 18 meters [and] There are no mandatory decompression stops during the ascent.
   * a) displayed at +5 m and -3 m from the calculated stop. b) The countdown [...] in a range of +2 m
   * and -2 m [...]. If the Diver moves -2 m from the stop depth [...], it is canceled. If the Diver is
   * between [stop + 2] and [stop + 6], the countdown is suspended. c) If the Diver again exceeds the
   * stop depth by more than 6 meters (or in any case, 18 m), the stop will be recalculated."
   */
  private tickDeep(s: DiveSession, dt: number, inDeco: boolean): void {
    if (this.settings.deepStop !== 'on' || !s.inDive || s.maxDepth <= 18 || inDeco) {
      if (inDeco) this.deep = null;
      return;
    }
    const target = s.maxDepth / 2;
    if (!this.deep) {
      this.deep = { depth: target, left: 150, state: 'shown' };
      return;
    }
    const dp = this.deep;
    if (s.depth > dp.depth + 6) {
      this.deep = { depth: target, left: 150, state: 'shown' };
      return;
    }
    if (dp.state === 'done') return;
    if (s.depth < dp.depth - 2) dp.state = 'done';
    else if (s.depth <= dp.depth + 2) {
      dp.state = 'counting';
      dp.left -= dt;
      if (dp.left <= 0) dp.state = 'done';
    } else if (dp.state === 'counting' || dp.state === 'suspended') dp.state = 'suspended';
  }

  /** The deep stop to display: "from 17 meters to 25 meters" for a stop at 20 m. */
  deepShown(v: ComputerView): DeepStop | null {
    const dp = this.deep;
    if (!dp || dp.state === 'done' || v.inDeco) return null;
    return v.depth <= dp.depth + 5 && v.depth >= dp.depth - 3 ? dp : null;
  }

  // --- Penalty points and lock ---------------------------------------------------------------------

  /** Locking the Computer: penalty points of this dive (lock at 150). */
  penalty = 0;
  private penaltyClock = 0;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deep = null;
    this.ssCancelled = false;
    // "After this period, the counter [...] will be reset at the beginning of the next dive."
    if (!this.locked) this.penalty = 0;
    this.penaltyClock = 0;
    this.prompt.reset();
  }

  /** Mix change: "Screen will alert the user at best time to make the change by flashing the %O2". */
  readonly prompt = new GasPrompt();

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;
    // The stop at this step (as the Mares do): the view is only computed when the screen is drawn.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const plan = { inDeco: ceil > 0, stop: ceil > 0 ? stopDepthFor(ceil, p) : 0 };
    this.tickDeep(s, dt, plan.inDeco);
    // "5 points for every 5 seconds, if the diver's current depth is lower than one meter/three feet
    // from the stop level indicated; 10 points for every 5 seconds, [...] lower than two meters" (above
    // the stop, "only if the violation is occurring in the direction of the surface").
    // "Screen will enter lock mode after about 2 minutes at a depth lower than one meter, and after about
    // 1 minute if the stop depth violation is 2 meters": the points count from 1 m (10 from 2 m) above.
    const above = plan.stop > 0 ? plan.stop - s.depth + 1e-6 : 0;
    if (above >= 1) {
      this.penaltyClock += dt;
      while (this.penaltyClock >= 5) {
        this.penaltyClock -= 5;
        this.penalty += above >= 2 ? 10 : 5;
      }
      if (this.penalty >= 150) this.lock(s);
    } else this.penaltyClock = 0;
    // A switch is offered while shallower than the MOD of a richer mix; it stays offered (flashing)
    // until answered or the diver goes back below that MOD (no time limit given).
    const mods = this.knownGases(s).map((g) => this.decoMod(g.o2));
    this.prompt.update(s, mods, null);
  }

  // --- Alerts --------------------------------------------------------------------------------------

  get soundKind(): AlertCue['kind'] {
    return 'beep';
  }

  /**
   * Alarms (both visual and audible; "The visual alarm cannot be disabled", "Users can disable the
   * audible alarm" per alarm, ALARMS menu): ascent speed beyond 12 m/min, MOD exceeded, deco stop
   * violation. How often the buzzer sounds is not described: while the alarm lasts (assumed).
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive) return [];
    const cues: AlertCue[] = [];
    const on = (k: string) => all || this.settings[k] !== 'off';
    if (v.ascentLevel === 2 && on('alAsc')) cues.push({ key: 'fast-ascent', kind: 'beep', level: 'alarm', until: 'clear' });
    if (v.depth > v.mod && on('alMod')) cues.push({ key: 'mod', kind: 'beep', level: 'alarm', until: 'clear' });
    if (v.ceilingViolation === 2 && on('alDeco')) cues.push({ key: 'ceiling', kind: 'beep', level: 'alarm', until: 'clear' });
    if (all && this.penalty >= 150) cues.push({ key: 'msg:WARNING DECO VLT', kind: 'beep', level: 'alarm', until: 'clear' });
    if (all && this.prompt.offer !== null) cues.push({ key: 'switch', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }

  alertExplain(key: string): AlertExplain | null {
    if (key === 'PPO2_HIGH') key = 'mod';
    if (key === 'NDL_LOW') return { what: { fr: 'Pas d’alarme de NDL décrite par le manuel : le NDL (en minutes) arrive simplement à 0, puis la ligne du milieu passe en TTS / STOP / TIME.', en: 'No NDL alarm described by the manual: the NDL (in minutes) simply reaches 0, then the middle row turns to TTS / STOP / TIME.' } };
    if (key === 'DECO') return { what: { fr: 'Pas de message d’entrée en décompression : la ligne du milieu affiche la TTS, la profondeur du premier palier et sa durée (DECO Dive). Le palier est obligatoire, contrairement au deep stop et au palier de sécurité.', en: 'No entering-decompression message: the middle row shows the TTS, the first stop depth and its time (DECO Dive). The stop is mandatory, unlike the deep stop and the safety stop.' } };
    if (key === 'CNS') return { what: { fr: 'Pas d’alarme de CNS décrite : la valeur est sur l’écran CNS / heure (R).', en: 'No CNS alarm described: the value is on the CNS / time screen (R).' } };
    if (key === 'ASCENT_WARN') return { what: { fr: 'Trois flèches allumées entre 9 et 12 m/min, sans alarme ; au-delà de 12 m/min elles clignotent et l’alarme sonne.', en: 'Three arrows lit between 9 and 12 m/min, with no alarm; beyond 12 m/min they flash and the alarm sounds.' } };
    if (key === 'LOW_GAS') return { what: { fr: 'Le manuel ne décrit aucune alarme de pression : la pression du bloc n’est qu’un champ (Tablet avec la sonde LED TANK PROBE).', en: 'The manual describes no pressure alarm: the tank pressure is only a field (Tablet with the LED TANK PROBE).' } };
    if (key === 'fast-ascent' || key === 'ASCENT') {
      return {
        id: 'fast-ascent', title: { fr: 'Vitesse de remontée', en: 'Ascent rate' }, code: 'ASCENT',
        what: {
          fr: 'Trois flèches indiquent la vitesse : aucune jusqu’à 3 m/min, une jusqu’à 6, deux jusqu’à 9, trois jusqu’à 12 m/min ; au-delà de 12 m/min, les trois flèches clignotent et l’alarme sonne (son coupable dans ALARMS > ASC SPD). Vitesse maximale standard : 9 m/min.',
          en: 'Three arrows show the rate: none up to 3 m/min, one up to 6, two up to 9, three up to 12 m/min; beyond 12 m/min the three arrows flash and the alarm sounds (sound can be turned off in ALARMS > ASC SPD). Standard maximum rate: 9 m/min.',
        },
      };
    }
    if (key === 'mod') {
      return {
        id: 'mod', title: { fr: 'MOD dépassée', en: 'MOD exceeded' }, code: 'PPO2_HIGH',
        what: { fr: 'Au-delà de la MOD du mélange respiré (PPO2 réglée du mélange) : la profondeur clignote et l’alarme sonne (son coupable : ALARMS > MOD VLT).', en: 'Beyond the MOD of the mix breathed (its set PPO2): the depth flashes and the alarm sounds (sound can be turned off: ALARMS > MOD VLT).' },
        todo: { fr: 'Remontez au-dessus de la MOD.', en: 'Ascend above the MOD.' },
      };
    }
    if (key === 'ceiling' || key === 'CEILING') {
      return {
        id: 'ceiling', title: { fr: 'Palier de déco non respecté', en: 'Deco stop violated' }, code: 'CEILING',
        what: {
          fr: 'Plus de 0,5 m au-dessus du palier obligatoire : la profondeur clignote et l’alarme sonne (son coupable : ALARMS > DECO VLT). Au-delà de 1 m au-dessus, 5 points de pénalité toutes les 5 s, 10 points au-delà de 2 m ; à 150 points (environ 2 min à 1 m, 1 min à 2 m), le mode SCUBA est verrouillé 18 h. Pas d’alarme pour le deep stop et le palier de sécurité, facultatifs.',
          en: 'More than 0.5 m above the mandatory stop: the depth flashes and the alarm sounds (sound can be turned off: ALARMS > DECO VLT). Beyond 1 m above, 5 penalty points every 5 s, 10 points beyond 2 m; at 150 points (about 2 min at 1 m, 1 min at 2 m), SCUBA mode is locked for 18 h. No alarm for the deep stop and the safety stop, which are optional.',
        },
      };
    }
    if (key === 'msg:WARNING DECO VLT' || key === 'LOCKED') {
      return {
        id: 'locked', screen: 'WARNING DECO VLT',
        what: {
          fr: '150 points de pénalité atteints : icône Alerte et message « WARNING DECO VLT » en alternance avec la décompression restante, qui reste calculée jusqu’à la fin de la plongée. Le mode SCUBA est indisponible 18 h ; une plongée faite avant affiche le message pendant toute la plongée, et les temps d’interdiction de vol et de désaturation ne sont pas affichés.',
          en: '150 penalty points reached: Alert icon and “WARNING DECO VLT” message alternating with the remaining decompression, still calculated until the end of the dive. SCUBA mode is unavailable for 18 h; a dive made before shows the message for the whole dive, and the no-fly and desaturation times are not shown.',
        },
      };
    }
    if (key === 'switch') {
      return {
        id: 'switch', screen: 'CHANGE MIX TO',
        what: { fr: 'Au meilleur moment pour changer de mélange (à la MOD du MIX plus riche), le % d’O2 en bas à gauche clignote. On ne peut ouvrir le menu de changement que pendant ce clignotement.', en: 'At the best time to change mix (at the MOD of the richer MIX), the O2 % at the lower left flashes. The change menu can only be opened while it flashes.' },
        todo: { fr: 'L ouvre « CHANGE MIX TO … » (déduit de la figure), puis R : YES, L : NO.', en: 'L opens “CHANGE MIX TO …” (deduced from the figure), then R: YES, L: NO.' },
      };
    }
    return null;
  }
}

/** The segmented LCD of the SCUBA (OC) DIVE figures, and the buttons L and R. */
export abstract class SeacDevice extends SeacRules {
  /** Bottom fields cycled with R (figures "Screen 1" to "Screen 4", Tablet: tank pressure second). */
  protected bottomScreens(v: ComputerView): ('max' | 'tank' | 'po2' | 'temp' | 'cns')[] {
    return v.tank.ai ? ['max', 'tank', 'po2', 'temp', 'cns'] : ['max', 'po2', 'temp', 'cns'];
  }

  /** Mix change menu "CHANGE MIX TO 50% / NO YES" (Mix change during the dive figure). */
  private changeMenu = false;

  press(button: string, s: DiveSession): boolean {
    if (!s.inDive) return false;
    if (this.changeMenu) {
      // "To confirm the mix change, select YES by pressing the R button. To reject the change, select NO with the L button."
      if (button === 'r') this.prompt.accept(s);
      else if (button === 'l') this.prompt.decline();
      else return false;
      this.changeMenu = false;
      return true;
    }
    // "You can only switch to the mix change menu during this flashing phase" (L, from the figure).
    if (button === 'l' && this.prompt.offer !== null) {
      this.changeMenu = true;
      return true;
    }
    if (button === 'r') {
      // The figures' filled R marker: R steps through the bottom fields (deduced from the figures).
      this.setScreen(this.screen + 1);
      return true;
    }
    return false;
  }

  hold(button: string): boolean {
    // Display, BKL MODE: "MAN: The backlighting will be turned on and off manually by long-pressing the L button".
    if (button === 'l') {
      this.backlightUntil = this.backlit ? 0 : performance.now() + 3000;
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      l: {
        name: 'L',
        press: { real: { fr: 'Pendant le clignotement du % d’O2 : menu de changement de mélange ; dans ce menu : NO', en: 'While the O2 % flashes: mix change menu; in that menu: NO' }, simulated: true },
        hold: { real: { fr: 'Rétroéclairage (mode MAN)', en: 'Backlight (MAN mode)' }, simulated: true, note: { fr: '3 s (BKL TIME par défaut)', en: '3 s (default BKL TIME)' } },
      },
      r: {
        name: 'R',
        press: { real: { fr: 'Champs suivants de la ligne du bas ; dans le menu de changement de mélange : YES', en: 'Next bottom-row fields; in the mix change menu: YES' }, simulated: true, note: { fr: 'défilement déduit des figures', en: 'scrolling deduced from the figures' } },
      },
    };
  }

  protected abstract readonly frame: string;

  /** Inverted label (black box, light text) as "NDL", "SFT STOP", "TTS" in the figures. */
  private tag(x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start'): string {
    const w = text.length * 7.4 + 6;
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return `<rect x="${x0}" y="${y - 11}" width="${w}" height="13" fill="#111"/><text x="${x0 + w / 2}" y="${y - 1}" class="sc-tag" text-anchor="middle">${text}</text>`;
  }

  private txt(x: number, y: number, size: number, t: string | number, anchor: 'start' | 'middle' | 'end' = 'start', cls = ''): string {
    return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" class="sc-t ${cls}">${t}</text>`;
  }

  /** Ascent arrows (three, lit from the bottom; flashing beyond 12 m/min). */
  private arrowsSvg(x: number, y: number, v: ComputerView): string {
    const n = v.inDive ? this.arrows(v.ascentRate) : 0;
    const blink = v.ascentLevel === 2 ? 'blink' : '';
    return [0, 1, 2].map((i) => {
      const yy = y + (2 - i) * 15;
      const on = i < n;
      return `<path d="M ${x} ${yy + 12} L ${x + 7} ${yy} L ${x + 14} ${yy + 12} Z" class="${on ? `sc-on ${blink}` : 'sc-off'}"/>`;
    }).join('');
  }

  private mins(sec: number): string {
    return `${Math.max(0, Math.ceil(sec / 60))}:`;
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    if (!v.inDive) this.changeMenu = false;
    const list = this.bottomScreens(v);
    const field = list[this.screen % list.length];
    const lcd = v.inDive ? this.diveLcd(v, s, field) : this.watchLcd(v, s);
    el.innerHTML = `
      <div class="dev sc ${this.frame} ${this.backlit ? 'lit' : ''}">
        <div class="sc-case">
          <div class="sc-glass"><svg class="sc-screen" viewBox="0 0 300 240">${lcd}</svg></div>
          <div class="sc-btns"><button class="sc-btn" data-btn="l"></button><button class="sc-btn" data-btn="r"></button></div>
        </div>
      </div>`;
  }

  /** SCUBA (OC) DIVE figures: dive time, arrows and depth; NDL, stop or TTS row; the bottom fields. */
  private diveLcd(v: ComputerView, s: DiveSession, field: string): string {
    const du = depthUnit();
    // MOD Exceeded and Deco Violation alarms: "the field for the current depth flashing".
    const depthBlink = v.depth > v.mod || v.ceilingViolation === 2 ? 'blink' : '';
    const top = `
      <rect x="0" y="0" width="300" height="240" class="sc-bg"/>
      <rect x="0" y="92" width="300" height="56" class="sc-band"/>
      <rect x="128" y="4" width="20" height="12" fill="#111"/>${this.txt(138, 14, 10, 'OC', 'middle', 'sc-inv')}
      ${this.txt(58, 72, v.diveTime >= 6000 ? 32 : 44, `${Math.floor(v.diveTime / 60)}:`, 'end')}
      ${this.arrowsSvg(72, 38, v)}
      ${this.txt(258, 80, 74, du === 'ft' ? depthInt(v.depth) : depthText(v.depth), 'end', depthBlink)}
      ${this.txt(262, 64, 22, du)}`;
    let mid: string;
    const deep = this.deepShown(v);
    const locked = this.penalty >= 150 || v.locked;
    // Locking the Computer: "WARNING DECO VLT", alternating with the remaining decompression (every 3 s
    // assumed); for the whole dive when the dive began locked.
    const warn = locked && (v.locked && !this.lockedThisDive(s) ? true : Math.floor(performance.now() / 3000) % 2 === 0);
    if (warn) {
      mid = `<path d="M 16 140 L 32 108 L 48 140 Z" fill="none" stroke="#111" stroke-width="3"/>${this.txt(32, 136, 20, '!', 'middle')}
        ${this.txt(170, 116, 22, 'WARNING', 'middle')}${this.txt(170, 142, 22, 'DECO VLT', 'middle')}`;
    } else if (v.inDeco && v.stopDepth > 0) {
      // DECO Dive: "TTS (total time to surface) – first stop depth – DECO time of the first stop".
      mid = `${this.tag(8, 102, 'TTS')}${this.tag(140, 102, 'STOP', 'middle')}${this.tag(292, 102, 'TIME', 'end')}
        ${this.txt(60, 142, 40, `${v.tts}:`, 'end')}${this.txt(150, 142, 40, depthInt(v.stopDepth), 'middle')}${this.txt(292, 142, 40, `${v.stopTime}:`, 'end')}`;
    } else if (deep) {
      mid = `${this.tag(140, 102, 'DEEP STOP', 'middle')}${this.tag(292, 102, 'TIME', 'end')}
        ${this.txt(150, 142, 40, depthInt(deep.depth), 'middle')}${this.txt(292, 142, 40, this.mins(deep.left), 'end', deep.state === 'suspended' ? 'blink' : '')}`;
    } else if (this.safetyShown(v)) {
      mid = `${this.tag(100, 102, 'SFT', 'end')}${this.tag(104, 102, 'STOP')}${this.tag(292, 102, 'TIME', 'end')}
        ${this.txt(150, 142, 40, depthInt(Number(this.settings.ssDepth) || 5), 'middle')}${this.txt(292, 142, 40, this.mins(v.safety.remaining), 'end')}`;
    } else {
      mid = `${this.tag(292, 92, 'NDL', 'end')}${this.txt(292, 142, 40, `${Math.min(99, v.ndl)}:`, 'end')}`;
    }
    if (this.changeMenu) {
      // "CHANGE MIX TO 50% / NO YES" (figure).
      const g = s.allGases[this.prompt.offer ?? 0];
      return `${top}
        ${this.txt(10, 120, 16, 'CHANGE')}${this.txt(10, 138, 16, 'MIX TO')}${this.txt(292, 140, 40, `${Math.round((g?.o2 ?? 0) * 100)}%`, 'end')}
        ${this.txt(80, 200, 34, 'NO', 'middle')}${this.txt(220, 200, 34, 'YES', 'middle')}`;
    }
    const offer = this.prompt.offer !== null;
    const mix = `${this.txt(10, 166, 11, 'MIX')}${this.txt(18, 210, 42, Math.round(s.gas.o2 * 100), 'start', offer ? 'sc-red blink' : '')}${this.txt(62, 222, 12, '%')}`;
    let bottom = '';
    if (field === 'max') bottom = `${mix}${this.txt(170, 166, 11, 'MAX')}${this.txt(266, 210, 42, du === 'ft' ? depthInt(v.maxDepth) : depthText(v.maxDepth), 'end')}${this.txt(270, 210, 16, du)}`;
    else if (field === 'po2') bottom = `${mix}${this.txt(200, 226, 11, 'PO2', 'end')}${this.txt(290, 210, 42, v.ppO2.toFixed(2), 'end')}`;
    else if (field === 'tank') bottom = `${mix}${this.txt(266, 210, 42, s.breathing === 0 ? pressText(v.tank.pressure) : '----', 'end')}${this.txt(270, 222, 12, pressUnit())}`;
    else if (field === 'temp') bottom = `${this.txt(18, 210, 42, tempVal(v.temperature).toFixed(1))}${this.txt(80, 222, 12, `°${tempUnit().replace('°', '')}`)}${this.txt(200, 166, 11, 'AVG')}${this.txt(266, 210, 42, du === 'ft' ? depthInt(v.avgDepth) : depthText(v.avgDepth), 'end')}${this.txt(270, 210, 16, du)}`;
    else {
      const { h, m } = clockOfDay(s);
      bottom = `${this.txt(18, 166, 11, 'CNS')}${this.txt(18, 210, 42, Math.round(v.cns))}${this.txt(292, 210, 42, `${h}:${String(m).padStart(2, '0')}`, 'end')}`;
    }
    return `${top}${mid}${bottom}`;
  }

  /** The dive began while the computer was already locked (message for the whole dive). */
  private lockedThisDive(s: DiveSession): boolean {
    return this.locked && this.lockedUntil - this.lockHours * 3600 >= s.diveStart;
  }

  /** Safety Stop NB b): shown within 9 m of the surface once proposed; not when cancelled or done. */
  private safetyShown(v: ComputerView): boolean {
    const st = v.safety.state;
    return this.hasSafetyStop && !this.ssCancelled && (st === 'active' || st === 'paused' || (st === 'pending' && v.depth <= 9));
  }

  /**
   * Watch screen at the surface (no figure: time, date and, after a dive, no-fly and desaturation
   * times, deduced). "Whenever the computer is locked, the NoFly and Desaturation times are not shown."
   */
  private watchLcd(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    // Date: fictive (the simulator has no calendar), the day advancing with the simulated clock.
    const day = 20 + Math.floor((s.clock + 9 * 3600) / 86400);
    const after = v.surfaceInterval !== null;
    let bottom = '';
    if (v.locked) bottom = `${this.txt(150, 214, 22, 'WARNING DECO VLT', 'middle')}`;
    else if (after) {
      bottom = `${this.txt(10, 172, 12, 'NOFLY')}${this.txt(10, 214, 34, hmm(v.noFly))}${this.txt(290, 172, 12, 'DESAT', 'end')}${this.txt(290, 214, 34, hmm(Math.max(v.desat, v.noFly)), 'end')}`;
    }
    return `<rect x="0" y="0" width="300" height="240" class="sc-bg"/>
      <rect x="0" y="92" width="300" height="56" class="sc-band"/>
      ${this.txt(150, 70, 30, `${String(day).padStart(2, '0')}.10`, 'middle')}
      ${this.txt(150, 140, 50, `${h}:${String(m).padStart(2, '0')}`, 'middle')}
      ${bottom}`;
  }
}


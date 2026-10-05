import type { Gas } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthUnit, depthVal, imperial, pressText, pressUnit, tempVal } from '../../../units';
import { type ButtonHelp, type ComputerView, clockOfDay, depthStr, leadingOnGas } from '../../base';
import { ttsAfter } from '../../common/predict';
import { type NauticNotice, NauticRules } from './rules';

/** Switch window fields (§4.6 table). */
type Field = 'gas' | 'po2mod' | 'tank' | 'gasCons' | 'gasTime' | 'tts' | 'avgDepth' | 'maxDepth' | 'gf' | 'gf99' | 'delta5' | 'ascent' | 'tissues' | 'ceiling' | 'otucns' | 'clock' | 'stopwatch';
/** A view: two fields (double) or one (large). */
type View = [Field, Field] | [Field];

/**
 * Views of the switch window (OK button). They are set up on the device (§4.6, "maximum of 10 views");
 * the manual shows "View 1 Active gas, ppO2 / MOD" and "View 2 Tank pressure, Gas consumpt…": the
 * others are an assumed list covering the remaining fields (Tissues and Stopwatch are large fields only).
 */
const VIEWS: View[] = [
  ['gas', 'po2mod'],
  ['tank', 'gasCons'],
  ['gas', 'tank'],
  ['gf99', 'delta5'],
  ['tts', 'ceiling'],
  ['otucns', 'ascent'],
  ['maxDepth', 'avgDepth'],
  ['gasTime', 'gf'],
  ['tissues'],
  ['stopwatch'],
];

/** §3.5 brightness: Low, Medium or High (default not given: Medium assumed). */
const BRIGHTNESS = ['Low', 'Medium', 'High'] as const;
const BRIGHT_FILTER: Record<(typeof BRIGHTNESS)[number], string> = { Low: 'brightness(0.65)', Medium: 'none', High: 'brightness(1.2)' };

/** Fictitious battery level (not simulated). */
const BATTERY = 85;

/** Gas name as on the Nautic figures: AIR, NX32, NX99, TX21/35. */
function gasName(g: Gas): string {
  const o2 = Math.round(g.o2 * 100);
  if (g.he > 0) return `TX${o2}/${Math.round(g.he * 100)}`;
  return o2 === 21 ? 'AIR' : `NX${Math.min(99, o2)}`;
}

/** Minutes and seconds as on the Nautic (45'28). */
function minSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`;
}

/** Depth value with its unit in small type. */
function depthHtml(m: number, cls = 'nt-unit'): string {
  const [i, d] = depthStr(m).split('.');
  return `${i}${d !== undefined ? `<span class="nt-dec">.${d}</span>` : ''}<span class="${cls}">${depthUnit()}</span>`;
}

/** Stop / ceiling depth: one decimal for the ceiling, whole stops (§4.5 figures: "6m", "3.0m"). */
function stopHtml(m: number, decimals: boolean): string {
  const val = imperial() ? String(depthInt(m)) : decimals ? m.toFixed(1) : String(Math.round(m));
  return `${val}<span class="nt-unit">${depthUnit()}</span>`;
}

/**
 * §4.5 Surface time: "minutes and seconds up to one hour. Above one hour, the time is displayed in
 * hours and minutes up to 24 hours, and after that, hours up to seven days and then only in days" (the
 * figures show hours only, e.g. "17h").
 */
function surfaceTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 3600) return minSec(s);
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}<span class="nt-unit">h</span>${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  if (h < 24 * 7) return `${h}<span class="nt-unit">h</span>`;
  return `${Math.floor(h / 24)}<span class="nt-unit">d</span>`;
}

const NOTICE_VIEW: Partial<Record<NauticNotice, View>> = {
  'po2-max': ['gas', 'po2mod'],
  'po2-gas': ['gas', 'po2mod'],
  'cns-100': ['gas', 'otucns'],
  'cns-80': ['gas', 'otucns'],
  'otu-300': ['gas', 'otucns'],
  'otu-250': ['gas', 'otucns'],
  'u-tank': ['tank', 'gasCons'],
  'u-gastime': ['tank', 'gasTime'],
};

/** Suunto Nautic: buttons and screen, after the user guide (rules in rules.ts). */
export class SuuntoNautic extends NauticRules {
  private brightness: (typeof BRIGHTNESS)[number] = 'Medium';
  private flashlight = false;
  private buttonLock = false;
  private swRunning = false;
  private swSec = 0;
  private swClock: number | null = null;
  /** Gas list (§5.2), cursor over the gases (in list order), or null when closed. */
  private gasList: { order: number[]; idx: number; fromPrompt: boolean } | null = null;

  private get view(): View {
    return VIEWS[this.screen % VIEWS.length];
  }

  /** Is a gas list (or a pop-up awaiting a button) using the buttons? */
  private popupTop(s: DiveSession): 'deviation' | NauticNotice | 'gas' | null {
    if (!s.inDive) return null;
    if (this.deviation && !this.deviationAcked) return 'deviation';
    const n = this.notices.top;
    if (n) return n;
    if (this.prompt.offer !== null) return 'gas';
    return null;
  }

  private openGasList(s: DiveSession, first: number | null): void {
    const all = this.knownGases(s).map((_, i) => i);
    const order = first === null ? all : [first, ...all.filter((i) => i !== first)];
    this.gasList = { order, idx: first === null ? Math.max(0, order.indexOf(s.breathing)) : 0, fromPrompt: first !== null };
  }

  press(button: string, s: DiveSession): boolean {
    const gl = this.gasList;
    if (gl) {
      // §5.2: the gas list (scroll, confirm; Back dismisses the suggestion: deduced, see the notes).
      const n = gl.order.length;
      if (button === 'up') gl.idx = (gl.idx + n - 1) % n;
      else if (button === 'down') gl.idx = (gl.idx + 1) % n;
      else if (button === 'ok') {
        s.switchGas(gl.order[gl.idx]);
        this.gasList = null;
      } else {
        if (gl.fromPrompt) this.prompt.decline();
        this.gasList = null;
      }
      return true;
    }
    // §7.1: "Acknowledge the first alarm by pressing any button and the next one will appear"; §3.4: the
    // buttons acknowledge alarms and gas switches even when locked.
    const top = this.popupTop(s);
    if (top === 'deviation') {
      this.deviationAcked = true;
      return true;
    }
    if (top === 'gas') {
      // §5.2: "pressing any button will open a gas list with the recommended gas first".
      this.openGasList(s, this.prompt.offer);
      return true;
    }
    if (top) {
      this.notices.dismiss();
      return true;
    }
    if (this.buttonLock) return false;
    if (button === 'ok') this.setScreen((this.screen + 1) % VIEWS.length);
    else if (button === 'up' && s.inDive) this.brightness = BRIGHTNESS[(BRIGHTNESS.indexOf(this.brightness) + 1) % BRIGHTNESS.length];
    else if (button === 'back' && this.view[0] === 'stopwatch') {
      if (this.swRunning) this.swSec += s.clock - (this.swClock ?? s.clock);
      this.swRunning = !this.swRunning;
      this.swClock = s.clock;
    } else if (button === 'down' && s.inDive && this.knownGases(s).length > 1) this.openGasList(s, null);
    else return false;
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (this.gasList || this.popupTop(s)) return this.press(button, s);
    // §3.4: "You can lock the buttons before or during your dive by keeping the down button pressed."
    if (button === 'down') {
      this.buttonLock = !this.buttonLock;
      this.flash(this.buttonLock ? 'Buttons locked' : 'Buttons unlocked');
      return true;
    }
    if (this.buttonLock) return false;
    // §3.3: "turn the flashlight on or off during diving by long pressing the up button".
    if (button === 'up') this.flashlight = !this.flashlight;
    // §9.4: "Reset by long pressing the back button" (stopwatch in the switch window).
    else if (button === 'back' && this.view[0] === 'stopwatch') {
      this.swRunning = false;
      this.swSec = 0;
      this.swClock = null;
    } else return false;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      up: {
        name: 'UP',
        press: { real: { fr: 'En plongée : luminosité de l’écran (en surface : widgets)', en: 'While diving: display brightness (at the surface: widgets)' }, simulated: true, note: { fr: 'luminosité seulement', en: 'brightness only' } },
        hold: { real: { fr: 'Allume / éteint la lampe', en: 'Turns the flashlight on / off' }, simulated: true, note: { fr: 'icône seulement', en: 'icon only' } },
      },
      back: {
        name: 'BACK',
        press: { real: { fr: 'Démarre / arrête le chronomètre (vue Stopwatch) ; fixe le cap (vue boussole)', en: 'Starts / stops the stopwatch (Stopwatch view); sets the bearing (compass view)' }, simulated: true, note: { fr: 'boussole non simulée', en: 'compass not simulated' } },
        hold: { real: { fr: 'Remet le chronomètre à zéro ; efface le cap', en: 'Resets the stopwatch; clears the bearing' }, simulated: true, note: { fr: 'boussole non simulée', en: 'compass not simulated' } },
      },
      down: {
        name: 'DOWN',
        press: {
          real: { fr: 'Menu de plongée (en surface : réglages de plongée)', en: 'Dive menu (at the surface: dive settings)' },
          simulated: true,
          note: { fr: 'contenu du menu non décrit : liste des gaz en mode Multigas (déduit)', en: 'menu contents not described: gas list in Multigas mode (deduced)' },
        },
        hold: { real: { fr: 'Verrouille / déverrouille les boutons', en: 'Locks / unlocks the buttons' }, simulated: true },
      },
      ok: {
        name: 'OK',
        press: { real: { fr: 'Vue suivante de la fenêtre de droite (switch window)', en: 'Next switch window view' }, simulated: true, note: { fr: 'liste de vues supposée', en: 'assumed list of views' } },
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Screen.

  render(el: HTMLElement, view: ComputerView, s: DiveSession, _lang: Lang): void {
    // §9.2: "If you go above the safe margin area, the decompression calculation is paused".
    const v = this.withPausedDeco(view);
    if (this.gasList && (!v.inDive || this.knownGases(s).length < 2)) this.gasList = null;
    const dive = v.inDive;
    const userCls = this.userLook === 'caution' ? 'nt-caution' : 'nt-notify';
    const pending = new Set(this.notices.all);

    // Depth cell, with the stop arrows (§4.5 "The stop depth range will be indicated in the depth area").
    const last = s.log[s.log.length - 1];
    let depthCell: string;
    if (dive) {
      depthCell = `<div class="nt-big nt-depth">${depthHtml(v.depth)}</div>${this.stopArrows(v)}`;
    } else {
      depthCell = `<div class="nt-lbl">MAX DEPTH</div><div class="nt-mid">${last ? depthHtml(last.maxDepth) : '--'}</div>`;
    }
    const depthHi = dive && pending.has('u-depth') ? userCls : '';

    // Dive time cell.
    const timeCell = dive
      ? `<div class="nt-big nt-time">${minSec(v.diveTime)}</div>`
      : `<div class="nt-lbl">LAST DIVE</div><div class="nt-mid">${last ? minSec(last.duration) : '--'}</div>`;
    const timeHi = dive && pending.has('u-time') ? userCls : '';

    el.innerHTML = `
      <div class="dev nt">
        <div class="nt-case">
          <i class="nt-screw" style="left:14px;top:14px"></i><i class="nt-screw" style="left:50%;top:14px"></i><i class="nt-screw" style="right:14px;top:14px"></i>
          <i class="nt-screw" style="left:14px;bottom:14px"></i><i class="nt-screw" style="left:50%;bottom:14px"></i><i class="nt-screw" style="right:14px;bottom:14px"></i>
          <button class="nt-btn up" data-btn="up"><b>▲</b></button>
          <button class="nt-btn back" data-btn="back"></button>
          <button class="nt-btn down" data-btn="down"><b>▼</b></button>
          <button class="nt-btn ok" data-btn="ok"></button>
          <div class="nt-bezel">
            <div class="nt-screen" style="filter:${BRIGHT_FILTER[this.brightness]}">
              <div class="nt-cell nt-c-depth ${depthHi}">${depthCell}</div>
              <div class="nt-cell nt-c-asc ${dive && this.ascentAlarm ? 'nt-asc-alarm' : ''}">${this.ascentBar(v)}</div>
              <div class="nt-cell nt-c-time ${timeHi}">${timeCell}</div>
              ${this.decoCell(v, pending.has('u-ndl') && dive ? userCls : '')}
              ${this.stopCell(v)}
              ${this.switchWindow(v, s, pending, userCls)}
              ${this.statusCell(v)}
            </div>
          </div>
        </div>
      </div>`;
  }

  /** §8.3, §9.1, §9.2: ▼▲ in the decompression or safety stop window, ▼ above it, red ▼▼ beyond the margin. */
  private stopArrows(v: ComputerView): string {
    if (!v.inDive) return '';
    if (v.inDeco) {
      if (v.ceilingViolation === 2) return '<div class="nt-arrows nt-arr-red"><b>▼</b><b>▼</b></div>';
      if (v.ceilingViolation === 1) return '<div class="nt-arrows nt-arr-yellow"><b>▼</b></div>';
      const ref = this.continuous ? v.ceiling : v.stopDepth;
      if (v.depth <= ref + this.stopWindow) return '<div class="nt-arrows nt-arr-window"><b>▼</b><b>▲</b></div>';
      return '';
    }
    if (this.safetyBroken(v)) return '<div class="nt-arrows nt-arr-yellow"><b>▼</b></div>';
    if (this.hasSafetyStop && v.safety.state === 'active') return '<div class="nt-arrows nt-arr-window"><b>▼</b><b>▲</b></div>';
    return '';
  }

  /**
   * §4.5 Ascent rate: "One bar step corresponds to 2 m (6.6 ft) per minute": five steps, gray below
   * 2 m/min, green, yellow over 8, red at 10, highlighted red over 10 m/min for 5 s (figure: 1 gray,
   * 1 to 3 green, 4 yellow, 5 red chevrons).
   */
  private ascentBar(v: ComputerView): string {
    const r = v.inDive ? v.ascentRate : 0;
    const n = r < 0.5 ? 0 : r < 2 ? 1 : Math.min(5, Math.floor(r / 2));
    const col = r < 2 ? 'gray' : r < 8 ? 'green' : r < 10 ? 'yellow' : 'red';
    let out = '';
    for (let i = 4; i >= 0; i--) out += i < n ? `<i class="nt-chev ${col}"></i>` : '<i class="nt-dash"></i>';
    return `<div class="nt-bar">${out}</div>`;
  }

  /**
   * §4.5 decompression area: "NO DECO" and the NDL (">99" above 99, highlighted at 5 min or less), or
   * the Deco badge and the TTS; optionally NDL and TTS together. The bar beside it is not described:
   * filled in green with the margin left before deco, in orange in deco (deduced from the figures).
   */
  private decoCell(v: ComputerView, userCls: string): string {
    const ndlTxt = v.ndl > 99 ? '>99' : String(v.ndl);
    const low = v.inDive && !v.inDeco && v.ndl <= 5;
    const tts = v.tts === 0 ? '00' : String(v.tts);
    if (this.settings.decoField === 'ndltts') {
      return `<div class="nt-cell nt-c-deco nt-dual ${low ? 'nt-caution' : userCls}">
        <div class="nt-row"><span class="nt-lbl green">NDL</span><span class="nt-val2">${v.inDeco ? '0' : ndlTxt}'</span></div>
        <div class="nt-row"><span class="nt-lbl orange">TTS</span><span class="nt-val2">${tts}'</span></div></div>`;
    }
    const load = Math.max(0, v.n2Load);
    const fill = v.inDeco ? Math.min(1, load / 200) : Math.max(0.03, Math.min(1, 1 - load / 100));
    const bar = `<div class="nt-load ${low || v.inDeco ? 'hatched' : ''}"><i class="${v.inDeco ? 'orange' : low ? 'black' : 'green'}" style="height:${Math.round(fill * 100)}%"></i></div>`;
    const head = v.inDeco ? '<span class="nt-badge">DECO</span>' : '<span class="nt-lbl green">NO DECO</span>';
    const val = v.inDeco ? `${v.tts}'` : `${ndlTxt}'`;
    return `<div class="nt-cell nt-c-deco ${low ? 'nt-caution' : userCls}"><div class="nt-dcol">${head}<div class="nt-big nt-ndl">${val}</div></div>${bar}</div>`;
  }

  /** §4.5 Stop area, §9.1 safety stops, §9.2 decompression stops, §4.5 surface time. */
  private stopCell(v: ComputerView): string {
    const cell = (cls: string, body: string) => `<div class="nt-cell nt-c-stop ${cls}">${body}</div>`;
    if (!v.inDive) {
      const si = v.surfaceInterval;
      return cell('', `<div class="nt-big nt-stopv">${si === null ? '--' : surfaceTime(si)}</div><div class="nt-lbl">SURFACE TIME</div>`);
    }
    // §4.5: "When surfacing, the stop area is replaced with a surface timer" (dive start depth 1.2 m, §4.4).
    if (v.depth < 1.2 && this.surfacedSec > 0) return cell('', `<div class="nt-big nt-stopv">${minSec(this.surfacedSec)}</div><div class="nt-lbl">SURFACE TIME</div>`);
    if (v.inDeco) {
      const level = v.ceilingViolation === 2 ? 'red' : v.ceilingViolation === 1 ? 'yellow' : '';
      if (this.continuous || this.deviation) {
        // §8.3 continuous profile: the ceiling, the whole area lit in the decompression window.
        const inWin = !level && v.depth <= v.ceiling + this.stopWindow;
        const cls = level === 'red' || this.deviation ? 'nt-fill-red' : level === 'yellow' ? 'nt-fill-yellow' : inWin ? 'nt-fill-pale' : '';
        return cell(cls, `<div class="nt-big nt-stopv">${stopHtml(this.continuous ? v.ceiling : v.stopDepth, true)}</div><div class="nt-lbl">CEILING</div>`);
      }
      // §8.3 stepped profile: next stop depth and its time; "a timer starts showing the needed length of
      // the decompression stop" once in the decompression window.
      const inWin = !level && v.depth <= v.stopDepth + this.stopWindow;
      const badge = level === 'red' ? 'red' : level === 'yellow' ? 'yellow' : inWin ? 'pale' : '';
      return cell('', `<div class="nt-big nt-stopd">${stopHtml(v.stopDepth, false)}</div><div class="nt-big nt-stopt ${badge ? `nt-pill ${badge}` : ''}">${Math.ceil(v.stopTimeSec / 60)}'</div><div class="nt-lbl">STOP</div>`);
    }
    if (!this.hasSafetyStop) return cell('', '');
    const st = v.safety.state;
    // §9.6: "Once all stops are done, the Stop done info will appear in the switch window".
    if (st === 'done') return cell('nt-fill-cyan', '<div class="nt-done">STOP DONE</div>');
    if (st === 'none') return cell('', '');
    // §9.1: "When a safety stop is required, the minimum ceiling value (3 m) appears"; the timer between 2.4 and 6 m.
    if (st === 'pending' || (st === 'paused' && v.depth > this.safetyStop.bottom)) {
      if (st === 'pending') return cell('', `<div class="nt-big nt-stopv">${stopHtml(3, true)}</div><div class="nt-lbl">SAFETY STOP</div>`);
      return cell('', `<div class="nt-big nt-stopv">${minSec(v.safety.remaining)}</div><div class="nt-lbl">SAFETY STOP</div>`);
    }
    const pill = this.safetyBroken(v) ? 'yellow' : 'pale';
    return cell('', `<div class="nt-big nt-stopv nt-pill ${pill}">${minSec(v.safety.remaining)}</div><div class="nt-lbl">SAFETY STOP</div>`);
  }

  /** Bottom right: flashlight, deviation icon, temperature and (fictitious) battery. */
  private statusCell(v: ComputerView): string {
    const temp = `${Math.round(tempVal(v.temperature))}<span class="nt-unit">°${imperial() ? 'F' : 'C'}</span>`;
    const torch = `<svg class="nt-torch ${this.flashlight ? 'on' : ''}" viewBox="0 0 12 22"><path d="M1 1h10v5l-3 4v11H4V10L1 6z"/></svg>`;
    const warn = this.deviation && v.inDive ? '<span class="nt-warnicon">⚠</span>' : '';
    const lock = this.buttonLock ? '<span class="nt-lockicon">🔒</span>' : '';

    const note = this.flashMessage();
    if (note) return `<div class="nt-cell nt-c-status"><span class="nt-note">${note}</span></div>`;
    return `<div class="nt-cell nt-c-status">${torch}${warn}${lock}<span class="nt-val3">${temp}</span><span class="nt-val3">${BATTERY}<span class="nt-unit">%</span></span></div>`;
  }

  /** The right column: the switch window view, or what an alarm or event brings into it. */
  private switchWindow(v: ComputerView, s: DiveSession, pending: Set<NauticNotice>, userCls: string): string {
    const large = (cls: string, body: string) => `<div class="nt-cell nt-c-sw nt-large ${cls}">${body}</div>`;
    if (this.gasList) {
      const gl = this.gasList;
      const gases = this.knownGases(s);
      const mods = this.gasMods(s);
      // No figure of the in-dive gas list: a plain list with the MOD of each gas (deduced).
      const rows = gl.order.map((g, k) => `<div class="nt-gasrow ${k === gl.idx ? 'sel' : ''}"><span>${gasName(gases[g])}${g === s.breathing ? ' ✓' : ''}</span><span>${stopHtml(mods[g], true)}</span></div>`).join('');
      return large('nt-list', `<div class="nt-lbl">GASES</div>${rows}`);
    }
    if (v.inDive && this.deviation && (!this.deviationAcked || v.inDeco)) {
      // §9.2 figures: "ALGORITHM DEVIATION! SURPASSED THE DECO CEILING" when it occurs, then
      // "ALGORITHM DEVIATION!" until "the required decompression stops are cleared".
      return large('nt-fill-red nt-alert', `<div class="nt-warnhead">⚠ <i></i></div><div>ALGORITHM<br>DEVIATION!</div>${this.deviationAcked ? '' : '<div>SURPASSED THE<br>DECO CEILING</div>'}`);
    }
    // A tank alarm without Tank POD data any more (POD off, other gas) brings nothing into the window.
    const top0 = v.inDive ? this.notices.top : undefined;
    const top = top0 && (top0 === 'tank-50' || top0 === 'u-tank' || top0 === 'u-gastime') && !v.tank.ai ? undefined : top0;
    if (top === 'tank-50') {
      // §7.1 figure: the tank pressure in a large red field.
      return large('nt-fill-red nt-alert', `<div class="nt-lbl white">TANK PRESSURE</div><div class="nt-mid">⚠ ${pressText(s.tankPressure)}<span class="nt-unit">${pressUnit()}</span></div>`);
    }
    if (v.inDive && this.prompt.offer !== null && !top) {
      // §5.2 figure: "SWITCH GAS" and the gas in a large cyan field.
      return large('nt-fill-cyan nt-alert', `<div class="nt-lbl black">SWITCH GAS</div><div class="nt-mid">${gasName(s.allGases[this.prompt.offer])}</div>`);
    }
    const vw: View = (top && NOTICE_VIEW[top]) || this.view;
    if (vw.length === 1) return large('', this.field(vw[0], v, s, pending, userCls, true));
    return `<div class="nt-cell nt-c-sw1">${this.field(vw[0], v, s, pending, userCls, false)}</div>
      <div class="nt-cell nt-c-sw2">${this.field(vw[1], v, s, pending, userCls, false)}</div>`;
  }

  private field(f: Field, v: ComputerView, s: DiveSession, pending: Set<NauticNotice>, userCls: string, large: boolean): string {
    const one = (lbl: string, val: string, cls = '') => `<div class="nt-fld ${cls}"><div class="nt-lbl">${lbl}</div><div class="nt-fv">${val}</div></div>`;
    const two = (a: [string, string, string?], b: [string, string, string?]) =>
      `<div class="nt-fld2">${[a, b].map(([l, val, cls]) => `<div class="nt-half ${cls ?? ''}"><div class="nt-lbl">${l}</div><div class="nt-fv">${val}</div></div>`).join('')}</div>`;
    const ai = v.tank.ai;
    switch (f) {
      case 'gas':
        return one('ACTIVE GAS', gasName(s.gas));
      case 'po2mod': {
        // §4.6: "If the ppO2 exceeds the preset limit for the gas, the switch window turns yellow … the
        // maximum partial pressure limit of 1.6, the switch window turns red" (figure: the ppO2 half).
        const setLevel = s.breathing > 0 && this.maxGases > 1 ? this.decoPpo2() : this.modPpo2;
        const cls = v.ppO2 > 1.6 ? 'nt-fill-red' : v.ppO2 > setLevel + 0.005 ? 'nt-fill-yellow' : '';
        return two(['ppO<sub>2</sub>', v.ppO2.toFixed(1), cls], ['MOD', stopHtml(v.mod, true)]);
      }
      case 'tank': {
        // §6.2: "If you have not paired a Suunto Tank POD, the switch window tank pressure will read No Tank Pod."
        if (!ai) return one('TANK PRESSURE', '<span class="nt-small">No Tank Pod</span>');
        const frac = Math.max(0, Math.min(1, v.tank.pressure / v.tank.fill));
        const hi = pending.has('u-tank') ? userCls : v.tank.pressure < 50 ? 'nt-fill-red' : '';
        const bar = `<div class="nt-tankbar"><i style="height:${Math.round((1 - frac) * 100)}%"></i></div>`;
        return `<div class="nt-fld nt-tank ${hi}"><div class="nt-lbl">TANK PRESSURE</div><div class="nt-fv">${pressText(v.tank.pressure)}<span class="nt-unit">${pressUnit()}</span></div>${large ? '' : bar}</div>`;
      }
      case 'gasCons': {
        // §6.3: real-time consumption (RMV, L/min); "might not be populated immediately at the beginning of the dive".
        const ok = ai && v.inDive && v.diveTime >= 60;
        const val = !ok ? '--' : imperial() ? `${(s.rmv / 28.3168).toFixed(2)}<span class="nt-unit">ft³/min</span>` : `${s.rmv.toFixed(1)}<span class="nt-unit">l/min</span>`;
        return one('GAS CONSUMPTION', val);
      }
      case 'gasTime': {
        const gt = v.tank.gasTime;
        const hi = pending.has('u-gastime') ? userCls : '';
        // §6.4 figure: hours and minutes ("0:36").
        return one('GAS TIME', ai && gt !== null ? `${Math.floor(gt / 60)}:${String(gt % 60).padStart(2, '0')}` : '--', hi);
      }
      case 'tts':
        return one('TIME TO SURFACE', `${v.tts}<span class="nt-unit">min</span>`);
      case 'avgDepth':
        return one('AVG. DEPTH', depthHtml(v.avgDepth));
      case 'maxDepth':
        return one('MAX DEPTH', depthHtml(v.maxDepth));
      case 'gf':
        return one('GRADIENT FACTORS', `${v.gfLow}/${v.gfHigh}`);
      case 'gf99': {
        // §4.6: "On Gas is displayed when tissue tension is less than the inspired inert gas pressure. GF99 is
        // shown in yellow when GF High is exceeded … red (warning) at 100%"; Surface GF takes the same colours.
        const col = v.gf99 >= 100 ? 'red' : v.gf99 > v.gfHigh ? 'yellow' : '';
        const gf99 = v.inDive && leadingOnGas(s) ? '<span class="nt-small">On Gas</span>' : `${Math.round(v.gf99)}<span class="nt-unit">%</span>`;
        return two(['GF99', gf99, col], ['SURF. GF', `${Math.round(v.surfGf)}<span class="nt-unit">%</span>`, col]);
      }
      case 'delta5': {
        // §4.6 Contingency: "The predicted change in TTS if you were to stay at the current depth for 5
        // more minutes" (Δ+5) and "The predicted TTS" then (@5).
        const at5 = v.inDive ? ttsAfter(s, v.depth, 5, this.decoParams(s), this.anchor) : 0;
        return two(['Δ+5', `${Math.max(0, at5 - v.tts)}'`], ['@5', `${at5}'`]);
      }
      case 'ascent':
        return one('ASCENT SPEED', `${Math.round(Math.max(0, depthVal(v.inDive ? v.ascentRate : 0)))}<span class="nt-unit">${depthUnit()}/min</span>`);
      case 'tissues':
        return this.tissues(s);
      case 'ceiling':
        // §4.6: "a ceiling value appears … always from the deepest stop"; §9.1 safety stop: "the minimum
        // ceiling value (3 m)".
        return one('CEILING', v.inDeco ? stopHtml(this.continuous ? v.ceiling : v.stopDepth, true) : v.inDive && this.hasSafetyStop && v.safety.state !== 'none' && v.safety.state !== 'done' ? stopHtml(3, true) : '--');
      case 'otucns': {
        const otuCls = v.otu >= 300 ? 'nt-fill-red' : v.otu >= 250 ? 'nt-fill-yellow' : '';
        const cnsCls = v.cns >= 100 ? 'nt-fill-red' : v.cns >= 80 ? 'nt-fill-yellow' : '';
        // §4.6 note: "The displayed oxygen exposure calculations are raised to the next higher percentage value."
        return two(['OTU', String(Math.ceil(v.otu)), otuCls], ['CNS', `${Math.ceil(v.cns)}<span class="nt-unit">%</span>`, cnsCls]);
      }
      case 'clock': {
        const { h, m } = clockOfDay(s);
        return one('TIME', `${h}:${String(m).padStart(2, '0')}`);
      }
      case 'stopwatch': {
        const sec = this.swSec + (this.swRunning && this.swClock !== null ? s.clock - this.swClock : 0);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        return `<div class="nt-fld"><div class="nt-lbl">STOPWATCH</div><div class="nt-fv">${mm}'${String(Math.floor(sec % 60)).padStart(2, '0')}</div><div class="nt-play ${this.swRunning ? '' : 'green'}">${this.swRunning ? '❚❚' : '▶'}</div></div>`;
      }
    }
  }

  /**
   * §4.6 Tissues graph: fastest compartment at the top, pressure increasing to the right; green below
   * ambient pressure, yellow above, red above the M-value (bar length: tension as a % of the M-value,
   * scale 0–150 % as in the figure).
   */
  private tissues(s: DiveSession): string {
    const amb = s.pressure;
    let bars = '';
    for (let i = 0; i < 16; i++) {
      const p = s.tissues.n2[i] + s.tissues.he[i];
      const [a, b] = s.tissues.coefficients(i);
      const m = amb / b + a;
      const pct = (p / m) * 100;
      const col = p > m ? 'red' : p > amb ? 'yellow' : 'green';
      bars += `<i class="${col}" style="width:${Math.min(100, (pct / 150) * 100).toFixed(1)}%"></i>`;
    }
    return `<div class="nt-fld nt-tis"><div class="nt-lbl">TISSUES</div><div class="nt-tisbars">${bars}</div></div>`;
  }
}

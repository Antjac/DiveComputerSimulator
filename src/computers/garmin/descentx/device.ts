// Garmin Descent X30 / X50i: what both screens share, after their owner's manuals (Dive Data Screens,
// Performing a Safety Stop / a Decompression Stop, Viewing Your Dynamic Depth, Dive Alerts): the left
// column (tissue load bar, NDL or stop banner, ascent rate chevrons, depth, dive time, gas and PO2),
// the dynamic depth screen, the alert pop-ups, the in-dive menu and the gas switch prompt. Each model
// draws its own right-hand fields and frame (x30/, x50i/).
import { ndl, type DecoParams } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthUnit, depthVal, pressText, tempVal } from '../../../units';
import { type AlertCue, type ButtonHelp, type ComputerView, clockOfDay, depthStr, mmss } from '../../base';
import { ttsAfter } from '../../common/predict';
import { DescentXRules } from './rules';

export const GREEN = '#3ccf3c';
export const YELLOW = '#f6a821';
export const RED = '#ff3b30';
export const GREY = '#9a9a9a';

/** Gas name on the dive screens: "Air", "EAN32" (figures), "O2", trimix "21/35" (deduced). */
export function gasName(g: { o2: number; he?: number }): string {
  const o2 = Math.round(g.o2 * 100);
  const he = Math.round((g.he ?? 0) * 100);
  if (he > 0) return `${o2}/${he}`;
  return o2 === 21 ? 'Air' : o2 === 100 ? 'O2' : `EAN${o2}`;
}

/** Simulator values the device would measure (marked as such: not data of the dive). */
export const FICTIVE = { battery: 100, heading: 0 };

/** Stop banner: depth, timer and colour of the box, or null outside any stop. */
export interface StopBanner {
  kind: 'DECO' | 'STOP';
  depth: number;
  time: string;
  fill: string;
  /** Depth and stop depth flash red (above the deco ceiling) or turn yellow (above the safety stop). */
  warn: '' | 'red' | 'yellow';
  /** A stop just completed: "The decompression stop depth and time flash." */
  done: boolean;
}

export abstract class DescentXDevice extends DescentXRules {
  /** Data screens in the NEXT loop: primary, dynamic depth, transceiver (X50i with a transceiver). */
  protected abstract screens(v: ComputerView): ('primary' | 'dynamic' | 'tank')[];
  /** SVG of the whole display (viewBox `vbW` × 320), the left column being drawn by `leftColumn`. */
  protected abstract primary(v: ComputerView, s: DiveSession): string;
  protected abstract tankScreen(v: ComputerView, s: DiveSession): string;
  protected abstract readonly vbW: number;
  /** CSS class of the model's case. */
  protected abstract readonly frame: string;

  // Deco stop behaviour (Performing a Decompression Stop and Dive Alerts): the stop timer pauses more
  // than 0.6 m above the stop; a completed stop flashes; "Approaching deco stop." within one stop
  // interval (3 m), "Decompression cleared." once all are done.
  private pausedStop: { depth: number; sec: number } | null = null;
  private lastStop = 0;
  private stopDoneUntil = 0;
  private approachedStop = 0;
  private toast: { title: string; msg: string; until: number; color: string } | null = null;
  private queue: { title: string; msg: string; color: string }[] = [];
  private given = new Set<string>();
  private repeats = new Map<string, { last: number; count: number }>();
  /** In-dive menu (ENTER): "Press ENTER, select Switch Gas, and select a backup or decompression gas." */
  private menu: { page: 'menu' | 'gas'; idx: number } | null = null;
  /** Answer highlighted in the switch prompt: 0 Yes, 1 Not Now. */
  private promptSel = 0;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.pausedStop = null;
    this.lastStop = this.approachedStop = 0;
    this.stopDoneUntil = 0;
    this.toast = null;
    this.queue = [];
    this.given.clear();
    this.repeats.clear();
    this.menu = null;
    this.promptSel = 0;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    const offered = this.prompt.offer;
    // "Continuing on %1. Switch at any time." also when "you ignored the prompt" (%1: the gas breathed, deduced).
    if (this.updatePrompt(s) !== null) this.say('', `Continuing on ${gasName(s.gas)}. Switch at any time.`);
    if (this.prompt.offer !== offered) this.promptSel = 0;
  }

  private say(title: string, msg: string, color = '#2c2c2e'): void {
    this.queue.push({ title, msg, color });
  }

  private once(key: string, on: boolean, title: string, msg: string, color?: string): void {
    if (on && !this.given.has(key)) {
      this.given.add(key);
      this.say(title, msg, color);
    }
  }

  /** While `on`: at once, then every `every` s of dive time, `times` times at most. */
  private repeat(key: string, on: boolean, s: DiveSession, every: number, times: number, title: string, msg: () => string, color?: string): void {
    const r = this.repeats.get(key);
    if (!on) {
      this.repeats.delete(key);
      return;
    }
    if (!r) {
      this.repeats.set(key, { last: s.clock, count: 1 });
      this.say(title, msg(), color);
    } else if (r.count < times && s.clock - r.last >= every) {
      r.last = s.clock;
      r.count++;
      this.say(title, msg(), color);
    }
  }

  /** Dive Alerts given as pop-ups when something happens (the lasting ones are drawn by `popup`). */
  private trackAlerts(v: ComputerView, s: DiveSession): void {
    if (!v.inDive || v.locked) return;
    this.once('ndl10', !v.inDeco && v.ndl <= 10 && v.ndl > 5, '', '10 minutes to NDL.');
    this.once('ndl5', !v.inDeco && v.ndl <= 5, '', '5 minutes to NDL.');
    this.once('ndl', v.inDeco, 'NDL exceeded.', 'Deco required.');
    // "Safety stop started.": "You ascended above 6 m (20 ft.) without other decompression guidance."
    this.once('ss-start', v.safety.state === 'active', '', 'Safety stop started.');
    this.once('ss-done', this.safetyState === 'done' && this.given.has('ss-start'), '', 'Safety stop cleared.');
    this.repeat('otu', v.otu > this.otuLimit, s, 120, 3, '', () => `${Math.round(v.otu)} OTU accumulated.`);
    // "The alert appears every 30 seconds, up to three times, until you ascend to a safe level."
    this.repeat('po2', v.ppO2 > this.po2Critical, s, 30, 3, 'ASCEND OR SWITCH GAS', () => 'PO2 is high.', RED);
    this.repeat('po2low', v.ppO2 < this.po2Low, s, 30, 3, 'DESCEND OR SWITCH GAS', () => 'PO2 is low.', s.diveTime < 120 ? YELLOW : RED);
    // Custom alerts (Scuba Alerts): pop-up text not given, the alert name (deduced).
    const depthAl = Number(this.settings.depthAlert);
    if (depthAl > 0) this.once('depth', v.depth >= depthAl, '', `Depth Alert ${depthInt(depthAl)}${depthUnit()}`);
    const timeAl = Number(this.settings.timeAlert);
    if (timeAl > 0) {
      const n = Math.floor(v.diveTime / 60 / timeAl);
      this.once(`time-${n}`, n > 0, '', `Time Alert ${n * timeAl}:00`);
    }
  }

  private trackStops(v: ComputerView): void {
    const now = performance.now();
    const stop = v.inDive && v.inDeco ? v.stopDepth : 0;
    if (this.lastStop > 0 && stop < this.lastStop) {
      // "None — You completed the decompression stop. — The decompression stop depth and time flash."
      this.stopDoneUntil = now + 5000;
      if (stop === 0 && v.inDive) this.say('', 'Decompression cleared.');
    }
    if (stop > 0 && stop !== this.approachedStop && v.depth > stop + this.stopWindow && v.depth <= stop + 3) {
      this.approachedStop = stop;
      this.say('', 'Approaching deco stop.');
    }
    this.lastStop = stop;
    this.pausedStop = v.ceilingViolation === 2
      ? this.pausedStop && this.pausedStop.depth === v.stopDepth ? this.pausedStop : { depth: v.stopDepth, sec: v.stopTimeSec }
      : null;
  }

  /**
   * Stop banner of the data screens. Safety stop (Performing a Safety Stop): "After a dive of at least
   * 11 m (35 ft.), ascend to 5 m (15 ft.). Safety stop information appears on the data screens" (green
   * STOP box in the figures); "If you ascend more than 3 m above the safety stop ceiling depth, the
   * safety stop timer pauses" and, Dive Alerts, "more than 2 m above [...] The current depth and stop
   * depth turn yellow". Decompression stop: yellow DECO box; "The depth and ceiling depth flash red
   * until you are within the safe margin."
   */
  protected stopBanner(v: ComputerView): StopBanner | null {
    if (v.inDeco && v.stopDepth > 0) {
      return {
        kind: 'DECO', depth: v.stopDepth, fill: YELLOW,
        time: mmss(this.pausedStop ? this.pausedStop.sec : v.stopTimeSec),
        warn: v.ceilingViolation === 2 ? 'red' : '', done: performance.now() < this.stopDoneUntil,
      };
    }
    const st = v.safety.state;
    if (v.inDive && (st === 'active' || st === 'paused' || (st === 'pending' && v.depth < 7))) {
      return { kind: 'STOP', depth: 5, fill: GREEN, time: mmss(v.safety.remaining), warn: v.depth < 3 ? 'yellow' : '', done: false };
    }
    return null;
  }

  // --- Drawing helpers (SVG, 320 units high) -------------------------------------------------------

  protected t(x: number, y: number, size: number, text: string | number, opts: { anchor?: 'start' | 'middle' | 'end'; fill?: string; cls?: string; weight?: number } = {}): string {
    return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${opts.anchor ?? 'start'}" fill="${opts.fill ?? '#fff'}" font-weight="${opts.weight ?? 700}" class="gx-t ${opts.cls ?? ''}">${text}</text>`;
  }

  /** Tissue load bar (Dive Data Screens ①): green 0–79 %, yellow 80–99 %, red from 100 %, with a pointer. */
  protected tissueBar(x: number, y0: number, y1: number, load: number): string {
    const h = y1 - y0;
    const y = (p: number) => y1 - (Math.min(120, Math.max(0, p)) / 120) * h;
    const ptr = y(load);
    return `<rect x="${x}" y="${y(120)}" width="9" height="${y(100) - y(120) - 2}" fill="${RED}"/>
      <rect x="${x}" y="${y(99)}" width="9" height="${y(80) - y(99) - 2}" fill="${YELLOW}"/>
      <rect x="${x}" y="${y(79)}" width="9" height="${y(0) - y(79)}" fill="${GREEN}"/>
      <path d="M ${x - 4} ${ptr - 6} L ${x + 6} ${ptr - 6} L ${x + 12} ${ptr} L ${x + 6} ${ptr + 6} L ${x - 4} ${ptr + 6} Z" fill="#fff" stroke="#000" stroke-width="1.5"/>`;
  }

  /**
   * Ascent rate (Dive Data Screens ②): five chevrons up, a bar and a chevron down; lit in green below
   * 7.9 m/min, yellow from 7.9 to 10.1 m/min, red beyond. How many chevrons light up with the speed is
   * not given (deduced: one per fifth of 10.1 m/min).
   */
  protected chevrons(x: number, y: number, v: ComputerView): string {
    const col = v.ascentLevel === 2 ? RED : v.ascentLevel === 1 ? YELLOW : GREEN;
    const up = v.ascentRate > 0.5 ? Math.min(5, Math.ceil((v.ascentRate / 10.1) * 5)) : 0;
    const down = v.ascentRate < -0.5;
    let out = '';
    for (let i = 0; i < 5; i++) {
      const yy = y + i * 13;
      const lit = 4 - i < up;
      out += `<path d="M ${x} ${yy + 11} L ${x + 8} ${yy + 3} L ${x + 16} ${yy + 11} L ${x + 16} ${yy + 15} L ${x + 8} ${yy + 7} L ${x} ${yy + 15} Z" fill="${lit ? col : '#5a5a5a'}"/>`;
    }
    const yb = y + 68;
    out += `<rect x="${x}" y="${yb}" width="16" height="5" fill="#d0d0d0"/>`;
    out += `<path d="M ${x} ${yb + 9} L ${x + 8} ${yb + 17} L ${x + 16} ${yb + 9} L ${x + 16} ${yb + 13} L ${x + 8} ${yb + 21} L ${x} ${yb + 13} Z" fill="${down ? '#d0d0d0' : '#5a5a5a'}"/>`;
    return out;
  }

  /** Ceiling icon of the stop banner (a bar over an up arrow, as "⤒" in the figures). */
  protected ceilIcon(x: number, y: number, size: number, fill: string): string {
    const k = size / 30;
    return `<g transform="translate(${x} ${y}) scale(${k})" fill="${fill}"><rect x="0" y="-26" width="18" height="3.5"/><path d="M 9 -21 L 17 -11 L 11.5 -11 L 11.5 0 L 6.5 0 L 6.5 -11 L 1 -11 Z"/></g>`;
  }

  /** Stop banner box (figures: STOP in green, DECO in yellow, black text). */
  protected bannerBox(b: StopBanner, x: number, y: number, w: number, h: number, big = false): string {
    const blink = b.done ? 'blink' : '';
    const depthCol = b.warn === 'red' ? RED : b.warn === 'yellow' ? '#7a5200' : '#000';
    const lbl = big ? 40 : 28;
    const dSize = big ? 58 : 34;
    const tSize = big ? 72 : 46;
    const depth = `${depthInt(b.depth)}`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${b.fill}"/>
      ${this.t(x + 8, y + (big ? 52 : 32), lbl, b.kind, { fill: '#000', cls: blink })}
      ${big ? '' : this.ceilIcon(x + w - 90, y + 32, 30, '#000')}
      <text x="${x + w - 6}" y="${y + (big ? 58 : 34)}" font-size="${dSize}" text-anchor="end" fill="${depthCol}" font-weight="700" class="gx-t ${blink} ${b.warn === 'red' ? 'blink' : ''}">${depth}<tspan font-size="${dSize * 0.55}">${depthUnit()}</tspan></text>
      ${this.t(x + w / 2, y + h - (big ? 14 : 8), tSize, b.time, { anchor: 'middle', fill: '#000', cls: blink })}`;
  }

  /** PO2 colour (Setting PO2 Thresholds, Dive Alerts): flashes yellow above PO2 Warning, red above
   *  PO2 Critical; below 0.18 bar yellow during the first two minutes, red afterwards. */
  protected po2Cls(v: ComputerView, s: DiveSession): { fill: string; cls: string } {
    if (v.ppO2 > this.po2Critical) return { fill: RED, cls: 'blink' };
    if (v.ppO2 < this.po2Low && v.inDive) return { fill: s.diveTime < 120 ? YELLOW : RED, cls: 'blink' };
    if (v.ppO2 > this.po2Warning) return { fill: YELLOW, cls: 'blink' };
    return { fill: '#fff', cls: '' };
  }

  /** NDL value: "99+" beyond 99 (figure of the transceiver screen). */
  protected ndlText(v: ComputerView): string {
    return v.ndl > 99 ? '99<tspan font-size="0.5em" dy="-0.9em">+</tspan>' : String(Math.max(0, v.ndl));
  }

  /** Depth: whole feet; metres with one decimal (not shown in the figures, deduced). */
  protected depthText(d: number): string {
    return depthUnit() === 'ft' ? String(depthInt(d)) : depthStr(d);
  }

  /**
   * Left column of the gas dive screens (190 × 320, Single-Gas / Multi-Gas Data Screens figure of the
   * X50i, Multi-Gas of the X30): NDL or the stop banner, ascent chevrons and depth, dive time, gas and
   * PO2. `showPo2`: the X50i hides the PO2 "in the single-gas dive mode [...] if you are using air".
   */
  protected leftColumn(v: ComputerView, s: DiveSession, showPo2: boolean): string {
    const b = this.stopBanner(v);
    const warn = b?.warn === 'red' ? `fill="${RED}" class="gx-t blink"` : b?.warn === 'yellow' ? `fill="${YELLOW}" class="gx-t"` : 'fill="#fff" class="gx-t"';
    const top = b
      ? this.bannerBox(b, 2, 2, 184, 82)
      : v.locked
        ? `<rect x="2" y="10" width="184" height="64" rx="4" fill="${RED}"/>${this.t(94, 50, 24, 'DECO LOCKOUT', { anchor: 'middle' })}`
        : `${this.tissueBar(8, 10, 74, v.n2Load)}
           <text x="34" y="72" font-size="66" font-weight="700" fill="#fff" class="gx-t">${this.ndlText(v)}</text>
           ${this.t(v.ndl > 99 ? 128 : v.ndl > 9 ? 112 : 78, 70, v.ndl > 99 ? 26 : 30, 'NDL', { fill: GREY })}`;
    const po2 = this.po2Cls(v, s);
    const gas = gasName(s.gas);
    return `
      ${top}
      ${this.chevrons(8, 92, v)}
      <text x="34" y="164" font-size="${this.depthText(v.depth).length > 3 ? 58 : 74}" font-weight="700" ${warn}>${this.depthText(v.depth)}<tspan font-size="30" fill="${GREY}">${depthUnit()}</tspan></text>
      ${this.t(96, 236, 66, mmss(v.diveTime), { anchor: 'middle' })}
      <rect x="4" y="250" width="${showPo2 ? 90 : 180}" height="66" rx="4" fill="#202022"/>
      ${this.t(showPo2 ? 49 : 94, 294, gas.length > 4 ? 26 : 32, gas, { anchor: 'middle' })}
      ${showPo2 ? `${this.t(104, 272, 24, 'PO2', { fill: GREY })}${this.t(100, 312, 44, v.ppO2.toFixed(2), { fill: po2.fill, cls: po2.cls })}` : ''}`;
  }

  /** Time of day, "2:52" (figures: no leading zero). */
  protected tod(s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  protected tempText(v: ComputerView): string {
    return `${Math.round(tempVal(v.temperature))}°`;
  }

  protected battery(x: number, y: number, size: number): string {
    // Battery level: fictive (the simulator has no battery).
    const w = size * 0.9;
    return `<g transform="translate(${x} ${y - size * 0.62})"><rect x="0" y="0" width="${w}" height="${size * 0.5}" rx="2" fill="none" stroke="#fff" stroke-width="2.5"/><rect x="${w}" y="${size * 0.15}" width="3" height="${size * 0.2}" fill="#fff"/><rect x="3" y="3" width="${w - 6}" height="${size * 0.5 - 6}" fill="#fff"/></g>`;
  }

  /** Tank pressure text and colour (Transceiver Alerts: yellow below the reserve, flashing red below
   *  the critical pressure). */
  protected tankText(v: ComputerView): { text: string; fill: string; cls: string } {
    const p = v.tank.pressure;
    return { text: `${pressText(p)}`, fill: p < this.criticalPressure() ? RED : p < v.tank.reserve ? YELLOW : '#fff', cls: p < this.criticalPressure() ? 'blink' : '' };
  }

  /** NDL Δ 3M / NDL Δ 10FT: "your No Decompression Limit (NDL) time if you ascend 3 m (10 ft.)". */
  protected ndlUp3(v: ComputerView, s: DiveSession, p: DecoParams): number {
    const d = Math.max(0, v.depth - (depthUnit() === 'ft' ? 3.048 : 3));
    return ndl(s.tissues, d, s.gas, p.gfHigh, 100);
  }

  /** @+5: TTS if you stay 5 more minutes at the current depth; Δ+5: its difference with the TTS now. */
  protected at5(v: ComputerView, s: DiveSession): { at: number; delta: number } {
    const p = this.decoParams(s);
    const at = ttsAfter(s, v.depth, 5, p, this.anchor);
    return { at, delta: at - v.plan.tts };
  }

  /**
   * Dynamic depth chart (Viewing Your Dynamic Depth): "your depth profile for the dive so far, along
   * with the projected ascent plan to the surface. The ascent plan shows required decompression stops
   * or the safety stop (if configured), as well as upcoming gas switches". Scale, colours and the
   * ceiling area are read from the figures (past ceiling in dark red, planned stops in red).
   */
  protected chart(x0: number, y0: number, w: number, h: number, v: ComputerView, s: DiveSession, labels: boolean): string {
    const prof = s.profile;
    const past = Math.max(60, v.diveTime);
    const future = Math.max(60, v.plan.tts * 60);
    const total = past + future;
    const xNow = x0 + (past / total) * w;
    const maxD = Math.max(10, v.maxDepth) * 1.1;
    const X = (t: number) => x0 + (t / total) * w;
    const Y = (d: number) => y0 + (Math.min(d, maxD) / maxD) * h;
    const line = prof.map((p) => `${X(p.t).toFixed(1)},${Y(p.depth).toFixed(1)}`).join(' ') + ` ${xNow.toFixed(1)},${Y(v.depth).toFixed(1)}`;
    const ceil = prof.filter((p) => p.ceiling > 0);
    const pastCeil = ceil.length
      ? `<path d="M ${X(ceil[0].t)} ${y0} ${ceil.map((p) => `L ${X(p.t).toFixed(1)} ${Y(p.ceiling).toFixed(1)}`).join(' ')} L ${xNow} ${Y(v.ceiling)} L ${xNow} ${y0} Z" fill="#7a1010"/>`
      : '';
    // Projected ascent: at the planned rate to each stop, the stop, then the next.
    let t = past;
    let d = v.depth;
    const pts = [`${xNow.toFixed(1)},${Y(d).toFixed(1)}`];
    let stopsArea = '';
    const rate = this.baseParams().ascentRate * 60;
    const stops = v.inDeco ? v.plan.stops : this.hasSafetyStop && v.maxDepth >= 11 && v.safety.state !== 'done' ? [{ depth: 5, minutes: this.safetySeconds() / 60 }] : [];
    for (const st of stops) {
      t += ((d - st.depth) / rate) * 60;
      d = st.depth;
      pts.push(`${X(t).toFixed(1)},${Y(d).toFixed(1)}`);
      const t2 = t + st.minutes * 60;
      if (v.inDeco) stopsArea += `<rect x="${X(t).toFixed(1)}" y="${y0}" width="${(X(t2) - X(t)).toFixed(1)}" height="${(Y(d) - y0).toFixed(1)}" fill="${RED}"/>`;
      t = t2;
      pts.push(`${X(t).toFixed(1)},${Y(d).toFixed(1)}`);
    }
    t += (d / rate) * 60;
    pts.push(`${X(t).toFixed(1)},${y0}`);
    const grid = [0, 1 / 3, 2 / 3, 1].map((k) => {
      const yy = y0 + k * h;
      return `<line x1="${x0}" y1="${yy}" x2="${x0 + w}" y2="${yy}" stroke="#444" stroke-width="1"/>${labels ? this.t(x0 - 4, yy + 8, 22, Math.round(depthVal(maxD * k)), { anchor: 'end', fill: GREY }) : ''}`;
    }).join('');
    return `${grid}${pastCeil}${stopsArea}
      <line x1="${xNow}" y1="${y0}" x2="${xNow}" y2="${y0 + h}" stroke="#ddd" stroke-width="1.5"/>
      <polyline points="${line}" fill="none" stroke="#ddd" stroke-width="2"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-width="2.5"/>
      <circle cx="${xNow}" cy="${Y(v.depth)}" r="5" fill="#2f8cff"/>`;
  }

  // --- Buttons ------------------------------------------------------------------------------------

  press(button: string, s: DiveSession): boolean {
    // "Switch to %1 now?": PREV / NEXT highlight an answer, ENTER selects it (the device's usual list
    // handling; the prompt has no figure). "A confirmation message for your choice appears."
    const offer = this.prompt.offer;
    if (offer !== null && s.inDive) {
      if (button === 'next' || button === 'prev') this.promptSel = 1 - this.promptSel;
      else if (button === 'enter') {
        const name = gasName(s.allGases[offer]);
        const yes = this.promptSel === 0;
        this.answerPrompt(s, yes ? 'yes' : 'notnow');
        // "Switched to %1." is deduced (the manual does not word the confirmation of a switch).
        this.say('', yes ? `Switched to ${name}.` : `Continuing on ${gasName(s.gas)}. Switch at any time.`);
        this.menu = null;
      } else return false;
      return true;
    }
    const m = this.menu;
    if (m && s.inDive) {
      const n = m.page === 'menu' ? 1 : this.knownGases(s).length;
      if (button === 'next') m.idx = (m.idx + 1) % n;
      else if (button === 'prev') m.idx = (m.idx + n - 1) % n;
      else if (button === 'back') this.menu = m.page === 'gas' ? { page: 'menu', idx: 0 } : null;
      else if (button === 'enter') {
        if (m.page === 'menu') this.menu = { page: 'gas', idx: s.breathing };
        else {
          s.switchGas(m.idx);
          this.menu = null;
        }
      }
      return true;
    }
    if (button === 'enter' && s.inDive && this.knownGases(s).length > 1) {
      this.menu = { page: 'menu', idx: 0 };
      return true;
    }
    if (button === 'next' || (button === 'prev' && this.prevScrolls)) {
      const n = this.lastScreens;
      this.setScreen((this.screen + (button === 'next' ? 1 : n - 1)) % n);
      return true;
    }
    return false;
  }

  /** PREV scrolls the data screens too (X30: "Press to scroll through menus or data screens"). */
  protected abstract readonly prevScrolls: boolean;
  private lastScreens = 1;

  protected baseButtons(): Record<string, ButtonHelp> {
    return {
      back: {
        name: 'BACK',
        press: { real: { fr: 'Retour à l’écran précédent', en: 'Back to the previous screen' }, simulated: true, note: { fr: 'dans le menu de plongée', en: 'in the in-dive menu' } },
        hold: { real: { fr: 'En plongée : retour à l’écran d’accueil (raccourci) ; sinon menu des commandes', en: 'While diving: back to the home screen (shortcut); otherwise controls menu' }, simulated: false },
      },
      prev: {
        name: 'PREV',
        press: this.prevScrolls
          ? { real: { fr: 'Écran de données précédent ; dans un menu : élément précédent', en: 'Previous data screen; in a menu: previous item' }, simulated: true }
          : { real: { fr: 'Dans un menu : élément précédent', en: 'In a menu: previous item' }, simulated: true },
      },
      next: {
        name: 'NEXT',
        press: {
          real: { fr: 'Écran de données suivant (et boussole) ; dans un menu : élément suivant', en: 'Next data screen (and compass); in a menu: next item' },
          simulated: true,
          note: { fr: 'la boussole n’est pas simulée', en: 'the compass is not simulated' },
        },
      },
      enter: {
        name: 'ENTER',
        press: {
          real: { fr: 'Menu de plongée (Switch Gas, boussole, chronomètre…) ; dans un menu : sélection', en: 'In-dive menu (Switch Gas, compass, stopwatch…); in a menu: select' },
          simulated: true,
          note: { fr: 'avec plusieurs gaz, entrée Switch Gas seulement', en: 'with several gases, Switch Gas item only' },
        },
      },
    };
  }

  // --- Screens -------------------------------------------------------------------------------------

  /** In-dive menu and gas list (no figure in the manual: a plain list, deduced). */
  private menuScreen(s: DiveSession): string {
    const m = this.menu!;
    const items = m.page === 'menu' ? ['Switch Gas'] : this.knownGases(s).map((g, i) => `${gasName(g)}${i === s.breathing ? ' ✓' : ''}`);
    const cx = this.vbW / 2;
    const rows = items.map((it, i) => {
      const y = 160 + (i - (items.length - 1) / 2) * 46;
      return `${i === m.idx ? `<rect x="${cx - 150}" y="${y - 32}" width="300" height="42" rx="6" fill="#0a84ff"/>` : ''}${this.t(cx, y, 30, it, { anchor: 'middle' })}`;
    }).join('');
    return `${this.t(cx, 40, 24, m.page === 'menu' ? 'DIVE' : 'SWITCH GAS', { anchor: 'middle', fill: GREY })}${rows}`;
  }

  /** "Switch to %1 now?" (layout and answers deduced: no figure). */
  private promptScreen(s: DiveSession): string {
    const cx = this.vbW / 2;
    const name = gasName(s.allGases[this.prompt.offer!]);
    const rows = ['Yes', 'Not Now'].map((it, i) => {
      const y = 190 + i * 52;
      return `${i === this.promptSel ? `<rect x="${cx - 110}" y="${y - 34}" width="220" height="46" rx="6" fill="#0a84ff"/>` : ''}${this.t(cx, y, 32, it, { anchor: 'middle' })}`;
    }).join('');
    return `${this.t(cx, 70, 40, `Switch to ${name} now?`, { anchor: 'middle' })}${rows}`;
  }

  /** Dynamic depth screen (gas dives): left column, then @+5 / Δ+5 or NDL Δ 3M / STOPS and the chart. */
  protected abstract dynamicScreen(v: ComputerView, s: DiveSession): string;

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const list = this.screens(v);
    this.lastScreens = list.length;
    if (this.screen >= list.length) this.screen = 0;
    this.trackStops(v);
    this.trackAlerts(v, s);
    if (this.menu && !v.inDive) this.menu = null;
    const kind = list[this.currentScreen()];
    let content: string;
    if (v.inDive && this.prompt.offer !== null) content = this.promptScreen(s);
    else if (this.menu) content = this.menuScreen(s);
    else if (kind === 'dynamic' && v.inDive) content = this.dynamicScreen(v, s);
    else if (kind === 'tank') content = this.tankScreen(v, s);
    else content = this.primary(v, s);
    el.innerHTML = `
      <div class="dev gx ${this.frame}">
        <div class="gx-case">
          <div class="gx-glass"><svg class="gx-screen" viewBox="0 0 ${this.vbW} 320">
            <rect width="${this.vbW}" height="320" fill="#000"/>
            ${content}
            ${this.popup(v)}
          </svg></div>
          <div class="gx-btns">
            <button class="gx-btn" data-btn="back"></button><button class="gx-btn" data-btn="prev"></button>
            <span class="gx-gap"></span>
            <button class="gx-btn" data-btn="next"></button><button class="gx-btn" data-btn="enter"></button>
          </div>
        </div>
      </div>`;
  }

  /** The pop-up message on display (without taking the next queued one): first line, for alertExplain. */
  private popupMessage(v: ComputerView): string {
    const p = this.popupContent(v, false);
    return p ? p.title || p.msg : '';
  }

  /** Lasting alerts first, then the queued ones (5 s each); null when nothing pops up. */
  private popupContent(v: ComputerView, take: boolean): { title: string; msg: string; color: string } | null {
    if (!v.inDive) return null;
    if (this.ascentAlarm) return { title: 'SLOW YOUR ASCENT', msg: 'Ascending too fast.', color: RED };
    if (v.ceilingViolation === 2) return { title: `DESCEND TO ${depthInt(v.stopDepth)}${depthUnit()}`, msg: 'You are above your deco ceiling.', color: RED };
    // Transceiver Alerts: "%1 pressure is critically low." / "%1 is below reserve pressure.", %1 being the
    // transceiver name (T1, deduced: the default name is not given).
    if (v.tank.ai && v.tank.pressure < this.criticalPressure()) return { title: 'PRESSURE CRITICAL', msg: 'T1 pressure is critically low.', color: RED };
    if (v.tank.ai && v.tank.pressure < v.tank.reserve) return { title: '', msg: 'T1 is below reserve pressure.', color: YELLOW };
    if (v.safety.state === 'paused' && v.depth < this.safetyStop.top) return { title: '', msg: 'Descend to complete safety stop.', color: YELLOW };
    // Queued pop-ups wait while the switch prompt (itself a pop-up) is shown (deduced).
    if (this.prompt.offer !== null) return null;
    const now = performance.now();
    if (this.toast && now < this.toast.until) return this.toast;
    if (!take) return null;
    const next = this.queue.shift();
    this.toast = next ? { ...next, until: now + 5000 } : null;
    return this.toast;
  }

  /** Alert pop-up over the data screen (no figure: a box in the alert's colour, title then message). */
  private popup(v: ComputerView): string {
    const p = this.popupContent(v, true);
    if (!p) return '';
    const w = Math.min(this.vbW - 40, 460);
    const x = (this.vbW - w) / 2;
    const words = p.msg.split(' ');
    const lines: string[] = [];
    const max = Math.floor(w / 17);
    for (const word of words) {
      if (lines.length && (lines[lines.length - 1] + ' ' + word).length <= max) lines[lines.length - 1] += ' ' + word;
      else lines.push(word);
    }
    const h = 28 + (p.title ? 42 : 0) + lines.length * 34;
    const y = 160 - h / 2;
    const ink = p.color === YELLOW ? '#000' : '#fff';
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${p.color}" stroke="#000" stroke-width="2"/>
      ${p.title ? this.t(this.vbW / 2, y + 44, 34, p.title, { anchor: 'middle', fill: ink }) : ''}
      ${lines.map((l, i) => this.t(this.vbW / 2, y + (p.title ? 42 : 0) + 42 + i * 34, 28, l, { anchor: 'middle', fill: ink, weight: 500 })).join('')}</g>`;
  }

  /** With `all` (alert bubble), also the pop-up on display, explained by alertExplain (`msg:` keys). */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    const cues = super.alertCues(v, all);
    if (all && v.inDive) {
      const shown = this.popupMessage(v);
      if (shown) cues.push({ key: `msg:${shown}`, kind: 'both', level: 'info', until: 'once' });
    }
    return cues;
  }
}

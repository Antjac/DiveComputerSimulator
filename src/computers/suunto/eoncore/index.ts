import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthUnit, imperial, pressText, pressUnit, tempVal } from '../../../units';
import { type ButtonHelp, type ComputerView, clockOfDay, depthStr, hmm } from '../../base';
import { type EonNotice, EonCoreRules } from './rules';

const GREEN = '#8fd12f';
const LIME = '#a6dc3c';
const CYAN = '#4fc9ea';
const ORANGE = '#f2953a';
const YELLOW = '#e9e22b';
const RED = '#ec3a2e';
const BROWN = '#6b4a2a';
const GREY = '#9b9b9b';

/** Pop-up texts: the §4.1 tables, and the figures for pO2 high / low and the §4.6.2 warning. */
const NOTICE_TEXT: Record<EonNotice, string> = {
  'po2-high': 'pO<sub>2</sub> high',
  'po2-low': 'pO<sub>2</sub> low',
  'ceiling-broken': 'WARNING: Ceiling broken',
  'cns-100': 'CNS 100%',
  'otu-300': 'OTU 300',
  depth: 'Depth',
  'dive-time': 'Dive time',
  'gas-time': 'Gas time',
  'safety-broken': 'Safety stop broken',
  'tank-50': 'Tank pressure',
  'tank-alarm': 'Tank pressure',
  'cns-80': 'CNS 80%',
  'otu-250': 'OTU 250',
  'change-gas': 'Change gas',
};

/** Depth-like value with its decimal smaller ("18.2" figures); whole feet in imperial. */
function num(m: number): string {
  const [i, d] = depthStr(m).split('.');
  return d !== undefined ? `${i}<small>.${d}</small>` : i;
}

/** Stop and deepstop depths: one decimal in metres (figures), whole feet in imperial. */
const stopVal = (m: number) => (imperial() ? String(depthInt(m)) : `${Math.floor(m)}<small>.${Math.round((m % 1) * 10) % 10}</small>`);
const stopTxt = (m: number) => (imperial() ? String(depthInt(m)) : m.toFixed(1));

/** m′ss with the seconds smaller (§4.27: "counted down in minutes and seconds"). */
function minSec(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}′<small>${String(s % 60).padStart(2, '0')}</small>`;
}

/** Point on the gauge circle; angles in degrees from 12 o'clock, clockwise. */
function pt(a: number, r: number): [number, number] {
  const rad = ((a - 90) * Math.PI) / 180;
  return [62 + r * Math.cos(rad), 62 + r * Math.sin(rad)];
}

function arcPath(from: number, to: number, r: number): string {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/**
 * The gauge around the centre field (figures): a 270° arc in segments, the part `frac` bright, the
 * rest dim; `full` draws a whole ring (timer view).
 */
function gauge(color: string, frac: number, dim = color, full = false): string {
  const span = full ? 360 : 270;
  const start = full ? 0 : -135;
  const end = start + span * Math.max(0, Math.min(1, frac));
  let ticks = '';
  for (let a = start; a < start + span; a += span / (full ? 36 : 18)) {
    const [x1, y1] = pt(a, 48);
    const [x2, y2] = pt(a, 58);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1"/>`;
  }
  const bg = full ? `<circle cx="62" cy="62" r="53" stroke="${dim}" stroke-opacity="0.45" stroke-width="9" fill="none"/>` : `<path d="${arcPath(-135, 135, 53)}" stroke="${dim}" stroke-opacity="0.45" stroke-width="9" fill="none"/>`;
  const fg = frac > 0.005 ? `<path d="${arcPath(start, Math.min(end, start + span - 0.01), 53)}" stroke="${color}" stroke-width="9" fill="none"/>` : '';
  return `<svg class="ec-gauge" viewBox="0 0 124 124">${bg}${fg}${ticks}</svg>`;
}

/** Fictitious weekday and date of the simulated day (dives start on day 1): shown at the surface. */
function dateOfDay(s: DiveSession): string {
  const day = Math.floor((s.clock + 9 * 3600) / 86400);
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day % 7];
  return `${wd} ${1 + (day % 30)} Sept`;
}

interface Field { lbl: string; val: string; col: string; lblCol?: string }

/** Suunto EON Core, Air/Nitrox mode, Prominent style: buttons and display, after the user guide (rules in rules.ts). */
export class SuuntoEonCore extends EonCoreRules {
  /** §4.20.1 gas options (middle button held): the gas under the cursor, or null when closed. */
  private gasList: number | null = null;
  /** Index in the switch window list (lower button). */
  private sw = 0;
  private swCount = 1;
  /** Set by the upper button (§4.34: the timer "is shown in the bottom right corner as a scrollable item"). */
  private showTimer = false;

  /** §4.16.1: views of the middle button (the Compass view is not simulated). */
  private views(): ('nodeco' | 'tank' | 'timer')[] {
    return this.settings.views === 'custom' ? ['nodeco', 'tank', 'timer'] : ['nodeco'];
  }

  press(button: string, s: DiveSession): boolean {
    // §4.6.2: "Approve the Ceiling broken warning by pushing the middle button."
    if (this.notices.top === 'ceiling-broken') {
      if (button !== 'middle') return false;
      this.notices.dismiss();
      return true;
    }
    // §4.1: "Pop-up messages can be acknowledged by pressing any button" (the press only acknowledges: assumed).
    if (this.notices.dismiss()) return true;
    // §4.20.1: "Scroll with the upper or lower button to the desired gas. Press the middle button to confirm gas selection."
    if (this.gasList !== null) {
      const n = this.knownGases(s).length;
      if (button === 'upper') this.gasList = (this.gasList + n - 1) % n;
      else if (button === 'lower') this.gasList = (this.gasList + 1) % n;
      else {
        s.switchGas(this.gasList);
        this.gasList = null;
      }
      return true;
    }
    // §3.2: upper "Start/Stop Timer", middle "Change view", lower "Switch window".
    if (button === 'upper') {
      this.timerRunning = !this.timerRunning;
      this.showTimer = true;
    } else if (button === 'middle') {
      const n = this.views().length;
      if (n < 2) return false;
      this.setScreen((this.screen + 1) % n);
    } else if (button === 'lower') this.sw = (this.sw + 1) % this.swCount;
    else return false;
    return true;
  }

  hold(button: string, s: DiveSession): boolean {
    if (this.notices.top === 'ceiling-broken') {
      if (button !== 'middle') return false;
      this.notices.dismiss();
      return true;
    }
    if (this.notices.dismiss()) return true;
    // §4.20.1: "Long press the middle button to see gas options."
    if (button === 'middle' && s.inDive && this.knownGases(s).length > 1) {
      this.gasList = this.gasList === null ? s.breathing : null;
      return true;
    }
    if (button === 'upper') {
      // §4.34: "Keep the upper button pressed to reset the timer."
      this.timerRunning = false;
      this.timerSec = 0;
      this.showTimer = true;
    } else if (button === 'lower' && s.inDive) this.flash('Bookmark'); // §5.9
    else return false;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      upper: {
        name: 'UPPER',
        press: { real: { fr: 'Remonter dans une liste ; démarre / arrête le chronomètre', en: 'Scroll up; starts / stops the timer' }, simulated: true },
        hold: { real: { fr: 'Remet le chronomètre à zéro', en: 'Resets the timer' }, simulated: true },
      },
      middle: {
        name: 'MIDDLE',
        press: {
          real: { fr: 'Sélectionner ; change de vue (No deco, Compass, et Tank pressure, Timer après personnalisation)', en: 'Select; changes the view (No deco, Compass, and Tank pressure, Timer after customisation)' },
          simulated: true,
          note: { fr: 'vue Compass non simulée ; approuve aussi l’avertissement Ceiling broken', en: 'Compass view not simulated; also approves the Ceiling broken warning' },
        },
        hold: {
          real: { fr: 'Entrer dans le menu, revenir ; en plongée multigaz : options de gaz (choix avec haut / bas, confirmation au milieu)', en: 'Enter the menu, go back; on a multi-gas dive: gas options (choose with upper / lower, confirm with middle)' },
          simulated: true,
          note: { fr: 'seulement la liste des gaz, avec l’option Multiple gases', en: 'gas list only, with the Multiple gases option' },
        },
      },
      lower: {
        name: 'LOWER',
        press: { real: { fr: 'Descendre dans une liste ; change le contenu de la fenêtre en bas à droite', en: 'Scroll down; changes the bottom-right (switch) window' }, simulated: true },
        hold: {
          real: { fr: 'Ajoute un repère (bookmark) au carnet ; en vue Compass, verrouille le cap', en: 'Adds a bookmark to the log; in the Compass view, locks the bearing' },
          simulated: true,
          note: { fr: 'confirmation affichée seulement', en: 'confirmation shown only' },
        },
      },
    };
  }

  /** Switch window contents (deduced from the figures; customised in the Suunto app on the device). */
  private switchItems(v: ComputerView, view: string): Field[] {
    const list: Field[] = [];
    if (view === 'nodeco') list.push({ lbl: `max, ${depthUnit()}`, val: num(v.maxDepth), col: '#fff' });
    else list.push({ lbl: 'no deco', val: v.inDeco ? '0′' : v.ndl > 99 ? '>99′' : `${v.ndl}′`, col: LIME });
    // Gas: "Nx 32" (§4.6.1 figure), "Air" (§4.16.2 figure).
    list.push(v.o2 === 21 ? { lbl: 'gas', val: 'Air', col: CYAN } : { lbl: 'Nx', val: String(v.o2), col: CYAN });
    if (v.tank.ai && view !== 'tank') list.push({ lbl: `tank, ${pressUnit()}`, val: pressText(v.tank.pressure), col: CYAN });
    // §4.21: gas time "not visible by default. After customization in Suunto app".
    if (this.settings.views === 'custom') list.push({ lbl: 'gas time', val: v.tank.ai ? (v.tank.gasTime === null ? '- -' : `${v.tank.gasTime}′`) : 'n/a', col: CYAN });
    // §4.24: CNS% and OTU "are not displayed until they reach 80% of their recommended limits [...] the
    // value stays in the view"; §4.4: "You can customize views to always show CNS% and OTU".
    if (this.settings.views === 'custom' || v.cns >= 80) list.push({ lbl: 'CNS, %', val: String(Math.ceil(v.cns)), col: v.cns >= 100 ? RED : v.cns >= 80 ? YELLOW : '#fff' });
    if (this.settings.views === 'custom' || v.otu >= 250) list.push({ lbl: 'OTU', val: String(Math.ceil(v.otu)), col: v.otu >= 300 ? RED : v.otu >= 250 ? YELLOW : '#fff' });
    if (view !== 'timer' && (this.timerRunning || this.timerSec > 0)) list.push({ lbl: 'timer', val: minSec(this.timerSec), col: GREEN });
    return list;
  }

  render(el: HTMLElement, view: ComputerView, s: DiveSession, _lang: Lang): void {
    // §4.11: above the safe margin "the decompression calculation is paused until you go back down".
    const v = this.withPausedDeco(view);
    const views = this.views();
    if (this.screen >= views.length) this.screen = 0;
    const cur = views[this.currentScreen()];
    // §4.11: "Suunto EON Core shows the ceiling value always from the deepest of these stops"; above the
    // deco ceiling, its warning takes over the deepstop (deduced).
    const dsNext = v.inDive && !v.locked ? this.currentDeepstop() : undefined;
    const deep = dsNext && !(v.inDeco && (v.ceiling > dsNext.target || v.ceilingViolation > 0)) ? dsNext : undefined;
    const deepActive = deep?.state === 'active';
    const safety = v.inDive && !v.inDeco && !v.locked && (v.safety.state === 'active' || v.safety.state === 'paused');
    const safetyAhead = v.inDive && !v.inDeco && !v.locked && v.safety.state === 'pending';

    // Top line (figures): the next stop ("3.0 SAFETY STOP", "20.3 DEEPSTOP", "17.7 CEILING") or "Locked".
    let top = '';
    let topCol = '#fff';
    if (v.locked) top = `<span class="ec-lock-i">🔒</span> Locked`;
    else if (deep) {
      const lv = deepActive ? this.deepstopLevel(deep, v.depth) : 0;
      topCol = lv === 2 ? RED : lv === 1 ? YELLOW : '#fff';
      top = `${stopTxt(deep.target)} <span class="ec-dim">DEEPSTOP</span>`;
    } else if (v.inDive && v.inDeco) {
      topCol = v.ceilingViolation === 2 ? RED : v.ceilingViolation === 1 ? YELLOW : '#fff';
      top = `${stopTxt(v.ceiling)} <span class="ec-dim">CEILING</span>`;
    } else if (safety || safetyAhead) {
      top = `${stopTxt(3)} <span class="ec-dim">SAFETY STOP</span>`;
    } else if (!v.inDive && v.surfaceInterval !== null) {
      // §4.30: surface time and no-fly countdown after a dive (§3.3 icons; place deduced).
      top = `<span class="ec-ico surf">◷</span>${hmm(v.surfaceInterval / 60)}${v.noFly > 0 ? ` <span class="ec-ico fly">✈</span>${Math.ceil(v.noFly / 60)}h` : ''}`;
    }

    // Centre gauge and bottom-right field.
    let gLbl = '';
    let gVal = '';
    let gCol = LIME;
    let gFrac = 0;
    let gDim = gCol;
    let gFull = false;
    let decoTag = false;
    let center = '';
    let forced: Field | null = null;
    // ▼ over ▲ (white) inside the window, ▼ (yellow) just above it, a red ⬇ beyond (§4.11, §4.27 figures).
    const arrows = (lv: 0 | 1 | 2, col: string) => (lv === 0 ? '<span class="ec-arr win"><i>▼</i><i>▲</i></span>' : `<span class="ec-arr" style="color:${col}">${lv === 2 ? '⬇' : '▼'}</span>`);

    if (v.locked) {
      // §4.6.1 figure: an orange padlock and "Locked" in a dim arc; "the ceiling value is no longer present".
      gCol = gDim = BROWN;
      gFrac = 1;
      center = `<div class="ec-padlock">🔒</div><div class="ec-glbl" style="color:#fff">Locked</div>`;
    } else if (!v.inDive) {
      // Surface (§4.4 figure): weekday, date and time of day in the gauge.
      const t = clockOfDay(s);
      gCol = gDim = GREEN;
      gFrac = 1;
      center = `<div class="ec-glbl" style="color:#fff">${dateOfDay(s)}</div><div class="ec-gval" style="color:${GREEN}">${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}</div>`;
    } else if (deepActive && deep) {
      // §4.11 figure "optional deepstop": yellow gauge with the countdown, "deepstop, m" bottom right.
      const lv = this.deepstopLevel(deep, v.depth);
      [gLbl, gVal, gCol, gFrac] = ['deepstop', minSec(deep.remaining), YELLOW, deep.remaining / 120];
      gDim = gCol;
      decoTag = v.inDeco;
      const col = lv === 2 ? RED : lv === 1 ? YELLOW : '#fff';
      forced = { lbl: `deepstop, ${depthUnit()}`, val: `${arrows(lv, col)}${stopVal(deep.target)}`, col };
    } else if (v.inDeco) {
      // §4.11 figures: orange "DECO", "asc. time" in the gauge (graduated as the no deco one: deduced).
      decoTag = true;
      [gLbl, gVal, gCol, gFrac] = ['asc. time', v.tts > 999 ? '>999′' : `${v.tts}′`, ORANGE, Math.max(0.04, v.tts / 100)];
      gDim = gCol;
      // "ceiling, m" with ▼▲ in the deco window, yellow ▼ in the safe margin, red ⬇ beyond it.
      if (v.ceilingViolation > 0 || v.depth <= v.ceiling + 3) {
        const col = v.ceilingViolation === 2 ? RED : v.ceilingViolation === 1 ? YELLOW : '#fff';
        forced = { lbl: `ceiling, ${depthUnit()}`, val: `${arrows(v.ceilingViolation, col)}${stopVal(v.ceiling)}`, col };
      }
    } else if (safety) {
      // §4.27: voluntary safety stop in yellow, mandatory in red; "stop, m" with ▼▲ in the window.
      const col = this.mandatorySafety ? RED : YELLOW;
      [gLbl, gVal, gCol, gFrac] = ['stop', minSec(v.safety.remaining), col, v.safety.remaining / Math.max(1, v.safety.total)];
      gDim = gCol;
      const inWin = v.safety.state === 'active';
      forced = { lbl: `stop, ${depthUnit()}`, val: `${inWin ? arrows(0, '#fff') : arrows(1, YELLOW)}${stopVal(3)}`, col: inWin ? '#fff' : YELLOW };
    } else if (cur === 'tank' && v.tank.ai) {
      [gLbl, gVal, gCol, gFrac] = [`tank, ${pressUnit()}`, pressText(v.tank.pressure), CYAN, v.tank.pressure / Math.max(1, v.tank.fill)];
      gDim = gCol;
    } else if (cur === 'tank') {
      // §4.21: "If you have not paired a Suunto Tank POD, the [...] field shows n/a" (same assumed here).
      [gLbl, gVal, gCol, gFrac] = [`tank, ${pressUnit()}`, 'n/a', CYAN, 0];
      gDim = gCol;
    } else if (cur === 'timer') {
      // §4.34: "In timer view, the timer is displayed as an analog watch."
      [gLbl, gVal, gCol, gFrac, gFull] = ['timer', minSec(this.timerSec), GREEN, ((this.timerSec % 60) + 0.6) / 60, true];
      gDim = '#3f6a1c';
    } else {
      // No deco view (§4.16.1 figure): gauge graduated 0, 50, 100 (deduced).
      const n = v.ndl;
      gCol = n <= 5 ? YELLOW : LIME;
      gDim = gCol;
      [gLbl, gVal, gFrac] = ['no deco', n > 99 ? '>99′' : `${n}′`, Math.min(1, n / 100)];
    }
    if (!center) center = `<div class="ec-glbl" style="color:${gCol === BROWN ? '#fff' : gCol === LIME || gCol === CYAN || gCol === GREEN || gCol === ORANGE ? GREY : gCol}">${gLbl}</div><div class="ec-gval" style="color:${gCol}">${gVal}</div>`;

    // Bottom-right window: forced values first (§4.1 "The information needing attention remains on
    // screen [...] in the bottom field"; §4.33 tank pressure "forced onto the display").
    const po2Bad = v.inDive && (v.ppO2 > this.po2Limit(s) + 0.005 || v.ppO2 < 0.18);
    const tankWarn = v.inDive && v.tank.ai && v.tank.pressure < Math.max(50, this.tankAlarm() ?? 0);
    if (!forced && po2Bad) forced = { lbl: 'pO<sub>2</sub>', val: v.ppO2.toFixed(1), col: RED };
    if (!forced && tankWarn) forced = { lbl: `tank, ${pressUnit()}`, val: pressText(v.tank.pressure), col: v.tank.pressure < 50 ? RED : YELLOW };
    const items = this.switchItems(v, v.inDive ? cur : 'nodeco');
    this.swCount = items.length;
    if (this.showTimer) {
      const i = items.findIndex((f) => f.lbl === 'timer');
      if (i >= 0) this.sw = i;
      this.showTimer = false;
    }
    // §4.24: once CNS or OTU reaches 80 %, "the value stays in the view" (shown once: assumed).
    if (!this.oxyShown && v.inDive && (v.cns >= 80 || v.otu >= 250)) {
      this.oxyShown = true;
      const i = items.findIndex((f) => f.lbl.startsWith(v.cns >= 80 ? 'CNS' : 'OTU'));
      if (i >= 0) this.sw = i;
    }
    if (this.sw >= items.length) this.sw = 0;
    const sw = forced ?? items[this.sw];
    const note = this.flashMessage();

    // Ascent bar (§4.3): six steps of 2 m/min, green up to 8, yellow 8–10, red beyond; dim when unlit.
    const steps = v.inDive && v.ascentRate > 0.5 ? Math.min(6, Math.ceil(v.ascentRate / 2)) : 0;
    const segCol = [GREEN, GREEN, GREEN, GREEN, YELLOW, RED];
    let bar = '';
    for (let i = 0; i < 6; i++) {
      const lit = i < steps;
      bar += `<i style="background:${segCol[i]};opacity:${lit ? 1 : 0.22}"></i>`;
    }
    const arrowCol = v.ascentLevel === 2 ? RED : v.ascentLevel === 1 ? YELLOW : GREEN;

    // §4.1 pop-up (figures: a yellow-framed box over the lower right of the gauge).
    const notice = v.inDive ? this.notices.top : undefined;
    let popup = notice ? `<div class="ec-pop"><span>${NOTICE_TEXT[notice]}</span></div>` : '';
    if (!popup && note) popup = `<div class="ec-pop"><span>${note}</span></div>`;
    if (this.gasList !== null && (!v.inDive || this.knownGases(s).length < 2)) this.gasList = null;
    let list = '';
    if (this.gasList !== null) {
      // Gas options: no figure in the user guide; a list over the gauge (deduced).
      const gases = this.knownGases(s);
      const mods = this.gasMods(s);
      list = `<div class="ec-gases">${gases.map((g, i) => {
        const o2 = Math.round(g.o2 * 100);
        const name = o2 === 21 ? 'Air' : o2 >= 99 ? 'Oxygen' : `Nx${o2}`;
        return `<div class="${this.gasList === i ? 'sel' : ''}">${name}${i === s.breathing ? ' ✓' : ''} <span>MOD ${depthInt(mods[i])} ${depthUnit()}</span></div>`;
      }).join('')}</div>`;
    }

    const nViews = views.length;
    const dots = nViews > 1 ? views.map((_, i) => `<i class="${i === this.screen ? 'on' : ''}"></i>`).join('') : '<i class="on"></i><i></i>';

    el.innerHTML = `
      <div class="dev ec">
        <div class="ec-strap l"></div><div class="ec-strap r"></div>
        <div class="ec-case">
          <button class="ec-btn upper" data-btn="upper"></button>
          <button class="ec-btn middle" data-btn="middle"></button>
          <button class="ec-btn lower" data-btn="lower"></button>
          <div class="ec-screen">
            <div class="ec-top"><span class="ec-batt"><i></i></span><span class="ec-bh">16<small>h</small></span><span class="ec-next" style="color:${topCol}">${top}</span></div>
            <div class="ec-asc">${bar}<b style="bottom:${steps * 28}px;border-bottom-color:${arrowCol}"></b></div>
            ${this.ceilingBroken && this.notices.top !== 'ceiling-broken' ? '<div class="ec-broken"><span>CEILING BROKEN</span></div>' : ''}
            <div class="ec-temp">${Math.round(tempVal(v.temperature))}°</div>
            <div class="ec-lbl ec-l-depth">depth, ${depthUnit()}</div>
            <div class="ec-depth" style="color:${v.inDive ? '#fff' : '#d8d8d8'}">${num(v.depth)}</div>
            <div class="ec-lbl ec-l-time">dive time</div>
            <div class="ec-time">${Math.floor(v.diveTime / 60)}′</div>
            ${decoTag ? '<div class="ec-deco">DECO</div>' : ''}
            <div class="ec-ring">${gauge(gCol, gFrac, gDim, gFull)}<div class="ec-center">${center}</div></div>
            <div class="ec-sw">
              <div class="ec-lbl" style="color:${sw.lblCol ?? (sw.col === RED || sw.col === YELLOW ? sw.col : GREY)}">${sw.lbl}</div>
              <div class="ec-swv" style="color:${sw.col}">${sw.val}</div>
            </div>
            <div class="ec-dots">${dots}</div>
            ${popup}${list}
          </div>
        </div>
      </div>`;
  }
}

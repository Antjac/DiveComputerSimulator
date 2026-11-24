import { depthToPressure, planAscent, SURFACE_PRESSURE } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthText, depthUnit, imperial, pressText, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, leadingOnGas } from '../../base';
import { SwMenu, bestGas, gasDensity, trimixName, turnGasOn } from '../multigas';
import { Perdix3Rules, type P3Event, type P3Warning } from './rules';

/** §4.11 warning texts (figures of the table). */
const WARNING_TEXT: Record<P3Warning, string> = {
  'low-ppo2': 'LOW PPO2',
  'high-ppo2': 'HIGH PPO2',
  'missed-stop': 'MISSED DECO STOP',
  'fast-ascent': 'FAST ASCENT',
  'very-high-cns': 'VERY HIGH CNS',
  'high-cns': 'HIGH CNS',
  'low-ndl': 'LOW NDL ALERT',
  'depth-alert': 'DEPTH ALERT',
  'time-alert': 'TIME ALERT',
  'critical-pres': 'T1 CRITICAL PRES',
};
/** §4.9 dive event texts (figure). */
const EVENT_TEXT: Record<P3Event, string> = { 'dive-started': 'Dive Started' };

/** §4.6 info screens, in the order of the figure (compass not simulated). */
type InfoPage = 'last' | 'ai' | 'maxavg' | 'cns' | 'gf' | 'tissues' | 'temp' | 'mbar' | 'date';

/**
 * §12.1 main menu: "Main menu items differ by mode, as well as at the surface versus on a dive" (order of
 * the figures: Turn Off, Select Gas, Brightness, Dive Tools, Log…; Turn Off does not appear during a dive).
 * Single gas modes have no Select Gas.
 */
const MENU_SURFACE = ['Turn Off', 'Select Gas', 'Brightness', 'Dive Tools', 'Log', 'Settings'];
const MENU_DIVE = ['Select Gas', 'Brightness', 'Dive Tools'];

/** Fictitious battery level (not simulated). */
const BATTERY = 75;

const cy = (t: string) => `<small class="p3-cy">${t}</small>`;
/** PPO2 as on the figures: ".21", "1.24". */
const ppo2Text = (p: number) => p.toFixed(2).replace(/^0/, '');
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Shearwater Perdix 3: two buttons and a 2.4" AMOLED display, after the manual (rules in rules.ts). */
export class ShearwaterPerdix3 extends Perdix3Rules {
  /** §12.1 main menu and Select Gas (classic: "If you increment past the number of gases available, the display will fall back out"). */
  private menu = new SwMenu('classic');
  /** §4.9 warnings overlay (MENU while the alert indicator is shown). */
  private overlay = false;
  private lastView: ComputerView | null = null;

  private menuItems(s: DiveSession): string[] {
    const items = s.inDive ? MENU_DIVE : MENU_SURFACE;
    return this.maxGases > 1 ? items : items.filter((i) => i !== 'Select Gas');
  }

  private betterGas(s: DiveSession): number | null {
    if (this.knownGases(s).length < 2) return null;
    const b = bestGas(s, this.knownGases(s), this.modPpo2, this.decoPpo2(), (i) => this.gasOff(i));
    return b !== null && b !== s.breathing ? b : null;
  }

  private infoPages(s: DiveSession): InfoPage[] {
    return [
      ...(!s.inDive && s.log.length ? ['last' as const] : []),
      ...(this.airIntegrated(s) ? ['ai' as const] : []),
      'maxavg', 'cns', 'gf', 'tissues', 'temp', 'mbar', 'date',
    ];
  }

  press(button: string, s: DiveSession): boolean {
    // §4.9: "Dive Events time out after 4 seconds or can be cleared by pressing any button"; "Press any
    // button to acknowledge and clear a warning".
    if (this.notices.dismiss()) return true;
    if (this.event) {
      this.event = null;
      return true;
    }
    // §4.9: "Pressing the menu button while the alert icon is present will display the warnings overlay
    // [...]. Pressing the menu button a second time brings up the main menu as normal."
    if (this.overlay) {
      this.overlay = false;
      if (button === 'menu') this.menu.menu(this.menuItems(s), this.knownGases(s));
      return true;
    }
    const gases = this.knownGases(s);
    if (this.menu.open) {
      const items = this.menuItems(s);
      // §2.3 in a menu: MENU "Moves to the next menu item", SELECT "Performs command".
      if (button === 'menu') this.menu.menu(items, gases);
      else if (button === 'select') {
        const g = this.menu.select(items[this.menu.item!], gases, s.breathing);
        if (g !== null) {
          turnGasOn(this.settings, g);
          s.switchGas(g);
        } else if (this.menu.gas === null && items[this.menu.item ?? -1] !== 'Select Gas') this.menu.close();
        // The other menus (Brightness, Dive Tools…) are not simulated: SELECT closes the menu.
      }
      return true;
    }
    switch (button) {
      case 'menu':
        // §4.6: "Pressing the MENU (left) button will return to the home screen at any time."
        if (this.currentScreen() > 0) this.setScreen(0);
        else if (this.persistentAlerts(s, this.lastView ?? this.compute(s)).length) this.overlay = true;
        else this.menu.menu(this.menuItems(s), gases);
        return true;
      case 'select': {
        // §4.6: "When all info screens have been viewed, pressing SELECT again will return to the main screen."
        const n = this.infoPages(s).length;
        this.setScreen((this.currentScreen() + 1) % (n + 1));
        return true;
      }
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      menu: {
        name: 'MENU',
        press: {
          real: { fr: 'Écran principal : menu (ou liste des avertissements si « ! ») ; écran d’info : retour ; menu : élément suivant', en: 'Main screen: menu (or the warnings list when “!”); info screen: back; menu: next item' },
          simulated: true,
          note: { fr: 'seul Select Gas est simulé dans le menu', en: 'only Select Gas is simulated in the menu' },
        },
      },
      select: {
        name: 'SELECT',
        press: { real: { fr: 'Écran principal : écrans d’info ; menu : exécute l’élément', en: 'Main screen: info screens; menu: performs the item' }, simulated: true },
      },
    };
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    const layout = this.settings.layout === 'tec' ? 'tec' : this.settings.layout === 'std' ? 'std' : 'big';
    const pages = this.infoPages(s);
    let screen = this.currentScreen();
    if (screen > pages.length) screen = 0;
    const page = screen > 0 ? pages[screen - 1] : null;
    // §4.6: "the Compass, Tissues and AI Info screens do not automatically time out when active".
    if (page === 'ai' || page === 'tissues') this.setScreen(screen);
    const warn = v.inDive ? this.notices.top : undefined;
    const event = v.inDive ? this.currentEvent(s) : null;
    this.screenAlerts = warn ? [WARNING_TEXT[warn]] : [];
    const persistent = this.persistentAlerts(s, v);
    const menuOpen = this.menu.open;

    // Bottom row (Info row): warning or event (§4.9), menu, info screen, or the home positions.
    let bottom: string | null = null;
    if (warn) bottom = this.banner('WARNING', WARNING_TEXT[warn], 'warn');
    else if (event) bottom = this.banner('INFO', EVENT_TEXT[event], 'info');
    else if (menuOpen) bottom = this.menuRow(s);
    else if (page) bottom = `<div class="p3-row page">${this.infoScreen(page, v, s)}</div>`;

    const alert = persistent.length ? '<span class="p3-tri">!</span>' : '';
    const body = layout === 'tec' ? this.tecBody(v, s, bottom, alert) : this.bigStdBody(v, s, bottom, alert, layout === 'big');
    // §4.9 figure: the warnings overlay covers the middle of the screen.
    const overlay = this.overlay && persistent.length && !warn && !event
      ? `<div class="p3-overlay"><div><span class="p3-tri">!</span> WARNINGS</div>${persistent.map((p) => `<div>▪${p}</div>`).join('')}</div>`
      : '';
    el.innerHTML = this.shell(`<div class="p3-body ${layout}">${body}${overlay}</div>${menuOpen ? this.hints() : ''}`);
  }

  /** The case: titanium bezel, MENU on the left, SELECT on the right (§2.3 figure). No brand drawn. */
  private shell(screen: string): string {
    return `
      <div class="dev p3">
        <div class="p3-case">
          <button class="p3-btn l" data-btn="menu"></button>
          <button class="p3-btn r" data-btn="select"></button>
          <div class="p3-screen ${this.backlit ? 'bright' : ''}">${screen}</div>
        </div>
      </div>`;
  }

  /** §2.4 button hints in a menu: next item (left), select (right). */
  private hints(): string {
    return `<span class="p3-hint l">${this.menu.gas !== null ? 'Next' : 'Next Item'}</span><span class="p3-hint r">Select</span>`;
  }

  /** §4.4 ascent rate: 1 arrow per 3 m/min, white / yellow / flashing red (6 arrows at most). */
  private arrows(v: ComputerView): string {
    const rate = v.inDive ? Math.max(0, v.ascentRate) : 0;
    const n = Math.min(6, Math.ceil(rate / 3 - 1e-9));
    if (n <= 0) return '';
    const cls = rate > 18 ? 'red blink' : rate > 9 ? 'yellow' : '';
    return `<div class="p3-rate ${cls}">${Array.from({ length: n }, () => '<i></i>').join('')}</div>`;
  }

  /** Depth: one decimal in metres, half a foot in feet (Big / Standard, §4.4); whole feet in Tec (§4.5). */
  private depthParts(v: ComputerView, tec: boolean): [string, string] {
    const d = v.inDive ? v.depth : 0;
    if (imperial()) {
      const ft = d * 3.28084;
      if (tec) return [String(Math.round(ft)), ''];
      const half = Math.round(ft * 2) / 2;
      return [String(Math.floor(half)), half % 1 ? '.5' : '.0'];
    }
    const t = depthText(d);
    const [i, dec] = t.includes('.') ? t.split('.') : [t, '0'];
    return [i, `.${dec}`];
  }

  /** Surface interval: minutes and seconds under an hour (§7.1 figure "58m 22s"), hours and minutes, then days beyond 96 h (§4.4). */
  private surfaceInterval(v: ComputerView): string {
    const si = v.surfaceInterval;
    if (si === null) return '--';
    if (si < 3600) return `${Math.floor(si / 60)}${cy('m')} ${Math.floor(si % 60)}${cy('s')}`;
    if (si < 96 * 3600) return `${Math.floor(si / 3600)}${cy('h')} ${Math.floor((si % 3600) / 60)}${cy('m')}`;
    return `${Math.floor(si / 86400)}${cy('d')}`;
  }

  /** Mode badge (§4.4 figures): AIR, NX, 3NX, OC. */
  private modeBadge(): string {
    const txt = { air: 'AIR', nitrox: 'NX', '3gasnx': '3NX', octec: 'OC' }[this.mode];
    return `<span class="p3-badge ${this.mode === 'air' ? 'air' : ''}">${txt}</span>`;
  }

  /** Active gas: "21%" (Air, Nitrox, 3 GasNx) or "18/45" (OC Tec); yellow when a better gas is available, flashing red beyond the PPO2 limits (§4.4). */
  private gasHtml(v: ComputerView, s: DiveSession): string {
    const tec = this.mode === 'octec';
    const g = s.gas;
    const name = tec ? trimixName(g) : `${Math.round(g.o2 * 100)}`;
    const bad = v.inDive && (s.ppO2 < this.lowPpo2 || s.ppO2 > this.ppo2Limit(s, v.inDeco) + 0.03);
    const cls = bad ? 'p3-inv-red blink' : this.betterGas(s) !== null && v.inDive ? 'p3-inv-yellow' : '';
    return `<span class="p3-gas ${cls}">${name}${tec ? '' : cy('%')}</span>`;
  }

  /** PPO2 colour (§13.1): yellow within 0.03 of the limit, flashing red beyond it or below OC Low PPO2. */
  private ppo2Class(v: ComputerView, s: DiveSession): string {
    if (!v.inDive) return '';
    const limit = this.ppo2Limit(s, v.inDeco);
    if (s.ppO2 > limit + 0.03 || s.ppO2 < this.lowPpo2) return 'red blink';
    return s.ppO2 >= limit - 0.03 ? 'yellow' : '';
  }

  private cell(lbl: string, val: string, cls = '', lblCls = ''): string {
    return `<div class="p3-cell ${cls}"><div class="p3-lbl ${lblCls}">${lbl}</div><div class="p3-val">${val}</div></div>`;
  }

  /** @+5: TTS after 5 more minutes at the current depth (§4.7). */
  private at5(v: ComputerView, s: DiveSession): number {
    const t = s.tissues.clone();
    t.expose(depthToPressure(v.depth), s.gas, 5);
    return planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts;
  }

  /** End of dive time (§4.7 EOD): the time of day at the surface if leaving now. */
  private eod(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    const end = new Date(0);
    end.setUTCHours(h, m + (v.inDive ? v.tts : 0));
    return `${end.getUTCHours()}:${String(end.getUTCMinutes()).padStart(2, '0')}`;
  }

  /** §4.7 Screen Element Descriptions: one configurable position. */
  private slot(id: string, v: ComputerView, s: DiveSession): string {
    const u = cy(depthUnit());
    const [, hi] = this.gf;
    const gfCls = v.gf99 > 100 ? 'red' : v.gf99 > hi ? 'yellow' : '';
    switch (id) {
      case 'none': return '<div class="p3-cell"></div>';
      case 'gas': return this.cell(this.mode === 'octec' ? 'O2/He' : 'O2', this.gasHtml(v, s));
      case 'ppo2': return this.cell('PPO2', ppo2Text(s.ppO2), this.ppo2Class(v, s));
      case 't1': {
        if (!v.tank.ai) return this.cell('T1', '----');
        // §11.3: yellow below the reserve, red below the critical pressure.
        const p = v.tank.pressure;
        const pCls = p < this.criticalPressure() ? 'p3-inv-red' : p < this.reservePressure() ? 'p3-inv-yellow' : '';
        return this.cell('T1', `<span class="${pCls}">${pressText(p)}</span><small class="p3-cy p3-vu">${imperial() ? 'PSI' : 'BAR'}</small>`);
      }
      case 'gtr': {
        // §11.3 GTR: "---" at the surface, "deco" once stops are needed, "wait" the first minutes (2 min
        // assumed); yellow at 5 min or less, red at 2 min or less.
        const g = v.tank.gasTime;
        const txt = !v.inDive ? '---' : v.inDeco ? 'deco' : g === null || v.diveTime < 120 ? 'wait' : String(Math.min(99, g));
        const cls = v.inDive && !v.inDeco && g !== null && v.diveTime >= 120 ? (g <= 2 ? 'red' : g <= 5 ? 'yellow' : '') : '';
        return this.cell(`GTR ${cy('T1')}`, txt, cls);
      }
      case 'sac': {
        // §11.3 SAC: "wait" the first minutes of a dive.
        const sac = v.inDive && v.diveTime < 120 ? 'wait' : imperial() ? String(Math.round(v.tank.sacBar * 14.5038)) : v.tank.sacBar.toFixed(1);
        return this.cell(`SAC ${cy('T1')}`, sac);
      }
      case 'max': return this.cell('MAX', `${depthText(v.maxDepth)}${u}`);
      case 'avg': return this.cell('AVG', `${depthText(v.avgDepth)}${u}`);
      case 'avgatm': return this.cell('AvgATM', (depthToPressure(v.avgDepth) / SURFACE_PRESSURE).toFixed(2));
      case 'temp': return this.cell('TEMP', `${Math.round(tempVal(v.temperature))}${cy(tempUnit())}`);
      // §4.7: MOD "Displays in Flashing Red when exceeded".
      case 'mod': return this.cell('MOD', `${Math.floor(imperial() ? v.mod * 3.28084 : v.mod)}${u}`, v.inDive && v.depth > v.mod ? 'red blink' : '');
      // §4.7: CNS yellow above 90 %, red above 150 %.
      case 'cns': return this.cell('CNS', `${Math.round(v.cns)}${cy('%')}`, v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : '');
      case 'rate': {
        // §4.7 Rate: "Numerical rate of ascent or descent. Same colour rules as ascent indicator."
        const r = v.inDive ? v.ascentRate : 0;
        const cls = r > 18 ? 'red blink' : r > 9 ? 'yellow' : '';
        return this.cell('RATE', `${Math.round(Math.abs(imperial() ? r * 3.28084 : r))}${cy(`${depthUnit()}/min`)}`, cls);
      }
      case 'tts': return this.cell('TTS', v.inDive ? String(v.tts) : '--');
      case 'at5': return this.cell('@+5', v.inDive ? String(this.at5(v, s)) : '--');
      case 'd5': {
        const d = v.inDive ? this.at5(v, s) - v.tts : 0;
        return this.cell('Δ+5', v.inDive ? `${d > 0 ? '+' : ''}${d}` : '--');
      }
      // §4.7 CEIL: "not rounded to the next deeper stop increment".
      case 'ceil': return this.cell('CEIL', String(Math.ceil(imperial() ? v.ceiling * 3.28084 : v.ceiling)));
      case 'gf': return this.cell('GF', `${this.gf[0]}/${this.gf[1]}`);
      // §4.7 GF99: yellow above GF high, red above 100 %, "On Gas" while on-gassing; SurfGF takes its colour.
      case 'gf99': return this.cell('GF99', v.inDive && leadingOnGas(s) ? '<small>On Gas</small>' : `${Math.round(v.gf99)}${cy('%')}`, gfCls);
      case 'surfgf': return this.cell('SurfGF', `${Math.round(v.surfGf)}${cy('%')}`, gfCls);
      case 'sgf5': {
        // §4.7 SurfGF +5: "The change in SurfGF if you were to stay at the current depth for 5 more minutes".
        const t = s.tissues.clone();
        t.expose(depthToPressure(v.depth), s.gas, 5);
        const d = v.inDive ? Math.round(t.maxGradientPercent(SURFACE_PRESSURE) - v.surfGf) : 0;
        return this.cell('SGF +5', `${d > 0 ? '+' : ''}${d}${cy('%')}`);
      }
      case 'det': return this.cell('EOD', this.eod(v, s));
      case 'density': {
        // §4.7 Gas Density: yellow at 6.3 g/L in open circuit, no other warning.
        const d = gasDensity(v, s.gas);
        return this.cell('DENSITY', `${d.toFixed(1)}${cy('g/L')}`, d >= 6.3 ? 'yellow' : '');
      }
      case 'clock': {
        const { h, m } = clockOfDay(s);
        const h12 = h % 12 || 12;
        return this.cell('CLOCK', `${h12}:${String(m).padStart(2, '0')}${cy(h < 12 ? 'AM' : 'PM')}`);
      }
      case 'battery': return this.cell('BATTERY', `${BATTERY}${cy('%')}`);
      default: return '<div class="p3-cell"></div>';
    }
  }

  /**
   * Decompression info area (§4.4 Big / Standard): NDL, deco stop, safety stop, CLEAR counter. Big: "N D L"
   * written down the left of large digits; Standard: the label above (figures of §2.3 and §7.2).
   */
  private decoArea(v: ComputerView, s: DiveSession, big: boolean): string {
    const st = v.safety.state;
    const stopTxt = (cls: string) => `<span class="${cls}">${Math.round(imperial() ? v.stopDepth * 3.28084 : v.stopDepth)}${cy(depthUnit())} ${v.stopTime}${cy('min')}</span>`;
    if (v.inDive && v.inDeco) {
      // §5.2: "If you ascend shallower than your current stop, the decompression information will flash
      // red" (from the ceiling, see violationRef); §4.4 / §7.2 figures: "Deco" on red.
      const cls = v.ceilingViolation === 2 ? 'red blink' : '';
      return `<div class="p3-deco"><div class="p3-tag red">Deco</div><div class="p3-dv stop">${stopTxt(cls)}</div></div>`;
    }
    if (v.inDive && this.hasSafetyStop && (st === 'active' || st === 'paused')) {
      // §5.1 figures: SAFETY on green with the countdown in green; paused: PAUSED, remaining time in yellow.
      // Count Up counts from zero; after a deco stop it shows as the CLEAR counter (§7.2 figure 11).
      const up = this.settings.safety === 'cntup';
      const rem = up ? (this.countUpFrom !== null ? s.clock - this.countUpFrom : 0) : Math.max(0, Math.ceil(v.safety.remaining));
      const lbl = st === 'paused' ? 'PAUSED' : up && this.hadDeco ? 'CLEAR' : 'SAFETY';
      return `<div class="p3-deco"><div class="p3-tag ${st === 'paused' ? 'yellow' : 'green'}">${lbl}</div><div class="p3-dv ${st === 'paused' ? 'yellow' : 'green'}">${mmss(rem)}</div></div>`;
    }
    if (v.inDive && this.hasSafetyStop && st === 'done') {
      // §5.1: "When the countdown reaches zero, the display changes to "Clear"".
      return `<div class="p3-deco"><div class="p3-tag green">SAFETY</div><div class="p3-dv green word">CLEAR</div></div>`;
    }
    if (v.inDive && this.clearedAt !== null && this.mode === 'octec') {
      // §4.4 Deco Clear Counter (OC Tec): counts up from zero; §5.2: "If the Deco Clear Counter is turned
      // off, the display will say "Clear"".
      const c = Math.floor(s.clock - this.clearedAt);
      if (this.settings.clearCntr === 'off') return `<div class="p3-deco"><div class="p3-tag green">CLEAR</div><div class="p3-dv green word">Clear</div></div>`;
      return `<div class="p3-deco"><div class="p3-tag green">CLEAR</div><div class="p3-dv green">${mmss(c)}</div></div>`;
    }
    // §4.4 NDL: "Displays in Yellow when the NDL is less than the low NDL limit (Default 5 minutes)"
    // (figure: yellow background); "--" at the surface.
    const ndlA = this.alertValue('ndlAlert') ?? 5;
    const low = v.inDive && v.ndl <= ndlA;
    const val = v.inDive ? String(Math.min(99, v.ndl)) : '--';
    if (big) return `<div class="p3-deco big"><div class="p3-vlbl">N<br>D<br>L</div><div class="p3-dv ndl ${low ? 'p3-inv-yellow' : ''}">${val}</div></div>`;
    return `<div class="p3-deco"><div class="p3-tag cyan">NDL</div><div class="p3-dv ${low ? 'yellow' : ''}">${val}${v.inDive ? cy('min') : ''}</div></div>`;
  }

  /** §4.4 Nitrogen loading bar: "scaled such that it is full once decompression stops will be needed" (colours deduced from the figures). */
  private n2Bar(v: ComputerView): string {
    const pct = Math.max(0, Math.min(100, v.n2Load));
    return `<div class="p3-n2"><i style="height:${pct.toFixed(0)}%"></i><span>N₂</span></div>`;
  }

  /** Big and Standard layouts (§4.3, §4.4): basic dive info, deco info, configurable slot, Info row. */
  private bigStdBody(v: ComputerView, s: DiveSession, bottom: string | null, alert: string, big: boolean): string {
    const [di, dd] = this.depthParts(v, false);
    const depthA = this.alertValue('depthAlert');
    const depthCls = v.inDive && depthA !== null && v.depth > depthA ? 'yellow' : '';
    const timeA = this.alertValue('timeAlert');
    const timeCls = v.inDive && timeA !== null && v.diveTime > timeA * 60 ? 'yellow' : '';
    const t = Math.floor(v.diveTime);
    const time = v.inDive
      ? `${big ? '' : '<div class="p3-tag cyan sm">TIME</div>'}<div class="p3-time ${timeCls}">${Math.floor(t / 60)}<small>:${String(t % 60).padStart(2, '0')}</small></div>`
      : `<div class="p3-tag cyan sm">SURFACE</div><div class="p3-time surf">${this.surfaceInterval(v)}<span class="p3-batt"><i style="height:${BATTERY}%"></i></span></div>`;
    const info = bottom ?? `<div class="p3-row"><div class="p3-gascell">${this.gasHtml(v, s)}${this.modeBadge()}</div>${this.slot(this.settings.infoC || 'max', v, s)}${this.slot(this.settings.infoR || 'temp', v, s)}</div>`;
    return `
      <div class="p3-left">
        <div class="p3-depth ${depthCls}"><span class="i">${di}</span><span class="d">${dd}<em>${depthUnit()}</em></span></div>
        ${this.arrows(v)}
        ${time}
        ${alert}
      </div>
      <div class="p3-right">
        ${this.decoArea(v, s, big)}
        ${this.n2Bar(v)}
        <div class="p3-slot">${this.slot(this.settings.slot || 'clock', v, s)}</div>
      </div>
      <div class="p3-info">${info}</div>`;
  }

  /**
   * Tec layout (§4.5): top row DEPTH, TIME (dive time in minutes, the seconds drawn as a bar under the
   * word TIME), NDL / DECO / SURFACE / CLEAR; centre row (3 positions); bottom row (mode, 2 positions).
   */
  private tecBody(v: ComputerView, s: DiveSession, bottom: string | null, alert: string): string {
    const [di] = this.depthParts(v, true);
    const d = imperial() ? di : depthText(v.inDive ? v.depth : 0);
    const t = Math.floor(v.diveTime);
    const secBar = v.inDive ? `<i class="p3-secbar" style="width:${((t % 60) / 60 * 100).toFixed(0)}%"></i>` : '';
    let rLbl = 'NDL';
    let rVal: string;
    let rCls = '';
    let lblCls = '';
    const st = v.safety.state;
    if (!v.inDive) {
      rLbl = 'SURFACE';
      const si = v.surfaceInterval;
      rVal = si === null ? '--' : si < 4 * 86400 ? `${Math.floor(si / 3600)}${cy('h')}${Math.floor((si % 3600) / 60)}${cy('min')}` : `${Math.floor(si / 86400)}${cy('d')}`;
    } else if (v.inDeco) {
      // §4.5: "Decompression information will Flash Red if you ascend shallower than the current stop"
      // (figure: the digits on red).
      rLbl = 'DECO';
      const fl = v.ceilingViolation === 2 ? 'p3-inv-red blink' : '';
      rVal = `<span class="${fl}">${Math.round(imperial() ? v.stopDepth * 3.28084 : v.stopDepth)}</span>${cy(depthUnit())}<span class="${fl}">${v.stopTime}</span>${cy('min')}`;
    } else if (this.hasSafetyStop && (st === 'active' || st === 'paused' || st === 'done')) {
      const up = this.settings.safety === 'cntup';
      const rem = up ? (this.countUpFrom !== null ? s.clock - this.countUpFrom : 0) : Math.max(0, Math.ceil(v.safety.remaining));
      rLbl = st === 'paused' ? 'PAUSED' : up && this.hadDeco ? 'CLEAR' : 'SAFETY';
      lblCls = st === 'paused' ? 'p3-inv-yellow' : 'p3-inv-green';
      rVal = st === 'done' ? 'CLEAR' : mmss(rem);
      rCls = st === 'paused' ? 'yellow' : 'green';
    } else if (this.clearedAt !== null && this.mode === 'octec') {
      // §4.5 Deco Clear Counter (figure: CLEAR on green, the counter in green).
      rLbl = 'CLEAR';
      lblCls = 'p3-inv-green';
      rCls = 'green';
      rVal = this.settings.clearCntr === 'off' ? 'Clear' : mmss(Math.floor(s.clock - this.clearedAt));
    } else {
      const ndlA = this.alertValue('ndlAlert') ?? 5;
      rVal = String(Math.min(99, v.ndl));
      rCls = v.ndl <= ndlA ? 'yellow' : '';
    }
    const depthA = this.alertValue('depthAlert');
    const timeA = this.alertValue('timeAlert');
    const top = `<div class="p3-trow top">
      <div class="p3-cell l ${v.inDive && depthA !== null && v.depth > depthA ? 'yellow' : ''}"><div class="p3-lbl">DEPTH</div><div class="p3-val">${d}</div></div>
      ${this.arrows(v)}
      <div class="p3-cell ${v.inDive && timeA !== null && v.diveTime > timeA * 60 ? 'yellow' : ''}"><div class="p3-lbl tm">TIME${secBar}</div><div class="p3-val">${v.inDive ? Math.floor(t / 60) : ''}</div></div>
      <div class="p3-cell r ${rCls}"><div class="p3-lbl ${lblCls}">${rLbl}</div><div class="p3-val ${rLbl === 'DECO' || rLbl === 'SURFACE' || /[A-Za-z]{4}/.test(rVal) ? 'sm' : ''}">${rVal}</div></div>
    </div>`;
    const centre = `<div class="p3-trow mid">${this.slot(this.settings.tecL || 'none', v, s)}${this.slot(this.settings.tecC || 'ppo2', v, s)}${this.slot(this.settings.tecR || 'none', v, s)}</div>`;
    const bot = bottom ?? `<div class="p3-row">${this.slot(this.settings.tecB1 || 'gas', v, s)}${this.slot(this.settings.tecB2 || 'tts', v, s)}</div>`;
    return `${top}${centre}<div class="p3-trow bot"><div class="p3-modecell">${alert}${this.modeBadge()}</div>${bot}</div>`;
  }

  /** §4.9 banner: "WARNING" (yellow) or "INFO" (cyan) over the message, in the bottom row (figures). */
  private banner(kind: string, text: string, cls: string): string {
    return `<div class="p3-banner ${cls}"><div class="k">${kind}</div><div class="t">${text}</div></div>`;
  }

  /** §12.1 menu (figures): the item in the bottom row; Select Gas lists the gases, "ACT" before the active one. */
  private menuRow(s: DiveSession): string {
    if (this.menu.gas !== null) {
      const g = this.knownGases(s)[this.menu.gas];
      const i = this.menu.gas;
      const state = i === s.breathing ? 'ACT' : this.gasOff(i) ? 'OFF' : 'ON';
      const name = this.mode === 'octec' ? trimixName(g) : `${Math.round(g.o2 * 100)}%`;
      return `<div class="p3-menu"><div class="p3-menu-title">Select Gas</div><div class="sel ${state === 'OFF' ? 'off' : ''}">${i + 1} <small>${state}</small> ${name}</div></div>`;
    }
    const items = this.menuItems(s);
    const i = this.menu.item ?? 0;
    return `<div class="p3-menu"><div class="sel">${items[i]}</div><div class="dim">${items[i + 1] ?? ''}</div></div>`;
  }

  /** §4.6 / §4.7 info screens (figures of §4.6). */
  private infoScreen(page: InfoPage, v: ComputerView, s: DiveSession): string {
    const u = cy(depthUnit());
    switch (page) {
      case 'last': {
        // §4.7 Last Dive: maximum depth and dive time of the last dive (figure "LAST DIVE 52.0m 52m38s").
        const d = s.log[s.log.length - 1];
        const sec = Math.round(d.duration);
        return this.cell('LAST DIVE', `${depthText(d.maxDepth)}${u}&nbsp; ${Math.floor(sec / 60)}${cy('m')}${String(sec % 60).padStart(2, '0')}${cy('s')}`);
      }
      case 'ai': return this.slot('t1', v, s) + this.slot('gtr', v, s) + this.slot('sac', v, s);
      case 'maxavg': return this.slot('max', v, s) + this.slot('avg', v, s);
      case 'cns': return this.slot('cns', v, s) + this.slot('mod', v, s) + this.slot('ppo2', v, s);
      case 'gf': return this.slot('gf', v, s) + this.slot('gf99', v, s) + this.slot('tts', v, s);
      case 'tissues': return `<div class="p3-tissues"><div class="p3-lbl">TISSUES</div>${this.tissueBars(s)}</div>`;
      case 'temp': return this.slot('temp', v, s) + this.slot('battery', v, s);
      case 'mbar':
        // §4.7 Pressure: surface and current pressure in millibars.
        return `<div class="p3-cell"><div class="p3-lbl">PRESSURE mBar</div><div class="p3-val mbar">${cy('SURF')}1013 ${cy('NOW')}${Math.round(s.pressure * 1000)}</div></div>`;
      case 'date': {
        const { h, m } = clockOfDay(s);
        return this.cell('DATE', '03-Mar-26') + this.cell('CLOCK', `${h}:${String(m).padStart(2, '0')}`);
      }
    }
  }

  /**
   * §4.7 tissues bar graph: fastest compartment on top, inert gas tensions growing to the right; cyan line:
   * inspired inert gas pressure, yellow: ambient pressure, red: M-value; yellow above ambient, red above the
   * M-value; each bar on its own scale.
   */
  private tissueBars(s: DiveSession): string {
    const t = s.tissues;
    const amb = s.pressure;
    const inspired = (amb - 0.0627) * (1 - s.gas.o2);
    const bars = Array.from({ length: 16 }, (_, i) => {
      const [a, b] = t.coefficients(i);
      const m = amb / b + a;
      const p = t.n2[i] + t.he[i];
      const cls = p > m ? 'red' : p > amb ? 'yellow' : '';
      return `<i class="${cls}" style="width:${Math.min(100, (p / m) * 100).toFixed(1)}%"></i>`;
    }).join('');
    const [a8, b8] = t.coefficients(8);
    const m8 = amb / b8 + a8;
    const pos = (x: number) => `${Math.min(100, x * 100).toFixed(1)}%`;
    return `<div class="p3-tbars">${bars}<b class="cy" style="left:${pos(inspired / m8)}"></b><b class="ye" style="left:${pos(amb / m8)}"></b><b class="re" style="left:100%"></b></div>`;
  }
}

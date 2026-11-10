import { depthToPressure, planAscent } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthText, depthUnit, imperial, pressText, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, leadingOnGas } from '../../base';
import { bestGas, gasDensity, nxName, trimixName, turnGasOn } from '../multigas';
import { TericRules, type TericEvent, type TericWarning } from './rules';

/** §15.1 warning texts, as on the figures ("TI CRITICAL" / "TI LOW PRESS": T1 with the device font). */
const WARNING_TEXT: Record<TericWarning, string> = {
  'low-ppo2': 'LOW PPO2',
  'high-ppo2': 'HIGH PPO2',
  'missed-stop': 'MISSED STOP',
  'fast-ascent': 'FAST ASCENT',
  'very-high-cns': 'VERY HIGH CNS',
  'high-cns': 'HIGH CNS',
  'critical-pres': 'T1 CRITICAL',
  'low-pres': 'T1 LOW PRESS',
  'deco-needed': 'DECO NEEDED',
  'low-ndl': 'LOW NDL',
};
/** §3.8, §4.1, §4.2 dive event texts (figures). */
const EVENT_TEXT: Record<TericEvent, string> = { 'dive-started': 'Dive Started', 'safety-stop': 'Safety Stop', 'deco-clear': 'Deco Clear' };

/** §3.5 info screens, in the order of the figure (compass not simulated). */
type InfoPage = 'last' | 'ai' | 'maxavg' | 'cns' | 'gf' | 'ceil' | 'tissues' | 'temp' | 'mbar' | 'time';

/** §10.1 main menu of the OC Rec and OC Tec modes ("Items in blue cells are only available at the surface"). */
const MENU_SURFACE = ['Watch', 'Select Gas', 'Dive Tools', 'Edit Gases', 'Alerts', 'Log', 'Bluetooth', 'Settings', 'Off', 'Home'];
const MENU_DIVE = ['Select Gas', 'Dive Tools', 'Edit Gases', 'Alerts', 'Home'];

/** Fictitious battery level (not simulated). */
const BATTERY = 49;

const cy = (t: string) => `<small class="tr-cy">${t}</small>`;
/** PPO2 as on the figures: ".21", "1.23". */
const ppo2Text = (p: number) => p.toFixed(2).replace(/^0/, '');

/** Shearwater Teric: four buttons and a round AMOLED display, after the manual (rules in rules.ts). */
export class ShearwaterTeric extends TericRules {
  /** §10.1 main menu: item highlighted (index in the list of the moment), null when closed. */
  private menuItem: number | null = null;
  /** Select Gas: entry highlighted (index in the sorted list, the last being Back), null when closed. */
  private gasItem: number | null = null;
  private menuAt = 0;
  /** §3.8 warnings overlay (MENU while the alert indicator is shown). */
  private overlay = false;

  private menuItems(s: DiveSession): string[] {
    return s.inDive ? MENU_DIVE : MENU_SURFACE;
  }

  /** Select Gas list: gases sorted by O2 (figure of §6.3: "50/00", "ACT 21/00", "14/55", "Back"). */
  private gasOrder(s: DiveSession): number[] {
    const g = this.knownGases(s);
    return g.map((_, i) => i).sort((a, b) => g[b].o2 - g[a].o2 || a - b);
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
      'maxavg', 'cns', 'gf', 'ceil', 'tissues', 'temp', 'mbar', 'time',
    ];
  }

  /** Opens Select Gas with the best gas pointed (§6.3: "The best gas will already be the initial selection"). */
  private openSelectGas(s: DiveSession): void {
    const order = this.gasOrder(s);
    this.gasItem = Math.max(0, order.indexOf(this.betterGas(s) ?? s.breathing));
    this.menuItem = this.menuItems(s).indexOf('Select Gas');
    this.menuAt = performance.now();
  }

  private closeMenu(): void {
    this.menuItem = null;
    this.gasItem = null;
  }

  press(button: string, s: DiveSession): boolean {
    // §3.8: "Dive Events time out after 4 seconds or can be cleared by pressing any button"; "Press any
    // button to acknowledge and clear a warning".
    if (this.notices.dismiss()) return true;
    if (this.event) {
      this.event = null;
      return true;
    }
    // Menus time out after 10 s without a press (as the other Shearwater models, not stated).
    if (this.menuItem !== null && performance.now() - this.menuAt > 10_000) this.closeMenu();
    // §3.8: "Pressing the menu button while the alert icon is present will display the warnings overlay
    // [...]. Pressing the menu button a second time brings up the main menu as normal."
    if (this.overlay) {
      this.overlay = false;
      if (button === 'menu') {
        this.menuItem = 0;
        this.menuAt = performance.now();
      }
      return true;
    }
    // §2.2 in a menu: LIGHT up, MENU down, FUNC select, INFO back / home.
    if (this.menuItem !== null) {
      this.menuAt = performance.now();
      if (this.gasItem !== null) {
        const order = this.gasOrder(s);
        const n = order.length + 1; // the gases, then Back
        if (button === 'menu') this.gasItem = (this.gasItem + 1) % n;
        else if (button === 'light') this.gasItem = (this.gasItem + n - 1) % n;
        else if (button === 'info') this.gasItem = null;
        else if (button === 'func') {
          const g = order[this.gasItem];
          if (g !== undefined) {
            turnGasOn(this.settings, g);
            s.switchGas(g);
          }
          this.closeMenu();
        }
        return true;
      }
      const items = this.menuItems(s);
      if (button === 'menu') this.menuItem = (this.menuItem + 1) % items.length;
      else if (button === 'light') this.menuItem = (this.menuItem + items.length - 1) % items.length;
      else if (button === 'info') this.closeMenu();
      else if (button === 'func') {
        const item = items[this.menuItem];
        if (item === 'Select Gas') this.openSelectGas(s);
        else if (item === 'Home') this.closeMenu();
        // The other menus (Dive Tools, Edit Gases, Alerts…) are not simulated.
      }
      return true;
    }
    switch (button) {
      case 'menu':
        // §3.5: "Pressing the MENU (bottom left) button will also return to the home screen at any time."
        if (this.currentScreen() > 0) this.setScreen(0);
        else if (this.persistentAlerts(s, this.lastView ?? this.compute(s)).length) this.overlay = true;
        else {
          this.menuItem = 0;
          this.menuAt = performance.now();
        }
        return true;
      case 'info': {
        // §3.5: "When all info screens have been viewed, pressing INFO again will return to the main screen."
        const n = this.infoPages(s).length;
        this.setScreen((this.currentScreen() + 1) % (n + 1));
        return true;
      }
      case 'light':
        // §2.2: "From the main screen > Cycles brightness levels".
        this.backlightUntil = this.backlit ? 0 : performance.now() + 30_000;
        return true;
      case 'func':
        // §2.5: configurable shortcut (Select Gas assumed, one of the options of §11.1).
        this.openSelectGas(s);
        return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      light: {
        name: 'LIGHT',
        press: { real: { fr: 'Écran principal : niveaux de luminosité ; menu : élément précédent (UP)', en: 'Main screen: brightness levels; menu: previous item (UP)' }, simulated: true },
      },
      func: {
        name: 'FUNC',
        press: {
          real: { fr: 'Écran principal : raccourci réglable (§2.5) ; menu : sélectionne (SELECT)', en: 'Main screen: configurable shortcut (§2.5); menu: selects (SELECT)' },
          simulated: true,
          note: { fr: 'raccourci réglé sur Select Gas (supposé)', en: 'shortcut set to Select Gas (assumed)' },
        },
      },
      menu: {
        name: 'MENU',
        press: {
          real: { fr: 'Écran principal : menu (ou liste des avertissements si « ! ») ; écran d’info : retour ; menu : élément suivant (DOWN)', en: 'Main screen: menu (or the warnings list when “!”); info screen: back; menu: next item (DOWN)' },
          simulated: true,
          note: { fr: 'seul Select Gas est simulé dans le menu', en: 'only Select Gas is simulated in the menu' },
        },
      },
      info: {
        name: 'INFO',
        press: { real: { fr: 'Écran principal : écrans d’info ; menu : retour (BACK / HOME)', en: 'Main screen: info screens; menu: back (BACK / HOME)' }, simulated: true },
      },
    };
  }

  private lastView: ComputerView | null = null;

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    if (this.menuItem !== null && performance.now() - this.menuAt > 10_000) this.closeMenu();
    const std = this.settings.layout === 'std';
    const pages = this.infoPages(s);
    let screen = this.currentScreen();
    if (screen > pages.length) screen = 0;
    const page = screen > 0 ? pages[screen - 1] : null;
    // §3.5: "When using the Standard layout, the AI, compass, and Tissues Info screens do not automatically time out."
    if (std && (page === 'ai' || page === 'tissues')) this.setScreen(screen);
    const warn = v.inDive ? this.notices.top : undefined;
    const event = v.inDive ? this.currentEvent(s) : null;
    this.screenAlerts = warn ? [WARNING_TEXT[warn]] : [];
    const persistent = this.persistentAlerts(s, v);

    // Info row: warning or event banner (§3.8), menu, warnings overlay, info screen, or the home page.
    let infoRow: string;
    if (warn) infoRow = this.banner('WARNING', WARNING_TEXT[warn], 'warn');
    else if (event) infoRow = this.banner('INFO', EVENT_TEXT[event], 'info');
    else if (this.menuItem !== null) infoRow = this.menuRow(s);
    else if (page) infoRow = this.infoScreen(page, v, s);
    else infoRow = std ? this.stdInfoHome(v, s) : this.decoCells(v, s);

    const top = this.topRow(v, std);
    const time = this.bottomTime(v, persistent.length > 0);
    // §3.4 "Alternate Active Gas [...] Location": at the very bottom when the info row does not show the gas.
    const infoShowsGas = std && !page && !warn && !event && this.menuItem === null && this.showsGasInStdInfo();
    const gasLine = !infoShowsGas ? `<div class="tr-gasline">${this.gasHtml(v, s, true)}</div>` : '';
    const body = std
      ? `${top}<div class="tr-rule r1"></div><div class="tr-row deco">${this.decoCells(v, s)}</div><div class="tr-rule r2"></div><div class="tr-row info std">${infoRow}</div><div class="tr-rule r3"></div>${time}${gasLine}`
      : `${top}<div class="tr-rule b1"></div><div class="tr-row info big">${infoRow}</div><div class="tr-rule b2"></div>${time}${gasLine}`;
    // §3.8 figure: the warnings overlay covers the middle of the screen, between depth and dive time.
    const overlay = this.overlay && persistent.length && !warn && !event
      ? `<div class="tr-overlay"><div><span class="tr-tri">!</span> WARNINGS</div>${persistent.map((p) => `<div>•${p}</div>`).join('')}</div>`
      : '';
    el.innerHTML = this.shell(`<div class="tr-body ${std ? 'std' : 'big'}">${body}${overlay}</div>${this.menuItem !== null ? this.hints() : ''}`);
  }

  /** The case: round bezel, LIGHT / MENU on the left, FUNC / INFO on the right (§2.2). */
  private shell(screen: string): string {
    return `
      <div class="dev tr">
        <div class="tr-case">
          <button class="tr-btn tl" data-btn="light"></button>
          <button class="tr-btn bl" data-btn="menu"></button>
          <button class="tr-btn tr" data-btn="func"></button>
          <button class="tr-btn br" data-btn="info"></button>
          <div class="tr-screen ${this.backlit ? 'bright' : ''}">${screen}</div>
        </div>
      </div>`;
  }

  /** §2.2 button hints in a menu (figure): UP, SELECT, DOWN, HOME / BACK next to their buttons. */
  private hints(): string {
    return `<span class="tr-hint tl">▲</span><span class="tr-hint tr">◉</span><span class="tr-hint bl">▼</span><span class="tr-hint br">${this.gasItem !== null ? '↶' : '⌂'}</span>`;
  }

  /**
   * §3.4 top row: depth with one decimal (unit in cyan under the decimals), ascent rate (1 arrow per 3
   * m/min with its value, white / yellow / flashing red), battery and dive mode at the surface.
   */
  private topRow(v: ComputerView, std: boolean): string {
    const d = depthText(v.inDive ? v.depth : 0);
    const [int, dec] = d.includes('.') ? d.split('.') : [d, ''];
    const rate = v.inDive ? Math.max(0, v.ascentRate) : 0;
    const n = Math.min(6, Math.ceil(rate / 3 - 1e-9));
    const cls = rate > 18 ? 'red blink' : rate > 9 ? 'yellow' : '';
    const arrows = n > 0
      ? `<div class="tr-rate ${cls}"><svg viewBox="0 0 12 36">${Array.from({ length: n }, (_, i) => `<path d="M1 ${33 - i * 6} L6 ${29 - i * 6} L11 ${33 - i * 6}"/>`).join('')}</svg><span>${Math.round(rate)}</span></div>`
      : '';
    const surface = !v.inDive;
    const mode = this.mode === 'octec' ? 'Tec' : 'Rec';
    return `<div class="tr-top ${std ? 'std' : 'big'}">
      ${surface ? `<div class="tr-batt"><i style="width:${BATTERY}%"></i></div><div class="tr-mode"><b>OC</b>${mode}</div>` : ''}
      <div class="tr-depth"><span class="i">${int}</span><span class="d">${dec ? `.${dec}` : ''}<em>${depthUnit()}</em></span></div>
      ${arrows}
    </div>`;
  }

  /** Bottom row: dive time (minutes and seconds), or SURFACE and the surface interval; alert indicator on its left. */
  private bottomTime(v: ComputerView, alert: boolean): string {
    const icon = alert ? '<span class="tr-tri big">!</span>' : '';
    if (!v.inDive) {
      // §3.4: minutes and seconds, then hours and minutes above one hour, then days above 4 days.
      const si = v.surfaceInterval;
      let val = '-- --';
      if (si !== null) {
        if (si < 3600) val = `${Math.floor(si / 60)}${cy('m')} ${Math.floor(si % 60)}${cy('s')}`;
        else if (si < 4 * 86400) val = `${Math.floor(si / 3600)}${cy('h')} ${Math.floor((si % 3600) / 60)}${cy('m')}`;
        else val = `${Math.floor(si / 86400)}${cy('d')}`;
      }
      // §6.1 figure: the alert notification icon on the left at the surface.
      const kind = { both: '((•))', beep: '♪', vib: '((•))', off: '✕' }[this.settings.alerts] ?? '';
      return `<div class="tr-time surf"><span class="tr-alerticon">${kind}</span><div class="tr-surf-lbl">SURFACE</div><div class="tr-surf-val">${val}</div></div>`;
    }
    const t = Math.floor(v.diveTime);
    return `<div class="tr-time">${icon}<span class="m">${Math.floor(t / 60)}</span><span class="s">:${String(t % 60).padStart(2, '0')}</span></div>`;
  }

  /** Active gas: "21%" (OC Rec) or "18/45" (OC Tec); yellow when a better gas is available, flashing red beyond the PPO2 limits (§3.4, §11.1). */
  private gasHtml(v: ComputerView, s: DiveSession, withTank: boolean): string {
    const tec = this.mode === 'octec';
    const g = s.gas;
    const name = tec ? trimixName(g) : `${Math.round(g.o2 * 100)}`;
    const limit = this.ppo2Limit(s, v.inDeco);
    const bad = v.inDive && (s.ppO2 < this.lowPpo2 || s.ppO2 > limit + 0.03);
    const cls = bad ? 'red blink' : this.betterGas(s) !== null && v.inDive ? 'better' : '';
    return `${withTank ? '<span class="tr-tank"></span>' : ''}<span class="tr-gas ${cls}">${name}${tec ? '' : cy('%')}</span>`;
  }

  /** PPO2 colour: yellow within 0.03 of the limit, flashing red beyond it or below OC Low PPO2 (§11.1). */
  private ppo2Class(v: ComputerView, s: DiveSession): string {
    if (!v.inDive) return '';
    const limit = this.ppo2Limit(s, v.inDeco);
    if (s.ppO2 > limit + 0.03 || s.ppO2 < this.lowPpo2) return 'red blink';
    return s.ppO2 >= limit - 0.03 ? 'yellow' : '';
  }

  private cell(lbl: string, val: string, cls = '', lblCls = ''): string {
    return `<div class="tr-cell ${cls}"><div class="tr-lbl ${lblCls}">${lbl}</div><div class="tr-val">${val}</div></div>`;
  }

  /**
   * NDL / DECO / SAFETY / CLEAR and TTS (§3.4 "The Deco Row", §4.1, §4.2): the Deco row of the Standard
   * layout, the home page of the Info row in the Big layout.
   */
  private decoCells(v: ComputerView, s: DiveSession): string {
    const tts = v.inDive ? String(v.tts) : '--';
    let left: string;
    const st = v.safety.state;
    if (!v.inDive) {
      left = this.cell(this.mode === 'octec' ? 'DECO' : 'NDL', this.mode === 'octec' ? `--${cy(depthUnit())} -${cy('min')}` : '--');
    } else if (v.inDeco) {
      // §4.2: shallower than the stop but below the ceiling: yellow; above the ceiling: flashing red. "In
      // OC Rec mode, the deco stop label appears in red".
      const cls = v.depth < v.ceiling - 0.05 ? 'red blink' : v.depth < v.stopDepth - 0.05 ? 'yellow' : '';
      left = this.cell('DECO', `<span class="${cls}">${Math.round(imperial() ? v.stopDepth * 3.28084 : v.stopDepth)}${cy(depthUnit())} ${v.stopTime}${cy('min')}</span>`, '', this.mode === 'ocrec' ? 'red' : '');
    } else if (this.hasSafetyStop && (st === 'active' || st === 'paused')) {
      // §4.1 figures: SAFETY on green with the countdown in green; paused: yellow. Count Up counts from 0.
      const rem = this.settings.safety === 'cntup' && this.countUpFrom !== null ? s.clock - this.countUpFrom : Math.max(0, Math.ceil(v.safety.remaining));
      const txt = `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`;
      left = this.cell('SAFETY', txt, st === 'paused' ? 'yellow' : 'green', st === 'paused' ? 'inv-yellow' : 'inv-green');
    } else if (this.hasSafetyStop && st === 'done') {
      left = this.cell('SAFETY', 'CLEAR', 'green', 'inv-cyan');
    } else if (this.mode === 'octec' && this.clearedAt !== null) {
      // §3.4 Deco Clear Counter: "counts up from zero"; "If safety stops or the Deco Clear Counter is
      // turned off, the display will say "Clear"".
      const c = Math.floor(s.clock - this.clearedAt);
      left = this.settings.clearCntr === 'off'
        ? this.cell('DECO', 'Clear', 'green')
        : this.cell('CLEAR', `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`, 'green', 'inv-green');
    } else if (this.mode === 'octec') {
      // §6.2 figure 5: in OC Tec the Deco box shows the NDL before any stop.
      left = this.cell('NDL', String(Math.min(99, v.ndl)), v.ndl < 5 ? 'yellow' : '');
    } else {
      // §3.4: "Displays in Yellow when the NDL is less than 5 minutes."
      left = this.cell('NDL', String(Math.min(99, v.ndl)), v.ndl < 5 ? 'yellow' : '');
    }
    // §3.7: In OC Rec mode, right slot of the Deco row is customizable (TTS by default).
    const rightChoice = this.mode === 'octec' ? 'tts' : (this.settings.decoRight || 'tts');
    const right = rightChoice === 'tts' ? this.cell('TTS', tts) : this.customCell(rightChoice, v, s);
    return left + right;
  }

  /** §3.4: True when the standard layout home info row contains the active gas. */
  private showsGasInStdInfo(): boolean {
    const row = this.settings.infoRow || 'default';
    if (row === 'ai' || row === 'deco') return false;
    if (row === 'custom') {
      return (this.settings.infoL || 'gas') === 'gas' || this.settings.infoC === 'gas' || (this.settings.infoR || 'ppo2') === 'gas';
    }
    return true;
  }

  /**
   * Standard layout home Info row (§3.4 figures, §3.7): customizable with 1, 2 or 3 items,
   * O2 and PPO2 in OC Rec by default, O2/He and PPO2 in OC Tec by default.
   */
  private stdInfoHome(v: ComputerView, s: DiveSession): string {
    const row = this.settings.infoRow || 'default';
    if (row === 'ai') {
      return this.customCell('t1', v, s) + this.customCell('sac', v, s) + this.customCell('gtr', v, s);
    }
    if (row === 'deco') {
      return this.customCell('gf99', v, s) + this.customCell('surfgf', v, s) + this.customCell('ceil', v, s);
    }
    if (row === 'custom') {
      const slots = [this.settings.infoL || 'gas', this.settings.infoC || 'none', this.settings.infoR || 'ppo2'];
      const cells = slots.filter((slot) => slot !== 'none').map((slot) => this.customCell(slot, v, s));
      return cells.join('') || this.cell('&nbsp;', '&nbsp;');
    }
    const tec = this.mode === 'octec';
    return this.cell(tec ? 'O2/He' : 'O2', this.gasHtml(v, s, false)) + this.cell('PPO2', ppo2Text(s.ppO2), this.ppo2Class(v, s));
  }

  /**
   * §3.7: Renders a cell for a customizable position in the Home screen (Info row or Deco/Big row).
   */
  private customCell(id: string, v: ComputerView, s: DiveSession): string {
    const u = cy(depthUnit());
    switch (id) {
      case 'gas': {
        const tec = this.mode === 'octec';
        return this.cell(tec ? 'O2/He' : 'O2', this.gasHtml(v, s, false));
      }
      case 'ppo2':
        return this.cell('PPO2', ppo2Text(s.ppO2), this.ppo2Class(v, s));
      case 't1': {
        if (!v.tank.ai) return this.cell('T1', '---');
        const p = v.tank.pressure;
        const pCls = p < this.criticalPressure() ? 'inv-red' : p < this.reservePressure() ? 'inv-yellow' : '';
        const unit = `<small class="tr-cy tr-vu">${imperial() ? 'PSI' : 'BAR'}</small>`;
        return this.cell('T1', `<span class="${pCls}">${pressText(p)}</span>${unit}`);
      }
      case 'sac': {
        const sac = !v.inDive || v.diveTime < 120 ? 'wait' : imperial() ? String(Math.round(v.tank.sacBar * 14.5038)) : v.tank.sacBar.toFixed(1);
        return this.cell('SAC', sac);
      }
      case 'gtr': {
        const gtr = !v.inDive ? '---' : v.inDeco ? 'deco' : v.tank.gasTime === null || v.diveTime < 120 ? 'wait' : String(Math.min(99, v.tank.gasTime));
        return this.cell('GTR', gtr);
      }
      case 'max':
        return this.cell('MAX', `${depthText(v.maxDepth)}${u}`);
      case 'avg':
        return this.cell('AVG', `${depthText(v.avgDepth)}${u}`);
      case 'cns': {
        const cns = Math.round(v.cns);
        return this.cell('CNS', `${cns}${cy('%')}`, v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : '');
      }
      case 'mod':
        return this.cell('MOD', `${Math.floor(imperial() ? v.mod * 3.28084 : v.mod)}${u}`, v.depth > v.mod ? 'red blink' : '');
      case 'density': {
        const d = gasDensity(v, s.gas);
        return this.cell('DENSITY', `${d.toFixed(1)}${cy('g/L')}`, d >= 6.3 ? 'yellow' : '');
      }
      case 'gf99': {
        const [, hi] = this.gf;
        const cls = v.gf99 > 100 ? 'red' : v.gf99 > hi ? 'yellow' : '';
        const gf99 = v.inDive && leadingOnGas(s) ? '<small>On Gas</small>' : `${Math.round(v.gf99)}${cy('%')}`;
        return this.cell('GF99', gf99, cls);
      }
      case 'surfgf': {
        const [, hi] = this.gf;
        const cls = v.gf99 > 100 ? 'red' : v.gf99 > hi ? 'yellow' : '';
        return this.cell('SurfGF', `${Math.round(v.surfGf)}${cy('%')}`, cls);
      }
      case 'ceil':
        return this.cell('CEIL', String(Math.ceil(imperial() ? v.ceiling * 3.28084 : v.ceiling)));
      case 'at5': {
        const at5 = v.inDive ? this.at5(v, s) : 0;
        return this.cell('@+5', v.inDive ? String(at5) : '--');
      }
      case 'd5': {
        const at5 = v.inDive ? this.at5(v, s) : 0;
        const d = at5 - v.tts;
        return this.cell('Δ+5', v.inDive ? `${d > 0 ? '+' : ''}${d}` : '--');
      }
      case 'tts':
        return this.cell('TTS', v.inDive ? String(v.tts) : '--');
      case 'temp':
        return this.cell('TEMP', `${Math.round(tempVal(v.temperature))}${cy(tempUnit())}`);
      case 'clock': {
        const { h, m } = clockOfDay(s);
        return this.cell('TIME', `${h}:${String(m).padStart(2, '0')}`);
      }
      case 'det': {
        const { h, m } = clockOfDay(s);
        const end = new Date(0);
        end.setUTCHours(h, m + (v.inDive ? v.tts : 0));
        return this.cell('EOD', `${end.getUTCHours()}:${String(end.getUTCMinutes()).padStart(2, '0')}`);
      }
      default:
        return '';
    }
  }

  /** §3.8 alert banner in the Info row: WARNING (yellow) or INFO (cyan), "CLEAR" on its right edge (figures). */
  private banner(kind: string, text: string, cls: string): string {
    return `<div class="tr-banner ${cls}"><div class="k">${kind}</div><div class="t">${text}</div><div class="c">CLEAR</div></div>`;
  }

  /** §2.2 figure: the item highlighted between two lines, the next one dimmed below. */
  private menuRow(s: DiveSession): string {
    if (this.gasItem !== null) {
      // §6.3 figure 15: "Select Gas", the gases (ACT before the active one), then Back.
      const order = this.gasOrder(s);
      const tec = this.mode === 'octec';
      const rows = [...order.map((i) => {
        const g = this.knownGases(s)[i];
        const name = tec ? trimixName(g) : nxName(g);
        return `${i === s.breathing ? '<small>ACT</small> ' : this.gasOff(i) ? '<small>OFF</small> ' : ''}${name}`;
      }), 'Back'];
      const i = this.gasItem;
      const show = [rows[i - 1], rows[i], rows[i + 1]];
      return `<div class="tr-menu gas"><div class="tr-menu-title">Select Gas</div>${show.map((r, k) => `<div class="${k === 1 ? 'sel' : 'dim'}">${r ?? ''}</div>`).join('')}</div>`;
    }
    const items = this.menuItems(s);
    const i = this.menuItem!;
    return `<div class="tr-menu"><div class="sel">${items[i]}</div><div class="dim">${items[(i + 1) % items.length]}</div></div>`;
  }

  /** @+5: TTS after 5 more minutes at the current depth (§3.6). */
  private at5(v: ComputerView, s: DiveSession): number {
    const t = s.tissues.clone();
    t.expose(depthToPressure(v.depth), s.gas, 5);
    return planAscent(t, v.depth, s.gas, this.decoParams(s), this.anchor).tts;
  }

  /** §3.6 info screen descriptions (figures of §3.5). */
  private infoScreen(page: InfoPage, v: ComputerView, s: DiveSession): string {
    const u = cy(depthUnit());
    switch (page) {
      case 'last': {
        const d = s.log[s.log.length - 1];
        const sec = Math.round(d.duration);
        return this.cell('LAST DIVE', `${depthText(d.maxDepth)}${u}`) + this.cell('&nbsp;', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
      }
      case 'ai': {
        // §3.6 "T1 & GTR/SAC" (AI settings GTR/SAC T1): pressure, SAC, GTR. §15.1: T1 yellow below the
        // reserve, red below the critical pressure; GTR "---" at the surface, "wait" the first minutes
        // (2 minutes assumed), "deco" once stops are needed (§8 AI).
        const p = v.tank.pressure;
        const pCls = p < this.criticalPressure() ? 'inv-red' : p < this.reservePressure() ? 'inv-yellow' : '';
        const unit = `<small class="tr-cy tr-vu">${imperial() ? 'PSI' : 'BAR'}</small>`;
        const gtr = !v.inDive ? '---' : v.inDeco ? 'deco' : v.tank.gasTime === null || v.diveTime < 120 ? 'wait' : String(Math.min(99, v.tank.gasTime));
        const sac = !v.inDive || v.diveTime < 120 ? 'wait' : imperial() ? String(Math.round(v.tank.sacBar * 14.5038)) : v.tank.sacBar.toFixed(1);
        return this.cell('T1', `<span class="${pCls}">${pressText(p)}</span>${unit}`) + this.cell('SAC', sac) + this.cell('GTR', gtr);
      }
      case 'maxavg':
        return this.cell('MAX', `${depthText(v.maxDepth)}${u}`) + this.cell('AVG', `${depthText(v.avgDepth)}${u}`);
      case 'cns': {
        // §3.6: CNS yellow above 90 %, red above 150 %; MOD flashing red when exceeded.
        const cns = Math.round(v.cns);
        return this.cell('CNS', `${cns}${cy('%')}`, v.cns > 150 ? 'red' : v.cns > 90 ? 'yellow' : '')
          + this.cell('MOD', `${Math.floor(imperial() ? v.mod * 3.28084 : v.mod)}${u}`, v.depth > v.mod ? 'red blink' : '')
          + this.cell('PPO2', ppo2Text(s.ppO2), this.ppo2Class(v, s));
      }
      case 'gf': {
        // §3.6: GF99 yellow above GF high, red above 100 %, "On Gas" while on-gassing; SurfGF takes its colour.
        const [lo, hi] = this.gf;
        const cls = v.gf99 > 100 ? 'red' : v.gf99 > hi ? 'yellow' : '';
        const gf99 = v.inDive && leadingOnGas(s) ? '<small>On Gas</small>' : `${Math.round(v.gf99)}${cy('%')}`;
        return this.cell('GF', `${lo}/${hi}`) + this.cell('GF99', gf99, cls) + this.cell('SurfGF', `${Math.round(v.surfGf)}${cy('%')}`, cls);
      }
      case 'ceil': {
        // §3.6: CEIL "not rounded up to the next deeper stop increment"; @+5 and Δ+5.
        const at5 = v.inDive ? this.at5(v, s) : 0;
        const d = at5 - v.tts;
        return this.cell('CEIL', String(Math.ceil(imperial() ? v.ceiling * 3.28084 : v.ceiling)))
          + this.cell('@+5', v.inDive ? String(at5) : '--') + this.cell('Δ+5', v.inDive ? `${d > 0 ? '+' : ''}${d}` : '--');
      }
      case 'tissues':
        return `<div class="tr-tissues"><div class="tr-lbl">TISSUES</div>${this.tissueBars(s)}</div>`;
      case 'temp':
        return this.cell('TEMP', `${Math.round(tempVal(v.temperature))}${cy(tempUnit())}`) + this.cell('BATTERY', `${BATTERY}${cy('%')}`);
      case 'mbar':
        return this.cell('mBar NOW', String(Math.round(s.pressure * 1000))) + this.cell('mBar SURF', '1013');
      case 'time': {
        // §3.6 End of Dive Time (EOD): time of day at the surface if leaving now.
        const { h, m } = clockOfDay(s);
        const end = new Date(0);
        end.setUTCHours(h, m + (v.inDive ? v.tts : 0));
        return this.cell('TIME', `${h}:${String(m).padStart(2, '0')}`) + this.cell('EOD', `${end.getUTCHours()}:${String(end.getUTCMinutes()).padStart(2, '0')}`);
      }
    }
  }

  /**
   * §3.6 tissues bar graph: fastest compartment on top, bars of the inert gas tensions growing to the
   * right; cyan line: inspired inert gas pressure, yellow: ambient pressure, red: M-value; yellow above
   * the ambient pressure, red above the M-value. Each bar is scaled from 0 to its own M-value (deduced
   * from "the scale for each tissue compartment is different").
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
    const pos = (x: number) => `${Math.min(100, x * 100).toFixed(1)}%`;
    // Lines placed for the middle compartment (each bar has its own scale on the device).
    const [a8, b8] = t.coefficients(8);
    const m8 = amb / b8 + a8;
    return `<div class="tr-tbars">${bars}<b class="cy" style="left:${pos(inspired / m8)}"></b><b class="ye" style="left:${pos(amb / m8)}"></b><b class="re" style="left:100%"></b></div>`;
  }
}

import { WATER_VAPOUR, depthToPressure } from '../../../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, hmm, mmss } from '../../base';
import { Acks } from '../../common/acks';
import { gfRate } from '../../common/predict';
import { quadAscentLimit, safetyShown, tankRange } from '../common';
import { SiriusRules } from './rules';

type Screen = 'ez' | 'full' | 'tissue' | 'profile' | 'stops';
const SCREENS: Screen[] = ['ez', 'full', 'tissue', 'profile', 'stops'];
/**
 * §9 COMPLICATIONS: field to the right of the depth (MAX by default, figures of §9), then with TR-SP
 * "average depth, MOD of gas in use, deep stop if active and calculated, TTS @+5, ceiling".
 */
const TR_FIELDS = ['max', 'avg', 'mod', 'deep', 'tts', 'ceil'] as const;
type TrField = (typeof TR_FIELDS)[number];
/**
 * §9 COMPLICATIONS: field to the right of the tank pressure (TTR by default, figures of §9; "BACK TO TTR" in
 * the quick guide of §1.5), then with BR-SP "main GF, GF NOW/GF @SURF, GF @SURF/GF RATE, O2%, CNS, ppO2, time
 * of day, battery status of Sirius, battery status of tank module in use, gas consumption".
 */
const BR_FIELDS = ['ttr', 'gf', 'gfnow', 'gfrate', 'o2', 'cns', 'ppo2', 'time', 'batt', 'tbatt', 'gas'] as const;
type BrField = (typeof BR_FIELDS)[number];
/** Battery levels shown: fictitious values (the batteries are not simulated). */
const BATTERY = 75;
const TANK_BATTERY = 'OK';

/** Mares Sirius: buttons and round colour display, after the manual's figures (rules in rules.ts). */
export class MaresSirius extends SiriusRules {
  /** COMPLICATIONS fields shown momentarily (index in the sequence, until real time in ms). */
  private trSel: { i: number; until: number } | null = null;
  private brSel: { i: number; until: number } | null = null;
  /** E-Z fields shown momentarily (2 s). */
  private ezTop: { i: number; until: number } | null = null;
  private ezBottom: { i: number; until: number } | null = null;
  /** Dive screen setting last applied, so a change in the settings shows at once. */
  private appliedDisplay = '';
  private stopwatchFrom = 0;
  private surfacePage: SurfacePage = 'detail';
  private acks = new Acks();
  /** §11.2: gas summary table (BR-LP), with the gas under the cursor; null when closed. */
  private gasTable: number | null = null;
  /** §2.5.5: the GF @SURF value blinks (reached the warning value, not acknowledged yet). */
  private gfSurfBlink = false;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.stopwatchFrom = 0;
    this.acks.clear();
    this.trSel = this.brSel = this.ezTop = this.ezBottom = null;
    this.gasTable = null;
    this.appliedDisplay = this.settings.display;
    this.screen = SCREENS.indexOf(this.appliedDisplay === 'full' ? 'full' : 'ez');
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'postdive';
  }

  /** §2.15 NOTE: with CEIL-CON and a decompression obligation, "E-Z is not available anymore". */
  private ezAvailable(v: ComputerView | null): boolean {
    return !(this.settings.ceilCon === 'on' && v && v.inDeco);
  }

  // §1.5, DIVE MODE: BL-SP cycles E-Z, COMPLICATIONS, tissue graph, dive profile and list of stops; TL-SP resets
  // the stopwatch; TR-SP / BR-SP change the top / bottom field; TR-LP: backlight; BR-LP: gas switch table. At the
  // surface: BL-SP cycles the watch faces (and POST DIVE), TR-SP PRE-DIVE, then the GF TABLE. Any button
  // acknowledges the messages that stay until then (§8.3).
  press(button: string, s: DiveSession): boolean {
    this.acks.ackAll();
    if (!s.inDive) return this.surfacePress(button, s);
    // §11.2: SWITCH TO G2: "With TR-SP or BR-SP you perform the switch [...] with TL-SP or BL-SP you stay on the
    // current gas".
    if (this.prompt.offer !== null) {
      const g = this.prompt.offer;
      if (button === 'tr' || button === 'br') {
        this.prompt.accept(s);
        this.say('GAS SWITCH OK');
      } else {
        this.prompt.decline();
        this.notSwitched(g);
      }
      return true;
    }
    // §11.2 gas table: "Scroll through the available gases with TR-SP and BR-SP [...] With BL-SP you can exit
    // without making changes."
    if (this.gasTable !== null) {
      const n = this.knownGases(s).length;
      if (button === 'tr') this.gasTable = (this.gasTable + n - 1) % n;
      else if (button === 'br') this.gasTable = (this.gasTable + 1) % n;
      else if (button === 'bl') this.gasTable = null;
      return true;
    }
    if (this.locked) {
      // §12: TL-SP resets the stopwatch (the other bottom timer fields are not simulated).
      if (button === 'tl') this.stopwatchFrom = s.diveTime;
      return true;
    }
    const screen = SCREENS[this.screen];
    if (button === 'bl') {
      let next = (this.screen + 1) % SCREENS.length;
      // §9.4: "In presence of a decompression stop deeper than 3m, BL-SP from the DIVE PROFILE view will show the
      // list of decompression stops".
      if (SCREENS[next] === 'stops' && !(this.lastView && this.lastView.stopDepth > 3)) next = 0;
      if (SCREENS[next] === 'ez' && !this.ezAvailable(this.lastView)) next = SCREENS.indexOf('full');
      this.setScreen(next);
      this.keepLayout();
    } else if (button === 'tl') {
      this.stopwatchFrom = s.diveTime;
    } else if (button === 'tr') {
      if (screen === 'ez') this.ezTop = this.momentary(this.ezTop, EZ_TOP.length, 2000);
      else this.trSel = this.cycle(this.trSel, this.trFields(s), this.trDefault());
    } else if (button === 'br') {
      if (screen === 'ez') this.ezBottom = this.momentary(this.ezBottom, this.ezBottomFields(s).length, 2000);
      else this.brSel = this.cycle(this.brSel, this.brFields(s), this.brDefault());
    } else {
      return false;
    }
    return true;
  }

  /**
   * The dive screen setting follows the layout reached with the buttons (E-Z or COMPLICATIONS): the settings
   * panel shows it, and the next dive starts with it (the manual has no menu entry for the layout, §2: it is
   * chosen with BL-SP during the dive; kept for the next dive: assumed). The graphic screens (tissues, profile,
   * stops) are momentary and leave it as it is.
   */
  private keepLayout(): void {
    const screen = SCREENS[this.screen];
    if (screen !== 'ez' && screen !== 'full') return;
    this.settings.display = this.appliedDisplay = screen;
  }

  /** Surface (§1.5 TOD, §1.5.5 PRE-DIVE, §2.2 GF TABLE, §10 POST DIVE in the BL-SP loop). */
  private surfacePress(button: string, s: DiveSession): boolean {
    const faces: SurfacePage[] = ['big', 'detail', ...(this.hasDesat(s) ? ['postdive' as const] : [])];
    if (button === 'bl') {
      // From PRE-DIVE or the GF TABLE, "BL-SP returns to TOD display".
      const i = faces.indexOf(this.surfacePage);
      this.surfacePage = i < 0 ? 'detail' : faces[(i + 1) % faces.length];
    } else if (button === 'tr') {
      if (this.surfacePage === 'predive') this.surfacePage = 'gftable';
      else if (this.surfacePage !== 'gftable') this.surfacePage = 'predive';
    }
    return true;
  }

  /** Next momentary field; back to normal `ms` after the last press. */
  private momentary(cur: { i: number; until: number } | null, n: number, ms: number): { i: number; until: number } {
    const now = performance.now();
    const i = cur && now < cur.until ? (cur.i + 1) % n : 0;
    return { i, until: now + ms };
  }

  /**
   * COMPLICATIONS: each press shows the next field of the sequence; 4 s later the display goes back to its
   * default field (quick guide of §1.5: "BACK TO MAX", "BACK TO TTR"; 4 s: §8.3.3 and §8.3.6, "it will remain for
   * 4s only, and then return").
   */
  private cycle<T>(cur: { i: number; until: number } | null, fields: readonly T[], def: T): { i: number; until: number } {
    const now = performance.now();
    const from = cur && now < cur.until ? cur.i : Math.max(0, fields.indexOf(def));
    return { i: (from + 1) % fields.length, until: now + 4000 };
  }

  hold(button: string, s: DiveSession): boolean {
    // §11.2: "You can always perform a manual switch with BR-LP. This will make the gas summary table appear [...]
    // then with TR-LP or BR-LP you activate it."
    if (s.inDive && this.gasTable !== null && (button === 'tr' || button === 'br')) {
      const i = this.gasTable;
      // §2.6.2 SWITCH BELOW MOD OFF: no switch deeper than the gas MOD.
      if (this.settings.belowMod !== 'off' || s.depth <= this.gasMods(s)[i]) {
        s.switchGas(i);
        this.prompt.offer = null;
        this.gasTable = null;
      }
      return true;
    }
    if (button === 'br' && s.inDive && !this.locked && this.knownGases(s).length > 1) {
      this.gasTable = s.breathing;
      return true;
    }
    // §1.5: TR-LP "activates the backlight" (§2.16 AUTO-OFF: 6 s).
    if (button === 'tr' && s.inDive) {
      this.backlightUntil = performance.now() + 6000;
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      tl: {
        name: 'TL',
        press: { real: { fr: 'Remise à zéro du chronomètre (même s’il n’est pas affiché)', en: 'Resets the stopwatch (even when not displayed)' }, simulated: true },
        hold: { real: { fr: 'Menu sous l’eau (UW MENU)', en: 'Underwater menu (UW MENU)' }, simulated: false },
      },
      bl: {
        name: 'BL',
        press: {
          real: { fr: 'Plongée : E-Z, COMPLICATIONS, tissus, profil, liste des paliers. Surface : cadrans de montre (BIG, DETAIL, ANALOG) et POST DIVE ; depuis PRE-DIVE, retour à l’heure', en: 'Dive: E-Z, COMPLICATIONS, tissue graph, profile, list of stops. Surface: watch faces (BIG, DETAIL, ANALOG) and POST DIVE; from PRE-DIVE, back to the time of day' },
          simulated: true,
          note: { fr: 'sans le cadran ANALOG', en: 'without the ANALOG face' },
        },
        hold: { real: { fr: 'Boussole', en: 'Compass' }, simulated: false },
      },
      tr: {
        name: 'TR',
        press: {
          real: { fr: 'E-Z : température puis profondeur max à la place de la profondeur (2 s). COMPLICATIONS : champ à droite de la profondeur (moyenne, MOD, deep stop, TTS @+5, plafond). Surface : PRE-DIVE, puis tableau des GF', en: 'E-Z: temperature then max depth instead of the depth (2 s). COMPLICATIONS: field to the right of the depth (average, MOD, deep stop, TTS @+5, ceiling). Surface: PRE-DIVE, then the GF table' },
          simulated: true,
        },
        hold: { real: { fr: 'Plongée : rétroéclairage. Surface : menu', en: 'Dive: backlight. Surface: menu' }, simulated: true, note: { fr: 'menu de surface non simulé', en: 'surface menu not simulated' } },
      },
      br: {
        name: 'BR',
        press: {
          real: { fr: 'E-Z : TTR, consommation, O2 %, heure, batterie à la place de la pression (2 s). COMPLICATIONS : champ à droite de la pression (MAIN GF, GF NOW/@SURF, GF @SURF/RATE, O2 %, CNS, ppO2, heure, batteries, consommation)', en: 'E-Z: TTR, gas consumption, O2 %, time, battery instead of the pressure (2 s). COMPLICATIONS: field to the right of the pressure (MAIN GF, GF NOW/@SURF, GF @SURF/RATE, O2 %, CNS, ppO2, time, batteries, gas consumption)' },
          simulated: true,
          note: { fr: 'batteries : valeurs fictives', en: 'batteries: fictitious values' },
        },
        hold: { real: { fr: 'Tableau de changement de gaz (multigaz) ; dans le tableau, active le gaz choisi', en: 'Gas switch table (multigas); in the table, activates the gas chosen' }, simulated: true },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fields.

  private trFields(s: DiveSession): TrField[] {
    // §9 NOTE: set to AIR, the MOD is not displayed.
    return TR_FIELDS.filter((f) => f !== 'mod' || this.nitrox(s));
  }

  private brFields(s: DiveSession): BrField[] {
    const ai = this.airIntegrated(s);
    // §9: without a tank module "in the lower right corner sequence TTR and l/min do not appear"; set to AIR,
    // CNS and ppO2 are not displayed (§9 NOTE).
    return BR_FIELDS.filter((f) => (ai || (f !== 'ttr' && f !== 'gas' && f !== 'tbatt')) && (this.nitrox(s) || (f !== 'cns' && f !== 'ppo2')));
  }

  /**
   * Default field at the right of the depth: MAX; with CEIL-CON, within 3 m of the deepest stop, the ceiling
   * ("CEILING become the default indication in the upper right corner of the display once you are within
   * 3 m / 10 ft of the deepest stop", §2.15), then STOP and its depth once the ceiling has reached 6 m.
   */
  private trDefault(): TrField | 'stop' {
    const v = this.lastView;
    if (v && this.settings.ceilCon === 'on' && v.inDeco && v.plan.stops.length) {
      if (v.ceiling <= 6) return 'stop';
      if (v.depth <= v.plan.stops[0].depth + 3) return 'ceil';
    }
    return 'max';
  }

  /** Default field at the right of the pressure: TTR; CNS while above 75 % (§8.3.3). Without a tank module: MAIN GF (deduced). */
  private brDefault(): BrField {
    const v = this.lastView;
    if (v && v.cns > 75) return 'cns';
    return v && v.tank.ai ? 'ttr' : 'gf';
  }

  private trField(s: DiveSession): TrField | 'stop' {
    const fields = this.trFields(s);
    if (this.trSel && performance.now() < this.trSel.until) return fields[this.trSel.i % fields.length];
    return this.trDefault();
  }

  private brField(s: DiveSession): BrField {
    const fields = this.brFields(s);
    if (this.brSel && performance.now() < this.brSel.until) return fields[this.brSel.i % fields.length];
    const d = this.brDefault();
    return fields.includes(d) ? d : fields[0];
  }

  private ezBottomFields(s: DiveSession): string[] {
    // §9 E-Z: "With BR-SP the tank pressure is momentarily replaced by TTR [...] BR-SP within two seconds brings up
    // gas consumption in l/min or cuft/min, O2%, time of day and battery status." Without a tank module the dive
    // time takes that place: TTR and gas consumption left out (deduced).
    return this.airIntegrated(s) ? ['ttr', 'gas', 'o2', 'time', 'batt'] : ['o2', 'time', 'batt'];
  }

  // -------------------------------------------------------------------------
  // Display: round colour screen, after the manual's figures (§8.3, §9, §10, §11).

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.screenAlerts = [];
    this.lastView = v;
    let html: string;
    let layout = 'sr-dive';
    if (!v.inDive) {
      html = this.surfaceScreen(v, s);
      layout = 'sr-surf';
    } else if (this.locked) {
      html = this.bottomTimer(v);
      layout = 'sr-dive sr-bt';
    } else {
      if (this.settings.display !== this.appliedDisplay) {
        this.appliedDisplay = this.settings.display;
        this.setScreen(SCREENS.indexOf(this.appliedDisplay === 'full' ? 'full' : 'ez'));
      }
      let screen = SCREENS[this.screen] ?? 'ez';
      // §9.3 / §9.4: the graphic screens revert to E-Z after 5 s (quick guide: "TIME-OUT 5 S", "BACK TO E-Z DISPLAY").
      if ((screen === 'tissue' || screen === 'profile' || screen === 'stops') && performance.now() - this.screenChangedAt > 5000) {
        this.setScreen(0);
        this.keepLayout();
        screen = 'ez';
      }
      if (screen === 'ez' && !this.ezAvailable(v)) screen = 'full';
      const alarm = this.alarm(v, s);
      this.screenAlerts = [alarm?.text, this.gasMsgs.current, this.deep.shown ? 'DEEP STOP' : null, this.gfSurfBlink ? 'GF @SURF' : null, this.plus === 'active' ? 'SAFETY STOP+' : null].filter((m): m is string => !!m);
      // §8.3 NOTE: "If you are in any graphic display mode [...] when an alarm is triggered, you will be kicked out of
      // that mode and back to the standard numeric display."
      if (alarm && screen !== 'ez' && screen !== 'full') this.setScreen(SCREENS.indexOf((screen = 'full')));
      // §8.3.2, §8.3.3, §2.5.1: the display switches to COMPLICATIONS (MOD, CNS, MAX DEPTH); the MOD keeps it while too deep.
      if ((alarm?.full || v.depth > v.mod) && screen === 'ez') screen = 'full';
      if (this.prompt.offer !== null) html = this.promptScreen(v, s);
      else if (this.gasTable !== null) html = this.gasTableScreen(v, s);
      else html = screen === 'ez' || screen === 'full' ? this.diveScreen(screen, v, s, alarm) : this.graphScreen(screen, v, s);
    }
    el.innerHTML = `
      <div class="dev sr">
        <div class="sr-case">
          <button class="sr-btn tl" data-btn="tl"></button>
          <button class="sr-btn bl" data-btn="bl"></button>
          <button class="sr-btn tr" data-btn="tr"></button>
          <button class="sr-btn br" data-btn="br"></button>
          <div class="sr-bezel"><div class="sr-screen ${layout} ${this.backlit ? 'backlit' : ''}">${html}</div></div>
        </div>
      </div>`;
  }

  /** Current alarm or warning (red bottom segment, figures of §8.3), highest priority first. */
  private alarm(v: ComputerView, s: DiveSession): Alarm | null {
    // Acknowledged messages stay off until the next dive.
    this.acks.begin();
    const ack = (key: string) => this.acks.show(key);
    const ai = v.tank.ai;
    const ceilCon = this.ceilCon(v.ceiling);
    let a: Alarm | null = null;
    if (v.ascentLevel === 2) {
      // §8.3 NOTE: "Ascent rate alarm has priority over other alarms if they are triggered simultaneously."
      a = { text: 'SLOW!' };
    } else if (ceilCon && v.ceilingViolation > 0 && !this.violation) {
      // §8.3.4.1: "the message CEILING! will be triggered as soon as you exceed the CEILING" (top row in red, figure).
      a = { text: 'CEILING!', top: true };
    } else if (v.ceilingViolation === 2 && !this.violation) {
      // §8.3.4: "If you ascend above the decompression stop depth by more than 0.3m (1ft) [...] DECO STOP!".
      a = { text: 'DECO STOP!' };
    } else if (this.violation === 'deco') {
      // §8.3.4.2: "the display will show VIOLATION - DECO!" (figure: VIOLATION / DECO!).
      a = { text: 'VIOLATION DECO!', lines: ['VIOLATION', 'DECO!'] };
    } else if (this.emergency && ack('emergency')) {
      // §8.3.4.2: "The message MAIN GF > GF 95/95 is displayed until you press any button" (figure: "MAIN GF=> GF 95/95").
      a = { text: 'MAIN GF=> GF 95/95', lines: ['MAIN GF=>', 'GF 95/95'] };
    } else if (v.depth > v.mod && ack('mod')) {
      a = { text: 'MOD!', full: true };
    } else if (this.settings.wMaxDepth !== 'off' && v.depth >= Number(this.settings.wMaxDepth) && ack('maxdepth')) {
      // §2.5.1: "an alarm similar in behaviour to the MOD alarm (section 8.3.2) is triggered, albeit with the message
      // MAX DEPTH REACHED".
      a = { text: 'MAX DEPTH REACHED', lines: ['MAX DEPTH', 'REACHED'], full: true };
    } else if (v.cns > 75 && ack('cns')) {
      a = { text: 'CNS > 75%', full: true };
    } else if (v.inDeco && this.runaway(v, s) && ack('runaway')) {
      // §9.2 NOTE: RUNAWAY DECO "remains on the display until you press any button" (figure: top row red, TTS@+5).
      a = { text: 'RUNAWAY DECO', lines: ['RUNAWAY', 'DECO'], top: true, full: true };
    } else if (ai && v.inDeco && s.diveTime > 120 && (v.tank.gasTime ?? 0) < v.tts && ack('lowtank')) {
      a = { text: 'LOW TANK PRESSURE', lines: ['LOW TANK', 'PRESSURE'] };
    } else if (ai && v.tank.pressure <= v.tank.reserve && ack('reserve')) {
      a = { text: 'TANK RESERVE', lines: ['TANK', 'RESERVE'] };
    } else if (ai && v.tank.pressure <= this.halfTank() && ack('half')) {
      a = { text: 'HALF TANK', lines: ['HALF', 'TANK'] };
    } else if (this.settings.wTime !== 'off' && v.diveTime / 60 >= Number(this.settings.wTime) && ack('timelimit')) {
      // §2.5.2: TURN AROUND at half of the time limit, TIME LIMIT at it, each until a button is pressed.
      a = { text: 'TIME LIMIT' };
    } else if (this.settings.wTime !== 'off' && v.diveTime / 60 >= Number(this.settings.wTime) / 2 && ack('turn')) {
      a = { text: 'TURN AROUND' };
    } else if (this.settings.wDeco !== 'off' && v.inDeco && ack('deco')) {
      // §2.5.3 / §2.5.4: "a warning will alert you"; the message is not given: the menu names, deduced.
      a = { text: 'ENTERING DECO', lines: ['ENTERING', 'DECO'] };
    } else if (this.settings.wNoDeco !== 'off' && !v.inDeco && v.ndl <= 2 && ack('nodeco')) {
      a = { text: 'NO DECO 2 MIN', lines: ['NO DECO', '2 MIN'] };
    }
    // §2.5.5: GF @SURF "will blink on the screen until you push any button to confirm having seen it".
    this.gfSurfBlink = this.settings.wGfSurf !== 'off' && v.surfGf >= Number(this.settings.wGfSurf) && this.acks.show('gfsurf');
    return a;
  }

  /** §9.2 NOTE: TTS @+X more than k × X beyond the current TTS (RUNAWAY DECO setting, ×2 by default). */
  private runaway(v: ComputerView, s: DiveSession): boolean {
    const x = this.futureX();
    return this.ttsPlus(v, s) - v.tts >= x * (Number(this.settings.runaway) || 2);
  }

  /** §2.3.1: BLUE / GREEN above HALF TANK, YELLOW down to 50 bar / 500 psi, RED below. */
  private tankColor(v: ComputerView): string {
    return tankRange(v.tank.pressure, v.tank.fill, this.halfTank(), imperial() ? 500 / 14.5038 : 50);
  }

  /** §9: "in presence of a depth change in excess of 80cm / 3ft" the ascent speed is shown (as on the Quad Ci). */
  private ascending(v: ComputerView): boolean {
    return v.inDive && v.depth >= 1.2 && v.ascentRate > 0.5;
  }

  private rateText(v: ComputerView): string {
    return String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate));
  }

  /**
   * Screen dividers during an ascent (§9): E-Z "in green up to 80% of the allowed limit, in yellow from 80 to 100%
   * and in red beyond that"; COMPLICATIONS "in green up to 100% of the allowed limit and in red beyond that";
   * SLOW!: "the screen dividers start blinking in red" (§8.3.1).
   */
  private speedBar(v: ComputerView, full: boolean): string {
    const pct = v.ascentRate / quadAscentLimit(v.depth);
    if (pct > 1) return '<div class="sr-bar speed red blink"><i style="width:100%"></i></div>';
    const cls = !full && pct > 0.8 ? 'yellow' : 'green';
    return `<div class="sr-bar speed ${cls}"><i style="width:${Math.round(Math.min(100, pct * 100))}%"></i></div>`;
  }

  /**
   * Upper divider: nitrogen bar graph (§9 / glossary: "any amount in excess of the equilibrium state at the surface"
   * in the leading tissue), "gradually from green to purple" (magenta from the left, green beyond, figures),
   * entirely purple in decompression.
   */
  private n2Bar(v: ComputerView, full: boolean): string {
    if (this.ascending(v)) return this.speedBar(v, full);
    const load = v.inDeco ? 100 : Math.min(100, v.n2Load);
    return `<div class="sr-bar n2"><i style="width:${Math.round(load)}%"></i><em>N2</em></div>`;
  }

  /** Lower divider: tank pressure graph in its range colour (§2.3.1); without a tank module it replicates the upper one (§9). */
  private tankBar(v: ComputerView, full: boolean): string {
    if (this.ascending(v)) return this.speedBar(v, full);
    if (!v.tank.ai) return this.n2Bar(v, full);
    const fill = Math.max(0, Math.min(100, (v.tank.pressure / v.tank.fill) * 100));
    return `<div class="sr-bar tank ${this.tankColor(v)}"><i style="width:${Math.round(fill)}%"></i><span class="sr-batt"></span></div>`;
  }

  /** Dive time: minutes and a colon, the seconds small above (figures: "DTIME 37 / 25:"). */
  private dtime(v: ComputerView, cls = ''): string {
    const min = Math.floor(v.diveTime / 60);
    const sec = String(Math.floor(v.diveTime % 60)).padStart(2, '0');
    return `<div class="sr-c dt ${cls}"><em>DTIME<span class="sr-sec">${sec}</span></em><b>${min}:</b></div>`;
  }

  /**
   * Right part of the middle row: no deco, deco stop, deep, safety stop or SAFETY STOP+, surfacing (§9, §9.1,
   * §10). While ascending, the speed takes the place of the TTS in deco (§9: "in lieu of the NO DECO time or
   * TTS"); without deco it sits beside NO DECO, as in the SLOW! figure of §8.3.1.
   */
  private stopCells(v: ComputerView, s: DiveSession, slow: boolean): string {
    const du = depthUnit();
    const ascending = this.ascending(v);
    const speed = `<div class="sr-c spd ${slow ? 'red' : ''}"><em>SPEED</em><b>${this.rateText(v)}</b></div>`;
    if (v.depth < 1.2) {
      // §10: "The screen shows the surfacing mode countdown timer, dive time, and tank pressure" (figure: SURFACING 2:58).
      return `<div class="sr-c r"><em>SURFACING</em><b>${mmss(Math.max(0, DIVE_END_TIMEOUT - s.surfaceTimer))}</b></div>`;
    }
    if (v.inDeco && v.stopDepth > 0) {
      // Figures of §8.3.4: TTS (yellow caption) top right, DECO STOP and its depth, stop time bottom right.
      const tts = ascending ? `<span class="sr-ttsv"><em>SPEED</em><b class="${slow ? 'redt' : ''}">${this.rateText(v)}</b></span>` : `<span class="sr-ttsv"><em class="y">TTS</em><b>${v.tts}:</b></span>`;
      return `<div class="sr-c deco">
          ${tts}
          <span class="sr-dsl"><em class="y">DECO STOP</em><b>${depthInt(v.stopDepth)}<u>${du}</u></b></span>
          <span class="sr-dst"><b>${v.stopTime}:</b></span>
        </div>`;
    }
    if (safetyShown(v, this.safetyStop.bottom)) return `<div class="sr-c r"><em>SAFETY STOP</em><b>${mmss(v.safety.remaining)}</b></div>`;
    if (v.safety.state === 'done' && v.depth < 6) {
      // §9.1.2: SAFETY STOP + after the regular stop; §9.1.1: then OK and a count-up while shallower than 6 m.
      if (this.plus === 'active') return `<div class="sr-c r"><em>SAFETY STOP+</em><b>${mmss(this.plusRemaining)}</b></div>`;
      return `<div class="sr-c r"><em><span class="sr-ok">OK</span></em><b>${mmss(this.countUp)}</b></div>`;
    }
    const nd = `<div class="sr-c r"><em>NO DECO</em><b>${Math.min(99, v.ndl)}:</b></div>`;
    return ascending ? `${nd}${speed}` : nd;
  }

  /** GF @SURF value, blinking while its §2.5.5 warning is not acknowledged. */
  private surfGfText(v: ComputerView): string {
    const t = String(Math.round(v.surfGf));
    return this.gfSurfBlink ? `<span class="blink">${t}</span>` : t;
  }

  private diveScreen(screen: 'ez' | 'full', v: ComputerView, s: DiveSession, alarm: Alarm | null): string {
    const du = depthUnit();
    const now = performance.now();
    const full = screen === 'full';
    const surfacing = v.depth < 1.2;
    const slow = alarm?.text === 'SLOW!';
    // §9.1: "At a depth shallower than 1.2m/4ft, the display shows ---" (figure of §10: "--.-").
    const depth = surfacing ? '--.-' : depthText(v.depth);
    const modRed = v.depth > v.mod;
    const topRed = modRed || !!alarm?.top;
    const temp = `<div class="sr-temp">${Math.round(tempVal(v.temperature))}<u>${tempUnit()}</u></div>`;
    const deep = this.deep.shown ? this.deep : null;
    const ai = v.tank.ai;

    // Top row.
    let top: string;
    if (!full) {
      const sel = this.ezTop && now < this.ezTop.until ? EZ_TOP[this.ezTop.i] : null;
      let lbl = 'DEPTH';
      let val = `${depth}<u>${du}</u>`;
      if (sel === 'temp') [lbl, val] = ['TEMP', `${Math.round(tempVal(v.temperature))}<u>${tempUnit()}</u>`];
      if (sel === 'max') [lbl, val] = ['MAX', `${depthText(v.maxDepth)}<u>${du}</u>`];
      top = `<div class="sr-top ez ${topRed ? 'red' : ''}"><em>${lbl}</em><b>${val}</b></div>`;
    } else {
      let field = this.trField(s);
      if (modRed) field = 'mod';
      else if (alarm?.text === 'CEILING!') field = 'ceil';
      else if (alarm?.text === 'RUNAWAY DECO') field = 'tts';
      // §2.9: the deep stop "is shown in the top right corner of the display, next to the current depth".
      else if (deep && field === 'max') field = 'deep';
      top = `<div class="sr-top ${topRed ? 'red' : ''}">${temp}<div class="sr-c dp"><em>DEPTH</em><b>${depth}<u>${du}</u></b></div>${this.trCell(field, v, s)}</div>`;
    }

    // Middle row.
    let mid: string;
    if (full && deep && deep.state === 'active' && !v.inDeco) {
      // Figure of §9.1: DEEP STOP and its countdown fill the middle row.
      mid = `<div class="sr-mid"><div class="sr-c deep"><em>DEEP<br>STOP</em><b>${mmss(deep.remaining)}</b></div></div>`;
    } else if (!ai && !v.inDeco && !surfacing && !safetyShown(v, this.safetyStop.bottom) && v.safety.state !== 'done' && !this.ascending(v)) {
      // Without a tank module (§1.6.2, figures of §1.6.2): NO DECO across the middle row, the dive time below.
      mid = `<div class="sr-mid"><div class="sr-c wide"><em>NO DECO</em><b>${Math.min(99, v.ndl)}:</b></div></div>`;
    } else {
      const small = v.inDeco || safetyShown(v, this.safetyStop.bottom) || v.safety.state === 'done' || surfacing || this.ascending(v) ? 'sm' : '';
      mid = `<div class="sr-mid">${ai || v.inDeco || surfacing ? this.dtime(v, small) : ''}<div class="sr-right">${this.stopCells(v, s, slow)}</div></div>`;
    }

    // Bottom row, or the alarm in red (figures of §8.3) or the gas messages of §11.2.
    let low: string;
    const msg = this.gasMsgs.current;
    if (alarm) low = `<div class="sr-alarm">${(alarm.lines ?? [alarm.text]).map((l) => `<span>${l}</span>`).join('')}</div>`;
    else if (msg) low = `<div class="sr-alarm cyan"><span>${msg}</span></div>`;
    else if (!full) low = this.ezBottomRow(v, s);
    else low = this.fullBottomRow(v, s, surfacing);

    return `${top}${this.n2Bar(v, full)}${mid}${this.tankBar(v, full)}${low}`;
  }

  /** E-Z bottom row: tank pressure (or dive time without a tank module), replaced momentarily by BR-SP (§9). */
  private ezBottomRow(v: ComputerView, s: DiveSession): string {
    const fields = this.ezBottomFields(s);
    const sel = this.ezBottom && performance.now() < this.ezBottom.until ? fields[this.ezBottom.i % fields.length] : null;
    if (sel) {
      const { h, m } = clockOfDay(s);
      const g = this.knownGases(s).length > 1 ? `G${s.breathing + 1} ` : '';
      const [lbl, val] = sel === 'ttr' ? ['TTR', this.ttrText(v, s)]
        : sel === 'gas' ? [imperial() ? 'cuft/min' : 'l/min', String(Math.round(s.rmv))]
        : sel === 'o2' ? [`${g}O2%`, `${v.o2}<u>%</u>`]
        : sel === 'time' ? ['TIME OF DAY', `${h}:${String(m).padStart(2, '0')}`]
        : ['BATTERY', `${BATTERY}<u>%</u>`];
      return `<div class="sr-low ez"><b>${val}</b><em>${lbl}</em></div>`;
    }
    if (v.tank.ai) return `<div class="sr-low ez"><b class="${this.tankColor(v) === 'red' ? 'redt' : ''}">${pressText(v.tank.pressure)}</b><em>${pressUnit().toUpperCase()}</em></div>`;
    // Figure of §1.6.2: "DTIME 25:23".
    const min = Math.floor(v.diveTime / 60);
    const sec = String(Math.floor(v.diveTime % 60)).padStart(2, '0');
    return `<div class="sr-low ez dtl"><em>DTIME</em><b>${min}:<small>${sec}</small></b></div>`;
  }

  /** COMPLICATIONS bottom row: tank pressure (or dive time), the bottom-right field and the stopwatch (§9). */
  private fullBottomRow(v: ComputerView, s: DiveSession, surfacing: boolean): string {
    let right: string;
    // §9.1.1: "When the safety stop countdown timer begins, GF @+3 appears next to GF @ SURF in the lower right
    // corner" (figures: GF@SURF/@+3, also during SAFETY STOP+).
    if (!surfacing && (safetyShown(v, this.safetyStop.bottom) || this.plus === 'active')) right = this.f('GF@SURF/@+3', `${this.surfGfText(v)}/${this.gfAt3(v, s)}`);
    // Figure of §10: SURFACING with MAIN GF bottom right.
    else if (surfacing) right = this.f('MAIN GF', `${v.gfLow}/${v.gfHigh}`);
    else right = this.brCell(this.brField(s), v, s);
    const sw = `<div class="sr-sw"><em>SW</em>${mmss(v.diveTime - this.stopwatchFrom)}</div>`;
    if (v.tank.ai) return `<div class="sr-low"><div class="sr-c pr"><b class="${this.tankColor(v) === 'red' ? 'redt' : ''}">${pressText(v.tank.pressure)}</b><em>${pressUnit().toUpperCase()}</em></div>${right}${sw}</div>`;
    // Figure of §1.6.2: the dive time with its seconds, "DTIME" below.
    const min = Math.floor(v.diveTime / 60);
    const sec = String(Math.floor(v.diveTime % 60)).padStart(2, '0');
    return `<div class="sr-low"><div class="sr-c pr dtf"><b>${min}:<small>${sec}</small></b><em>DTIME</em></div>${right}${sw}</div>`;
  }

  private f(lbl: string, val: string, cls = ''): string {
    return `<div class="sr-f ${cls}"><em>${lbl}</em><b>${val}</b></div>`;
  }

  private ttrText(v: ComputerView, s: DiveSession): string {
    // TTR not shown at the very beginning of the dive: "Sirius needs approximately 2 minutes to analyze your
    // breathing pattern" (manual FW 1.02.00, §9.1; not in the 06/2026 revision).
    return v.tank.gasTime === null || s.diveTime < 120 ? '--' : `${v.tank.gasTime}:`;
  }

  private trCell(field: TrField | 'stop', v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const d = (m: number) => `${depthText(m)}<u>${du}</u>`;
    switch (field) {
      case 'avg': return this.f('AVG', d(v.avgDepth));
      case 'mod': return this.f('MOD', d(v.mod), v.depth > v.mod ? 'redv' : '');
      case 'deep': return this.f('DEEP', this.deep.shown ? d(this.deep.depth) : '--');
      // §9.2: TTS @+5 (X of FUTURE DECO), in decompression dives.
      case 'tts': return this.f(`TTS@+${this.futureX()}`, v.inDeco ? `${this.ttsPlus(v, s)}:` : '--');
      case 'ceil': return this.f('CEILING', v.ceiling > 0 ? d(v.ceiling) : '--');
      // §2.15: "the upper right field will show STOP followed by depth of the stop".
      case 'stop': return this.f('STOP', v.stopDepth > 0 ? `${depthInt(v.stopDepth)}<u>${du}</u>` : '--');
      default: return this.f('MAX', d(v.maxDepth));
    }
  }

  private brCell(field: BrField, v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    const g = this.knownGases(s).length > 1 ? `G${s.breathing + 1} ` : '';
    switch (field) {
      case 'gf': return this.f(this.emergency ? 'EMERGENCY GF' : 'MAIN GF', `${v.gfLow}/${v.gfHigh}`);
      case 'gfnow': return this.f('GF NOW/@SURF', `${Math.round(v.gf99)}/${this.surfGfText(v)}`);
      case 'gfrate': {
        // Glossary, GF RATE: "The amount by which GF @SURF will increase (yellow digits) or decrease (blue digits)
        // over the next minute."
        const { r, text } = gfRate(s, v.depth);
        const cls = text === '0' ? '' : r > 0 ? 'yel' : 'blu';
        return `<div class="sr-f"><em>GF@SURF/RATE</em><b>${this.surfGfText(v)}/<span class="${cls}">${text}</span></b></div>`;
      }
      case 'o2': return this.f(`${g}O2%`, `${v.o2}<u>%</u>`);
      case 'cns': return this.f('CNS', `${Math.round(v.cns)}<u>%</u>`, v.cns > 75 ? 'redv' : '');
      case 'ppo2': return this.f('PPO2', v.ppO2.toFixed(2));
      case 'time': return this.f('TIME OF DAY', `${h}:${String(m).padStart(2, '0')}`);
      case 'batt': return this.f('BATTERY', `${BATTERY}<u>%</u>`);
      case 'tbatt': return this.f(`G${s.breathing + 1} BATTERY`, TANK_BATTERY);
      case 'gas': return this.f(imperial() ? 'cuft/min' : 'l/min', String(Math.round(s.rmv)));
      default: return this.f('TTR', this.ttrText(v, s));
    }
  }

  /** §11.2 prompt, as in its figure: depth on top, then a cyan screen with NO (left buttons) and OK (right buttons). */
  private promptScreen(v: ComputerView, s: DiveSession): string {
    const g = this.prompt.offer!;
    const gas = s.allGases[g];
    const du = depthUnit();
    return `
      <div class="sr-top ez"><em>DEPTH</em><b>${depthText(v.depth)}<u>${du}</u></b></div>
      <div class="sr-prompt">
        <i class="no t">NO</i><i class="ok t">OK</i>
        <span>SWITCH TO</span><span>G${g + 1} ${Math.round(gas.o2 * 100)}%</span><span>MOD ${depthText(this.gasMods(s)[g])}<u>${du}</u></span>
        <i class="no b">NO</i><i class="ok b">OK</i>
      </div>`;
  }

  /**
   * §11.2 gas summary table, as in its figure: each gas (O2 % and tank pressure) and its MOD, the cursor in cyan.
   * NOTE: "tank pressure for a paired and active transmitter [...] OFF for a paired but DISABLED transmitter and NP
   * (NOT PAIRED) for a gas without a paired transmitter" (only G1 has one here).
   */
  private gasTableScreen(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const mods = this.gasMods(s);
    const rows = this.knownGases(s).map((gas, i) => {
      const p = i === 0 && this.transmitter && s.transmitterOn ? `${pressText(s.tankPressure)} ${pressUnit()}` : i === 0 ? 'OFF' : 'NP';
      return `<div class="sr-gt ${this.gasTable === i ? 'sel' : ''}"><span>G${i + 1} ${Math.round(gas.o2 * 100)}%<br>${p}</span><b>${depthText(mods[i])}<u>${du}</u></b></div>`;
    }).join('');
    return `<div class="sr-top ez"><em>DEPTH</em><b>${depthText(v.depth)}<u>${du}</u></b></div><div class="sr-gtab">${rows}</div>`;
  }

  /** Bottom row of the graphic screens (figures of §9.3 / §9.4): the tank pressure, or the dive time without a tank module. */
  private graphBottom(v: ComputerView, s: DiveSession): string {
    if (v.tank.ai) return `<div class="sr-low ez gb"><b>${pressText(v.tank.pressure)}</b><em>${pressUnit().toUpperCase()} G${s.breathing + 1}</em></div>`;
    return `<div class="sr-low ez gb"><b>${mmss(v.diveTime)}</b><em>DTIME</em></div>`;
  }

  private graphScreen(screen: Screen, v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const top = `<div class="sr-top ez"><em>DEPTH</em><b>${depthText(v.depth)}<u>${du}</u></b></div>`;
    if (screen === 'tissue') {
      // §9.3: "The graph shows the value of GF @SURF in each of the 16 tissues"; figure: off-gassing tissues in blue,
      // on-gassing ones in yellow, the GF high as a yellow line with its value.
      const g = s.tissues.gradientPercents(depthToPressure(0));
      const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
      const scale = Math.max(120, ...g);
      const bars = g.map((x, i) => `<i class="${s.tissues.n2[i] + s.tissues.he[i] < inspired ? 'yellow' : 'blue'}" style="height:${Math.round(Math.max(2, (Math.max(0, x) / scale) * 100))}%"></i>`).join('');
      const pos = (v.gfHigh / scale) * 100;
      return `${top}<div class="sr-tissue">${bars}<b style="bottom:${pos}%"></b><em style="bottom:${pos}%">${v.gfHigh}</em></div>${this.graphBottom(v, s)}`;
    }
    if (screen === 'profile') {
      // Figure of §9.4: profile in cyan over horizontal depth lines every 10 m.
      const pts = [...s.profile.map((p) => [p.t, p.depth] as const), [v.diveTime, v.depth] as const];
      const tMax = Math.max(60, v.diveTime);
      const dMax = Math.max(10, Math.ceil(v.maxDepth / 10) * 10);
      const xy = pts.map(([t, d]) => `${((t / tMax) * 220).toFixed(1)},${((d / dMax) * 100).toFixed(1)}`).join(' ');
      const lines = Array.from({ length: dMax / 10 + 1 }, (_, i) => `<line x1="0" x2="220" y1="${(i * 1000) / dMax}" y2="${(i * 1000) / dMax}"/>`).join('');
      return `${top}<svg class="sr-prof" viewBox="-2 -4 224 108" preserveAspectRatio="none">${lines}<polyline points="${xy}"/></svg>${this.graphBottom(v, s)}`;
    }
    // §9.4: "the list of decompression stops and the respective duration".
    const stops = v.plan.stops;
    const size = Math.min(26, Math.floor(104 / Math.max(1, stops.length) / 1.05));
    return `${top}<div class="sr-stops" style="font-size:${size}px">${stops.map((st) => `<div><span>${depthInt(st.depth)}<u>${du}</u></span><span>${Math.ceil(st.minutes)}:</span></div>`).join('')}</div>${this.graphBottom(v, s)}`;
  }

  /** §12 bottom timer: depth; average depth and temperature (or the ascent speed); dive time; §12.1 message. */
  private bottomTimer(v: ComputerView): string {
    const du = depthUnit();
    const right = this.ascending(v) ? this.f('SPEED', this.rateText(v)) : this.f('TEMP', `${Math.round(tempVal(v.temperature))}<u>${tempUnit()}</u>`);
    return `
      <div class="sr-top ez"><em>DEPTH</em><b>${depthText(v.depth)}<u>${du}</u></b></div>
      <div class="sr-bar cyan"></div>
      <div class="sr-mid">${this.f('AVG', `${depthText(v.avgDepth)}<u>${du}</u>`)}${right}</div>
      <div class="sr-bar cyan"></div>
      <div class="sr-low ez"><b>${mmss(v.diveTime)}</b><em>DTIME</em></div>
      <div class="sr-lock">LOCKED BY PREVIOUS DIVE</div>`;
  }

  /** Watch faces (§1.5.1), PRE-DIVE (§9), GF TABLE (§2.2) and POST DIVE (§10). */
  private surfaceScreen(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const { h, m } = clockOfDay(s);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const day = Math.floor((s.clock + 9 * 3600) / 86400);
    const date = new Date(2026, 8, 26 + day);
    const dayName = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
    // §12.1: "continuously displaying the message LOCKED BY PREVIOUS DIVE".
    const lock = this.locked ? `<div class="sr-lock">LOCKED BY PREVIOUS DIVE ${hmm(Math.max(0, (this.lockedUntil - s.clock) / 60))}</div>` : '';
    if (!this.hasDesat(s) && this.surfacePage === 'postdive') this.surfacePage = 'detail';
    if (this.surfacePage === 'predive') {
      // Figure of §9: MAIN GF on top (BATT and GF captions), the gas and its MOD, the G1 pressure ("GAS").
      const gases = this.knownGases(s);
      const mods = this.gasMods(s);
      const gasLine = gases.length > 1
        ? gases.map((g, i) => `<span>G${i + 1} ${Math.round(g.o2 * 100)}% ${depthText(mods[i])}<u>${du}</u></span>`).join('')
        : `<span>${gases[0].o2 > 0.215 ? 'EAN' : 'AIR'}</span><span>${Math.round(gases[0].o2 * 100)}% ${depthText(mods[0])}<u>${du}</u></span>`;
      const tank = v.tank.ai ? `<div class="sr-low ez pd"><b>${pressText(v.tank.pressure)}</b><em>${pressUnit().toUpperCase()}</em><i>GAS</i></div>` : '<div class="sr-low ez pd"></div>';
      return `
        <div class="sr-top pd"><i class="l">BATT</i><em>MAIN GF</em><b>${v.gfLow}/${v.gfHigh}</b><i class="r">GF</i></div>
        ${this.n2Bar(v, true)}
        <div class="sr-mid pdg ${gases.length > 1 ? 'multi' : ''}">${gasLine}</div>
        ${v.tank.ai ? this.tankBar(v, true) : '<div class="sr-bar n2"><i style="width:0"></i></div>'}
        ${tank}${lock}`;
    }
    if (this.surfacePage === 'gftable') {
      // Figure of §2.2 (GF TABLE): the GF in use on top, then MAIN and each reduction.
      const lvl = (k: string, step: number) => (this.settings[k] === 'off' ? 'OFF' : this.settings[k] === 'adv' ? '+5' : `-${step * Number(this.settings[k])}`);
      const [lo, hi] = [Math.round(this.baseParams().gfLow * 100), Math.round(this.baseParams().gfHigh * 100)];
      const rows = [
        ['MAIN', `${lo}/${hi}`, 'sel'],
        ['PHYSIO', lvl('physio', 10), ''],
        ['I TODAY', lvl('itoday', 5), ''],
        ['DIVE', lvl('dive', 3), ''],
        ['REP DIVES', this.settings.repetitive === 'on' ? 'ON' : 'OFF', ''],
        ['MULTIDAY', this.settings.multiday === 'on' ? 'ON' : 'OFF', ''],
      ].map(([a, b, c]) => `<div class="${c}"><span>${a}</span><span>${b}</span></div>`).join('');
      return `<div class="sr-gft"><h4>GF ${v.gfLow}/${v.gfHigh}</h4>${rows}</div>${lock}`;
    }
    if (this.surfacePage === 'postdive' && this.hasDesat(s)) {
      // Figure of §10: max depth and minimum temperature, dive time and time of day, then S.I., CNS%, DESAT,
      // no-fly time and GF NOW.
      const last = s.log[s.log.length - 1];
      const noFly = this.noFlyMin(s);
      return `
        <div class="sr-top post"><div class="sr-f"><em>MAX</em><b>${depthText(last.maxDepth)}<u>${du}</u></b></div><div class="sr-f"><em>MIN<br>TEMP</em><b>${Math.round(tempVal(last.minTemp))}<u>${tempUnit()}</u></b></div></div>
        ${this.n2Bar(v, true)}
        <div class="sr-mid post"><div class="sr-f"><em>DTIME</em><b>${Math.round(last.duration / 60)}:</b></div><div class="sr-f"><em>TIME OF DAY</em><b>${hh}:${mm}</b></div></div>
        <div class="sr-bar tank ${v.tank.ai ? this.tankColor(v) : ''}"><i style="width:${v.tank.ai ? Math.round((v.tank.pressure / v.tank.fill) * 100) : 0}%"></i><span class="sr-batt"></span></div>
        <div class="sr-post">
          <div><em>S.I.</em><b>${hmm((v.surfaceInterval ?? 0) / 60)}</b><em>CNS%</em><b>${Math.round(v.cns)}</b></div>
          <div><em>DESAT</em><b>${hmm(v.desat)}</b><i class="sr-nofly">✈</i><b>${hmm(noFly)}</b></div>
          <div><em>GF NOW</em><b>${Math.round(v.surfGf)}</b></div>
        </div>${lock}`;
    }
    if (this.surfacePage === 'big') {
      // Figure of §1.5.1 (BIG): day and date, hours in white, minutes in cyan.
      return `<div class="sr-big"><em>${dayName} ${date.getDate()}</em><b>${hh}</b><b class="c">${mm}</b></div>${lock}`;
    }
    // Figure of §1.5.1 (DETAIL): day and date, time, seconds, battery (fictitious value).
    const sec = String(Math.floor((s.clock + 9 * 3600) % 60)).padStart(2, '0');
    return `<div class="sr-detail"><em>${dayName} ${date.getDate()}</em><b>${hh}:${mm}</b><i>${sec}</i><span>${BATTERY}% <span class="sr-battico"></span></span></div>${lock}`;
  }
}

type SurfacePage = 'big' | 'detail' | 'postdive' | 'predive' | 'gftable';

interface Alarm {
  text: string;
  /** Lines as in the figure, when the message wraps. */
  lines?: string[];
  /** The top row turns red (CEILING!, RUNAWAY DECO; MOD! colours it too). */
  top?: boolean;
  /** The display switches to COMPLICATIONS. */
  full?: boolean;
}

const EZ_TOP = ['temp', 'max'] as const;

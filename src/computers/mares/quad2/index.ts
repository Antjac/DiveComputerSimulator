import { planAscent } from '../../../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { Acks } from '../../common/acks';
import { gfRate } from '../../common/predict';
import { sevenSeg } from '../../common/segments';
import { Quad2Rules } from './rules';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Pictograms printed on the case beside the buttons (product photos on mares.com): a stopwatch by
 * ENTER (TL-SP resets it), a round symbol by GF-LOG (TR, TR-LP: backlight; drawn as a bulb, deduced)
 * and the Bluetooth symbol by GAS-PLAN (BR-LP starts Bluetooth from POST DIVE, §1.5).
 */
const ICON_WATCH = '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5"/><path d="M8 9V6M6.5 2h3"/></svg>';
const ICON_LIGHT = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/><path d="M6 11h4M6.3 9.5C5 8.5 5 5 8 5s3 3.5 1.7 4.5"/></svg>';
const ICON_BT = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/><path d="M5.5 5.5l5 5L8 13V3l2.5 2.5-5 5"/></svg>';

/** §8: TR-SP sequence of the field to the right of the depth (figure of §1.5: temperature first). */
type TopField = 'temp' | 'max' | 'avg' | 'mod' | 'deep' | 'tts' | 'ceil';
/**
 * BR-SP sequence of the field to the right of the dive time. Order of the figure of §1.5 (O2 %, GF,
 * GF NOW, GF @SURF, ppO2, CNS, time of day, stopwatch), with GF @SURF / GF RATE of the §8 list after
 * GF @SURF (the text lists CNS before ppO2; OTU only in trimix, §10.4).
 */
type BottomField = 'o2' | 'gf' | 'gfnow' | 'gfsurf' | 'gfrate' | 'ppo2' | 'cns' | 'time' | 'sw';

/** Mares Quad 2: buttons and segmented LCD, after the manual's figures (rules in rules.ts). */
export class MaresQuad2 extends Quad2Rules {
  private topIdx = 0;
  private botIdx = 0;
  /** §7.3.3: over CNS 75 %, another bottom value stays 4 s (real ms). */
  private botUntil = 0;
  /** The diver chose a top field since the deep stop appeared (otherwise DEEP is shown, §2.8). */
  private topChosen = false;
  private stopwatchFrom = 0;
  private acks = new Acks();
  /** §8.3: MAIN and ALT GF calculations alternating (BR-LP on MAIN GF), opened at (real ms); 0: closed. */
  private altView = 0;
  private surfacePage: 'pre' | 'post' = 'pre';

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.topIdx = this.botIdx = 0;
    this.botUntil = 0;
    this.topChosen = false;
    this.stopwatchFrom = 0;
    this.altView = 0;
    this.acks.clear();
  }

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'post';
  }

  // -------------------------------------------------------------------------
  // Buttons (§1.5): TL, TR, BL, BR; short press (SP) and press of one second (LP).

  private altShown(): boolean {
    if (this.altView && performance.now() - this.altView > 10_000) this.altView = 0;
    return this.altView !== 0;
  }

  press(button: string, s: DiveSession): boolean {
    // §7.3.4.2, §2.4: ALT, the violation symbol and the warnings stay until any button is pressed.
    this.acks.ackAll();
    if (!s.inDive) {
      // §1.5: BL-SP toggles PRE-DIVE and MENU, POST DIVE being part of the loop (menus not simulated).
      if (button === 'bl' && this.hasDesat(s)) this.surfacePage = this.surfacePage === 'pre' ? 'post' : 'pre';
      return true;
    }
    // §8.3: "Any other button operation will revert to the normal display".
    if (this.altShown()) {
      this.altView = 0;
      return true;
    }
    const v = this.lastView;
    if (this.locked) {
      // §11: TR-SP changes the top right field (max, avg, temperature), TL-SP resets the stopwatch.
      if (button === 'tr') this.topIdx = (this.topIdx + 1) % 3;
      if (button === 'tl') this.stopwatchFrom = s.diveTime;
      return true;
    }
    switch (button) {
      case 'tl':
        // §8: "The stopwatch can be reset by TL-SP even when the stopwatch is not displayed" (and a bookmark).
        this.stopwatchFrom = s.diveTime;
        return true;
      case 'tr':
        this.topIdx = (this.topIdx + 1) % this.topFields(s, v).length;
        this.topChosen = true;
        return true;
      case 'br': {
        // §10.2: BR-SP while G1 blinks starts the switch; during the sequence, the next available gas.
        if (this.seq.gas !== null) {
          this.seq.next(s, this.seqMods(s));
          return true;
        }
        if (this.prompt.offer !== null) {
          this.seq.start(s, this.seqMods(s), this.prompt.offer);
          this.prompt.offer = null;
          return true;
        }
        const fields = this.bottomFields(s, v);
        this.botIdx = (this.botIdx + 1) % fields.length;
        // §7.3.3: over CNS 75 %, "you can view any other value, but it will remain for 4s only".
        this.botUntil = v !== null && v.cns >= 75 && fields.includes('cns') ? performance.now() + 4000 : 0;
        return true;
      }
      default:
        return false;
    }
  }

  hold(button: string, s: DiveSession): boolean {
    this.acks.ackAll();
    if (button === 'tr') {
      // §8.3: TR-LP activates the alternate gradient factors while both calculations are shown.
      if (s.inDive && this.altShown()) {
        this.activateAlt();
        this.altView = 0;
        return true;
      }
      this.backlightUntil = performance.now() + 6000; // §2.15: 6 s by default
      return true;
    }
    if (!s.inDive) return false;
    if (this.altShown()) {
      this.altView = 0;
      return true;
    }
    if (button === 'bl') {
      // §8: "With BL-LP you can hide/show the seconds in the dive time."
      this.settings.seconds = this.settings.seconds === 'off' ? 'on' : 'off';
      return true;
    }
    if (button !== 'br' || this.locked) return false;
    // §10.2: "Use BR-LP to confirm the switch".
    if (this.seq.gas !== null) {
      this.seq.confirm(s, this.seqMods(s));
      this.botIdx = 0; // "the set oxygen concentration will be displayed steadily in the lower right corner"
      return true;
    }
    // §10.2 NOTE: BR-LP on MAIN GF initiates the ALT GF visualization (§8.3, while the MAIN GF are in use);
    // otherwise it initiates the gas switch sequence.
    // During the prompt the lower right corner shows the O2 %, not MAIN GF.
    const v = this.lastView;
    if (this.prompt.offer === null && this.bottomNow(s, v) === 'gf') {
      if (this.altActive) return false;
      this.altView = performance.now();
      return true;
    }
    if (this.knownGases(s).length > 1) {
      this.seq.start(s, this.seqMods(s), this.prompt.offer);
      this.prompt.offer = null;
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      tl: {
        name: 'TL',
        press: { real: { fr: 'Remet le chronomètre à zéro (et pose un repère dans le profil)', en: 'Resets the stopwatch (and sets a bookmark in the profile)' }, simulated: true, note: { fr: 'sans repère', en: 'no bookmark' } },
        hold: null,
      },
      tr: {
        name: 'TR',
        press: { real: { fr: 'Champ à droite de la profondeur : température, max, moyenne, MOD, deep stop, TTS @+5, plafond', en: 'Field right of the depth: temperature, max, average, MOD, deep stop, TTS @+5, ceiling' }, simulated: true },
        hold: { real: { fr: 'Rétroéclairage ; pendant l’affichage MAIN / ALT GF, active les GF alternatifs', en: 'Backlight; while MAIN / ALT GF are shown, activates the alternate GF' }, simulated: true, note: { fr: '6 s (réglage par défaut)', en: '6 s (default setting)' } },
      },
      bl: {
        name: 'BL',
        press: { real: { fr: 'Surface : PRE-DIVE, POST DIVE et MENU', en: 'Surface: PRE-DIVE, POST DIVE and MENU' }, simulated: true, note: { fr: 'menus non simulés', en: 'menus not simulated' } },
        hold: { real: { fr: 'Affiche ou masque les secondes du temps de plongée', en: 'Shows or hides the seconds of the dive time' }, simulated: true },
      },
      br: {
        name: 'BR',
        press: { real: { fr: 'Champ à droite du temps de plongée : O2 %, GF, GF NOW, GF @SURF, GF RATE, ppO2, CNS, heure, chronomètre ; pendant un changement de gaz, gaz suivant', en: 'Field right of the dive time: O2 %, GF, GF NOW, GF @SURF, GF RATE, ppO2, CNS, time of day, stopwatch; during a gas switch, next gas' }, simulated: true },
        hold: { real: { fr: 'Changement de gaz (confirmation pendant la séquence) ; avec MAIN GF affiché : calculs MAIN et ALT GF alternés 10 s', en: 'Gas switch (confirms during the sequence); with MAIN GF shown: MAIN and ALT GF calculations alternating for 10 s' }, simulated: true },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Fields.

  /** §8: TR-SP sequence; MOD hidden in AIR (§8 NOTE), deep stop "if active and calculated", TTS @+5 in deco (§8.2). */
  private topFields(s: DiveSession, v: ComputerView | null): TopField[] {
    const f: TopField[] = ['temp', 'max', 'avg'];
    if (this.nitrox(s)) f.push('mod');
    if (this.deep.shown) f.push('deep');
    if (v?.inDeco) f.push('tts');
    f.push('ceil');
    return f;
  }

  /** §8: BR-SP sequence; MOD, CNS and ppO2 hidden in AIR (§8 NOTE) unless CNS reaches 75 % (§7.3.3). */
  private bottomFields(s: DiveSession, v: ComputerView | null): BottomField[] {
    const nx = this.nitrox(s);
    const f: BottomField[] = ['o2', 'gf', 'gfnow', 'gfsurf', 'gfrate'];
    if (nx) f.push('ppo2', 'cns');
    else if (v && v.cns >= 75) f.push('cns');
    f.push('time', 'sw');
    return f;
  }

  private bottomNow(s: DiveSession, v: ComputerView | null): BottomField {
    const fields = this.bottomFields(s, v);
    if (this.botUntil && performance.now() > this.botUntil) {
      this.botUntil = 0;
      this.botIdx = fields.indexOf('cns');
    }
    let f = fields[this.botIdx % fields.length];
    if (v && v.cns >= 75 && fields.includes('cns') && !this.botUntil) f = 'cns';
    return f;
  }

  // -------------------------------------------------------------------------
  // Display.

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    const lcd = !v.inDive ? this.surface(v, s) : this.locked ? this.bottomTimer(v, s) : this.dive(v, s);
    el.innerHTML = `
      <div class="dev q2">
        <div class="q2-case">
          <span class="q2-pr tl"><b>ENTER</b><i class="q2-ico">${ICON_WATCH}</i></span>
          <span class="q2-pr tr"><small>UP</small><b>GF-LOG</b><i class="q2-ico">${ICON_LIGHT}</i></span>
          <span class="q2-pr bl"><b>DISPLAY</b><small>BACK</small></span>
          <span class="q2-pr br"><b>GAS-PLAN</b><i class="q2-ico">${ICON_BT}</i><small>DOWN</small></span>
          <span class="q2-side"><b>DEPTH</b><b>DECO</b><b>TIME</b></span>
          <span class="q2-scale"><i class="r"></i>${'<i></i>'.repeat(9)}</span>
          <span class="q2-algo">ZH-L16C GF</span>
          <button class="q2-btn tl" data-btn="tl" aria-label="TL"></button>
          <button class="q2-btn tr" data-btn="tr" aria-label="TR"></button>
          <button class="q2-btn bl" data-btn="bl" aria-label="BL"></button>
          <button class="q2-btn br" data-btn="br" aria-label="BR"></button>
          <div class="q2-lcd ${this.backlit ? 'backlit' : ''}">${lcd}</div>
        </div>
      </div>`;
  }

  /** Dive time, mm:ss (figures of §8) or minutes only once BL-LP hid the seconds. */
  private diveTimeText(sec: number): string {
    const m = Math.floor(sec / 60);
    if (this.settings.seconds === 'off' || m > 99) return `${Math.min(999, m)}`;
    return `${m}:${pad2(Math.floor(sec % 60))}`;
  }

  private dive(v: ComputerView, s: DiveSession): string {
    this.acks.begin();
    const du = depthUnit();
    const surfacing = v.depth < 1.2;
    const nx = this.nitrox(s);
    const multi = this.knownGases(s).length > 1;

    // Warnings (§2.4) and messages kept until a button is pressed.
    const warns = new Set(this.activeWarnings(v).filter((w) => this.acks.show(`w-${w}`)));
    for (const w of ['max', 'time', 'half', 'nodeco', 'deco', 'gfsurf']) if (!this.activeWarnings(v).includes(w)) this.acks.show(`w-${w}`, false);
    const altBlink = this.acks.show('alt', this.altBySystem);
    const violBlink = this.acks.show('viol', this.violation !== null);

    // Top-right field.
    const tops = this.topFields(s, v);
    let top: TopField = tops[this.topIdx % tops.length];
    if (this.deep.shown && !this.topChosen) top = 'deep'; // §2.8: "shown in the top right corner"
    const first = v.plan.stops[0];
    // §2.14: with CEIL-CON, the ceiling becomes the default "once you are within 3 m / 10 ft of the deepest stop".
    const ceilCon = this.ceilCon(v.ceiling);
    if (ceilCon && first && v.depth <= first.depth + 3) top = 'ceil';
    const modAlarm = v.depth > v.mod;
    if (modAlarm) top = 'mod'; // §7.3.2: "the MOD is shown next to it"
    if (this.seq.gas !== null) top = 'mod'; // §10.2: MOD of the proposed gas, blinking

    // Bottom-right field.
    let bot = this.bottomNow(s, v);
    if (warns.has('gfsurf')) bot = 'gfsurf'; // §2.4.5: GF @SURF blinks
    const switching = this.prompt.offer !== null || this.seq.gas !== null;
    if (switching) bot = 'o2';
    const slow = v.ascentLevel === 2 && !surfacing;

    // Middle row.
    const ascending = v.ascentRate >= 1 && !surfacing; // threshold not given: 1 m/min assumed (no flicker at a stop)
    const mid: Mid = { left: '', leftUnit: '', labels: [], r1: '', r2: '' };
    if (ascending) Object.assign(mid, { left: String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)), leftUnit: 'speed', leftBlink: slow });
    const altCalc = this.altShown() ? this.altCalc(v, s) : null;
    const calc = altCalc && Math.floor(performance.now() / 1000) % 2 === 1 ? altCalc : null;
    const stopDepth = calc ? calc.stopDepth : v.stopDepth;
    const inDeco = calc ? calc.stopDepth > 0 : v.inDeco && v.stopDepth > 0;
    const safety = v.safety.state;
    if (surfacing) {
      // §9: "The screen shows the surfacing mode countdown timer."
      const t = Math.max(0, DIVE_END_TIMEOUT - s.surfaceTimer);
      Object.assign(mid, { r1: `${Math.floor(t / 60)}:`, r2: pad2(Math.floor(t % 60)) });
    } else if (inDeco) {
      // §8.1: depth of the deepest stop, its time (minutes) and the total ascent time (figures: "6 m DECO 2: 12:").
      const stopMin = calc ? calc.stopMin : v.stopTime;
      const tts = calc ? calc.tts : v.tts;
      if (!ascending) Object.assign(mid, { left: String(depthInt(stopDepth)), leftUnit: 'depth' });
      const blink = (this.altShown() ? 'blink' : '') || (warns.has('deco') ? 'blink' : '');
      Object.assign(mid, { labels: ['DECO', 'TTS'], r1: `${Math.min(99, stopMin)}:`, r2: `${Math.min(99, tts)}:`, blink, leftBlink: v.ceilingViolation === 2 || !!blink });
    } else if (safety === 'active' || safety === 'paused') {
      // §8.1: "always shown as a 3-minute countdown in minutes and seconds".
      const t = Math.ceil(v.safety.remaining);
      Object.assign(mid, { labels: ['SAFE'], r1: `${Math.floor(t / 60)}:`, r2: pad2(t % 60) });
    } else if (safety === 'done' && this.plus === 'active') {
      // §8.1.2 figure: "+" on the left, SAFE ✓, the SAFETY STOP + countdown.
      const t = Math.ceil(this.plusRemaining);
      if (!ascending) Object.assign(mid, { alpha: '+' });
      Object.assign(mid, { labels: ['SAFE', '✓'], r1: `${Math.floor(t / 60)}:`, r2: pad2(t % 60) });
    } else if (safety === 'done' && v.depth < 6) {
      // §8.1.1: "a check mark appears and a countup timer starts as long as you stay shallower than 6 m".
      const t = Math.floor(this.countUp);
      Object.assign(mid, { labels: ['SAFE', '✓'], r1: `${Math.min(99, Math.floor(t / 60))}:`, r2: pad2(t % 60) });
    } else if (this.deep.state === 'active') {
      // Figure of §8.1: at the deep stop, its 2-minute countdown in minutes and seconds ("NO DECO 1:59").
      const t = Math.ceil(this.deep.remaining);
      Object.assign(mid, { labels: ['NO DECO'], r1: `${Math.floor(t / 60)}:`, r2: pad2(t % 60) });
    } else {
      // NO DECO time in minutes (figures: "27:"); 99 at most (assumed).
      Object.assign(mid, { labels: ['NO DECO'], r1: `${Math.min(99, v.ndl)}:`, blink: warns.has('nodeco') ? 'blink' : '' });
    }

    const viewGf = calc ? calc.gf : null;
    const bottom = surfacing
      ? this.bottomValue('gfnow', v, s, false)
      : slow
        ? { lbl: [], alpha: 'SLOW', blink: true, units: [] }
        : this.bottomValue(bot, v, s, warns.has('gfsurf'), viewGf, this.altShown());
    const above = v.ceilingViolation === 2;
    return this.lcd({
      depth: surfacing ? '---' : depthText(v.depth),
      depthBlink: modAlarm || above || warns.has('max') || (ceilCon && v.ceilingViolation > 0),
      unit: du,
      tri: modAlarm ? 'up' : above ? 'down' : '',
      icons: {
        fast: this.violation === 'ascent' ? (violBlink ? 'blink' : 'on') : slow ? 'blink' : '',
        missed: this.violation === 'deco' ? (violBlink ? 'blink' : 'on') : '',
      },
      top: surfacing ? this.topValue('temp', v, s, false) : this.topValue(top, v, s, modAlarm, altBlink, ceilCon && v.ceilingViolation > 0),
      mid: { ...mid, leftBlink: mid.leftBlink || (above && !ascending) },
      bottom: {
        left: this.diveTimeText(v.diveTime),
        leftBlink: warns.has('time') || warns.has('half'),
        gas: multi ? (this.seq.gas ?? s.breathing) + 1 : 0,
        gasBlink: switching,
        switchLbl: switching,
        ...bottom,
        // §10.2: SWITCH and the O2 % blink during the prompt and the sequence.
        blink: bottom.blink || switching,
      },
      bar: v.inDeco ? 10 : Math.min(10, Math.floor(v.n2Load / 10)),
      nx,
    });
  }

  /** §8.3: the decompression data with the ALT GF, alternating with the MAIN ones. */
  private altCalc(v: ComputerView, s: DiveSession): { stopDepth: number; stopMin: number; tts: number; gf: string } {
    const ap = this.altParams(s);
    const p = { ...ap, gases: this.planGases(s) };
    const plan = planAscent(s.tissues, v.depth, s.gas, p, this.anchor, 1 / 6);
    const st = plan.stops[0];
    return { stopDepth: st ? st.depth : 0, stopMin: st ? Math.ceil(st.minutes) : 0, tts: plan.tts, gf: `${Math.round(ap.gfLow * 100)}:${Math.round(ap.gfHigh * 100)}` };
  }

  private topValue(f: TopField, v: ComputerView, s: DiveSession, modBlink: boolean, alt = false, ceilBlink = false): TopView {
    const du = depthUnit();
    // §7.3.4.2: "display ALT blinking in the top right corner" until a button is pressed.
    if (alt) return { lbl: [], alpha: 'ALt', unit: '', blink: true };
    switch (f) {
      case 'temp': return { lbl: [], value: String(Math.round(tempVal(v.temperature))), unit: tempUnit() };
      case 'max': return { lbl: ['MAX'], value: depthText(v.maxDepth), unit: du };
      case 'avg': return { lbl: ['AVG'], value: depthText(v.avgDepth), unit: du };
      case 'mod': {
        const g = this.seq.gas;
        if (g !== null) return { lbl: ['MOD'], value: depthText(this.gasMods(s)[g]), unit: du, blink: true };
        return { lbl: ['MOD'], value: depthText(v.mod), unit: du, blink: modBlink };
      }
      case 'deep': return { lbl: ['DEEP'], value: this.deep.shown ? String(depthInt(this.deep.depth)) : '', unit: du };
      // §8.2 figure: "TTS @+5" and the minutes.
      case 'tts': return { lbl: ['TTS'], value: String(Math.min(999, this.ttsPlus(v, s))), unit: '', plus: Number(this.settings.future) || 5 };
      // Terminology: "QUAD 2 shows the ceiling only if the value is greater than 6 m / 20 ft."
      case 'ceil': return { lbl: ['CEILING'], value: v.ceiling > 6 ? depthText(v.ceiling) : '', unit: v.ceiling > 6 ? du : '', blink: ceilBlink };
    }
  }

  private bottomValue(f: BottomField, v: ComputerView, s: DiveSession, blink: boolean, altGf: string | null = null, gfBlink = false): BottomView {
    const surf = Math.round(v.surfGf);
    switch (f) {
      case 'o2': {
        const g = this.seq.gas ?? s.breathing;
        // §8 NOTE / figure of §8.1: in AIR, "AIR" instead of the O2 %.
        if (!this.nitrox(s)) return { lbl: [], alpha: 'AIR', units: [] };
        return { lbl: [], value: String(Math.round((s.allGases[g] ?? s.gas).o2 * 100)), units: ['O2', '%'] };
      }
      case 'gf': {
        // §8.3: ALT GF and its values replace MAIN GF once activated; both blink while alternating.
        if (altGf) return { lbl: ['ALT', 'GF'], value: altGf, units: [], blink: true };
        return { lbl: this.altActive ? ['ALT', 'GF'] : ['GF'], value: `${v.gfLow}:${v.gfHigh}`, units: [], blink: gfBlink };
      }
      case 'gfnow': return { lbl: ['GF', 'NOW'], value: String(Math.round(v.gf99)), units: [] };
      case 'gfsurf': {
        // §8.1.1: GF @+3 next to GF @SURF once the safety stop countdown begins (figure: "83:78").
        const st = v.safety.state;
        if (st === 'active' || st === 'paused' || (st === 'done' && this.plus === 'active')) return { lbl: ['GF', '@SURF'], value: `${Math.min(99, surf)}:${Math.min(99, this.gfAt3(v, s))}`, units: [] };
        return { lbl: ['GF', '@SURF'], value: String(surf), units: [], blink };
      }
      case 'gfrate': {
        // §8: GF @SURF (2 s) alternating with GF RATE (4 s). How GF RATE is labelled is not shown: GF only, "-" when falling (assumed).
        if (performance.now() % 6000 < 2000) return { lbl: ['GF', '@SURF'], value: String(surf), units: [] };
        const r = gfRate(s, v.depth);
        return { lbl: ['GF'], value: `${r.r < 0 ? '-' : ''}${r.text}`, units: [] };
      }
      case 'ppo2': return { lbl: [], value: v.ppO2.toFixed(2), units: ['PPO2', 'bar'], blink: v.depth > v.mod };
      case 'cns': return { lbl: [], value: String(Math.round(v.cns)), units: ['CNS%'], blink: v.cns >= 75 };
      case 'time': {
        const { h, m } = clockOfDay(s);
        return { lbl: [], value: `${h}:${pad2(m)}`, units: [] };
      }
      case 'sw': return { lbl: ['SW'], value: this.swText(v.diveTime - this.stopwatchFrom), units: [] };
    }
  }

  private swText(sec: number): string {
    const t = Math.max(0, Math.floor(sec));
    const m = Math.floor(t / 60);
    return m > 99 ? String(Math.min(9999, m)) : `${m}:${pad2(t % 60)}`;
  }

  /** §11 figure: depth, top right field, BT and the time of day, dive time and stopwatch; violation symbols (§11.1). */
  private bottomTimer(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const tops: TopField[] = ['temp', 'max', 'avg'];
    const top = tops[this.topIdx % tops.length];
    const { h, m } = clockOfDay(s);
    const ascending = v.ascentRate > 0.3 && v.depth >= 1.2;
    return this.lcd({
      depth: v.depth < 1.2 ? '---' : depthText(v.depth),
      unit: du,
      icons: { fast: this.lockCause === 'ascent' ? 'on' : '', missed: this.lockCause === 'deco' ? 'on' : '' },
      top: this.topValue(top, v, s, false),
      mid: {
        left: ascending ? String(Math.round(imperial() ? v.ascentRate * 3.28084 : v.ascentRate)) : '',
        leftUnit: ascending ? 'speed' : '',
        labels: ['BT', 'TIME'],
        r1: `${h}:`,
        r2: pad2(m),
      },
      bottom: { left: this.diveTimeText(v.diveTime), lbl: ['SW'], value: this.swText(v.diveTime - this.stopwatchFrom), units: [] },
      bar: 0,
      nx: false,
    });
  }

  /** PRE-DIVE (§8 figure) and POST DIVE, two pages alternating every 4 s (§9 figures). */
  private surface(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    if (!this.hasDesat(s)) this.surfacePage = 'pre';
    const nx = this.nitrox(s);
    const icons = { fast: this.locked && this.lockCause === 'ascent' ? 'on' : '', missed: this.locked && this.lockCause === 'deco' ? 'on' : '' };
    const { h, m } = clockOfDay(s);
    const bar = Math.min(10, Math.floor(v.n2Load / 10));
    const last = s.log[s.log.length - 1];
    if (this.surfacePage === 'post' && last) {
      if (Math.floor(performance.now() / 4000) % 2 === 1) {
        // Condensed log: "maximum depth, lowest temperature, dive time and GF @SURF at the end of the dive".
        return this.lcd({
          depth: depthText(last.maxDepth), unit: du, icons, bar, nx,
          top: { lbl: [], value: String(Math.round(tempVal(last.minTemp))), unit: tempUnit() },
          // The figures show NO DECO lit (a no-deco dive): DECO after a deco dive deduced.
          mid: { left: '', leftUnit: '', labels: [this.hadDeco ? 'DECO' : 'NO DECO', 'TIME'], r1: `${h}:`, r2: pad2(m) },
          bottom: { left: this.swText(last.duration), lbl: ['GF', '@SURF'], value: String(Math.round(this.lastSurfGf)), units: [] },
        });
      }
      // DESAT and NO-FLY in hours (figure: "13 h DESAT", "✈ 11 h"), time of day, S.I. and GF NOW.
      const si = s.surfaceInterval ?? 0;
      return this.lcd({
        depth: String(Math.ceil(v.desat / 60)), hours: true, unit: '', icons: { ...icons, plane: true }, bar, nx,
        top: { lbl: [], value: String(Math.ceil(this.noFlyMin(s) / 60)), unit: 'h' },
        mid: { left: '', leftUnit: '', labels: ['TIME'], r1: `${h}:`, r2: pad2(m) },
        bottom: { left: `${Math.min(99, Math.floor(si / 3600))}:${pad2(Math.floor((si % 3600) / 60))}`, si: true, lbl: ['GF', 'NOW'], value: String(Math.round(v.gf99)), units: [] },
      });
    }
    // PRE-DIVE: "the active GF values, the active gas and its MOD" (figure: MOD 34.1, "32 O2", "GF R0").
    return this.lcd({
      depth: '---', unit: du, icons, bar, nx,
      top: nx ? { lbl: ['MOD'], value: depthText(v.mod), unit: du } : { lbl: [], value: '', unit: '' },
      mid: { left: '', leftUnit: '', labels: this.locked ? ['BT'] : [], r1: `${h}:`, r2: pad2(m) },
      bottom: { left: nx ? String(v.o2) : '', leftAlpha: nx ? '' : 'AIR', leftO2: nx, lbl: ['GF'], alpha: this.settings.gf, units: [] },
    });
  }

  /** The LCD, drawn like the manual's figures: every printed label and segment is there, unlit ones in light grey. */
  private lcd(d: LcdState): string {
    const L = (t: string, on: boolean, cls = '', blink = false) => `<span class="q2-l ${cls} ${on ? 'on' : ''} ${on && blink ? 'blink' : ''}">${t}</span>`;
    const top = d.top;
    const mid = d.mid;
    const bot = d.bottom;
    const tl = new Set(top.lbl);
    const ml = new Set(mid.labels);
    const bl = new Set(bot.lbl);
    const bu = new Set(bot.units);
    const imp = imperial();
    const bar = Array.from({ length: 10 }, (_, i) => `<i class="${9 - i < d.bar ? 'on' : ''}"></i>`).join('');
    const topTemp = top.unit === '°C' || top.unit === '°F';
    const topLen = top.alpha ? '' : top.value ?? '';
    return `
      <div class="q2-bar">${bar}</div>
      <div class="q2-depth ${d.depthBlink ? 'blink' : ''}">${sevenSeg(d.depth, 3, 'q2-d')}</div>
      ${L('h', !!d.hours, 'q2-h')}${L(d.unit === 'ft' ? 'ft' : 'm', !d.hours && !!d.unit, 'q2-dm')}
      ${L('▲', d.tri === 'up', 'q2-tup', true)}${L('▼', d.tri === 'down', 'q2-tdn', true)}
      ${L('DESAT', !!d.hours, 'q2-desat')}
      <svg class="q2-mtn" viewBox="0 0 30 26"><path d="M1 25 L15 2 L29 25 Z M8 25 L15 13 L22 25" /></svg>
      <span class="q2-batt"></span>${L('✈', !!d.icons.plane, 'q2-plane')}
      <span class="q2-tlbl">${L('CEILING', tl.has('CEILING'), '', !!top.blink)}${L('MAX', tl.has('MAX'))}${L('DEEP', tl.has('DEEP'))}${L('AVG', tl.has('AVG'))}${L('MOD', tl.has('MOD'), '', !!top.blink)}</span>
      ${L(`TTS<br>@+${top.plus ?? 5}`, tl.has('TTS'), 'q2-ttst')}
      <div class="q2-top ${top.blink ? 'blink' : ''}">${top.alpha ? `<span class="q2-alpha">${top.alpha}</span>` : sevenSeg(topLen, 3, 'q2-t')}</div>
      ${L('h', top.unit === 'h', 'q2-th')}${L(imp ? '°F' : '°C', topTemp, 'q2-tc')}${L(top.unit === 'ft' ? 'ft' : 'm', top.unit === 'm' || top.unit === 'ft', 'q2-tm')}
      <div class="q2-hr r1"></div>
      <div class="q2-left ${mid.leftBlink ? 'blink' : ''}">${mid.alpha ? `<span class="q2-alpha">${mid.alpha}</span>` : sevenSeg(mid.left, 2, 'q2-m')}</div>
      ${L(imp ? 'ft' : 'm', mid.leftUnit === 'depth', 'q2-lu', !!mid.leftBlink)}${L(`${imp ? 'ft' : 'm'}<br>min`, mid.leftUnit === 'speed', 'q2-spd')}
      <span class="q2-mlbl">${L('NO', ml.has('NO DECO'))}${L('DECO', ml.has('NO DECO') || ml.has('DECO'), '', mid.blink === 'blink')}<br>${L('BT', ml.has('BT'))}${L('SAFE', ml.has('SAFE'))}</span>
      <span class="q2-icons">${L('↑!!', !!d.icons.fast, 'q2-fast', d.icons.fast === 'blink')}${L('⧗', !!d.icons.missed, 'q2-hg', d.icons.missed === 'blink')}${L('✓', ml.has('✓'), 'q2-check')}</span>
      <span class="q2-rlbl">${L('TIME', ml.has('TIME'))}${L('IN', false)}${L('OUT', false)}${L('TTS', ml.has('TTS'))}</span>
      <div class="q2-r1 ${mid.blink ?? ''}">${sevenSeg(mid.r1, 2, 'q2-m')}</div>
      <div class="q2-r2 ${mid.blink ?? ''}">${sevenSeg(mid.r2, 2, 'q2-m')}</div>
      <div class="q2-hr r2"></div>
      ${L('S.I.', !!bot.si, 'q2-si')}
      <div class="q2-time ${bot.leftBlink ? 'blink' : ''}">${bot.leftAlpha ? `<span class="q2-alpha">${bot.leftAlpha}</span>` : sevenSeg(bot.left, 4, 'q2-b')}</div>
      ${L('O₂', !!bot.leftO2, 'q2-o2l')}
      ${L('SWITCH', !!bot.switchLbl, 'q2-switch', true)}${L(`G${bot.gas || 1}`, !!bot.gas, 'q2-gas', !!bot.gasBlink)}
      <span class="q2-blbl">${L('ALT', bl.has('ALT'), '', !!bot.blink)}${L('GF', bl.has('GF'), '', !!bot.blink)}${L('NOW', bl.has('NOW'))}${L('@SURF', bl.has('@SURF'))}${L('⏱', bl.has('SW'), 'q2-sw')}</span>
      <div class="q2-br ${bot.blink ? 'blink' : ''}">${bot.alpha ? `<span class="q2-alpha">${bot.alpha}</span>` : sevenSeg(bot.value ?? '', 4, 'q2-b')}</div>
      <span class="q2-units">${L('O₂', bu.has('O2'))}${L('%', bu.has('O2'))}<br>${L('PPO₂', bu.has('PPO2'))}<br>${L('CNS%', bu.has('CNS%'))}<br>${L('OTU', false)}<br>${L('bar', bu.has('bar'))}</span>`;
  }
}

interface TopView {
  lbl: string[];
  value?: string;
  alpha?: string;
  unit: string;
  blink?: boolean;
  plus?: number;
}

interface Mid {
  left: string;
  leftUnit: '' | 'depth' | 'speed';
  leftBlink?: boolean;
  alpha?: string;
  labels: string[];
  r1: string;
  r2: string;
  blink?: string;
}

interface BottomView {
  lbl: string[];
  value?: string;
  alpha?: string;
  units: string[];
  blink?: boolean;
}

interface BottomState extends BottomView {
  left: string;
  leftAlpha?: string;
  leftO2?: boolean;
  leftBlink?: boolean;
  si?: boolean;
  gas?: number;
  gasBlink?: boolean;
  switchLbl?: boolean;
}

interface LcdState {
  depth: string;
  depthBlink?: boolean;
  hours?: boolean;
  unit: string;
  tri?: '' | 'up' | 'down';
  icons: { fast?: string; missed?: string; plane?: boolean };
  top: TopView;
  mid: Mid;
  bottom: BottomState;
  bar: number;
  nx: boolean;
}

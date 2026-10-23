import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, imperial, pressText, pressUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay, hmm } from '../../base';
import { decoSummary, diveProfile, gasSummary, saturation } from '../altPages';
import { idealAscent, levelParams } from '../common';
import { type G3Warning, G3Rules, type LevelInfo } from './rules';

const DU = () => (imperial() ? 'FEET' : 'METER');
const DU1 = () => (imperial() ? 'FT' : 'M');

/** Alternate displays reached by holding an arrow (§3.5.2.6, §3.8.1.2). */
type AltPage = 'gas' | 'deco' | 'profile' | 'sat';

/** A data window: green header (label, unit) and its value; `hl` colours it (yellow warning, red alarm). */
interface Win {
  lbl: string;
  unit?: string;
  val: string;
  hl?: '' | 'yellow' | 'red';
  /** Value colour when the header is not highlighted (deco stops in orange, level stops in white). */
  cls?: string;
}

/** Fictitious battery level (not simulated): a full battery icon, as on the figures. */
const BATTERY = '<span class="g3-batt"><i></i><i></i><i></i><i></i><i></i></span>';

/** Stop value as on the figures: "1: 3" with MINUTE / METER underneath. */
function stopValue(minutes: number, depth: number): string {
  return `<span>${minutes}:</span><span class="g3-gap">${depthInt(depth)}</span><em class="g3-sub l">MINUTE</em><em class="g3-sub r">${DU()}</em>`;
}

/** Stopwatch as on the figure of §3.6.9 ("0h01.38"). */
function stopwatch(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}.${String(s % 60).padStart(2, '0')}`;
}

/** Scubapro G3: four buttons and a round colour display, after the manual (rules in rules.ts). */
export class ScubaproG3 extends G3Rules {
  /** Information window shown (index in the sequence of the active layout, §3.8.1.2 table). */
  private info = 0;
  /** Stopwatch: started at the immersion (§3.8.3), reset with BOOK while it is shown (§3.8.2 note). */
  private swStart = 0;
  /** §3.5.2 gas switch screen: gas proposed, from the prompt or from BOOK held; null when closed. */
  private sw: number | null = null;
  private swFromPrompt = false;
  private swAt = 0;
  private successUntil = 0;
  private successGas = 0;
  /** Alternate displays (arrow held): page shown, real time opened and of the last press. */
  private alt: { page: AltPage; opened: number; last: number } | null = null;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.info = 0;
    this.swStart = s.clock;
    this.sw = null;
    this.alt = null;
  }

  /** Gases that can be breathed at this depth, other than the current one (T1 always). */
  private candidates(s: DiveSession): number[] {
    const mods = this.gasMods(s);
    return mods.map((m, i) => (i !== s.breathing && (i === 0 || s.depth <= m) ? i : -1)).filter((i) => i >= 0);
  }

  /** The layout on display: Light switches to Classic while stops are needed (§3.8.1.1). */
  private layout(v: ComputerView, lv: LevelInfo): 'light' | 'classic' {
    return this.settings.screen === 'light' && !(v.inDive && (v.inDeco || lv.stop)) ? 'light' : 'classic';
  }

  /**
   * §3.8.1.2 table: windows scrolled with the arrows, in order (heart rate and skin temperature need
   * the belt: left out). Light: tank pressure and O2 %, max depth, RBT, temperature, MB L0 (100/100)
   * information, active MB level (GF) if not L0, battery, time of day, PDIS, OTU, CNS %. Classic: max
   * depth, ppO2, average depth, MB L0 information, active MB level if not L0, stopwatch, battery, PDIS,
   * OTU, CNS %. Labels of the figures where shown ("MAX M", "STOPW", "BATTERY", "MB LEVEL", "GRD FCT",
   * "CNSO2 %", "AVG M" of the gauge figure); the others deduced.
   */
  private infoSeq(v: ComputerView, s: DiveSession, light: boolean): Win[] {
    const gf = this.gfMode;
    const base = v.inDeco ? `${depthInt(v.stopDepth)}${DU1()} ${v.stopTime}:` : `${Math.min(this.ndlCap, v.ndl)}:`;
    const pdis = this.settings.pdis === 'on'
      ? (this.pdisState === 'ok' ? 'OK' : this.pdisState === 'no' ? 'NO' : this.pdisDepth > 8 ? String(depthInt(this.pdisDepth)) : '--')
      : 'OFF';
    const stage = this.hasStage ? [{ lbl: gf ? 'GRD FCT' : 'MB LEVEL', val: gf ? this.activeGf.join('/') : `L${this.activeLevel}` }] : [];
    const { h, m } = clockOfDay(s);
    const common = {
      max: { lbl: 'MAX', unit: DU1(), val: depthText(v.maxDepth) },
      base: { lbl: gf ? '100/100' : 'MB L0', unit: v.inDeco ? '' : 'NO STOP', val: base },
      battery: { lbl: 'BATTERY', val: BATTERY },
      pdis: { lbl: 'PDIS', unit: DU1(), val: pdis },
      otu: { lbl: 'OTU', val: String(Math.round(v.otu)) },
      cns: { lbl: 'CNSO2', unit: '%', val: String(Math.round(v.cns)), hl: v.cns >= 100 ? 'red' as const : '' as const },
    };
    if (light) {
      return [
        this.tankWin(v, s),
        common.max,
        { lbl: 'RBT', unit: 'MIN', val: this.rbtText(v) },
        { lbl: 'TEMP', val: `${Math.round(tempVal(v.temperature))}<small>${tempUnit()}</small>` },
        common.base,
        ...stage,
        common.battery,
        { lbl: 'TIME', val: `${h}:${String(m).padStart(2, '0')}` },
        common.pdis,
        common.otu,
        common.cns,
      ];
    }
    return [
      common.max,
      { lbl: 'PPO2', unit: 'BAR', val: v.ppO2.toFixed(2) },
      { lbl: 'AVG', unit: DU1(), val: depthText(v.avgDepth) },
      common.base,
      ...stage,
      { lbl: 'STOPW', val: stopwatch(s.clock - this.swStart) },
      common.battery,
      common.pdis,
      common.otu,
      common.cns,
    ];
  }

  /** Tank window: pressure of T1 ("NO P" on a tank without transmitter, "---" without signal) and its O2 %. */
  private tankWin(v: ComputerView, s: DiveSession): Win {
    const n = this.maxGases > 1 ? String(s.breathing + 1) : '';
    const p = v.tank.ai ? pressText(v.tank.pressure) : this.transmitter && s.transmitterOn ? 'NO P' : '---';
    const hl = v.tank.ai && v.tank.pressure < v.tank.reserve ? 'red' : '';
    return { lbl: `TANK${n}`, unit: pressUnit().toUpperCase(), val: `${p}<span class="g3-o2">${v.o2}%<small>O2</small></span>`, hl };
  }

  private rbtText(v: ComputerView): string {
    const rbt = v.tank.gasTime;
    return v.tank.ai && rbt !== null ? `${Math.min(99, rbt)}:` : '--:';
  }

  press(button: string, s: DiveSession): boolean {
    // Alternate displays (figure of §3.5.2.6: ▲ on the upper right button, ▼ on the lower right one).
    if (this.alt) {
      this.alt.last = performance.now();
      const pages = this.altPages(s);
      const i = pages.indexOf(this.alt.page);
      if (button === 'next' || button === 'prev') {
        // The display after the saturation is the list of pictures (not simulated): back to the dive
        // screen instead; ▼ on the first display goes back to it too (deduced).
        const next = pages[i + (button === 'next' ? 1 : -1)];
        if (next) this.alt.page = next;
        else this.alt = null;
      } else if (button === 'light') this.backlightUntil = performance.now() + 10_000;
      return true;
    }
    // §3.5.2.1 gas switch screen: SAVE (lower left) confirms, the arrow proposes another gas.
    if (this.sw !== null) {
      if (button === 'book') {
        const g = this.sw;
        this.sw = null;
        if (s.depth <= this.gasMods(s)[g] || g === 0) {
          s.switchGas(g);
          this.prompt.offer = null;
          this.successUntil = performance.now() + 4000; // "affiché pendant 4 secondes"
          this.successGas = g;
        }
        return true;
      }
      if (button === 'prev' || button === 'next') {
        const c = this.candidates(s);
        this.sw = c[(c.indexOf(this.sw) + 1) % c.length] ?? this.sw;
        this.swAt = s.clock;
        return true;
      }
    }
    if (!s.inDive) {
      if (button === 'light') this.backlightUntil = performance.now() + 10_000;
      return button === 'light';
    }
    const v = this.lastView;
    const lv = v ? this.levelInfo(v, s) : null;
    const seq = v ? this.infoSeq(v, s, this.layout(v, lv!) === 'light').length : 1;
    switch (button) {
      case 'next':
        this.info = (this.info + 1) % seq;
        return true;
      case 'prev':
        this.info = (this.info + seq - 1) % seq;
        return true;
      case 'light':
        // §3.8.5: "il peut être renforcé par une pression sur le bouton LIGHT" (duration: 10 s assumed).
        this.backlightUntil = performance.now() + 10_000;
        return true;
      case 'book': {
        // §3.8.4: the safety stop countdown "peut être arrêté par une pression sur le bouton TIMER" (the
        // G2 manual: "restarted"; restart kept); a manual countdown is started with it (§3.8.4 note).
        if (this.safetyState === 'active' || this.safetyState === 'paused') this.safetyRemaining = this.safetyTotal;
        else this.startSafetyStop(s);
        // §3.8.2 note: "une pression sur BOOK [...] avec l'affichage Classic réinitialisera le chronomètre
        // lorsqu'il est activement affiché".
        if (v && lv && this.layout(v, lv) === 'classic' && this.infoSeq(v, s, false)[this.info]?.lbl === 'STOPW') this.swStart = s.clock;
        this.flash('BOOKMARK');
        return true;
      }
    }
    return false;
  }

  /** Alternate displays: gas summary (PMG), deco summary (PMG or an active level), profile, saturation. */
  private altPages(s: DiveSession): AltPage[] {
    const pmg = this.maxGases > 1 && this.knownGases(s).length > 1;
    return [...(pmg ? ['gas' as const] : []), ...(pmg || this.hasStage ? ['deco' as const] : []), 'profile', 'sat'];
  }

  hold(button: string, s: DiveSession): boolean {
    // §3.2: a long press of either right button "Affiche le profil de plongée / Accès au tableau
    // résumé des gaz (PMG)".
    if ((button === 'next' || button === 'prev') && s.inDive && !this.locked && this.sw === null) {
      const now = performance.now();
      this.alt = this.alt ? null : { page: this.altPages(s)[0], opened: now, last: now };
      return true;
    }
    // §3.5.2.2: "vous pouvez manuellement initier le changement de gaz par une pression prolongée sur le
    // bouton BOOK"; the richest gas available is proposed first (the planned switch), else a leaner one.
    if (button !== 'book' || !s.inDive || this.locked || this.maxGases < 2) return false;
    const c = this.candidates(s);
    if (!c.length) return true;
    const gases = s.allGases;
    const richer = c.filter((i) => gases[i].o2 > s.gas.o2);
    this.sw = richer.length ? richer.reduce((a, b) => (gases[b].o2 > gases[a].o2 ? b : a)) : c[0];
    this.swFromPrompt = false;
    this.swAt = s.clock;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      light: {
        name: 'LIGHT · DIM',
        press: { real: { fr: 'Assombrit / augmente le rétroéclairage', en: 'Dims / brightens the backlight' }, simulated: true },
        hold: { real: { fr: 'Lance la boussole', en: 'Starts the compass' }, simulated: false },
      },
      book: {
        name: 'BOOK · SAVE',
        press: {
          real: { fr: 'Réinitialise la minuterie (§3.2) : pose un repère, relance le palier de sécurité, remet à zéro le chronomètre affiché (Classic) ; SAVE confirme un changement de gaz', en: 'Resets the timer (§3.2): sets a bookmark, restarts the safety stop, resets the stopwatch on display (Classic); SAVE confirms a gas switch' },
          simulated: true,
        },
        hold: { real: { fr: 'Changement de gaz manuel (PMG)', en: 'Manual gas switch (PMG)' }, simulated: true, note: { fr: 'avec PMG activé', en: 'with PMG enabled' } },
      },
      next: {
        name: '➡ · ▲',
        press: { real: { fr: 'Fait défiler les informations de plongée ; ▲ : écran alternatif suivant', en: 'Scrolls the dive information; ▲: next alternate display' }, simulated: true, note: { fr: 'fréquence cardiaque et température cutanée absentes', en: 'heart rate and skin temperature omitted' } },
        hold: { real: { fr: 'Profil de plongée, résumé des gaz (PMG) et de la déco, saturation', en: 'Dive profile, gas (PMG) and deco summaries, saturation' }, simulated: true, note: { fr: 'images non simulées', en: 'pictures not simulated' } },
      },
      prev: {
        name: '⬅ · ▼',
        press: { real: { fr: 'Fait défiler les informations de plongée (sens inverse) ; ▼ : écran alternatif précédent', en: 'Scrolls the dive information (backwards); ▼: previous alternate display' }, simulated: true },
        hold: { real: { fr: 'Profil de plongée, résumé des gaz (PMG) et de la déco, saturation', en: 'Dive profile, gas (PMG) and deco summaries, saturation' }, simulated: true, note: { fr: 'images non simulées', en: 'pictures not simulated' } },
      },
    };
  }

  private lastView: ComputerView | null = null;

  /** The case: round bezel, two buttons on each side (§3.2: upper / lower left, upper / lower right). */
  private shell(screen: string, cls = ''): string {
    return `
      <div class="dev g3">
        <div class="g3-case">
          <button class="g3-btn tl" data-btn="light"></button>
          <button class="g3-btn bl" data-btn="book"></button>
          <button class="g3-btn tr" data-btn="next"></button>
          <button class="g3-btn br" data-btn="prev"></button>
          <div class="g3-screen ${cls} ${this.backlit ? 'backlit' : ''}">${screen}</div>
        </div>
      </div>`;
  }

  /** Button labels on the edge of the screen (figures): upper pair and lower pair. */
  private tabs(tl: string, tr: string, bl: string, br: string): string {
    return `<div class="g3-tabs top"><span>${tl}</span><span>${tr}</span></div><div class="g3-tabs bot"><span>${bl}</span><span>${br}</span></div>`;
  }

  /** A row of windows; `cols` gives the grid columns. */
  private row(cls: string, wins: Win[], cols: string): string {
    // Long values (time of day, stopwatch, MB L0 stop) get a smaller font to stay inside their window.
    const long = (val: string) => (val.replace(/<span class="g3-o2">.*<\/span>|<[^>]+>/g, '').length > 4 ? 'long' : '');
    const cells = wins.map((w) => `<div class="g3-win ${w.hl ?? ''} ${w.cls ?? ''} ${long(w.val)}"><div class="g3-h"><span>${w.lbl}</span><span>${w.unit ?? ''}</span></div><div class="g3-v">${w.val}</div></div>`).join('');
    return `<div class="g3-row ${cls}" style="grid-template-columns:${cols}">${cells}</div>`;
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    this.screenAlerts = [];
    if (!v.inDive) {
      this.alt = null;
      this.sw = null;
      el.innerHTML = this.shell(this.surface(v, s));
      return;
    }
    // §3.5.2.1: the prompt opens the switch screen; it closes when the 30 s run out (EXCLUDING GAS T2);
    // a switch started with BOOK closes after 30 s too (not stated, assumed).
    if (this.prompt.offer !== null && this.sw === null && !this.swFromPrompt) {
      this.sw = this.prompt.offer;
      this.swFromPrompt = true;
      this.swAt = s.clock;
    }
    if (this.swFromPrompt && this.prompt.offer === null) {
      if (this.sw !== null && this.sw !== s.breathing) this.sw = null;
      this.swFromPrompt = false;
    }
    if (this.sw !== null && !this.swFromPrompt && s.clock - this.swAt > 30) this.sw = null;
    if (this.sw !== null) {
      this.alt = null;
      el.innerHTML = this.shell(this.switchScreen(v, s, this.sw));
      return;
    }

    const lv = this.levelInfo(v, s);
    const warnings = this.updateWarnings(v, lv, s);
    const warn = warnings[0];
    const has = (...k: G3Warning[]) => k.some((x) => warnings.includes(x));

    // Pop-up (§3.6.1, §3.7): alarm (red) > warning (yellow). Texts of the figures.
    let pop = '';
    let popCls = '';
    const reserve = v.tank.ai && v.tank.pressure < v.tank.reserve;
    const rbt0 = v.tank.ai && v.tank.gasTime === 0;
    if (!v.locked) {
      if (this.ascentAlarm) [pop, popCls] = ['ASCENT TOO FAST!', 'red'];
      else if (v.ceilingViolation === 2) [pop, popCls] = ['MISSED DECO STOP!', 'red'];
      else if (v.depth > v.mod) [pop, popCls] = ['MOD EXCEEDED', 'red'];
      else if (v.cns >= 100) [pop, popCls] = ['CNS O2 = 100%!', 'red'];
      else if (reserve) [pop, popCls] = ['TANK RESERVE REACHED', 'red'];
      else if (rbt0 && this.rbt0Alarm) [pop, popCls] = ['RBT = 0 MINUTES', 'red'];
      else if (warn) [pop, popCls] = [this.warningText(warn, `${pressText(this.tankWarnPressure() ?? 0)}${pressUnit().toUpperCase()}`), 'yellow'];
    }
    // §3.5.2.1 figure: EXCLUDING GAS T2 in the yellow pop-up (4 s assumed).
    if (this.excluded && s.clock - this.excluded.at < 4 && popCls !== 'red') [pop, popCls] = [`EXCLUDING GAS T${this.excluded.gas + 1}`, 'yellow'];
    this.screenAlerts = pop ? [pop] : [];
    const note = this.flashMessage();
    if (note && !pop) [pop, popCls] = [note, 'note'];

    // §3.8.1.2: the alternate displays "reste[nt] affiché[s] pendant 12 secondes et revien[nen]t à
    // l'affichage normal de plongée sauf si d'autres boutons sont pressés"; §3.8.1.1 note: 1 minute at
    // most, and back at once on any warning or alarm.
    if (this.alt) {
      const now = performance.now();
      if (popCls === 'red' || popCls === 'yellow' || now - this.alt.last > 12_000 || now - this.alt.opened > 60_000 || !this.altPages(s).includes(this.alt.page)) this.alt = null;
    }
    if (this.alt) {
      el.innerHTML = this.shell(this.altScreen(v, s, this.alt.page));
      return;
    }

    const layout = this.layout(v, lv);
    const light = layout === 'light';
    const seq = this.infoSeq(v, s, light);
    if (this.info >= seq.length) this.info = 0;
    // The window of an alarm or warning takes the information window (§3.7.2: "La MOD est affichée sur
    // une fenêtre secondaire"; figures of §3.6.14, §3.6.15, §3.7.4): MOD, CNS, active level.
    let info = seq[this.info];
    if (v.depth > v.mod) info = { lbl: 'MOD', unit: DU(), val: depthText(v.mod), hl: 'red' };
    else if (v.cns >= 100) info = { lbl: 'CNSO2', unit: '%', val: `${Math.round(v.cns)}<small>%</small>`, hl: 'red' };
    else if (has('levelChanged')) info = { ...seq.find((w) => w.lbl === 'MB LEVEL' || w.lbl === 'GRD FCT') ?? info, hl: 'yellow' };
    else if (has('levelIgnored') && !light) info = seq.find((w) => w.lbl === 'MB LEVEL' || w.lbl === 'GRD FCT') ?? info;
    else if (light && this.info === 0 && (this.pdisState === 'shown' || this.pdisState === 'active')) info = seq.find((w) => w.lbl === 'PDIS') ?? info;
    if (has('cns75') && info.lbl === 'CNSO2') info = { ...info, hl: 'yellow' };

    // Depth: "---" above 0.8 m (§3.8); red and flashing below the MOD or above a missed stop (§3.7.2,
    // §3.7.6); yellow above a level stop (figures of §3.6.12, §3.6.13).
    const depthHl = v.depth > v.mod || v.ceilingViolation === 2 ? 'red' : has('levelIgnored', 'depth') ? 'yellow' : '';
    const depthVal = `<span class="${v.depth > v.mod ? 'blink' : ''}">${v.depth < 0.8 ? '---' : depthText(v.depth)}</span>`;
    const timeHl = has('time') ? 'yellow' : '';
    const rbt = v.tank.gasTime;
    const rbtHl = rbt0 && v.tank.ai ? (this.rbt0Alarm ? 'red' : 'yellow') : reserve ? 'red' : has('rbt3') ? 'yellow' : '';
    const rbtWin = (unit: string): Win => ({ lbl: 'RBT', unit, val: this.rbtText(v), hl: rbtHl });
    const ndlMax = Math.min(this.ndlCap, lv.ndl);

    // Decompression window: deco stop (orange), level / GF stop (white), safety stop or PDIS countdown.
    let stop: Win | null = null;
    let tat: Win | null = null;
    if (v.locked) {
      stop = { lbl: 'GAUGE', val: '--' };
    } else if (v.inDeco) {
      stop = { lbl: 'DECO STOP', val: stopValue(v.stopTime, v.stopDepth), cls: 'deco' };
      tat = { lbl: 'TAT', unit: 'MIN', val: `${v.tts}:`, cls: 'deco' };
    } else if (lv.stop) {
      stop = { lbl: this.gfMode ? 'GF STOP' : 'LEVEL STOP', val: stopValue(lv.stop.min, lv.stop.depth), cls: 'level' };
      tat = { lbl: 'TAT', unit: 'MIN', val: `${lv.tat}:` };
    }
    // Safety stop countdown: "TIMER MINUTE" with m.ss (figure of §3.7.2, deduced).
    const safety = v.safety.state === 'active' || v.safety.state === 'paused' || (v.safety.state === 'pending' && v.depth <= 5.5 && v.maxDepth > 10)
      ? { lbl: 'TIMER', unit: light ? 'MINUTE' : 'MIN', val: `${Math.floor(v.safety.remaining / 60)}.${String(Math.max(0, Math.ceil(v.safety.remaining)) % 60).padStart(2, '0')}` }
      : null;
    const noStop: Win = safety ?? { lbl: 'NO STOP', unit: 'MIN', val: `${ndlMax}:`, hl: has('nostop') ? 'yellow' : '' };

    let body: string;
    if (light) {
      // §3.8.1.1 figure: DEPTH METER | DIVE TIME MIN, then TANK BAR (and O2 %) | RBT MINUTE; NOTE: "seul le
      // temps restant le plus court entre le temps sans palier et la véritable autonomie restante RBT est
      // indiqué en configuration LIGHT".
      const showRbt = v.tank.ai && rbt !== null && rbt <= lv.ndl;
      body = this.row('l1', [
        { lbl: 'DEPTH', unit: DU(), val: depthVal, hl: depthHl },
        { lbl: 'DIVE TIME', unit: 'MIN', val: `${Math.floor(v.diveTime / 60)}:`, hl: timeHl },
      ], '1fr 1fr') + this.row('l2', [
        info,
        safety ?? (showRbt ? rbtWin('MINUTE') : noStop),
      ], '1fr 1fr');
    } else {
      // §3.8.1.2 figure: DEPTH M | TEMP | TIME MIN; information window | TIME (time of day) | NO STOP MIN;
      // TANK BAR | O2 | RBT MIN. While ascending, SPEED % replaces TEMP (figures of §3.7.1), yellow above
      // 110 % and red above 140 % of the ideal rate.
      const pct = Math.round((v.ascentRate / idealAscent(v.depth)) * 100);
      const speedHl = v.ascentLevel === 2 ? 'red' : v.ascentLevel === 1 ? 'yellow' : '';
      const second: Win = v.ascentRate > 0.5 && pct > 0
        ? { lbl: 'SPEED', unit: '%', val: String(pct), hl: speedHl }
        : { lbl: 'TEMP', val: `${Math.round(tempVal(v.temperature))}<small>${tempUnit()}</small>` };
      const { h, m } = clockOfDay(s);
      // §3.11.4: "La profondeur du PDIS est affichée dans la fenêtre du milieu", with its 2-minute countdown.
      const middle: Win = this.pdisState === 'active'
        ? { lbl: 'PDIS', unit: 'MIN', val: `${Math.floor(this.pdisRemaining / 60)}.${String(Math.max(0, Math.ceil(this.pdisRemaining)) % 60).padStart(2, '0')}` }
        : this.pdisState === 'shown'
          ? { lbl: 'PDIS', unit: DU1(), val: String(depthInt(this.pdisDepth)) }
          : { lbl: 'TIME', val: `${h}:${String(m).padStart(2, '0')}` };
      const row2 = stop
        ? this.row('c2', [info, stop, ...(tat ? [tat] : [])], tat ? '1fr 1.25fr 0.75fr' : '1fr 2fr')
        : this.row('c2', [info, middle, noStop], '1fr 1fr 1fr');
      body = this.row('c1', [
        { lbl: 'DEPTH', unit: DU1(), val: depthVal, hl: depthHl },
        second,
        { lbl: 'TIME', unit: 'MIN', val: String(Math.floor(v.diveTime / 60)), hl: timeHl },
      ], '1.3fr 0.85fr 0.85fr') + row2 + this.row('c3', [
        { ...this.tankWin(v, s), val: v.tank.ai ? pressText(v.tank.pressure) : this.transmitter && s.transmitterOn ? 'NO P' : '---' },
        { lbl: 'O2', val: `${v.o2}%` },
        rbtWin('MIN'),
      ], '1.2fr 0.8fr 1fr');
    }

    const popHtml = pop ? `<div class="g3-pop ${popCls} ${popCls === 'red' ? 'blink-bg' : ''}"><span>${pop}</span></div>` : '';
    const success = performance.now() < this.successUntil ? `<div class="g3-swok">SWITCH TO GAS T${this.successGas + 1}<br>SUCCESSFUL</div>` : '';
    el.innerHTML = this.shell(`${popHtml}${this.tabs(this.backlit ? 'DIM' : 'LIGHT', '➡', 'BOOK', '⬅')}<div class="g3-body ${layout}">${body}</div>${success}`);
  }

  /**
   * Surface (figures of §3.1.1, §3.1.6, §3.1.7): HEART+ (no belt: ---), then TEMP | MB LVL (or GF) | MOD
   * before a dive, INTERVAL | NO FLY and DESAT | CNSO2 (or the yellow NO DIVE countdown) after one; TANK
   * BAR and O2 at the bottom ("2G": two gases with PMG). SOS (§1.11): the 24-hour countdown instead of
   * the no-fly time.
   */
  private surface(v: ComputerView, s: DiveSession): string {
    const gf = this.gfMode;
    const tank = this.transmitter && s.transmitterOn ? pressText(s.tankPressure) : '---';
    const nGas = this.maxGases > 1 && this.knownGases(s).length > 1 ? `<small class="g3-ng">${this.knownGases(s).length}G</small>` : '';
    const level: Win = { lbl: gf ? 'GF' : 'MB LVL', val: gf ? this.activeGf.join('/') : `L${this.settings.level}` };
    const temp: Win = { lbl: 'TEMP', val: `${Math.round(tempVal(v.temperature))}<small>${tempUnit()}</small>` };
    const after = s.log.length > 0 || v.locked;
    let rows: string;
    if (!after) {
      rows = this.row('s1', [{ lbl: 'HEART+', val: '---' }], '1fr')
        + this.row('s2', [temp, level, { lbl: 'MOD', unit: DU1(), val: depthText(v.mod) }], '1fr 1fr 1fr');
    } else {
      const si = v.surfaceInterval !== null ? hmm(v.surfaceInterval / 60) : '--';
      const noFly: Win = v.locked
        ? { lbl: 'SOS', unit: 'HR', val: hmm(Math.max(0, (this.lockedUntil - s.clock) / 60)), hl: 'red' }
        : { lbl: 'NO FLY', val: v.noFly > 0 ? `${Math.ceil(v.noFly / 60)}h` : '--' };
      // §3.1.7: the no-dive countdown "du fait du niveau de microbulles ou d'une charge excessive en
      // oxygène (CNS O2% > 40 %)" (only the CNS part is simulated: the time for it to fall to 40 %).
      const noDive = v.cns > 40 ? Math.ceil(Math.log(v.cns / 40) / Math.LN2 * 90) : 0;
      const mid = noDive > 0
        ? `<div class="g3-row s2" style="grid-template-columns:1fr 2fr"><div class="g3-win"><div class="g3-h"><span>TEMP</span><span></span></div><div class="g3-v">${temp.val}</div></div><div class="g3-nodive"><div class="g3-h"><span>NO DIVE</span><span></span></div><div class="g3-v"><b>⊘</b>${hmm(noDive)}</div></div></div>`
        : this.row('s2', [temp, { lbl: 'DESAT', val: v.desat > 0 ? hmm(v.desat) : '--' }, { lbl: 'CNSO2', val: `${Math.round(v.cns)}%` }], '1fr 1fr 1fr');
      rows = this.row('s1', [{ lbl: 'HEART+', val: '---' }, { lbl: 'INTERVAL', val: si }, noFly], '1fr 1fr 1fr') + mid;
    }
    rows += `<div class="g3-row s3" style="grid-template-columns:1.4fr 1fr"><div class="g3-win"><div class="g3-h"><span>TANK</span><span>${pressUnit().toUpperCase()}</span></div><div class="g3-v big">${tank}</div></div><div class="g3-win"><div class="g3-h"><span>O2</span><span></span></div><div class="g3-v">${v.o2}%${nGas}</div></div></div>`;
    const pop = v.locked ? '<div class="g3-pop red"><span>SOS MODE</span></div>' : '';
    return `${pop}<div class="g3-batt-top">${BATTERY}</div>${this.tabs(this.backlit ? 'DIM' : 'LIGHT', '➡', 'TIME', '⬅')}<div class="g3-body surf">${rows}</div>`;
  }

  /**
   * §3.5.2.1 figure: DIM / ➡ and SAVE / ⬅ on the edges, depth and dive time, the SWITCH TO GAS T2 banner,
   * then the gas mix (O2), its PO2MAX (BAR) and its MOD (METER).
   */
  private switchScreen(v: ComputerView, s: DiveSession, g: number): string {
    const gas = s.allGases[g] ?? s.gas;
    const ppo2 = g === 0 ? this.modPpo2 : gas.o2 >= 0.8 ? 1.6 : this.decoPpo2();
    const top = this.row('l1', [
      { lbl: 'DEPTH', unit: DU(), val: depthText(v.depth) },
      { lbl: 'DIVE TIME', unit: 'MIN', val: `${Math.floor(v.diveTime / 60)}:` },
    ], '1fr 1fr');
    const cap = (val: string, c: string) => `${val}<em class="g3-cap">${c}</em>`;
    const bottom = this.row('w3', [
      { lbl: 'GAS MIX', val: cap(`${Math.round(gas.o2 * 100)}%`, 'O2') },
      { lbl: 'PO2MAX', val: cap(ppo2.toFixed(2), 'BAR') },
      { lbl: 'MOD', val: cap(depthText(this.gasMods(s)[g]), DU()) },
    ], '1fr 1fr 1fr');
    return `${this.tabs(this.backlit ? 'DIM' : 'LIGHT', '➡', 'SAVE', '⬅')}<div class="g3-body sw">${top}<div class="g3-banner">SWITCH TO GAS T${g + 1}</div>${bottom}</div>`;
  }

  /**
   * Alternate displays (figure of §3.5.2.6: "4. Deco summary", DIM / ▲ above, SHOW / ▼ below): the
   * same pages as the G2 (gas summary, deco summary, profile, saturation). Page numbers of the G2.
   */
  private altScreen(v: ComputerView, s: DiveSession, page: AltPage): string {
    const levels = this.gfMode
      ? (this.hasStage ? [{ label: this.activeGf.join('/'), params: this.stageParams()!, anchor: this.levelAnchor }] : [])
        .concat([{ label: '100/100', params: this.baseParams(), anchor: this.anchor }])
      : (this.activeLevel > 0 ? [this.activeLevel, 0] : [0]).map((lv) => ({ label: `L${lv}`, params: levelParams(lv, lv > 0 ? this.stageDeco : this.baseDeco), anchor: lv > 0 ? this.levelAnchor : this.anchor }));
    const body = page === 'gas' ? gasSummary(this, s) : page === 'deco' ? decoSummary(this, v, s, levels) : page === 'profile' ? diveProfile(this, v, s) : saturation(s);
    const [n, title] = { gas: ['3.', 'Gas summary'], deco: ['4.', 'Deco summary'], profile: ['5.', 'Dive profile'], sat: ['6.', 'Compartment saturation'] }[page];
    return `${this.tabs(this.backlit ? 'DIM' : 'LIGHT', '▲', 'SHOW', '▼')}<div class="g3-alt-title">${n}<br>${title}</div><div class="g3-alt">${body}</div>`;
  }
}

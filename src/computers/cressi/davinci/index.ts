import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, tempUnit, tempVal } from '../../../units';
import { type ButtonHelp, type ComputerView, clockOfDay } from '../../base';
import { DaVinciRules } from './rules';

const GREEN = '#22e01e';
const YELLOW = '#ffd400';
const RED = '#e3141b';
const DARKRED = '#8a0b0f';
const BLUE = '#1565c0';
const CYAN = '#29b6f6';

/** Gas name (§4.3.5: AIR, EAN22 to EAN99, O2). */
function gasName(o2: number): string {
  const p = Math.round(o2 * 100);
  return p === 21 ? 'AIR' : p >= 100 ? 'O2' : `EAN${p}`;
}

/** Hours:minutes as on the display, ":18" below one hour, "1:09" beyond (§11.3: 0:00 – 9:59 hr:min). */
function hm(min: number): string {
  const m = Math.max(0, Math.floor(min));
  return m < 60 ? `:${String(m).padStart(2, '0')}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Cressi DaVinci display: 1.54" colour TFT, two buttons (§3.6). Dive Main after §3.3 and §7.7 figures:
 * DEPTH and the ASC bar, NO DECO (green) or the stop (yellow), DIVE TIME (or a message in its place), the
 * GAS / MOD band, the Ti bar on the left.
 */
export class CressiDaVinci extends DaVinciRules {
  readonly notes = {
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient : C0 90/90 (par défaut), C1 35/85, C2 35/70 (§4.3.6). Mode Computer (Gauge non simulé), jusqu’à 4 gaz (GAS 2 à 4 désactivés par défaut) ; le calcul utilise toujours le gaz respiré (§7.8). Écran principal (§3.3) : profondeur et barre ASC (5 segments, seuils plus élevés au-delà de 18 m ; 4 segments = avertissement jaune et 3 bips, 5 = alarme et « SLOW! »), NO DECO sur fond vert (jaune sous l’alarme NO DECO, 5 min par défaut), durée, gaz et MOD, barre Ti (5 segments). Déco (§7.7) : palier et durée sur fond jaune, « DECO ENTRY » 10 s, flèche vers le haut jusqu’à 3 m sous le palier puis flèches haut et bas. Au-dessus du palier (§7.9.1) : « BACK TO STOP DEPTH », 1,5 min de pénalité par minute (rattrapée au dernier palier, déduit), après 5 min mode violation (VMS, 24 h) à la fin de la plongée (le manuel dit 5 min après la sortie). Palier de sécurité réglable (OFF, 3 ou 6 m, 3 ou 5 min ; 6 m supposé par défaut, le tableau §11.2 indiquant « 5 M », profondeur absente du menu) ; deep stop facultatif à la moitié de la profondeur max. après 24 m, 2 min. Alarmes (§4.3.1) : son chaque seconde pendant 10 s, acquittées par R : NO DECO, OXTOX (80 % par défaut ; le plus grand du CNS et des OTU / 3, déduit), PPO2 (MAX PPO2 1,60 par défaut), profondeur et durée (désactivées par défaut), « SWITCH TO » au palier (30 s). R : écran ALT (max., heure, altitude ou NO DECO pendant un palier, TTS après l’entrée en déco à la place de l’altitude (déduit), température, PPO2, Oxtox ; retour après 10 s). L : changement de gaz (L choisit, R enregistre, R long : retour). Surface : SURFACE TIME, dernière plongée, ALT 1 (NO FLY, DESAT), ALT 2. Valeurs fictives : batterie 90 %, date. Non simulés : O2 Time à la place du NO DECO, mode Gauge, boussole, luminosité, planificateur, carnet, violations VMU (palier sous 60 m, palier de plus de 99 min) et TOO DEEP, durée de 10 min avant la fin de plongée (le simulateur clôt la plongée après 3 min).',
    en: 'Bühlmann ZHL-16C with gradient factors: C0 90/90 (default), C1 35/85, C2 35/70 (§4.3.6). Computer mode (Gauge not simulated), up to 4 gases (GAS 2 to 4 off by default); the calculation always uses the gas breathed (§7.8). Main screen (§3.3): depth and ASC bar (5 segments, higher thresholds deeper than 18 m; 4 segments = yellow warning and 3 beeps, 5 = alarm and “SLOW!”), NO DECO on green (yellow below the NO DECO alarm, 5 min by default), dive time, gas and MOD, Ti bar (5 segments). Deco (§7.7): stop and time on yellow, “DECO ENTRY” for 10 s, up arrow until 3 m below the stop then up and down arrows. Above the stop (§7.9.1): “BACK TO STOP DEPTH”, 1.5 min penalty per minute (worked off at the last stop, deduced), after 5 min violation mode (VMS, 24 h) at the end of the dive (the manual says 5 min after surfacing). Settable safety stop (OFF, 3 or 6 m, 3 or 5 min; 6 m assumed by default, the §11.2 table giving “5 M”, a depth the menu lacks); optional deep stop at half the max depth after 24 m, 2 min. Alarms (§4.3.1): sound every second for 10 s, acknowledged with R: NO DECO, OXTOX (80 % by default; the larger of CNS and OTU / 3, deduced), PPO2 (MAX PPO2 1.60 by default), depth and dive time (off by default), “SWITCH TO” at the stop (30 s). R: ALT screen (max, time, altitude or NO DECO during a stop, TTS after deco entry in place of the altitude (deduced), temperature, PPO2, Oxtox; back after 10 s). L: gas switch (L chooses, R saves, R long: back). Surface: SURFACE TIME, last dive, ALT 1 (NO FLY, DESAT), ALT 2. Fictive values: battery 90 %, date. Not simulated: O2 Time in place of the NO DECO, Gauge mode, compass, brightness, planner, logbook, VMU violations (stop deeper than 60 m, stop longer than 99 min) and TOO DEEP, 10 min before the dive ends (the simulator closes the dive after 3 min).',
  };

  /** Gas switch screen (§7.5.5): index of the gas shown, or null. */
  private gasSel: number | null = null;
  /** Alarms acknowledged with R (keys of alertCues), until their condition ends. */
  private acked = new Set<string>();

  constructor() {
    super();
    this.screenTimeout = 10000; // §7.5.4: "During dive, ALT will revert to Main after 10 seconds."
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.gasSel = null;
    this.acked.clear();
  }

  press(button: string, s: DiveSession): boolean {
    if (this.gasSel !== null && s.inDive) {
      const n = this.knownGases(s).length;
      if (button === 'l') this.gasSel = (this.gasSel + 1) % n;
      else if (button === 'r') {
        s.switchGas(this.gasSel);
        this.gasSel = null;
      } else return false;
      return true;
    }
    if (button === 'r') {
      // "The alarm sound can be stopped by acknowledging the alarm by short pressing the R button."
      const active = (this.lastView ? this.alertCues(this.lastView, true) : []).filter((c) => c.until === 'ack' || c.key === 'switch');
      if (s.inDive && active.some((c) => !this.acked.has(c.key))) {
        for (const c of active) this.acked.add(c.key);
        if (this.prompt.offer !== null) this.prompt.decline();
        return true;
      }
      // §7.5.4 / §7.5.2: R opens and advances in the ALT displays.
      const n = s.inDive ? 2 : 3;
      this.setScreen((this.screen + 1) % n);
      return true;
    }
    if (button === 'l' && s.inDive && this.knownGases(s).length > 1) {
      // §7.5.5: "Pressing the L button while dive Main is being displayed will show the Gas Switch screen."
      this.gasSel = (s.breathing + 1) % this.knownGases(s).length;
      return true;
    }
    return false;
  }

  hold(button: string, s: DiveSession): boolean {
    if (button === 'r' && this.gasSel !== null && s.inDive) {
      this.gasSel = null; // "Press the R button for 2 seconds to go back to Main without gas switch."
      return true;
    }
    if (button === 'r' && this.screen !== 0) {
      this.setScreen(0);
      return true;
    }
    return false;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      l: {
        name: 'L',
        press: { real: { fr: 'En plongée : écran de changement de gaz ; dans cet écran : gaz suivant', en: 'While diving: gas switch screen; there: next gas' }, simulated: true },
        hold: { real: { fr: 'Luminosité', en: 'Brightness' }, simulated: false },
      },
      r: {
        name: 'R',
        press: { real: { fr: 'Acquitte une alarme ; sinon écrans ALT ; dans l’écran de gaz : enregistre', en: 'Acknowledges an alarm; otherwise ALT displays; in the gas screen: saves' }, simulated: true },
        hold: { real: { fr: 'Retour à l’écran principal (sans changer de gaz)', en: 'Back to the main screen (without switching gas)' }, simulated: true },
      },
    };
  }

  private lastView: ComputerView | null = null;

  private t(x: number, y: number, size: number, text: string | number, fill = '#fff', anchor: 'start' | 'middle' | 'end' = 'start', cls = ''): string {
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" class="dv-t ${cls}">${text}</text>`;
  }

  /** §7.4.2: Ti bar, 5 segments (colours from the figures: green, green, green, yellow, red). */
  private tiBar(v: ComputerView, s: DiveSession): string {
    const lit = v.inDeco ? 5 : Math.min(4, Math.ceil(Math.max(0, v.n2Load) / 25));
    const flash = v.inDeco && this.decoEntryAt >= 0 && s.clock - this.decoEntryAt < 10 && !this.acked.has('deco-entry') ? 'blink' : '';
    const cols = [GREEN, GREEN, GREEN, YELLOW, RED];
    return cols.map((c, i) => `<rect x="3" y="${200 - (i + 1) * 30}" width="9" height="27" fill="${i < lit ? c : '#2a2a2a'}" class="${flash}"/>`).join('')
      + this.t(7, 218, 12, 'Ti', '#fff', 'middle');
  }

  /** §7.4.1: ASC bar, 5 chevrons right of the depth. */
  private ascBar(v: ComputerView): string {
    const n = v.inDive ? this.segments(v.ascentRate, v.depth) : 0;
    const col = n >= 5 ? RED : n === 4 ? YELLOW : GREEN;
    const cls = n >= 4 ? 'blink' : '';
    let out = '';
    for (let i = 0; i < 5; i++) {
      const y = 64 - i * 11;
      out += `<path d="M 218 ${y + 8} L 227 ${y} L 236 ${y + 8} L 236 ${y + 11} L 227 ${y + 3} L 218 ${y + 11} Z" fill="${i < n ? col : '#2a2a2a'}" class="${i < n ? cls : ''}"/>`;
    }
    return out;
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    this.lastView = v;
    // Acknowledged alarms come back once their condition has ended.
    const now = new Set(this.alertCues(v, true).map((c) => c.key));
    for (const k of [...this.acked]) if (!now.has(k)) this.acked.delete(k);
    if (!v.inDive) this.gasSel = null;
    const scr = this.currentScreen();
    let body: string;
    if (!v.inDive) body = scr === 1 ? this.surfaceAlt1(v) : scr === 2 ? this.surfaceAlt2(v, s) : this.surfaceMain(v, s);
    else if (this.gasSel !== null) body = this.gasScreen(s);
    else if (scr === 1) body = this.diveAlt(v, s);
    else body = this.diveMain(v, s);
    el.innerHTML = `
      <div class="dev dv">
        <div class="dv-case">
          <div class="dv-glass"><svg class="dv-screen" viewBox="0 0 240 240"><rect width="240" height="240" fill="#000"/>${body}</svg></div>
          <div class="dv-btns"><button class="dv-btn" data-btn="l">⇓</button><button class="dv-btn" data-btn="r">➜</button></div>
        </div>
      </div>`;
  }

  /** Message in place of the dive time (§7.7, §7.8, §7.9.1, §7.4.1, alarms), by priority; null: the dive time. */
  private message(v: ComputerView, s: DiveSession): { text: string; bg: string; fg: string } | null {
    if (v.ceilingViolation > 0) return { text: 'BACK TO STOP DEPTH', bg: this.aboveSec > 300 ? DARKRED : YELLOW, fg: this.aboveSec > 300 ? '#fff' : '#000' };
    if (v.inDeco && this.decoEntryAt >= 0 && s.clock - this.decoEntryAt < 10 && !this.acked.has('deco-entry')) return { text: 'DECO ENTRY', bg: RED, fg: '#fff' };
    if (v.ascentLevel === 2) return { text: 'SLOW!', bg: RED, fg: '#fff' };
    if (v.depth > v.mod + 0.05 && !this.acked.has('ppo2')) return { text: `PPO2 ${v.ppO2.toFixed(2)}`, bg: DARKRED, fg: '#fff' };
    const ox = Math.max(v.cns, v.otu / 3);
    const oxAl = this.settings.oxtoxAlarm === 'off' ? 100 : Number(this.settings.oxtoxAlarm);
    if (ox >= oxAl && (ox >= 100 || !this.acked.has('oxtox'))) return { text: `OXTOX ${Math.round(ox)}%`, bg: DARKRED, fg: '#fff' };
    if (this.prompt.offer !== null) return { text: `SWITCH TO ${gasName(s.allGases[this.prompt.offer].o2)}`, bg: YELLOW, fg: '#000' };
    if (this.settings.depthAlarm !== 'off' && v.depth >= Number(this.settings.depthAlarm) && !this.acked.has('depth')) return { text: 'DEPTH', bg: RED, fg: '#fff' };
    return null;
  }

  private diveMain(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const surf = v.depth < 0.9;
    const depthRed = this.settings.depthAlarm !== 'off' && v.depth >= Number(this.settings.depthAlarm);
    // §7.5.7: shallower than 0.9 m, the depth is replaced by the surface time and No Deco by dashes.
    const top = surf
      ? `${this.t(18, 20, 13, 'SURFACE')}${this.t(18, 34, 13, 'TIME')}${this.t(212, 62, 50, hm(s.surfaceTimer / 60), '#fff', 'end')}`
      : `${this.t(18, 22, 14, 'DEPTH')}${this.t(18, 44, 22, du.toUpperCase())}${this.t(212, 64, 62, du === 'ft' ? depthInt(v.depth) : depthText(v.depth), depthRed ? RED : '#fff', 'end', depthRed ? 'blink' : '')}`;
    // Middle row: NO DECO (green, yellow under the alarm), or a stop on yellow (red above it).
    let mid: string;
    const deep = this.deepShown();
    const stopBox = (depth: number, l1: string, l2: string, time: string, bg: string, fg: string) =>
      `<rect x="16" y="76" width="224" height="72" fill="${bg}"/>${this.t(28, 132, 54, depthInt(depth), fg)}
       ${this.t(98, 104, 13, l1, fg)}${this.t(98, 118, 13, l2, fg)}${this.t(232, 132, time.length > 3 ? 42 : 54, time, fg, 'end')}`;
    if (v.inDeco && v.stopDepth > 0) {
      const above = v.ceilingViolation > 0;
      const min = v.stopTime + Math.ceil(this.penaltySec / 60);
      mid = stopBox(v.stopDepth, 'DECO', 'STOP', `:${String(Math.min(99, min)).padStart(2, '0')}`, above ? RED : YELLOW, above ? '#fff' : '#000');
      // §7.7: up arrow until 3 m below the stop, then up and down arrows; §7.9.1: down arrow when above.
      const arrow = above ? 'down' : v.depth > v.stopDepth + 3 ? 'up' : 'both';
      mid += arrow === 'up' ? `<path d="M 100 140 l 8 -12 l 8 12 z" fill="#000" class="blink"/>`
        : arrow === 'down' ? `<path d="M 100 128 l 8 12 l 8 -12 z" fill="#fff" class="blink"/>`
        : `<path d="M 100 132 l 7 -8 l 7 8 z M 118 128 l 7 8 l 7 -8 z" fill="#000"/>`;
    } else if (!v.inDeco && this.penaltySec > 0) {
      mid = stopBox(3, 'DECO', 'STOP', `:${String(Math.ceil(this.penaltySec / 60)).padStart(2, '0')}`, YELLOW, '#000');
    } else if (deep) {
      mid = stopBox(deep.depth, 'DEEP', 'STOP', `${Math.floor(deep.left / 60)}:${String(Math.floor(deep.left % 60)).padStart(2, '0')}`, YELLOW, '#000');
    } else if (this.hasSafetyStop && v.safety.state === 'active') {
      mid = stopBox(this.ssDepth(), 'SAFETY', 'STOP', `${Math.floor(v.safety.remaining / 60)}:${String(Math.floor(v.safety.remaining % 60)).padStart(2, '0')}`, YELLOW, '#000');
    } else {
      const alarm = v.ndl <= Number(this.settings.ndlAlarm);
      const blink = alarm && !this.acked.has('ndl') ? 'blink' : '';
      mid = `<rect x="16" y="76" width="224" height="72" fill="${alarm ? YELLOW : GREEN}"/>${this.t(24, 106, 20, 'NO', '#000')}${this.t(24, 128, 20, 'DECO', '#000')}
        ${this.t(232, 134, 58, surf ? '-:--' : hm(v.ndl), '#000', 'end', blink)}`;
    }
    const msg = this.message(v, s);
    const timeRed = this.settings.timeAlarm !== 'off' && v.diveTime >= Number(this.settings.timeAlarm) * 60;
    const row3 = msg
      ? `<rect x="16" y="152" width="224" height="58" fill="${msg.bg}"/>${this.t(128, 190, msg.text.length > 12 ? 17 : 26, msg.text, msg.fg, 'middle', 'blink')}`
      : `${this.t(22, 176, 20, 'DIVE', CYAN)}${this.t(22, 198, 20, 'TIME', CYAN)}${this.t(232, 204, 58, hm(v.diveTime / 60), timeRed ? RED : CYAN, 'end')}`;
    const modAlarm = v.depth > v.mod + 0.05;
    const gas = gasName(s.gas.o2);
    const band = `<rect x="16" y="214" width="224" height="26" fill="${BLUE}"/>
      ${this.t(20, 233, 13, `GAS <tspan font-size="18">${s.breathing + 1}</tspan>`)}${this.t(66, 234, 19, gas)}
      ${modAlarm ? `<rect x="150" y="214" width="90" height="26" fill="${RED}" class="blink"/>` : ''}
      ${this.t(152, 233, 13, 'MOD')}${this.t(236, 234, 17, `${depthInt(v.mod)}<tspan font-size="11"> ${du.toUpperCase()}</tspan>`, '#fff', 'end')}`;
    return `${this.tiBar(v, s)}${top}${this.ascBar(v)}${mid}${row3}${band}`;
  }

  /**
   * §7.5.4, figure: MAX DEPTH, TIME OF DAY, ALTITUDE LEVEL (NO DECO during a safety or deep stop; TTS
   * after deco entry, deduced), TEMPERATURE, PPO2, OXTOX.
   */
  private diveAlt(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const { h, m } = clockOfDay(s);
    const stop = !!this.deepShown() || v.safety.state === 'active';
    const third: [string, string, string] = v.inDeco ? ['TTS', hm(v.tts), '#fff'] : stop ? ['NO DECO', hm(v.ndl), v.ndl <= Number(this.settings.ndlAlarm) ? YELLOW : GREEN] : ['ALTITUDE LEVEL', 'SEA', '#fff'];
    const cell = (x: number, y: number, l: string, val: string, col = '#fff') => `<rect x="${x}" y="${y}" width="114" height="76" fill="#111"/>${this.t(x + 6, y + 18, 12, l, '#bbb')}${this.t(x + 57, y + 62, 34, val, col, 'middle')}`;
    return cell(4, 4, `MAX DEPTH ${du.toUpperCase()}`, du === 'ft' ? String(depthInt(v.maxDepth)) : depthText(v.maxDepth))
      + cell(122, 4, 'TIME OF DAY', `${h % 12 || 12}:${String(m).padStart(2, '0')}`)
      + cell(4, 82, third[0], third[1], third[2])
      + cell(122, 82, 'TEMPERATURE', `${Math.round(tempVal(v.temperature))}${tempUnit()}`)
      + cell(4, 160, 'PPO2', v.ppO2.toFixed(2))
      + cell(122, 160, 'OXTOX', `${Math.round(Math.max(v.cns, v.otu / 3))}%`);
  }

  /** §7.5.5: gas number, name and MOD, on blue for AIR, on green for EAN and O2. */
  private gasScreen(s: DiveSession): string {
    const g = s.allGases[this.gasSel!];
    const name = gasName(g.o2);
    const bg = name === 'AIR' ? BLUE : '#1b8f2a';
    const mod = this.gasSel === 0 ? this.modDepth(g.o2) : this.decoMod(g.o2);
    return `${this.t(120, 40, 20, 'GAS SWITCH', '#fff', 'middle')}<rect x="10" y="60" width="220" height="120" rx="6" fill="${bg}"/>
      ${this.t(24, 96, 20, `GAS ${this.gasSel! + 1}`)}${this.t(120, 140, 44, name, '#fff', 'middle')}
      ${this.t(120, 170, 18, `MOD ${depthInt(mod)} ${depthUnit().toUpperCase()}`, '#fff', 'middle')}`;
  }

  /** §7.5.1 figure: SURFACE TIME, LAST DIVE (MAX, DIVE TIME), GAS, battery (fictive), no-fly icon. */
  private surfaceMain(v: ComputerView, s: DiveSession): string {
    const du = depthUnit();
    const si = v.surfaceInterval;
    const recent = si !== null && si < 86400;
    const last = s.log[s.log.length - 1];
    const violation = v.locked;
    return `${this.tiBar(v, s)}
      <rect x="16" y="0" width="224" height="98" fill="#fff"/>${this.t(110, 22, 17, 'SURFACE TIME', '#000', 'middle')}
      ${v.noFly > 0 ? `<rect x="210" y="4" width="24" height="22" fill="${RED}"/>${this.t(222, 21, 15, '✈', '#fff', 'middle')}` : ''}
      ${this.t(126, 84, 54, recent ? `${String(Math.floor(si! / 3600)).padStart(2, '0')}:${String(Math.floor((si! % 3600) / 60)).padStart(2, '0')}` : '-:--', '#000', 'middle')}
      <rect x="16" y="100" width="224" height="112" fill="${violation ? RED : BLUE}"/>${this.t(128, 122, 17, 'LAST DIVE', '#fff', 'middle')}
      ${this.t(70, 144, 13, `MAX - ${du.toUpperCase()}`, '#fff', 'middle')}${this.t(186, 144, 13, 'DIVE TIME', '#fff', 'middle')}
      ${this.t(70, 194, 40, recent && last ? (du === 'ft' ? depthInt(last.maxDepth) : depthText(last.maxDepth)) : '-:--', '#fff', 'middle')}
      ${this.t(186, 194, 40, recent && last ? hm(last.duration / 60) : '-:--', '#fff', 'middle')}
      <rect x="16" y="214" width="224" height="26" fill="${violation ? RED : BLUE}"/>
      ${violation ? this.t(24, 234, 18, 'VIOLATION') : `${this.t(20, 233, 13, 'GAS <tspan font-size="18">1</tspan>')}${this.t(66, 234, 19, gasName(s.allGases[0].o2))}`}
      <rect x="166" y="218" width="40" height="18" fill="${GREEN}"/>${this.t(186, 233, 15, '90', '#000', 'middle')}`;
  }

  /** §7.5.2: ALT 1, NO FLY and DESAT (dashes at zero; desaturation not shown in violation mode). */
  private surfaceAlt1(v: ComputerView): string {
    const h = (min: number) => (min > 0 ? `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}` : '-:--');
    return `<rect x="4" y="4" width="232" height="112" fill="#111"/>${this.t(14, 28, 16, 'NO FLY', '#bbb')}${this.t(120, 96, 52, h(v.noFly), '#fff', 'middle')}
      <rect x="4" y="124" width="232" height="112" fill="#111"/>${this.t(14, 148, 16, 'DESAT', '#bbb')}${this.t(120, 216, 52, v.locked ? '-:--' : h(v.desat), '#fff', 'middle')}`;
  }

  /** §7.5.2: ALT 2, date, time of day, altitude level, temperature, max PPO2 of the gas, Oxtox. */
  private surfaceAlt2(v: ComputerView, s: DiveSession): string {
    const { h, m } = clockOfDay(s);
    const cell = (x: number, y: number, l: string, val: string, col = '#fff') => `<rect x="${x}" y="${y}" width="114" height="76" fill="#111"/>${this.t(x + 6, y + 18, 12, l, '#bbb')}${this.t(x + 57, y + 62, 30, val, col, 'middle')}`;
    // Date: fictive (the simulator has no calendar). Violation mode: Max PPO2 and Oxtox as yellow dashes.
    return cell(4, 4, 'DATE', '10.20') + cell(122, 4, 'TIME OF DAY', `${h % 12 || 12}:${String(m).padStart(2, '0')}`)
      + cell(4, 82, 'ALTITUDE LEVEL', 'SEA') + cell(122, 82, 'TEMPERATURE', `${Math.round(tempVal(v.temperature))}${tempUnit()}`)
      + cell(4, 160, 'MAX PPO2 SET', v.locked ? '-.--' : this.modPpo2.toFixed(2), v.locked ? YELLOW : '#fff')
      + cell(122, 160, 'OXTOX', v.locked ? '--' : `${Math.round(Math.max(v.cns, v.otu / 3))}%`, v.locked ? YELLOW : '#fff');
  }
}

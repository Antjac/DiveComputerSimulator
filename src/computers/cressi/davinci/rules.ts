import type { DecoParams } from '../../../engine/buhlmann';
import { ceilingDepth, stopDepthFor } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, type AlertExplain, type ComputerView, DiveComputer, type SettingDef } from '../../base';
import { GasPrompt } from '../../common/gasSwitch';

/** §4.3.6: "C0 : (GF Low: 90, GF High 90) [...] C1 : (GF Low: 35, GF High 85) [...] C2 : (GF Low: 35, GF High 70)". */
export const DAVINCI_GF: Record<string, [number, number]> = { c0: [90, 90], c1: [35, 85], c2: [35, 70] };

const ppo2 = Array.from({ length: 13 }, (_, i) => (1 + i * 0.05).toFixed(2)).map((v) => ({ value: v, label: `${v} ATA` }));

/**
 * Cressi DaVinci (Direction for Use, Rev. 04/2021), Computer mode: Bühlmann ZHL-16C with gradient
 * factors (§3.1, §4.3.6), up to four gases (§4.3.5), colour TFT display and two buttons (§3.6).
 * Rules cited by section; display in index.ts.
 */
export abstract class DaVinciRules extends DiveComputer {
  readonly id = 'cressi-davinci';
  readonly name = 'Cressi DaVinci';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  readonly exact = true;

  readonly settingDefs: SettingDef[] = [
    // §4.3.6 and §11.2 (default C0).
    { key: 'cons', label: { fr: 'Conservatisme (CONSERVAT.)', en: 'Conservatism (CONSERVAT.)' }, default: 'c0',
      options: [{ value: 'c0', label: 'C0 (90/90)' }, { value: 'c1', label: 'C1 (35/85)' }, { value: 'c2', label: 'C2 (35/70)' }] },
    // §4.3.5: MAX PPO2 1.00–1.60 per gas; §11.2: 1.60 ATA for all gases. One value for gas 1, one for the others here.
    { key: 'ppo2', label: { fr: 'MAX PPO2 du GAS 1', en: 'GAS 1 MAX PPO2' }, default: '1.60', options: ppo2 },
    { key: 'decoPpo2', label: { fr: 'MAX PPO2 des GAS 2 à 4', en: 'GAS 2 to 4 MAX PPO2' }, default: '1.60', options: ppo2 },
    // §4.3.5: GAS 2 (then 3 and 4) can be set OFF; §11.2: Gas 2, 3, 4 OFF.
    { key: 'multigas', label: { fr: 'GAS 2 à 4 (gaz de déco)', en: 'GAS 2 to 4 (deco gases)' }, default: 'off',
      options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }] },
    // §4.3.7: "OFF, or safety stop depth to 10 ft (3 m) or 20 ft (6 m) and time to 3 minutes or 5 minutes".
    // §11.2 lists "3 minutes/5 M", a depth the menu does not offer: 6 m assumed by default (NOT VERIFIED).
    { key: 'ssDepth', label: { fr: 'Palier de sécurité (profondeur)', en: 'Safety stop (depth)' }, default: '6',
      options: [{ value: 'off', label: 'OFF' }, { value: '3', label: '3 m' }, { value: '6', label: '6 m' }] },
    { key: 'ssTime', label: { fr: 'Palier de sécurité (durée)', en: 'Safety stop (time)' }, default: '3',
      options: [{ value: '3', label: '3 min' }, { value: '5', label: '5 min' }] },
    // §4.3.8, §11.2: OFF.
    { key: 'deepStop', label: { fr: 'Deep stop', en: 'Deep stop' }, default: 'off', options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }] },
    // §4.3.1.3: NO DECO alarm 1–30 min, cannot be OFF; §11.2: 5 minutes.
    { key: 'ndlAlarm', label: { fr: 'Alarme NO DECO', en: 'NO DECO alarm' }, default: '5',
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30].map((m) => ({ value: String(m), label: `${m} min` })) },
    // §4.3.1.4: OXTOX alarm OFF or 60–99 %; §11.2: 80 %.
    { key: 'oxtoxAlarm', label: { fr: 'Alarme OXTOX', en: 'OXTOX alarm' }, default: '80',
      options: [{ value: 'off', label: 'OFF' }, ...[60, 70, 75, 80, 85, 90, 95, 99].map((p) => ({ value: String(p), label: `${p} %` }))] },
    // §4.3.1.1: depth alarm OFF or 10–100 m; §4.3.1.2: dive time alarm OFF or 1–99 min; both OFF (§11.2).
    { key: 'depthAlarm', label: { fr: 'Alarme de profondeur (DEPTH)', en: 'Depth alarm (DEPTH)' }, default: 'off',
      options: [{ value: 'off', label: 'OFF' }, ...[10, 15, 20, 25, 30, 35, 40, 45, 50, 60].map((d) => ({ value: String(d), label: `${d} m` }))] },
    { key: 'timeAlarm', label: { fr: 'Alarme de durée (DIVE TIME)', en: 'Dive time alarm (DIVE TIME)' }, default: 'off',
      options: [{ value: 'off', label: 'OFF' }, ...[10, 20, 30, 40, 45, 50, 60, 70, 80, 90].map((m) => ({ value: String(m), label: `${m} min` }))] },
    // §11.2: Sound ON.
    { key: 'sound', label: { fr: 'Son (SOUND)', en: 'Sound (SOUND)' }, default: 'on', options: [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }] },
  ];

  constructor() {
    super();
    // §4.3.7: safety stop on a no-deco dive deeper than 9 m, shown "upon ascending to within 3 FT (0.9 M)
    // deeper than the Safety Stop Depth"; it keeps counting when shallower ("the safety stop will
    // continue to be displayed until the countdown reaches 0:00"); "descend greater than 10 FT (3 M)
    // deeper than the Stop Depth for 10 seconds" cancels it, re-triggered below 9 m.
    this.safetyStop = { trigger: 9, start: 6.9, top: 0.9, bottom: 9, reset: 9 };
    this.ceilingMargin = 0.05; // §7.9.1: "shallower than the deepest stop depth"
    this.violationRef = 'stop';
    this.lockAfter = null; // §7.9.1: violation mode after surfacing (VMS, 24 h), see tick
    this.lockHours = 24;
    this.stopWindow = 3; // §7.7: "from 10 ft (3 m) deeper than deco stop depth to the deco stop depth"
    this.ndlCap = 599; // §11.3: No Deco Time 0:00 – 9:59 (hr:min)
    this.ascentAlarmDelay = 0;
    this.init();
  }

  get maxGases(): number {
    return this.settings.multigas === 'on' ? 4 : 1;
  }

  decoPpo2(): number {
    return Number(this.settings.decoPpo2) || 1.6;
  }

  baseParams(): DecoParams {
    const [lo, hi] = DAVINCI_GF[this.settings.cons] ?? DAVINCI_GF.c0;
    // Last stop 3 m, 3 m steps and the ascent rate of the plan: not given (figures show a 3 m stop; 9 m/min assumed).
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: 3, stopStep: 3, ascentRate: 9 };
  }

  get hasSafetyStop(): boolean {
    return this.settings.ssDepth !== 'off' || this.settings.deepStop === 'on';
  }

  /** §4.3.8: "If you set the deep stop to ON and the safety stop was set to OFF, the safety stop is automatically set to 6 m – 3 min". */
  ssDepth(): number {
    return this.settings.ssDepth === 'off' ? 6 : Number(this.settings.ssDepth);
  }

  safetySeconds(): number {
    return (this.settings.ssDepth === 'off' ? 3 : Number(this.settings.ssTime)) * 60;
  }

  /**
   * §7.4.1, ASC bar segments: 18 m and shallower 3.1 / 4.6 / 6.1 / 7.6 / 9.1+ m/min, deeper than 18 m
   * 6.1 / 9.1 / 12.1 / 15.1 / 18.1+ m/min; "4 segments represent warning condition, and 5 segments
   * represent alarm condition".
   */
  segments(rate: number, depth: number): number {
    const t = depth > 18 ? [6.1, 9.1, 12.1, 15.1, 18.1] : [3.1, 4.6, 6.1, 7.6, 9.1];
    return t.filter((x) => rate >= x - 1e-9).length;
  }

  ascentLevel(rate: number, depth: number): 0 | 1 | 2 {
    const n = this.segments(rate, depth);
    return n >= 5 ? 2 : n === 4 ? 1 : 0;
  }

  protected tickSafetyStop(s: DiveSession, dt: number, inDeco: boolean): void {
    const d = this.ssDepth();
    this.safetyStop = { trigger: 9, start: d + 0.9, top: 0.9, bottom: d + 3, reset: 9 };
    super.tickSafetyStop(s, dt, inDeco);
  }

  // --- Deep stop (§4.3.8) --------------------------------------------------------------------------

  deep: { depth: number; left: number; state: 'armed' | 'shown' | 'off' } | null = null;
  private deepOut = 0;

  // --- Violations (§7.9.1) -------------------------------------------------------------------------

  /** Seconds spent shallower than the deepest stop this dive (more than 5 min: violation mode after the dive). */
  aboveSec = 0;
  /** §7.9.1: "a 1.5-minute penalty time will be added to your deco time for every minute you are shallower". */
  penaltySec = 0;
  violated = false;
  /** Safety stop cancelled by staying more than 3 m deeper for 10 s (§4.3.7). */
  private ssDeep = 0;
  /** Gas switch warning "SWITCH TO" (§7.8): offered at the deco stop zone, 30 s. */
  readonly prompt = new GasPrompt();
  /** §7.4.2: "DECO ENTRY" for 10 s after deco entry (session clock), with the Ti bar flashing. */
  decoEntryAt = -1;

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deep = null;
    this.deepOut = 0;
    this.aboveSec = this.penaltySec = 0;
    this.violated = false;
    this.ssDeep = 0;
    this.decoEntryAt = -1;
    this.prompt.reset();
  }

  /** §7.9.1: violation mode at surface, 24 h, when more than 5 minutes were spent above the deco depth. */
  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    if (this.violated) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    const wasDeco = this.decoEntryAt >= 0;
    super.tick(s, dt);
    if (!s.inDive) return;
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const stop = ceil > 0 ? stopDepthFor(ceil, p) : 0;
    if (stop > 0 && !wasDeco) this.decoEntryAt = s.clock;
    // §7.9.1: shallower than the deepest stop: penalty 1.5 min per minute, violation after 5 minutes.
    if (stop > 0 && s.depth < stop - 0.05) {
      this.aboveSec += dt;
      this.penaltySec += 1.5 * dt;
      if (this.aboveSec > 300) this.violated = true;
    }
    // The penalty is worked off at the last stop once the computed stops are cleared (deduced: the
    // manual only says it is "added to your deco time").
    if (stop === 0 && this.penaltySec > 0 && s.depth >= 2.9 && s.depth <= 6) this.penaltySec = Math.max(0, this.penaltySec - dt);
    // §4.3.7: safety stop cancelled after 10 s more than 3 m deeper than the stop depth (until re-triggered below 9 m).
    if (this.safetyState === 'active' || this.safetyState === 'paused') {
      this.ssDeep = s.depth > this.ssDepth() + 3 ? this.ssDeep + dt : 0;
      if (this.ssDeep >= 10) this.safetyState = 'done';
    }
    this.tickDeep(s, dt, stop > 0);
    // §7.8: "If the actual gas is not the best gas when arriving at the deco stop zone": offered when at a
    // stop (within 3 m) and a richer programmed gas is breathable; 30 s ("will time out after 30 seconds").
    const mods = this.knownGases(s).map((g) => (stop > 0 && s.depth <= stop + 3 ? this.decoMod(g.o2) : -1));
    this.prompt.update(s, mods, 30);
  }

  /**
   * §4.3.8: "the deep stop will trigger when you descend to 80 ft (24 m) for 1 second and calculate [...]
   * a Stop Depth equal to 1/2 the maximum depth. Upon initial ascent to within 10 ft (3 m) deeper than the
   * calculated Deep Stop Depth [...] a 2-minute countdown [...]. If you descend 10 ft (3 m) below or ascend
   * 10 ft (3 m) above the calculated stop depth for 10 seconds during the countdown, the deep stop will
   * disappear and will be disabled for the remainder of that dive." Also disabled by a high Oxtox or PPO2 alarm.
   */
  private tickDeep(s: DiveSession, dt: number, inDeco: boolean): void {
    if (this.settings.deepStop !== 'on') return;
    if (!this.deep) {
      if (s.depth >= 24) this.deep = { depth: s.maxDepth / 2, left: 120, state: 'armed' };
      return;
    }
    const d = this.deep;
    if (d.state === 'off') return;
    if (inDeco || s.ppO2 > this.modPpo2 + 1e-6 || s.oxygen.cns >= 100) {
      d.state = 'off';
      return;
    }
    if (d.state === 'armed') {
      d.depth = s.maxDepth / 2;
      if (s.depth <= d.depth + 3) d.state = 'shown';
      return;
    }
    if (Math.abs(s.depth - d.depth) > 3) {
      this.deepOut += dt;
      if (this.deepOut >= 10) d.state = 'off';
    } else this.deepOut = 0;
    d.left -= dt;
    if (d.left <= 0) d.state = 'off';
  }

  /** The deep stop on display (countdown running), or null. */
  deepShown(): { depth: number; left: number } | null {
    return this.deep && this.deep.state === 'shown' ? this.deep : null;
  }

  // --- Alerts --------------------------------------------------------------------------------------

  get soundKind(): AlertCue['kind'] {
    return 'beep';
  }

  /**
   * §4.3.1: "During an alarm, there will be an alarm sound every second for 10 seconds. The alarm sound
   * can be stopped by acknowledging the alarm by short pressing the R button." §7.4.1: warning level "3
   * short beeps"; §4.3.7: the safety stop starts with "1 short beep".
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive || (!all && this.settings.sound === 'off')) return [];
    const cues: AlertCue[] = [];
    const alarm = (key: string) => cues.push({ key, kind: 'beep', level: 'alarm', until: 'ack', every: 1, first: 10 });
    if (v.ascentLevel === 2) alarm('fast-ascent');
    else if (v.ascentLevel === 1) cues.push({ key: 'asc-warn', kind: 'beep', level: 'warning', until: 'once' });
    if (v.ceilingViolation > 0) alarm('back-to-stop');
    if (v.inDeco) alarm('deco-entry');
    else if (v.ndl <= Number(this.settings.ndlAlarm)) alarm('ndl');
    if (v.depth > v.mod + 0.05) alarm('ppo2');
    const ox = Math.max(v.cns, v.otu / 3);
    const oxAl = this.settings.oxtoxAlarm === 'off' ? 100 : Number(this.settings.oxtoxAlarm);
    if (ox >= oxAl) alarm('oxtox');
    if (this.settings.depthAlarm !== 'off' && v.depth >= Number(this.settings.depthAlarm)) alarm('depth');
    if (this.settings.timeAlarm !== 'off' && v.diveTime >= Number(this.settings.timeAlarm) * 60) alarm('time');
    if (this.prompt.offer !== null) cues.push({ key: 'switch', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }

  acknowledgeAlerts(): boolean {
    return false;
  }

  ackButtons = ['r'];

  alertExplain(key: string): AlertExplain | null {
    const k = ({ ASCENT: 'fast-ascent', ASCENT_WARN: 'asc-warn', CEILING: 'back-to-stop', DECO: 'deco-entry', NDL_LOW: 'ndl', PPO2_HIGH: 'ppo2', CNS: 'oxtox', LOCKED: 'vms' } as Record<string, string>)[key] ?? key;
    const ack = { fr: 'Alarme sonore une fois par seconde pendant 10 s, arrêtée par un appui court sur R.', en: 'Alarm sound every second for 10 s, stopped by a short press on R.' };
    switch (k) {
      case 'fast-ascent':
        return { id: k, screen: 'SLOW!', code: 'ASCENT', what: { fr: `Barre ASC à 5 segments (9,1 m/min et plus jusqu’à 18 m, 18,1 m/min et plus au-delà) : toute la barre clignote et « SLOW! » clignote jusqu’au retour sous le seuil (§7.4.1). ${ack.fr}`, en: `ASC bar at 5 segments (9.1 m/min and more down to 18 m, 18.1 m/min and more deeper): the whole bar and “SLOW!” flash until back below the threshold (§7.4.1). ${ack.en}` } };
      case 'asc-warn':
        return { id: k, code: 'ASCENT_WARN', what: { fr: 'Barre ASC à 4 segments (7,6–9 m/min jusqu’à 18 m, 15,1–18 m/min au-delà) : segments jaunes clignotants et 3 bips courts (§7.4.1).', en: 'ASC bar at 4 segments (7.6–9 m/min down to 18 m, 15.1–18 m/min deeper): flashing yellow segments and 3 short beeps (§7.4.1).' } };
      case 'deco-entry':
        return { id: k, screen: 'DECO ENTRY', code: 'DECO', what: { fr: `Le palier (profondeur et durée, fond jaune) remplace le NO DECO ; la barre Ti et « DECO ENTRY » (fond rouge, à la place de la durée) clignotent 10 s ; une flèche vers le haut clignote jusqu’à 3 m sous le palier, puis deux flèches (haut et bas) au palier (§7.7). ${ack.fr}`, en: `The stop (depth and time, yellow background) replaces the NO DECO; the Ti bar and “DECO ENTRY” (red background, in place of the dive time) flash for 10 s; an up arrow flashes until 3 m below the stop, then two arrows (up and down) at the stop (§7.7). ${ack.en}` } };
      case 'back-to-stop':
        return { id: k, screen: 'BACK TO STOP DEPTH', code: 'CEILING', what: { fr: 'Plus haut que le palier le plus profond : « BACK TO STOP DEPTH » clignote sur fond jaune à la place de la durée, le palier passe sur fond rouge, une flèche vers le bas clignote. Chaque minute au-dessus ajoute 1,5 min de palier ; après 5 min au-dessus, le message passe sur fond rouge foncé et l’ordinateur entre en mode violation (VMS) 5 min après la sortie, pour 24 h (§7.9.1).', en: 'Shallower than the deepest stop: “BACK TO STOP DEPTH” flashes on a yellow background in place of the dive time, the stop turns red, a down arrow flashes. Each minute above adds 1.5 min of stop; after 5 min above, the message turns dark red and the computer enters violation mode (VMS) 5 min after surfacing, for 24 h (§7.9.1).' }, todo: { fr: 'Redescendez au palier.', en: 'Go back down to the stop.' } };
      case 'vms':
        return { id: k, screen: 'VIOLATION', code: 'LOCKED', what: { fr: 'Mode violation à la surface (VMS) : pas de plongée pendant 24 h, plus d’informations de décompression ni d’oxygène ; désaturation non affichée (§7.9.1).', en: 'Violation mode at surface (VMS): no dive for 24 h, no more decompression or oxygen information; desaturation not shown (§7.9.1).' } };
      case 'ndl':
        return { id: k, code: 'NDL_LOW', what: { fr: `Le temps sans palier descend à l’alarme NO DECO réglée (5 min par défaut, 1 à 30, non désactivable) : chiffres sur fond jaune clignotants ; le fond reste jaune jusqu’à l’entrée en déco (§4.3.1.3). ${ack.fr}`, en: `The no-deco time drops to the set NO DECO alarm (5 min by default, 1 to 30, cannot be off): digits flash on a yellow background; it stays yellow until deco entry (§4.3.1.3). ${ack.en}` }, todo: { fr: 'Commencez la remontée.', en: 'Begin the ascent.' } };
      case 'ppo2':
        return { id: k, screen: 'PPO2', code: 'PPO2_HIGH', what: { fr: `PPO2 au-delà de la MAX PPO2 du gaz (sous la MOD) : « PPO2 » clignote sur fond rouge foncé, la MOD clignote en blanc sur fond rouge tant que la PPO2 reste au-dessus (§4.3.5.1). ${ack.fr}`, en: `PPO2 beyond the gas MAX PPO2 (below the MOD): “PPO2” flashes on a dark red background, the MOD flashes white on red while the PPO2 stays above (§4.3.5.1). ${ack.en}` }, todo: { fr: 'Remontez au-dessus de la MOD.', en: 'Ascend above the MOD.' } };
      case 'oxtox':
        return { id: k, screen: 'OXTOX', code: 'CNS', what: { fr: `Oxtox (100 % = 300 OTU par plongée ou 24 h ; le plus grand du CNS et des OTU ici, déduit) au seuil réglé (80 % par défaut) et toujours à 100 % : « OXTOX » clignote sur fond rouge foncé, sans arrêt au-delà de 100 % (§4.3.1.4). ${ack.fr}`, en: `Oxtox (100 % = 300 OTU per dive or 24 h; the larger of CNS and OTU here, deduced) at the set threshold (80 % by default) and always at 100 %: “OXTOX” flashes on a dark red background, continuously beyond 100 % (§4.3.1.4). ${ack.en}` } };
      case 'depth':
        return { id: k, screen: 'DEPTH', what: { fr: `Alarme de profondeur réglée (désactivée par défaut) : « DEPTH » et la profondeur clignotent en rouge ; la profondeur reste rouge tant qu’on est plus profond (§4.3.1.1). ${ack.fr}`, en: `Set depth alarm (off by default): “DEPTH” and the depth flash red; the depth stays red while deeper (§4.3.1.1). ${ack.en}` } };
      case 'time':
        return { id: k, screen: 'DIVE TIME', what: { fr: `Alarme de durée réglée (désactivée par défaut) : la durée clignote 10 s, puis reste rouge jusqu’à la surface (§4.3.1.2). ${ack.fr}`, en: `Set dive time alarm (off by default): the dive time flashes for 10 s, then stays red until surfacing (§4.3.1.2). ${ack.en}` } };
      case 'switch':
        return { id: k, screen: 'SWITCH TO', what: { fr: 'Au palier, si un gaz réglé (ON) est meilleur que le gaz respiré : « SWITCH TO … » clignote sur fond jaune à la place de la durée jusqu’à l’acquittement ou 30 s. Le calcul utilise toujours le gaz respiré (§7.8).', en: 'At the stop, if a gas set ON is better than the gas breathed: “SWITCH TO …” flashes on a yellow background in place of the dive time until acknowledged or for 30 s. The calculation always uses the gas breathed (§7.8).' }, todo: { fr: 'L : écran de changement de gaz (L choisit, R enregistre).', en: 'L: gas switch screen (L chooses, R saves).' } };
    }
    return null;
  }

  /**
   * §7.8: "The deco and oxygen toxicity calculations are always done with the actual gas": only the
   * gas breathed is in the plan.
   */
  planGases() {
    return [];
  }
}

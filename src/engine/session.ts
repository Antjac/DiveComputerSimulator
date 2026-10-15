import { AIR, Gas, SURFACE_PRESSURE, Tissues, depthToPressure } from './buhlmann';
import { OxygenTracker } from './oxygen';

export const DIVE_START_DEPTH = 1.2; // m
export const DIVE_END_TIMEOUT = 180; // s spent at the surface before the dive is closed
const MAX_DESCENT = 35; // m/min the diver can physically reach
const MAX_ASCENT = 22; // m/min (deliberately above computer limits so alarms can be triggered)
const ACCEL = 0.15; // m/s²
const DEFAULT_ASCENT = 9; // m/min, within every computer's ascent limit
const DEFAULT_DESCENT = 18; // m/min

// Rescue alert: situations that stop the simulation, judged on the diver's physical state and never
// on a computer model. These thresholds are teaching choices, not taken from any manual.
/** Rapid ascent: every ascent that ends near the surface is judged — at the surface, or at a stop
 *  in the last RAPID_STOP_ZONE metres (the 3 min "palier de principe" at 3 m, a safety stop), so
 *  that doing that stop never hides a rapid ascent. An ascent starts at the bottom or after a
 *  steady depth held RAPID_STOP_S; its average speed is taken over its last RAPID_REF_DEPTH metres
 *  (at least 3 m of ascent)… The alert is raised on reaching the surface. */
export const RAPID_REF_DEPTH = 10; // m
export const RAPID_STOP_S = 30; // s at a steady depth (±0.3 m)
export const RAPID_STOP_ZONE = 6; // m
/** …above this speed, well over the usual 9–10 m/min. */
export const RAPID_RATE = 15; // m/min
/** Missed stops: on surfacing, a compartment beyond its surface M-value (pure Bühlmann ZH-L16C,
 *  GF 100 %), so decompression stops were due whatever the computer. Skipping the palier de
 *  principe / safety stop never triggers it. */
export const MISSED_DECO_GF = 100; // %

/** What the session tells its listeners: a dive starts, ends, or is cut short by the rescue alert. */
export type SessionEvent = 'start' | 'end' | 'interrupt';

export type EmergencyReason = 'OUT_OF_AIR' | 'RAPID_ASCENT' | 'MISSED_DECO';
export interface Emergency {
  reasons: EmergencyReason[];
  clock: number; // session clock (s)
  depth: number; // m, where it happened
  /** RAPID_ASCENT: the fastest ascent judged, average speed (m/min) from `fromDepth` to `toDepth`. */
  rate?: number;
  fromDepth?: number;
  toDepth?: number;
  /** MISSED_DECO: highest gradient at the surface (%). */
  surfGf?: number;
}

/** Ascent judged too fast: average speed (m/min) from `fromDepth` to `toDepth` (m). */
export interface RapidAscent {
  rate: number;
  fromDepth: number;
  toDepth: number;
}

export interface ProfileSample {
  t: number; // s since dive start
  depth: number;
  ceiling: number;
  /** Saturation of the diver's tissues (pure ZH-L16C, % of the M-value gradient): the most loaded
   *  compartment at the current depth (GF99) and if surfacing now (SurfGF). Dive recap (app/recap.ts). */
  gf99?: number;
  surfGf?: number;
}

/** Scuba tank: water capacity (L) and working/fill pressure (bar). The reserve is a setting of each computer. */
export interface Tank {
  volume: number;
  fill: number;
}

/** A decompression gas carried in its own tank (stage), with its current pressure (bar). */
export interface DecoGas {
  gas: Gas;
  tank: Tank;
  pressure: number;
}

/** Most decompression gases the page lets the diver carry (besides the bottom gas). */
export const MAX_DECO_GASES = 2;

export interface DiveLogEntry {
  number: number;
  start: number; // session clock (s)
  duration: number; // s
  maxDepth: number;
  avgDepth: number;
  gas: Gas;
  /** Decompression gases carried during the dive. */
  decoGases?: Gas[];
  /** Gases breathed during the dive, main tank first. */
  gasesUsed?: Gas[];
  minTemp: number;
  surfaceIntervalBefore: number | null; // s
  profile: ProfileSample[];
  cnsEnd: number;
  tankStart: number; // bar
  tankEnd: number; // bar
  gasUsed: number; // surface litres
  alarms: string[];
  /** The dive was cut short by the rescue alert (the simulation stopped there): the reasons. */
  interrupted?: EmergencyReason[];
}

/**
 * What the diver (or the interface) did to the session, with the session clock: with the state the
 * session was in before the first of them, it is all that is needed to replay the dive (app/replay.ts).
 */
export type JournalEvent =
  | { t: number; k: 'target' | 'rate' | 'gas' | 'seabed' | 'site' | 'rmv' | 'heading'; v: number }
  | { t: number; k: 'refill' };

/** The journal of a dive that ended: `token` is whatever `onJournalStart` returned before the first command. */
export interface ClosedJournal {
  token: unknown;
  events: JournalEvent[];
  /** Session clock when the dive ended. */
  endClock: number;
}

/** Seabed moves smaller than this (m) are not journaled. */
const SEABED_STEP = 0.25;
/** Turns smaller than this (degrees) are not journaled. */
const HEADING_STEP = 5;

/** Longest journal kept (events other than the diver's own commands are dropped beyond it). */
const MAX_JOURNAL = 20_000;

/** Water temperature model: warm surface layer, thermocline around 12–18 m. */
export function waterTemperature(depth: number): number {
  const surface = 24;
  const deep = 14;
  const x = (depth - 15) / 4;
  return deep + (surface - deep) / (1 + Math.exp(x)) - Math.min(1.5, Math.max(0, depth - 30) * 0.03);
}

/**
 * Physical state of the diver: depth, time, gas and tissue loading. Dive computers read this
 * state; they never change it.
 */
export class DiveSession {
  tissues = new Tissues();
  oxygen = new OxygenTracker();
  /** Mix of the main tank (T1). */
  backGas: Gas = { ...AIR };
  /** Decompression gases carried in stage tanks (at most MAX_DECO_GASES). */
  decoGases: DecoGas[] = [];
  /** Gas breathed: 0 = the main tank, i = decoGases[i - 1]. Changed with the computer's buttons. */
  breathing = 0;

  /** Gas breathed now. Setting it (at the surface) sets the main tank's mix and breathes from it. */
  get gas(): Gas {
    return this.breathing > 0 && this.decoGases[this.breathing - 1] ? this.decoGases[this.breathing - 1].gas : this.backGas;
  }

  set gas(g: Gas) {
    if (this.inputsLocked) return;
    this.backGas = { ...g };
    this.breathing = 0;
  }

  /** Every gas carried: the main tank first, then the deco gases. */
  get allGases(): Gas[] {
    return [this.backGas, ...this.decoGases.map((d) => d.gas)];
  }

  /** Breathes from gas `i` (0 = main tank, as in allGases). */
  switchGas(i: number): void {
    if (this.inputsLocked) return;
    if (i < 0 || i > this.decoGases.length || i === this.breathing) return;
    this.note('gas', i, true);
    this.doSwitchGas(i);
  }

  private doSwitchGas(i: number): void {
    this.breathing = i;
    this.usedGases.add(i);
    // The breathing rate measured on the main tank must not include the time spent on another tank
    // (its pressure stays flat meanwhile).
    this.pressureHistory = [];
  }

  /** Gases breathed during the dive in progress (indexes as in allGases). */
  private usedGases = new Set<number>([0]);

  /** Pressure (bar) of the tank of gas `i` (0 = main tank). */
  gasPressure(i: number): number {
    return i === 0 ? this.tankPressure : this.decoGases[i - 1]?.pressure ?? 0;
  }

  clock = 0; // s, total simulated time
  depth = 0;
  targetDepth = 0;
  velocity = 0; // m/s, positive = descending
  /**
   * 'target': head for targetDepth at full speed (click in the water). 'rate': hold the vertical
   * speed chosen with ▲/▼ until it is changed or the surface / bottom is reached.
   */
  control: 'target' | 'rate' = 'target';
  commandRate = 0; // m/min, positive = descending
  /** Speeds used to reach a target depth: the last ones chosen with ▲/▼ (m/min). */
  ascentSpeed = DEFAULT_ASCENT;
  descentSpeed = DEFAULT_DESCENT;
  private _siteDepth = 40;
  get siteDepth(): number {
    return this._siteDepth;
  }

  set siteDepth(v: number) {
    if (this.inputsLocked) return;
    this.note('site', v);
    this._siteDepth = v;
  }

  /** Depth of whatever lies under the diver (seabed, wreck…), set by the 3D view; the diver rests on it. */
  private _seabed = Infinity;
  private seabedNoted = Infinity;
  get seabed(): number {
    return this._seabed;
  }

  set seabed(v: number) {
    if (this.inputsLocked) return;
    // The 3D view sets it on every frame: only moves that matter are journaled.
    if (v !== this.seabedNoted && (!Number.isFinite(v) || !Number.isFinite(this.seabedNoted) || Math.abs(v - this.seabedNoted) >= SEABED_STEP)) {
      this.seabedNoted = v;
      this.note('seabed', v);
    }
    this._seabed = v;
  }

  /**
   * Compass heading of the diver, degrees clockwise from north (0–360), set by the 3D view as the diver
   * turns (north being the scene's own reference); it stays as it is in the 2D view. Read by the
   * computers that have a compass.
   */
  private _heading = 0;
  private headingNoted = 0;
  get heading(): number {
    return this._heading;
  }

  set heading(v: number) {
    if (this.inputsLocked) return;
    v = ((v % 360) + 360) % 360;
    const turn = Math.abs(((v - this.headingNoted + 540) % 360) - 180);
    if (turn >= HEADING_STEP) {
      this.headingNoted = v;
      this.note('heading', v);
    }
    this._heading = v;
  }

  // --- Journal, for the replay of the dive (app/replay.ts) ---

  /** Commands since the last one given at the surface. */
  journal: JournalEvent[] = [];
  /** The journal of the dive that ended last. */
  lastJournal: ClosedJournal | null = null;
  /** Called before the first command of a descent, with the session still untouched; what it returns is kept as the journal's token. */
  onJournalStart: (() => unknown) | null = null;
  private journalToken: unknown = null;
  /** A replay is running: the commands of the interface are ignored, only the journal's are applied. */
  replaying = false;
  private applying = false;

  private get inputsLocked(): boolean {
    return this.replaying && !this.applying;
  }

  /**
   * Notes a command. A command given out of the water starts a new journal (the last one before the
   * descent is the one that counts), after the hook has recorded the state the command finds.
   */
  private note(k: JournalEvent['k'], v?: number, restart = false): void {
    if (this.replaying) return;
    if (restart && !this.inDive) {
      this.journal = [];
      this.journalToken = this.onJournalStart ? this.onJournalStart() : null;
    }
    if (this.journal.length >= MAX_JOURNAL && !restart) return;
    this.journal.push(k === 'refill' ? { t: this.clock, k } : { t: this.clock, k, v: v ?? 0 });
  }

  /** Replays one journaled command. */
  applyEvent(e: JournalEvent): void {
    this.applying = true;
    try {
      switch (e.k) {
        case 'target': this.setTarget(e.v); break;
        case 'rate': this.setRate(e.v); break;
        case 'gas': this.switchGas(e.v); break;
        case 'seabed': this.seabed = e.v; break;
        case 'heading': this.heading = e.v; break;
        case 'site': this.siteDepth = e.v; break;
        case 'rmv': this.rmv = e.v; break;
        case 'refill': this.refillTank(); break;
      }
    } finally {
      this.applying = false;
    }
  }

  inDive = false;
  diveNumber = 0;
  diveStart = 0;
  diveTime = 0; // s
  maxDepth = 0;
  depthIntegral = 0;
  minTemp = 99;
  surfaceTimer = 0; // s at the surface during a dive
  lastDiveEnd: number | null = null;
  profile: ProfileSample[] = [];
  log: DiveLogEntry[] = [];
  diveAlarms = new Set<string>();
  /** Current ceiling reported by the active computer, stored in the profile. */
  reportedCeiling = 0;
  /** Rescue alert for a rapid ascent or missed stops (optional); an empty tank always raises one. */
  rescueAlert = false;
  /** Set when the simulation must stop (see Emergency); cleared by reset(). */
  emergency: Emergency | null = null;
  /** [clock, depth] over the last minutes of the dive, to measure the final ascent. */
  private track: [number, number][] = [];
  /** Steady stretch in progress (depth ±0.3 m since `steadySince`), judged once it lasts RAPID_STOP_S. */
  private steadyDepth = 0;
  private steadySince = 0;
  private steadyJudged = false;
  /** Fastest ascent over RAPID_RATE this dive, reported on surfacing. */
  private rapid: RapidAscent | null = null;
  /** Fastest ascent over RAPID_RATE of the current (or last) dive, judged so far. */
  get rapidAscent(): RapidAscent | null {
    return this.rapid;
  }

  // Gas supply.
  tank: Tank = { volume: 12, fill: 200 };
  /** Wireless tank transmitter paired with the computer (used when the model supports one). */
  transmitterOn = true;
  /** Surface respiratory minute volume (RMV / "SAC"), in litres per minute. */
  private _rmv = 20;
  get rmv(): number {
    return this._rmv;
  }

  set rmv(v: number) {
    if (this.inputsLocked) return;
    this.note('rmv', v);
    this._rmv = v;
  }

  tankPressure = 200;
  private tankAtStart = 200;
  private gasUsed = 0;
  /** Recent tank pressure samples [clock s, bar], used by computers to measure the breathing rate. */
  pressureHistory: [number, number][] = [];
  private historyTimer = 0;

  private sampleTimer = 0;
  private listeners: Array<(e: SessionEvent) => void> = [];

  on(fn: (e: SessionEvent) => void): void {
    this.listeners.push(fn);
  }

  get pressure(): number {
    return depthToPressure(this.depth);
  }

  get ppO2(): number {
    return this.pressure * this.gas.o2;
  }

  get temperature(): number {
    return waterTemperature(this.depth);
  }

  get avgDepth(): number {
    return this.diveTime > 0 ? this.depthIntegral / this.diveTime : 0;
  }

  /** Vertical speed in m/min, positive when ascending (dive computer convention). */
  get ascentRate(): number {
    return -this.velocity * 60;
  }

  get surfaceInterval(): number | null {
    if (this.inDive || this.lastDiveEnd === null) return null;
    return this.clock - this.lastDiveEnd;
  }

  setTarget(depth: number): void {
    if (this.aboard || this.inputsLocked) return;
    this.note('target', depth, true);
    this.control = 'target';
    this.targetDepth = Math.min(this.siteDepth, Math.max(0, depth));
  }

  /** Vertical speed command in m/min, positive when descending. */
  setRate(rate: number): void {
    if (this.aboard || this.inputsLocked) return;
    this.note('rate', rate, true);
    this.control = 'rate';
    this.commandRate = Math.min(MAX_DESCENT, Math.max(-MAX_ASCENT, Math.round(rate)));
    if (this.commandRate < 0) this.ascentSpeed = -this.commandRate;
    else if (this.commandRate > 0) this.descentSpeed = this.commandRate;
  }

  /** Changes the speed command; starts from the current speed when coming from target mode. */
  nudgeRate(delta: number): void {
    this.setRate((this.control === 'rate' ? this.commandRate : Math.round(this.velocity * 60)) + delta);
  }

  canChangeGas(): boolean {
    return !this.inDive;
  }

  /** Advance the simulation by dt seconds (dt should be ≤ 1 s). */
  step(dt: number): void {
    const prevDepth = this.depth;

    // Diver kinematics: head toward the target depth (or hold the commanded speed) with limited
    // speed and acceleration.
    const bottom = Math.min(this.siteDepth, this.seabed);
    // Braking curve v = sqrt(2·a·d) so the diver stops on the target without overshooting.
    const brake = (d: number) => Math.min(Math.sqrt(2 * ACCEL * 0.8 * d), d / Math.max(dt, 0.5));
    let desired: number;
    if (this.control === 'rate') {
      const v = this.commandRate / 60;
      desired = v > 0 ? Math.min(v, brake(Math.max(0, bottom - this.depth))) : -Math.min(-v, brake(this.depth));
      // The seabed rose above the diver (3D view): lifted like in target mode.
      if (this.depth > bottom) desired = Math.min(desired, -Math.min(MAX_ASCENT / 60, brake(this.depth - bottom)));
    } else {
      const diff = Math.min(this.targetDepth, bottom) - this.depth;
      const maxV = (diff > 0 ? this.descentSpeed : this.ascentSpeed) / 60;
      desired = Math.sign(diff) * Math.min(maxV, brake(Math.abs(diff)));
    }
    const dv = desired - this.velocity;
    this.velocity += Math.sign(dv) * Math.min(Math.abs(dv), ACCEL * dt);
    // Never sink below the bottom; if it rose above the diver, the kinematics above bring them up.
    this.depth = Math.min(Math.max(bottom, prevDepth), Math.max(0, this.depth + this.velocity * dt));
    if (this.depth === 0 && this.velocity < 0) this.velocity = 0;
    if (this.depth >= bottom && this.velocity > 0) this.velocity = 0;
    if (this.control === 'rate') {
      this.targetDepth = this.depth;
      // Stop the command once the surface or the bottom is reached.
      if ((this.commandRate < 0 && this.depth <= 0.01) || (this.commandRate > 0 && this.depth >= bottom - 0.01)) this.commandRate = 0;
    }

    const minutes = dt / 60;
    // Nothing comes out of an empty stage tank: the diver is already back on another one.
    if (Math.max(prevDepth, this.depth) > 0.5) this.leaveEmptyStage();
    this.tissues.exposeLinear(depthToPressure(prevDepth), depthToPressure(this.depth), this.gas, minutes);
    this.oxygen.expose(this.ppO2, minutes);
    this.breathe(prevDepth, minutes, dt);
    this.clock += dt;

    if (!this.inDive && this.depth > DIVE_START_DEPTH && !this.emergency) this.startDive();

    if (this.inDive) {
      this.track.push([this.clock, this.depth]);
      while (this.track.length > 2 && this.clock - this.track[0][0] > 600) this.track.shift();
      this.watchStops();
      if (prevDepth >= DIVE_START_DEPTH && this.depth < DIVE_START_DEPTH) this.checkSurfacing();
      this.diveTime += dt;
      this.depthIntegral += this.depth * dt;
      this.maxDepth = Math.max(this.maxDepth, this.depth);
      this.minTemp = Math.min(this.minTemp, this.temperature);
      this.sampleTimer += dt;
      if (this.sampleTimer >= 5) {
        this.sampleTimer = 0;
        this.profile.push({
          t: this.diveTime,
          depth: this.depth,
          ceiling: this.reportedCeiling,
          gf99: this.tissues.maxGradientPercent(this.pressure),
          surfGf: this.tissues.maxGradientPercent(SURFACE_PRESSURE),
        });
      }
      if (this.depth < DIVE_START_DEPTH) {
        this.surfaceTimer += dt;
        if (this.surfaceTimer >= DIVE_END_TIMEOUT) this.endDive();
      } else {
        this.surfaceTimer = 0;
      }
      if (this.emergency && !this.interrupted) this.interrupt(this.emergency);
    }
  }

  /** Arrival at the surface: too fast over the last metres (always judged, the boat reports it), or
   *  with stops still due. The rescue alert is raised only when it is on. */
  private checkSurfacing(): void {
    this.noteAscent(this.track.length - 1);
    if (!this.rescueAlert) return;
    const reasons: EmergencyReason[] = [];
    const e: Omit<Emergency, 'reasons'> = { clock: this.clock, depth: this.depth };
    const surfGf = this.tissues.maxGradientPercent(SURFACE_PRESSURE);
    if (surfGf > MISSED_DECO_GF) {
      reasons.push('MISSED_DECO');
      e.surfGf = surfGf;
    }
    if (this.rapid) {
      reasons.push('RAPID_ASCENT');
      Object.assign(e, this.rapid);
    }
    if (reasons.length) this.raise({ ...e, reasons });
  }

  /** A stop held RAPID_STOP_S in the last metres: judge the ascent that led to it. */
  private watchStops(): void {
    if (Math.abs(this.depth - this.steadyDepth) > 0.3) {
      this.steadyDepth = this.depth;
      this.steadySince = this.clock;
      this.steadyJudged = false;
    } else if (!this.steadyJudged && this.clock - this.steadySince >= RAPID_STOP_S) {
      this.steadyJudged = true;
      if (this.depth <= RAPID_STOP_ZONE && this.depth >= DIVE_START_DEPTH) {
        this.noteAscent(this.track.findIndex(([t]) => t >= this.steadySince));
      }
    }
  }

  /** Average speed of the ascent ending at track[end], kept if it is the fastest over RAPID_RATE. */
  private noteAscent(end: number): void {
    const tr = this.track;
    if (end < 1) return;
    // Start of the ascent, walking back: a shallower point (descent before it) or a steady depth
    // held RAPID_STOP_S (a stop); short hesitations are part of it.
    let k = end; // where the ascent resumed after the steady stretch being examined
    for (let i = end - 1; i >= 0; i--) {
      const [t, d] = tr[i];
      if (d > tr[k][1] + 0.3) k = i;
      else if (d < tr[k][1] - 0.3 || tr[k][0] - t >= RAPID_STOP_S) break;
    }
    const [tEnd, to] = tr[end];
    const ref = Math.min(to + RAPID_REF_DEPTH, tr[k][1]);
    if (ref - to < 3) return; // too short to judge
    // Last moment of that ascent at or below the reference depth.
    const from = tr.slice(k, end + 1).reverse().find(([, d]) => d >= ref);
    if (!from || tEnd <= from[0]) return;
    const rate = ((from[1] - to) / (tEnd - from[0])) * 60;
    if (rate > RAPID_RATE && rate > (this.rapid?.rate ?? 0)) this.rapid = { rate, fromDepth: from[1], toDepth: to };
  }

  private raise(e: Emergency): void {
    // A replay never stops: the dive was played through to its end.
    if (!this.emergency && !this.replaying) this.emergency = e;
  }

  /** Gas consumption: RMV scaled by ambient pressure, drawn from the tank. */
  private breathe(prevDepth: number, minutes: number, dt: number): void {
    const inWater = Math.max(prevDepth, this.depth) > 0.5;
    const stage = this.breathing > 0 ? this.decoGases[this.breathing - 1] : undefined;
    if (inWater && !this.outOfGas) {
      const pAtm = depthToPressure((prevDepth + this.depth) / 2) / 1.01325;
      const liters = this.rmv * pAtm * minutes;
      this.gasUsed += liters;
      if (stage) stage.pressure = Math.max(0, stage.pressure - liters / stage.tank.volume);
      else this.tankPressure = Math.max(0, this.tankPressure - liters / this.tank.volume);
    }
    if (inWater) {
      this.leaveEmptyStage();
      // Out of gas in the water (no tank left with gas): always stops the simulation.
      if (this.outOfGas) this.raise({ reasons: ['OUT_OF_AIR'], clock: this.clock, depth: this.depth });
    }
    this.historyTimer += dt;
    if (this.historyTimer >= 5) {
      this.historyTimer = 0;
      this.pressureHistory.push([this.clock, this.tankPressure]);
      if (this.pressureHistory.length > 60) this.pressureHistory.shift();
    }
  }

  /** Fresh tank: at reset, when the tank model is changed at the surface, or handed from the boat
   *  (boardBoat, or a tank swap in the water). There is no automatic refill between dives. */
  refillTank(): void {
    if (this.inDive) this.note('refill');
    this.tankPressure = this.tank.fill;
    for (const d of this.decoGases) d.pressure = d.tank.fill;
    this.pressureHistory = [];
  }

  /**
   * An empty stage tank (just emptied, or switched to once empty): the diver goes back to the main tank
   * (or another tank still holding gas), as taught; the computers see the gas breathed change.
   */
  private leaveEmptyStage(): void {
    if (this.breathing === 0 || !this.outOfGas) return;
    const other = [0, ...this.decoGases.map((_, i) => i + 1)].find((i) => this.gasPressure(i) > 0);
    if (other === undefined) return;
    this.doSwitchGas(other); // not journaled: the same thing happens when the dive is replayed
    this.diveAlarms.add('STAGE_EMPTY');
    this.stageEmptyAt = this.clock;
  }

  /** Clock (s) when the diver last left an empty stage tank (the notice under the computer). */
  stageEmptyAt = -Infinity;

  /** The tank breathed is empty. */
  get outOfGas(): boolean {
    return this.gasPressure(this.breathing) <= 0;
  }

  /** On the boat (app/boat.ts): the diver stays at the surface, depth commands are ignored. */
  aboard = false;

  /** The diver climbs aboard for a break: the dive in progress ends now and the tank is refilled, so
   *  the next descent is a new dive (consecutive or repetitive). `leaveBoat` puts them back in the water. */
  boardBoat(): void {
    if (this.inDive && this.depth < DIVE_START_DEPTH) this.endDive();
    this.refillTank();
    this.setTarget(0);
    this.aboard = true;
  }

  leaveBoat(): void {
    this.aboard = false;
  }

  private startDive(): void {
    this.tankAtStart = this.tankPressure;
    this.gasUsed = 0;
    this.inDive = true;
    this.interrupted = false;
    this.interruptedEntry = null;
    this.diveNumber += 1;
    this.diveStart = this.clock;
    this.diveTime = 0;
    this.maxDepth = 0;
    this.depthIntegral = 0;
    this.minTemp = 99;
    this.surfaceTimer = 0;
    this.sampleTimer = 0;
    this.profile = [{ t: 0, depth: 0, ceiling: 0, gf99: this.tissues.maxGradientPercent(SURFACE_PRESSURE), surfGf: this.tissues.maxGradientPercent(SURFACE_PRESSURE) }];
    this.track = [];
    this.usedGases = new Set([this.breathing]);
    this.rapid = null;
    this.diveAlarms.clear();
    this.stageEmptyAt = -Infinity;
    this.listeners.forEach((l) => l('start'));
  }

  /** The log entry of the dive in progress, `duration` long. */
  private logEntry(duration: number, profile: ProfileSample[]): DiveLogEntry {
    return {
      number: this.diveNumber,
      start: this.diveStart,
      duration,
      maxDepth: this.maxDepth,
      avgDepth: this.depthIntegral / Math.max(1, duration),
      gas: { ...this.backGas },
      decoGases: this.decoGases.map((d) => ({ ...d.gas })),
      gasesUsed: this.allGases.filter((_, i) => this.usedGases.has(i)).map((g) => ({ ...g })),
      minTemp: this.minTemp,
      surfaceIntervalBefore: this.lastDiveEnd === null ? null : this.diveStart - this.lastDiveEnd,
      profile,
      cnsEnd: this.oxygen.cns,
      tankStart: this.tankAtStart,
      tankEnd: this.tankPressure,
      gasUsed: this.gasUsed,
      alarms: [...this.diveAlarms],
    };
  }

  /** The dive in progress as it stands, as a log entry (null: not diving). */
  currentEntry(): DiveLogEntry | null {
    if (!this.inDive) return null;
    const last: ProfileSample = { t: this.diveTime, depth: this.depth, ceiling: this.reportedCeiling, gf99: this.tissues.maxGradientPercent(this.pressure), surfGf: this.tissues.maxGradientPercent(SURFACE_PRESSURE) };
    return this.logEntry(this.diveTime, [...this.profile, last]);
  }

  /** The journal of the dive in progress, up to now (null: not diving, or nothing to replay from). */
  openJournal(): ClosedJournal | null {
    if (!this.inDive || !this.journalToken) return null;
    return { token: this.journalToken, events: [...this.journal], endClock: this.clock };
  }

  /** The rescue alert stops the simulation: the dive is over for the logbook and the recap, though the diver stays where they are. */
  private interrupt(e: Emergency): void {
    this.interrupted = true;
    this.interruptedEntry = { ...this.currentEntry()!, interrupted: [...e.reasons] };
    this.lastJournal = { token: this.journalToken, events: [...this.journal], endClock: this.clock };
    this.listeners.forEach((l) => l('interrupt'));
  }

  /** The dive cut short by the rescue alert, as a log entry (null: none). Not in `log`: the dive is still open, and a reset wipes it. */
  interruptedEntry: DiveLogEntry | null = null;
  private interrupted = false;

  private endDive(): void {
    // The dive ends when the diver surfaced; the trailing surface time is not counted.
    const duration = this.diveTime - this.surfaceTimer;
    this.log.push(this.logEntry(duration, this.profile.filter((p) => p.t <= duration + 5)));
    if (!this.replaying) this.lastJournal = { token: this.journalToken, events: [...this.journal], endClock: this.clock };
    this.inDive = false;
    // Back on the main tank between dives.
    this.breathing = 0;
    this.lastDiveEnd = this.clock - this.surfaceTimer;
    this.diveTime = duration;
    this.listeners.forEach((l) => l('end'));
  }

  /** Full reset: fresh tissues, as after several days without diving. */
  reset(): void {
    this.tissues = new Tissues();
    this.oxygen.reset();
    this.clock = 0;
    this.depth = 0;
    this.targetDepth = 0;
    this.velocity = 0;
    this.control = 'target';
    this.commandRate = 0;
    this.ascentSpeed = DEFAULT_ASCENT;
    this.descentSpeed = DEFAULT_DESCENT;
    this.inDive = false;
    this.diveNumber = 0;
    this.diveTime = 0;
    this.maxDepth = 0;
    this.depthIntegral = 0;
    this.surfaceTimer = 0;
    this.lastDiveEnd = null;
    this.breathing = 0;
    this.aboard = false;
    this.refillTank();
    this.profile = [];
    this.log = [];
    this.diveAlarms.clear();
    this.stageEmptyAt = -Infinity;
    this.track = [];
    this.rapid = null;
    this.emergency = null;
    this.journal = [];
    this.lastJournal = null;
    this.journalToken = null;
    this.interrupted = false;
    this.interruptedEntry = null;
  }

}

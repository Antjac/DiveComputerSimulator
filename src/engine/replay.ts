// Replay of a dive: the simulation is deterministic, so a dive is reproduced from the state the session
// and the computers were in when the descent began plus the journal of the commands given (see
// JournalEvent). Going back is done from key frames (the state every FRAME_EVERY seconds, taken as the
// replay goes forward), going forward by simulating again.
import { applyState, plainState } from './plainState';
import type { DiveSession, JournalEvent } from './session';

/** The part of a computer the replay needs. */
export interface ReplayComputer {
  id: string;
  tick(s: DiveSession, dt: number): void;
}

/** State of the session and of every computer, as plain data (survives IndexedDB and JSON). */
export interface DiveState {
  session: Record<string, unknown>;
  computers: Record<string, Record<string, unknown>>;
}

/** Fields of the session that are not state: the replay's own, and the journal. */
const SESSION_SKIP = ['journal', 'lastJournal', 'journalToken', 'replaying', 'applying', 'listeners', 'onJournalStart', 'interruptedEntry'];
/** The current dive's samples are rebuilt by the replay; a stored state leaves them out (and the logged dives' profiles). */
const SESSION_SLIM_SKIP = ['profile', 'track'];
/** What a computer is (not what it did) and its real-time timers (backlight, flashes…): never stored. */
const COMPUTER_SKIP = ['id', 'name', 'algorithm', 'exact', 'notes', 'settingDefs', 'transmitter', 'gasTimeName', 'undocumentedVariant',
  'backlightUntil', 'flashUntil', 'flashText', 'screenChangedAt', 'selAt', 'savedUntil', 'successUntil', 'success', 'last', 'altView', 'menuAt'];

/** Seconds between two key frames. */
const FRAME_EVERY = 30;
/** Longest simulation step in the water / at the surface (s), as the live loop. */
const STEP_WATER = 0.5;
const STEP_SURFACE = 5;
const EPS = 1e-6;

/**
 * The state now. `slim`: for storage in the logbook (the logged dives keep their figures but not their
 * profiles, which the replay does not need).
 */
export function captureState(session: DiveSession, computers: readonly ReplayComputer[], slim = false): DiveState {
  const s = plainState(session, slim ? [...SESSION_SKIP, ...SESSION_SLIM_SKIP] : SESSION_SKIP);
  if (slim) s.log = session.log.map((e) => plainState({ ...e, profile: [] }));
  return { session: s, computers: Object.fromEntries(computers.map((c) => [c.id, plainState(c, COMPUTER_SKIP)])) };
}

/** Puts a captured state back. */
export function restoreState(session: DiveSession, computers: readonly ReplayComputer[], st: DiveState): void {
  applyState(session, st.session, SESSION_SKIP);
  for (const c of computers) {
    const data = st.computers[c.id];
    if (data) applyState(c, data, COMPUTER_SKIP);
  }
}

export class Replayer {
  /** Replay time (s since the start state). */
  pos = 0;
  /** Length of the replay (s). */
  readonly duration: number;
  private frames: { t: number; state: DiveState; next: number }[];
  private next = 0;
  private lastFrame = 0;
  /** Session clock at replay time 0. */
  readonly startClock: number;

  /**
   * `start` is the state before the first command; `events` the journal; the replay ends at session clock `endClock`.
   * The session is put in replay mode (the interface's commands are ignored) until `stop()`.
   */
  constructor(
    private readonly session: DiveSession,
    private readonly computers: readonly ReplayComputer[],
    start: DiveState,
    private readonly events: readonly JournalEvent[],
    endClock: number,
    /** The state at `endClock` when it is at hand (a dive still going on): the replay starts there, at its end, without simulating. */
    from?: DiveState,
  ) {
    session.replaying = true;
    restoreState(session, computers, start);
    this.startClock = session.clock;
    this.duration = Math.max(0, endClock - this.startClock);
    this.frames = [{ t: 0, state: start, next: 0 }];
    if (from) {
      this.frames.push({ t: this.duration, state: from, next: events.length });
      restoreState(session, computers, from);
      this.pos = this.lastFrame = this.duration;
      this.next = events.length;
    } else {
      this.apply();
    }
  }

  /** Leaves replay mode (the caller puts the live state back). */
  stop(): void {
    this.session.replaying = false;
  }

  /** Applies the commands due at the session's clock. */
  private apply(): void {
    const now = this.session.clock + EPS;
    while (this.next < this.events.length && this.events[this.next].t <= now) this.session.applyEvent(this.events[this.next++]);
  }

  /**
   * Simulates forward up to replay time `to`, or a little beyond: the steps depend only on the state, the
   * journal and the end of the dive, never on where the replay is asked to stop, so that the same moment
   * is the same state whichever way it is reached.
   */
  private run(to: number): void {
    const s = this.session;
    const stop = this.startClock + Math.min(to, this.duration);
    const end = this.startClock + this.duration;
    this.apply(); // the first command is due before any step
    while (s.clock < stop - EPS) {
      let dt = s.inDive || s.depth > 0.01 || s.velocity !== 0 ? STEP_WATER : STEP_SURFACE;
      const ev = this.events[this.next];
      if (ev && ev.t > s.clock + EPS) dt = Math.min(dt, ev.t - s.clock);
      dt = Math.min(dt, end - s.clock);
      s.step(dt);
      for (const c of this.computers) c.tick(s, dt);
      this.apply();
      this.pos = s.clock - this.startClock;
      if (this.pos - this.lastFrame >= FRAME_EVERY) this.keyFrame();
    }
    this.pos = s.clock - this.startClock;
  }

  /** A key frame here, unless the stretch was already taken (after going back). */
  private keyFrame(): void {
    this.lastFrame = this.pos;
    if (this.frames.some((f) => Math.abs(f.t - this.pos) < FRAME_EVERY / 2)) return;
    this.frames.push({ t: this.pos, state: captureState(this.session, this.computers), next: this.next });
    this.frames.sort((a, b) => a.t - b.t);
  }

  /** Goes to replay time `t` (s): forward by simulating, backward from the last key frame before it. */
  seek(t: number): void {
    t = Math.min(this.duration, Math.max(0, t));
    if (t < this.pos - STEP_WATER) {
      let i = this.frames.length - 1;
      while (i > 0 && this.frames[i].t > t) i--;
      restoreState(this.session, this.computers, this.frames[i].state);
      this.pos = this.frames[i].t;
      this.lastFrame = this.pos;
      this.next = this.frames[i].next;
    }
    this.run(t);
  }

  get atEnd(): boolean {
    return this.pos >= this.duration - EPS;
  }
}

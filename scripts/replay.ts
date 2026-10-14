// Replay of a dive: plays a dive with the live loop's small steps, then replays it from its journal and
// compares the session and every computer's view at several moments. Also times the replay.
import { createComputers } from '../src/computers';
import { Replayer, captureState, restoreState, type DiveState } from '../src/engine/replay';
import { DiveSession } from '../src/engine/session';

const s = new DiveSession();
const cs = createComputers();
s.on((e) => cs.forEach((c) => (e === 'start' ? c.onDiveStart(s) : c.onDiveEnd(s))));
s.onJournalStart = () => captureState(s, cs, true);
let n2End: Float64Array | null = null;
s.on((e) => { if (e === 'end') n2End = new Float64Array(s.tissues.n2); });

const live = (sec: number, step = 0.05) => {
  for (let left = sec; left > 1e-9; left -= step) {
    const dt = Math.min(step, left);
    s.step(dt);
    cs.forEach((c) => c.tick(s, dt));
  }
};

// A first dive, then a surface interval, then the dive that is replayed (decompression, a gas switch, a stop held).
s.setTarget(20); live(900); s.setTarget(0); live(400);
live(3600, 5);
s.decoGases = [{ gas: { o2: 0.5, he: 0 }, tank: { volume: 7, fill: 200 }, pressure: 200 }];
s.siteDepth = 45;
s.setTarget(42); live(300);
s.setRate(0); live(1200);
s.setTarget(21); live(150);
s.switchGas(1); live(60);
s.setTarget(9); live(120);
s.nudgeRate(2); live(60);
s.setTarget(6); live(400);
s.setTarget(3); live(900);
s.setTarget(0); live(400);

const closed = s.lastJournal;
if (!closed) throw new Error('no journal');
const n = s.log.length;
console.log(`dive ${n}: ${closed.events.length} commands, ends at clock ${closed.endClock.toFixed(0)}, log ${(s.log[n - 1].duration / 60).toFixed(1)} min`);
const stored = JSON.parse(JSON.stringify(closed.token)) as DiveState;
console.log(`stored start state: ${(JSON.stringify(stored).length / 1024).toFixed(0)} KB, journal ${(JSON.stringify(closed.events).length / 1024).toFixed(1)} KB`);
// What the live dive came to, to compare with its replay.
const orig = s.log[n - 1];

// Replay on a second session / set of computers, as the interface does on the live one.
const s2 = new DiveSession();
const cs2 = createComputers();
s2.on((e) => cs2.forEach((c) => (e === 'start' ? c.onDiveStart(s2) : c.onDiveEnd(s2))));
const snap = captureState(s2, cs2);
const t0 = performance.now();
const r = new Replayer(s2, cs2, stored, closed.events, closed.endClock);
console.log(`replay length ${r.duration.toFixed(0)} s`);
r.seek(r.duration);
const t1 = performance.now();
console.log(`forward to the end: ${(t1 - t0).toFixed(0)} ms, log ${s2.log.length} dives`);
const e2 = s2.log[s2.log.length - 1];
console.log('duration', (orig.duration / 60).toFixed(2), (e2.duration / 60).toFixed(2), '| max depth', orig.maxDepth.toFixed(2), e2.maxDepth.toFixed(2),
  '| tank', orig.tankEnd.toFixed(1), e2.tankEnd.toFixed(1), '| cns', orig.cnsEnd.toFixed(2), e2.cnsEnd.toFixed(2));
const tissueDiff = Math.max(...Array.from(n2End!, (v, i) => Math.abs(v - s2.tissues.n2[i])));
console.log('tissues N2 max diff at the end of the dive', tissueDiff.toExponential(1), 'bar');

// Going back and forth must give the same state as going straight there (fields the computers latch in
// compute(), which the interface calls on its own schedule, are left out).
const LATCHED = ['alarmUntil', 'alarmWas', 'notices', 'prompt'];
const stateAt = (rp: Replayer, a: DiveSession, b: typeof cs2, m: number): string => {
  rp.seek(m);
  const st = captureState(a, b);
  for (const c of Object.values(st.computers)) for (const k of LATCHED) delete c[k];
  return JSON.stringify(st);
};
const marks = [100, 1500, r.duration];
const t2 = performance.now();
let bad = 0;
for (const m of marks) {
  const s3 = new DiveSession();
  const cs3 = createComputers();
  s3.on((e) => cs3.forEach((c) => (e === 'start' ? c.onDiveStart(s3) : c.onDiveEnd(s3))));
  const straight = stateAt(new Replayer(s3, cs3, stored, closed.events, closed.endClock), s3, cs3, m);
  r.seek(30); r.seek(r.duration); r.seek(0);
  const got = stateAt(r, s2, cs2, m);
  if (got !== straight) {
    bad++;
    console.log('differs at', m);
  }
}
console.log('seek back and forth gives the same state:', bad === 0, `(${(performance.now() - t2).toFixed(0)} ms)`);

// The live state comes back.
r.stop();
restoreState(s2, cs2, snap);
const restored = s2.clock === 0 && s2.log.length === 0 && !s2.replaying;
console.log('live state restored:', restored);

if (bad || !restored || tissueDiff > 1e-3) {
  console.log('✗ replay differs');
  (globalThis as { process?: { exit: (c: number) => void } }).process!.exit(1);
}
console.log('✓ replay OK');

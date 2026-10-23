// Comparison with the Deeply Safe Labs chamber tests (scripts/dslData.ts): replays each test on the
// matching model of the simulator, following the stops it shows, and compares the stops with those of the
// real computer. `npm run dsl`, or `npm run dsl -- <computer id>`.
//  - Exact models (Bühlmann ZH-L16C + GF): the total stop time of each dive must be within tolerance,
//    otherwise the script fails (regression check of the engine).
//  - Approximated models (≈): the gap is only reported (calibration aid).
// Depth: the chamber tests are made with the computers set to fresh water, but the stops of the Garmin
// Descent MK2 (to the second) are only found again with 30 m of salt water (≈ 4.03 bar), not with
// 30 m of fresh water (≈ 3.96 bar): the chamber pressure is taken as 30 m of salt water (deduction).
import { DiveSession } from '../src/engine/session';
import { createComputers } from '../src/computers';
import type { DiveComputer } from '../src/computers';
import { ceilingDepth, planAscent, type DecoParams } from '../src/engine/buhlmann';
import { DSL_TESTS, type DslTest } from './dslData';

const only = (globalThis as { process?: { argv: string[] } }).process?.argv[2];

interface Case {
  computer: string; // Deeply Safe Labs name
  algo: string;
  id: string; // model of the simulator
  exact: boolean;
  settings: (gf?: string) => Record<string, string> | null; // null: setting not offered
  note?: string;
}

const gfPair = (gf?: string) => (gf ?? '').split('/');
const CASES: Case[] = [
  {
    computer: 'Descent MK2', algo: 'ZH-L16 C GF', id: 'garmin', exact: true,
    settings: (gf) => ({ gf: 'custom', gfLow: gfPair(gf)[0], gfHigh: gfPair(gf)[1] }),
    note: 'Descent MK2 measured, Descent Mk3i simulated: same algorithm (Bühlmann ZH-L16C + GF).',
  },
  {
    computer: 'Perdix 2', algo: 'ZH-L16 C GF', id: 'shearwater', exact: true,
    settings: (gf) => ({ mode: 'octec', tecGfLow: gfPair(gf)[0], tecGfHigh: gfPair(gf)[1], lastStop: '3' }),
  },
  { computer: 'Perdix 2', algo: 'DCIEM', id: 'shearwater', exact: false, settings: () => null, note: 'DCIEM algorithm not simulated.' },
  { computer: 'G2', algo: 'ZH-L16 ADT MB', id: 'scubapro', exact: false, settings: () => ({ level: '0', pdis: 'off' }),
    note: 'The chamber followed the G2 ideal ascent rate (slower near the surface); simulated at 10 m/min.' },
  { computer: 'Luna 2.0', algo: 'ZH-L16 ADT MB', id: 'luna', exact: false, settings: () => ({ algo: 'adt', level: '0', pdis: 'off' }) },
  {
    computer: 'Luna 2.0', algo: 'ZH-L16 C GF', id: 'luna', exact: false,
    // §2.1.2.4: GF sets offered by the Luna 2.0 AI (90/90 is not one of them).
    settings: (gf) => (['30/70', '30/85', '35/75', '40/85', '45/95', '50/80'].includes(gf ?? '') ? { algo: 'gf', gf: gf! } : null),
  },
  { computer: 'Quad Air', algo: 'Mares RGBM', id: 'quadair', exact: false,
    settings: () => ({ personal: 'P0', deepstop: 'off', runaway: 'off', fast: 'off' }) },
  { computer: 'i100', algo: 'Pelagic Z+', id: 'i770r', exact: false, settings: () => ({ cf: 'off', deepStop: 'off' }),
    note: 'i100 measured, i770R simulated: same algorithm (Pelagic Z+).' },
  { computer: 'i300C', algo: 'Pelagic Z+', id: 'i770r', exact: false, settings: () => ({ cf: 'off', deepStop: 'off' }),
    note: 'i300C measured, i770R simulated: same algorithm (Pelagic Z+).' },
];

const DEPTH = 30;
const fmt = (sec: number | null) => (sec === null ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
const stopsText = (stops: [number, number][]) => stops.map(([d, t]) => `${d}m ${fmt(t)}`).join(' ') || 'none';
const total = (stops: [number, number][]) => stops.reduce((a, [, t]) => a + t, 0);
/**
 * Exact models: allowed gap on the total stop time of a dive. A regression guard, not a claim of
 * agreement: the Garmin second dives are already 4 to 12 % longer in the simulator, and the Perdix shows
 * whole minutes (up to a minute per stop).
 */
const tolerance = (realTotal: number, nStops: number) => Math.max(180, 0.15 * realTotal, 45 * nStops);

/**
 * First stop of the stricter stage chosen on a Scubapro (MB level, GF on the Luna): not mandatory, but
 * shown and followed. Computed on the computer's own view of the session (its own tissues).
 */
function stageStop(c: DiveComputer, s: DiveSession): number {
  const sc = c as unknown as { stageParams?: () => DecoParams | null; levelAnchor?: number };
  const lp = sc.stageParams?.();
  if (!lp) return 0;
  const v = c.sees(s);
  if (ceilingDepth(v.tissues, sc.levelAnchor ?? 0, lp) <= 0) return 0;
  return planAscent(v.tissues, v.depth, v.gas, lp, sc.levelAnchor ?? 0, 1 / 6).stops[0]?.depth ?? 0;
}

function replay(cs: Case, t: DslTest, settings: Record<string, string>): { nst: number | null; stops: [number, number][] }[] {
  const s = new DiveSession();
  s.siteDepth = 60;
  s.rescueAlert = false;
  s.tank = { volume: 200, fill: 300 }; // never runs out of gas
  s.refillTank();
  const all = createComputers();
  const c = all.find((x) => x.id === cs.id)!;
  Object.assign(c.settings, settings);
  s.on((e) => all.forEach((x) => (e === 'start' ? x.onDiveStart(s) : x.onDiveEnd(s))));
  const step = (sec: number) => { for (let i = 0; i < sec * 2; i++) { s.step(0.5); all.forEach((x) => x.tick(s, 0.5)); } };
  s.descentSpeed = 30;
  s.ascentSpeed = 10;

  const out: { nst: number | null; stops: [number, number][] }[] = [];
  const bottom = t.test === '2x30' ? 30 : 16;
  const interval = t.test === '2x30' ? 90 : 75;
  for (let n = 0; n < t.dives.length; n++) {
    if (n > 0) { s.boardBoat(); step(interval * 60); s.leaveBoat(); }
    const t0 = s.clock;
    let nst: number | null = null;
    s.setTarget(DEPTH);
    while (s.clock - t0 < bottom * 60) {
      step(1);
      if (nst === null && (c.compute(s).inDeco || stageStop(c, s) > 0)) nst = Math.round(s.clock - t0);
    }
    // Ascent: to the deepest stop shown (mandatory or stage), no safety stop, as in the chamber.
    const stops: [number, number][] = [];
    for (let k = 0; k < 4 * 3600; k++) {
      const v = c.compute(s);
      s.reportedCeiling = v.ceiling;
      const target = Math.max(v.inDeco ? v.stopDepth : 0, stageStop(c, s));
      s.setTarget(target);
      if (target > 0 && Math.abs(s.depth - target) < 0.3) {
        const last = stops[stops.length - 1];
        if (last && last[0] === target) last[1]++;
        else stops.push([target, 1]);
      }
      if (target === 0 && s.depth < 0.05) break;
      step(1);
    }
    out.push({ nst, stops });
  }
  return out;
}

let failures = 0;
for (const cs of CASES) {
  if (only && cs.id !== only) continue;
  const proto = createComputers().find((x) => x.id === cs.id)!;
  console.log(`\n=== ${cs.computer} (${cs.algo}) → ${proto.name} ${cs.exact ? '[exact]' : '[≈]'}${cs.note ? `  ${cs.note}` : ''}`);
  for (const t of DSL_TESTS.filter((x) => x.computer === cs.computer && x.algo === cs.algo)) {
    const label = `${t.test}${t.gf ? ` GF ${t.gf}` : ''}`;
    const settings = cs.settings(t.gf);
    if (!settings) { console.log(`  ${label}: not simulated`); continue; }
    const sim = replay(cs, t, settings);
    console.log(`  ${label}`);
    t.dives.forEach((real, i) => {
      const r = total(real.stops), m = total(sim[i].stops);
      const gap = m - r;
      const pct = r > 0 ? ` (${gap >= 0 ? '+' : ''}${Math.round((100 * gap) / r)} %)` : '';
      let mark = '';
      if (cs.exact) {
        const ok = Math.abs(gap) <= tolerance(r, Math.max(real.stops.length, sim[i].stops.length));
        if (!ok) failures++;
        mark = ok ? ' ✓' : ' ✗';
      }
      console.log(`    dive ${i + 1}  NST ${fmt(real.nst).padStart(5)} / ${fmt(sim[i].nst).padEnd(5)}  real ${stopsText(real.stops).padEnd(44)} sim ${stopsText(sim[i].stops).padEnd(44)} total ${fmt(r)} / ${fmt(m)}  ${gap >= 0 ? '+' : '-'}${fmt(Math.abs(gap))}${pct}${mark}`);
    });
  }
}
console.log(failures ? `\n✗ ${failures} dive(s) of exact models out of tolerance` : '\n✓ exact models within tolerance');
if (failures) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;

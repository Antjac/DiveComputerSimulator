// Alternate displays shared by the Scubapro G2 and G3 (G2 §3.7.1, G3 §3.5.2.6 and §3.8.1.2: same
// pages, same figures): gas summary, deco summary table, dive profile and compartment saturation.
// Drawn with the g2-* classes of g2/g2.css.
import { type DecoParams, WATER_VAPOUR, planAscent } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { depthInt, depthText, imperial, pressText } from '../../units';
import type { ComputerView } from '../base';
import type { ScubaproRules } from './common';

/** The computer seen by the pages (public parts of the G2 / G3 rules). */
interface Model extends ScubaproRules {
  gasMods(s: DiveSession): number[];
}

/** Projected ascent at 10 m/min with the planned stops (and the safety stop when pending), as [s, m] points. */
export function projection(v: ComputerView): [number, number][] {
  const now = v.inDive ? v.diveTime : 0;
  const proj: [number, number][] = [[now, v.depth]];
  let t = now;
  let d = v.depth;
  const stops = v.plan.stops.map((st) => ({ depth: st.depth, min: st.minutes }));
  if (!stops.length && v.maxDepth > 10 && v.safety.state !== 'done' && v.depth > 5) stops.push({ depth: 5, min: v.safety.remaining / 60 });
  for (const st of stops) {
    t += ((d - st.depth) / 10) * 60;
    d = st.depth;
    proj.push([t, d]);
    t += st.min * 60;
    proj.push([t, d]);
  }
  t += (d / 10) * 60;
  proj.push([t, 0]);
  return proj;
}

/**
 * Gas summary (G2 §2.8.2.5 figure, "a fast overview of the paired tank pressures and their content"):
 * BAR, O2 and MOD of tanks T1 to T4 (more rows when more gases are set); "NO P" for a tank without a
 * paired transmitter (only T1 has one here), "---" when it is not received, "--%" and "-" for an
 * unused tank; the MOD column gives the AMD (0.0 with nitrox) and the MOD. Title number deduced.
 */
export function gasSummary(c: Model, s: DiveSession): string {
  const gases = c.knownGases(s);
  const mods = c.gasMods(s);
  const n = Math.max(4, gases.length);
  const u = imperial() ? 'FT' : 'M';
  const rows = Array.from({ length: n }, (_, i) => {
    const g = gases[i];
    const bar = i === 0 ? (c.transmitter && s.transmitterOn ? pressText(s.tankPressure) : '---') : 'NO P';
    const o2 = g ? `${Math.round(g.o2 * 100)}<small>%</small>` : '--<small>%</small>';
    const mod = g ? `0.0- ${depthText(mods[i])}<small>${u}</small>` : '-';
    return `<div class="${i === s.breathing ? 'cur' : ''}"><span>T${i + 1}</span><span>${bar}</span><span>${o2}</span><span>${mod}</span></div>`;
  }).join('');
  return `<div class="g2-gsum"><div class="hd"><span></span><span>${imperial() ? 'PSI' : 'BAR'}</span><span>O2</span><span>MOD</span></div>${rows}</div>`;
}

/** A row group of the deco summary table: its label ("L5", "L0"…), parameters and GF low anchor. */
export interface DecoLevel {
  label: string;
  params: DecoParams;
  anchor: number;
}

/**
 * Deco summary table (G2 §3.4.2, G3 §3.5.2.6 figures): "the predicted decompression stops are shown
 * with all enabled gases used (PMG) and assuming only the current gas would be used (1G). Also,
 * current selected MB level as well as MB level 0 schedules are shown": first stop (depth, minutes)
 * and TAT in orange. Without PMG the rows are labelled 1G (deduced).
 */
export function decoSummary(c: Model, v: ComputerView, s: DiveSession, levels: DecoLevel[]): string {
  const pmg = c.maxGases > 1 && c.knownGases(s).length > 1;
  const rows: string[] = [];
  for (const lv of levels) {
    for (const mode of pmg ? ['PMG', '1G'] : ['1G']) {
      const p = { ...lv.params, gases: mode === 'PMG' ? c.planGases(s) : [] };
      const plan = planAscent(s.tissues, v.depth, s.gas, p, lv.anchor);
      const st = plan.stops[0];
      const stop = st ? `<span class="o">${depthInt(st.depth)}<small>${imperial() ? 'FT' : 'M'}</small></span><span class="o">${Math.ceil(st.minutes)}:</span>` : '<span></span><span></span>';
      rows.push(`<div><span class="b">${mode}</span><span class="b">${lv.label}</span>${stop}<span class="o">${plan.tts}:</span></div>`);
    }
  }
  return `<div class="g2-dsum">${rows.join('')}</div>`;
}

/**
 * "blue is the dived part, the gray line identifies current time and green is the predicted ascent
 * profile) with required gas switching depths according to MOD's (white lines)"; figures: depth scale
 * on the right (0 m to a round depth below the maximum: deduced) and the stops in orange.
 */
export function diveProfile(c: Model, v: ComputerView, s: DiveSession): string {
  const past: [number, number][] = [...s.profile.map((p) => [p.t, p.depth] as [number, number]), [v.diveTime, v.depth]];
  const proj = projection(v);
  const now = v.diveTime;
  const tMax = Math.max(proj[proj.length - 1][0], 600);
  const scale = Math.max(10, Math.ceil(v.maxDepth / 10) * 10);
  const W = 268;
  const H = 150;
  const X = (x: number) => ((x / tMax) * W).toFixed(1);
  const Y = (y: number) => ((Math.min(y, scale) / scale) * (H - 2) + 1).toFixed(1);
  const area = (pts: [number, number][]) => `M ${X(pts[0][0])} 0 ${pts.map(([x, y]) => `L ${X(x)} ${Y(y)}`).join(' ')} L ${X(pts[pts.length - 1][0])} 0 Z`;
  const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${X(x)} ${Y(y)}`).join(' ');
  const mods = c.maxGases > 1
    ? c.planGases(s).map((g) => `<line x1="${X(now)}" y1="${Y(g.mod)}" x2="${W}" y2="${Y(g.mod)}" stroke="#fff" stroke-width="1"/>`).join('')
    : '';
  const stops = [...v.plan.stops].reverse().map((st) => `<div><span>${depthInt(st.depth)}<small>${imperial() ? 'FT' : 'M'}</small></span><span>${Math.ceil(st.minutes)}:</span></div>`).join('');
  const u = imperial() ? 'FT' : 'M';
  return `<svg class="g2-prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${area(past)}" fill="#0b1f78"/><path d="${line(past)}" fill="none" stroke="#3f7bff" stroke-width="1.5"/>
        <path d="${area(proj)}" fill="#1c6a1c"/><path d="${line(proj)}" fill="none" stroke="#8be08b" stroke-width="1.5"/>
        ${mods}
        <line x1="${X(now)}" y1="0" x2="${X(now)}" y2="${H}" stroke="#a0a0a0" stroke-width="2"/>
        <path d="M ${Number(X(now)) - 4} 0 L ${Number(X(now)) + 4} 0 L ${X(now)} 6 Z M ${Number(X(now)) - 4} ${H} L ${Number(X(now)) + 4} ${H} L ${X(now)} ${H - 6} Z" fill="#a0a0a0"/>
      </svg>
      <div class="g2-prof-scale"><span>0${u}</span><span>${imperial() ? depthInt(scale) : scale}${u}</span></div>
      <div class="g2-prof-stops">${stops}</div>`;
}

/**
 * "The height of each bar indicates the ratio of current tissue loading with respect to the maximum
 * tolerable loading, expressed in a percentage. The green color indicates that the compartment is
 * off-gassing, and the red color shows on-gassing." The tolerable loading is taken as the M-value at
 * the current ambient pressure (deduced). Captions of the figures: CNS, SKIN, MUSCLE, BONE.
 */
export function saturation(s: DiveSession): string {
  const t = s.tissues;
  const inspired = (s.pressure - WATER_VAPOUR) * (1 - s.gas.o2);
  const bars = Array.from({ length: 16 }, (_, i) => {
    const [a, b] = t.coefficients(i);
    const p = t.n2[i] + t.he[i];
    const ratio = Math.max(0, Math.min(1, p / (s.pressure / b + a)));
    return `<i class="${p > inspired ? 'off' : 'on'}" style="height:${(ratio * 100).toFixed(1)}%"></i>`;
  }).join('');
  return `<div class="g2-sat"><div class="g2-sat-bars">${bars}</div><div class="g2-sat-lbl"><span>CNS</span><span>SKIN</span><span>MUSCLE</span><span>BONE</span></div></div>`;
}

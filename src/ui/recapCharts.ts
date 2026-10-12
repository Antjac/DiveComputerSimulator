// Charts of the dive recap (app/recap.ts), drawn in SVG on the recap's paper sheet: sharp when printed,
// and sized by the page. Depths are passed in the display unit.
import { COMPARTMENTS, N2_HALF } from '../engine/buhlmann';

const W = 680;
const PAD = { l: 46, r: 14, t: 10, b: 24 };

function niceStep(max: number, target: number): number {
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

const f1 = (v: number) => Math.round(v * 10) / 10;

/** Time axis (minutes) along the bottom of a chart `h` high. */
function timeAxis(maxT: number, x: (s: number) => number, h: number): string {
  const step = niceStep(maxT / 60, 7);
  let out = '';
  for (let m = 0; m <= maxT / 60 + 1e-9; m += step) {
    out += `<line class="rc-grid" x1="${f1(x(m * 60))}" x2="${f1(x(m * 60))}" y1="${PAD.t}" y2="${h - PAD.b}"/>`;
    out += `<text class="rc-axis" x="${f1(x(m * 60))}" y="${h - 7}" text-anchor="middle">${m}'</text>`;
  }
  return out;
}

export interface RecapPoint {
  t: number; // s
  depth: number; // display unit
  ceiling: number; // display unit
}

export interface RecapMarker {
  t: number;
  depth: number; // display unit
  level: 'crit' | 'serious' | 'warn';
  n: number;
}

/** Depth profile, the computer's ceiling as a shaded area, and the alerts as numbered markers. */
export function profileSvg(points: RecapPoint[], markers: RecapMarker[], unit: string, labels: { depth: string; ceiling: string }): string {
  const h = 230;
  const maxT = Math.max(5 * 60, ...points.map((p) => p.t));
  const maxD = Math.max(unit === 'm' ? 6 : 20, ...points.map((p) => Math.max(p.depth, p.ceiling))) * 1.1;
  const pw = W - PAD.l - PAD.r;
  const ph = h - PAD.t - PAD.b;
  const x = (s: number) => PAD.l + (s / maxT) * pw;
  const y = (d: number) => PAD.t + (d / maxD) * ph;
  let out = timeAxis(maxT, x, h);
  const step = niceStep(maxD, 5);
  for (let d = 0; d <= maxD; d += step) {
    out += `<line class="rc-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(d))}" y2="${f1(y(d))}"/>`;
    out += `<text class="rc-axis" x="${PAD.l - 6}" y="${f1(y(d) + 4)}" text-anchor="end">${d} ${unit}</text>`;
  }
  if (points.length > 1) {
    if (points.some((p) => p.ceiling > 0)) {
      const top = points.map((p) => `${f1(x(p.t))},${f1(y(p.ceiling))}`).join(' ');
      out += `<polygon class="rc-ceil" points="${f1(x(points[0].t))},${f1(y(0))} ${top} ${f1(x(points[points.length - 1].t))},${f1(y(0))}"/>`;
      out += `<polyline class="rc-ceil-line" points="${top}"/>`;
    }
    out += `<polyline class="rc-depth" points="${points.map((p) => `${f1(x(p.t))},${f1(y(p.depth))}`).join(' ')}"/>`;
  }
  for (const m of markers) {
    const mx = f1(x(Math.min(m.t, maxT)));
    const my = f1(y(m.depth));
    out += `<g class="rc-mk ${m.level}"><circle cx="${mx}" cy="${my}" r="8"/><text x="${mx}" y="${f1(my + 3.5)}" text-anchor="middle">${m.n}</text></g>`;
  }
  const legend = `<g class="rc-legend" transform="translate(${W - PAD.r - 190} ${h - PAD.b - 12})">
    <line class="rc-depth" x1="0" x2="18" y1="0" y2="0"/><text x="22" y="4">${labels.depth}</text>
    <rect class="rc-ceil" x="90" y="-5" width="18" height="10"/><text x="112" y="4">${labels.ceiling}</text></g>`;
  return `<svg class="rc-chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${labels.depth}">${out}${legend}</svg>`;
}

export interface SaturationPoint {
  t: number;
  gf99: number;
  surfGf: number;
}

/** Saturation over the dive: GF99 and SurfGF of the most loaded compartment, against 100 % and the computer's GF high. */
export function saturationSvg(points: SaturationPoint[], gfHigh: number, labels: { mValue: string; gfHigh: string }): string {
  const h = 170;
  const maxT = Math.max(5 * 60, ...points.map((p) => p.t));
  const maxGf = Math.max(110, ...points.map((p) => Math.max(p.gf99, p.surfGf))) * 1.05;
  const pw = W - PAD.l - PAD.r;
  const ph = h - PAD.t - PAD.b;
  const x = (s: number) => PAD.l + (s / maxT) * pw;
  const y = (g: number) => PAD.t + ph - (Math.max(0, g) / maxGf) * ph;
  let out = timeAxis(maxT, x, h);
  const step = niceStep(maxGf, 4);
  for (let g = 0; g <= maxGf; g += step) {
    out += `<line class="rc-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(g))}" y2="${f1(y(g))}"/>`;
    out += `<text class="rc-axis" x="${PAD.l - 6}" y="${f1(y(g) + 4)}" text-anchor="end">${g} %</text>`;
  }
  out += `<line class="rc-mvalue" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(100))}" y2="${f1(y(100))}"/>`;
  // M-value label on the left, GF high on the right: the two lines can be close.
  out += `<text class="rc-axis rc-mvalue-t" x="${PAD.l + 170}" y="${f1(y(100) - 4)}">${labels.mValue}</text>`;
  if (gfHigh > 0 && gfHigh < 100) {
    out += `<line class="rc-gfhigh" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(gfHigh))}" y2="${f1(y(gfHigh))}"/>`;
    out += `<text class="rc-axis rc-gfhigh-t" x="${W - PAD.r - 4}" y="${f1(y(gfHigh) - 4)}" text-anchor="end">${labels.gfHigh} ${gfHigh} %</text>`;
  }
  if (points.length > 1) {
    out += `<polyline class="rc-surfgf" points="${points.map((p) => `${f1(x(p.t))},${f1(y(p.surfGf))}`).join(' ')}"/>`;
    out += `<polyline class="rc-gf99" points="${points.map((p) => `${f1(x(p.t))},${f1(y(p.gf99))}`).join(' ')}"/>`;
  }
  const legend = `<g class="rc-legend" transform="translate(${PAD.l + 10} ${PAD.t + 10})">
    <line class="rc-surfgf" x1="0" x2="18" y1="0" y2="0"/><text x="22" y="4">SurfGF</text>
    <line class="rc-gf99" x1="80" x2="98" y1="0" y2="0"/><text x="102" y="4">GF99</text></g>`;
  return `<svg class="rc-chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="SurfGF / GF99">${out}${legend}</svg>`;
}

/** The 16 compartments (Tissues tab scale at the surface): below 0 under atmospheric pressure, above 0 the GF. */
export function tissuesSvg(values: number[], gfHigh: number): string {
  const h = 170;
  const top = Math.max(100, ...values) * 1.08;
  const bottom = Math.max(40, ...values.map((v) => -v)) * 1.08;
  const pw = W - PAD.l - PAD.r;
  const ph = h - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ((top - v) / (top + bottom)) * ph;
  let out = '';
  const step = niceStep(top + bottom, 5);
  for (let g = -Math.floor(bottom / step) * step; g <= top; g += step) {
    out += `<line class="rc-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(g))}" y2="${f1(y(g))}"/>`;
    out += `<text class="rc-axis" x="${PAD.l - 6}" y="${f1(y(g) + 4)}" text-anchor="end">${g} %</text>`;
  }
  out += `<line class="rc-zero" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>`;
  out += `<line class="rc-mvalue" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(100))}" y2="${f1(y(100))}"/>`;
  if (gfHigh > 0 && gfHigh < 100) out += `<line class="rc-gfhigh" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f1(y(gfHigh))}" y2="${f1(y(gfHigh))}"/>`;
  const bw = pw / COMPARTMENTS;
  values.slice(0, COMPARTMENTS).forEach((v, i) => {
    const x0 = PAD.l + i * bw + bw * 0.18;
    const cls = v > 100 ? 'crit' : v > gfHigh ? 'warn' : v > 0 ? 'ok' : 'under';
    const y0 = Math.min(y(0), y(v));
    out += `<rect class="rc-bar ${cls}" x="${f1(x0)}" y="${f1(y0)}" width="${f1(bw * 0.64)}" height="${f1(Math.max(1, Math.abs(y(v) - y(0))))}"><title>${i + 1} · ${N2_HALF[i]} min : ${Math.round(v)} %</title></rect>`;
    out += `<text class="rc-axis" x="${f1(x0 + bw * 0.32)}" y="${h - 7}" text-anchor="middle">${i + 1}</text>`;
  });
  return `<svg class="rc-chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="16 compartments">${out}</svg>`;
}

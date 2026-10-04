// "MN90 tables" dialog: the FFESSM air tables (MN90 of the French Navy) and where the diver stands in
// them right now, step by step: type of dive (single, successive, consecutive), residual nitrogen
// (Tableau I), penalty time (Tableau II), depth and time entering the table, the line read (stops,
// DTR, GPS). Can be opened at any time; it follows the dive while open.
import {
  GROUPS,
  MN90,
  MN90_DEPTHS,
  MN90_MAX_DEPTH,
  TABLE_I,
  TABLE_I_INTERVALS,
  TABLE_II,
  TABLE_II_DEPTHS,
  assessDive,
  lineStops,
  majorationCell,
  resultLine,
  type Mn90Dive,
  type Mn90Result,
  type Mn90Successive,
} from '../engine/mn90';
import { gasLabel } from '../engine/buhlmann';
import { lang } from '../i18n';
import { $, mn90, session } from './state';


const L = {
  title: { fr: 'Tables MN90', en: 'MN90 tables' },
  sub: { fr: 'Tables fédérales FFESSM (MN90 de la Marine nationale) · air · niveau de la mer', en: 'FFESSM tables (French Navy MN90) · air · sea level' },
  pCover: { fr: 'La plongée', en: 'The dive' },
  pT1: { fr: 'Tableau I', en: 'Table I' },
  pT2: { fr: 'Tableau II', en: 'Table II' },
  pStops: { fr: 'Paliers', en: 'Stops' },
  pNextT1: { fr: 'Replonger : tableau I', en: 'Next dive: table I' },
  pNextT2: { fr: 'Replonger : tableau II', en: 'Next dive: table II' },
  t1Title: { fr: 'Tableau I : évolution de l’azote résiduel entre deux plongées', en: 'Table I: residual nitrogen between two dives' },
  t2Title: { fr: 'Tableau II : détermination de la majoration en minutes', en: 'Table II: penalty time in minutes' },
  stopsTitle: { fr: 'Tables de plongée à l’air : paliers, DTR et GPS', en: 'Air diving tables: stops, DTR and group' },
  coverTitle: { fr: 'La démarche, table par table', en: 'The method, table by table' },
  coverHint: { fr: 'Tournez les pages (◀ ▶, ou les flèches du clavier) : chaque table utilisée, avec la ligne, la colonne et la valeur lue.', en: 'Turn the pages (◀ ▶, or the arrow keys): each table used, with the row, the column and the value read.' },
  lower: { fr: 'valeur immédiatement inférieure', en: 'next value down' },
  upper: { fr: 'valeur immédiatement supérieure', en: 'next value up' },
  howRowGps: { fr: 'Ligne : le GPS de la plongée précédente, <b>{g}</b>.', en: 'Row: the previous dive’s group, <b>{g}</b>.' },
  howColInterval: { fr: 'Colonne : l’intervalle de surface, {i}{pick}.', en: 'Column: the surface interval, {i}{pick}.' },
  howCellN: { fr: 'À l’intersection : l’azote résiduel, <b>{n}</b>, qu’on emporte au tableau II.', en: 'Where they cross: the residual nitrogen, <b>{n}</b>, taken to table II.' },
  howCellBlank: { fr: 'À l’intersection : case vide. Plus d’azote résiduel à compter, donc pas de majoration (lecture du simulateur, le livret ne le précise pas).', en: 'Where they cross: a blank cell. No residual nitrogen left to count, so no penalty time (the simulator’s reading, the booklet does not say).' },
  howRowN: { fr: 'Ligne : l’azote résiduel {n}{pick}.', en: 'Row: the residual nitrogen {n}{pick}.' },
  howColDepth: { fr: 'Colonne : la profondeur de la 2ᵉ plongée, {p}{pick}.', en: 'Column: the depth of the 2nd dive, {p}{pick}.' },
  howColAny: { fr: 'Colonne : la profondeur prévue pour la prochaine plongée (toute la ligne est utile).', en: 'Column: the depth planned for the next dive (the whole row matters).' },
  howCellMaj: { fr: 'À l’intersection : la majoration, <b>{m} min</b>, qui s’ajoute à la durée de la plongée.', en: 'Where they cross: the penalty time, <b>{m} min</b>, added to the dive time.' },
  howDepthBlock: { fr: 'Table : la profondeur maximale {p}{pick}, table des <b>{t} m</b>.', en: 'Table: the maximum depth {p}{pick}, the <b>{t} m</b> table.' },
  howRowTime: { fr: 'Ligne : la durée {d}{pick}, ligne <b>{l}</b>.', en: 'Row: the time {d}{pick}, line <b>{l}</b>.' },
  howResult: { fr: 'Sur la ligne : paliers <b>{s}</b>, DTR <b>{dtr} min</b>, GPS <b>{g}</b>.', en: 'On the line: stops <b>{s}</b>, DTR <b>{dtr} min</b>, group <b>{g}</b>.' },
  howNoLine: { fr: 'Pas de ligne pour cette durée : hors table.', en: 'No line for that time: out of the tables.' },
  lgRow: { fr: 'ligne', en: 'row' },
  lgCol: { fr: 'colonne', en: 'column' },
  lgTable: { fr: 'table', en: 'table' },
  lgVal: { fr: 'valeur lue', en: 'value read' },
  prev: { fr: 'Page précédente', en: 'Previous page' },
  next: { fr: 'Page suivante', en: 'Next page' },
  none: { fr: 'Aucune plongée pour l’instant : la prochaine sera une plongée isolée.', en: 'No dive yet: the next one will be a single dive.' },
  nowDive: { fr: 'Plongée en cours : si vous quittiez le fond maintenant', en: 'Dive in progress: if you left the bottom now' },
  nowStop: { fr: 'Au premier palier : la durée de plongée est arrêtée', en: 'At the first stop: the dive time is stopped' },
  nowSurf: { fr: 'En surface pendant la plongée : une nouvelle immersion serait consécutive', en: 'At the surface during the dive: going down again would be a consecutive dive' },
  lastDive: { fr: 'Dernière plongée', en: 'Last dive' },
  nextDive: { fr: 'Si vous replongiez maintenant', en: 'If you dived again now' },
  single: { fr: 'Plongée isolée', en: 'Single dive' },
  successive: { fr: 'Plongée successive', en: 'Repetitive dive' },
  consecutive: { fr: 'Plongée consécutive', en: 'Consecutive dive' },
  immersions: { fr: '{n} immersions à moins de 15 min d’intervalle : durées additionnées, profondeur la plus grande', en: '{n} immersions less than 15 min apart: times added, deepest depth' },
  interval: { fr: 'intervalle', en: 'interval' },
  prevGps: { fr: 'GPS de la plongée précédente', en: 'previous dive’s group' },
  t1Step: { fr: 'Tableau I : GPS {g}, intervalle {i} → colonne {c} → azote résiduel {n}', en: 'Table I: group {g}, interval {i} → column {c} → residual nitrogen {n}' },
  t1Blank: { fr: 'Tableau I : GPS {g}, intervalle {i} → colonne {c} → case vide : plus d’azote résiduel à compter, pas de majoration', en: 'Table I: group {g}, interval {i} → column {c} → blank cell: no residual nitrogen left to count, no penalty time' },
  t2Step: { fr: 'Tableau II : azote {n} → ligne {r}, profondeur {d} → colonne {c} → majoration {m}', en: 'Table II: nitrogen {n} → row {r}, depth {d} → column {c} → penalty time {m}' },
  depthStep: { fr: 'Profondeur maximale {p}{pe} → table des {t}', en: 'Maximum depth {p}{pe} → {t} table' },
  depthNitrox: { fr: '{gas} : profondeur équivalente PE = (P + 10) × {x} / 0,79 − 10 = {pe}', en: '{gas}: equivalent depth PE = (P + 10) × {x} / 0.79 − 10 = {pe}' },
  timeStep: { fr: 'Durée de plongée {real}{maj} → ligne {line}', en: 'Dive time {real}{maj} → line {line}' },
  timeMaj: { fr: ' + majoration {m} = {tot}', en: ' + penalty {m} = {tot}' },
  timeOut: { fr: 'Durée de plongée {real}{maj} → au-delà de la table', en: 'Dive time {real}{maj} → beyond the table' },
  nextLine: { fr: 'ligne suivante dans {t}', en: 'next line in {t}' },
  noStop: { fr: 'Aucun palier', en: 'No stop' },
  stops: { fr: 'Paliers', en: 'Stops' },
  dtr: { fr: 'DTR', en: 'DTR' },
  dtrHelp: { fr: 'durée totale de remontée', en: 'total ascent time' },
  gps: { fr: 'GPS', en: 'Group' },
  gpsHelp: { fr: 'groupe de plongée successive', en: 'repetitive dive group' },
  outOfTable: { fr: 'Hors table', en: 'Out of the tables' },
  nextConsec: { fr: 'Intervalle {i} (moins de 15 min) : plongée consécutive. Durée = {t} déjà comptées + la nouvelle immersion ; profondeur = la plus grande des deux ({p} pour l’instant).', en: 'Interval {i} (under 15 min): consecutive dive. Time = the {t} already counted + the new immersion; depth = the deeper of both ({p} so far).' },
  nextSingle: { fr: 'Intervalle {i} (plus de 12 h) : la prochaine plongée sera une plongée isolée.', en: 'Interval {i} (over 12 h): the next dive will be a single dive.' },
  nextSucc: { fr: 'Intervalle {i} : plongée successive.', en: 'Interval {i}: repetitive dive.' },
  majRow: { fr: 'Majoration selon la profondeur de la 2ᵉ plongée (min) :', en: 'Penalty time by depth of the 2nd dive (min):' },
  majNote: { fr: 'La majoration se calcule avant de replonger, avec la profondeur prévue, et se conserve même si la profondeur réelle diffère. Ici elle suit la profondeur maximale atteinte.', en: 'The penalty time is worked out before diving again, with the planned depth, and kept even if the actual depth differs. Here it follows the deepest point reached.' },
  issue_deep: { fr: 'Profondeur au-delà des tables (ou de la colonne 60 m du tableau II).', en: 'Depth beyond the tables (or the 60 m column of Table II).' },
  issue_time: { fr: 'Durée au-delà de la dernière ligne de la table : hors table.', en: 'Time beyond the table’s last line: out of the tables.' },
  issue_emergencyTable: { fr: 'Au-delà de 60 m : tables de secours (dépassement accidentel), aucune nouvelle plongée pendant 12 heures.', en: 'Beyond 60 m: emergency tables (accidental overrun), no new dive for 12 hours.' },
  issue_noGps: { fr: 'La plongée précédente n’a pas de GPS (*) : plongée successive interdite.', en: 'The previous dive has no group (*): no repetitive dive allowed.' },
  issue_prevOut: { fr: 'La plongée précédente était hors table : pas de GPS, plongée successive non calculable.', en: 'The previous dive was out of the tables: no group, the repetitive dive cannot be worked out.' },
  issue_twoPer24h: { fr: 'Deux plongées au maximum par 24 heures.', en: 'Two dives at most in 24 hours.' },
  issue_trimix: { fr: 'Mélange à l’hélium : les tables MN90 ne s’appliquent pas.', en: 'Helium mix: the MN90 tables do not apply.' },
  issue_maxN: { fr: 'Azote résiduel au-delà du tableau II.', en: 'Residual nitrogen beyond Table II.' },
  rapid: { fr: 'Remontée à {v} vers le premier palier (plus de 17 m/min) : remontée rapide, procédure de réimmersion à mi-profondeur (non simulée).', en: 'Ascent at {v} to the first stop (over 17 m/min): rapid ascent, re-immersion procedure at half depth (not simulated).' },
  decoGas: { fr: 'Gaz de déco non pris en compte : la règle des paliers à l’oxygène pur (2/3 de la durée, au moins 5 min) n’est pas appliquée.', en: 'Deco gases are not taken into account: the pure-oxygen stop rule (2/3 of the time, at least 5 min) is not applied.' },
  howTime: { fr: 'Durée de plongée : de la sortie de surface au départ du fond, à 15–17 m/min. Plus lente, la remontée jusqu’au premier palier s’ajoute à la durée (« remontée lente ») : le simulateur arrête donc la durée à l’arrivée au premier palier (en surface sans palier). Toute minute entamée compte ; durée et profondeur hors table : valeur immédiatement supérieure.', en: 'Dive time: from leaving the surface to leaving the bottom, at 15–17 m/min. A slower ascent adds its time up to the first stop (“slow ascent”): the simulator therefore stops the time on reaching the first stop (the surface without stops). Any minute started counts; time and depth not in the table: next value up.' },
  source: { fr: 'Source : « Tables de plongée FFESSM établies à partir des tables MN 90 de la Marine Nationale », mode d’emploi J.-L. Blanchard et F. Imbert, juillet 2005. Profondeurs toujours en mètres. Usage pédagogique uniquement.', en: 'Source: “Tables de plongée FFESSM établies à partir des tables MN 90 de la Marine Nationale”, instructions by J.-L. Blanchard and F. Imbert, July 2005. Depths always in metres. For teaching only.' },
  duration: { fr: 'Durée', en: 'Time' },
  depth: { fr: 'Prof.', en: 'Depth' },
  t1Head: { fr: 'GPS \\ intervalle', en: 'Group \\ interval' },
  t2Head: { fr: 'Azote \\ prof.', en: 'N₂ \\ depth' },
  t1Note: { fr: 'Évolution de l’azote résiduel entre deux plongées. Intervalle absent du tableau : valeur immédiatement inférieure. Une case vide : plus d’azote résiduel à compter (lecture du simulateur, le livret ne le précise pas).', en: 'Residual nitrogen between two dives. Interval not in the table: next value down. A blank cell: no residual nitrogen left to count (the simulator’s reading, the booklet does not say).' },
  t2Note: { fr: 'Détermination de la majoration (min). Azote résiduel absent : valeur immédiatement supérieure ; profondeur absente : profondeur immédiatement supérieure (moins de 12 m : colonne 12 m).', en: 'Penalty time (min). Nitrogen not in the table: next value up; depth not in the table: next depth deeper (under 12 m: the 12 m column).' },
} satisfies Record<string, { fr: string; en: string }>;

function tr(k: keyof typeof L, vars: Record<string, string | number> = {}): string {
  return L[k][lang()].replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? ''));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (v: number, d = 2) => (lang() === 'fr' ? v.toFixed(d).replace('.', ',') : v.toFixed(d));
const m = (d: number) => `${num(d, 1)} m`;
/** Durations as in the booklet: "45 min", "1 h 05". */
function dur(min: number): string {
  if (min <= 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
/** Long intervals: "2 h 04", "7 min". */
function span(min: number): string {
  const v = Math.floor(min);
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)} h ${String(v % 60).padStart(2, '0')}`;
}
function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Big result: stops, DTR, GPS of the line. */
function resultCard(r: Mn90Result): string {
  const line = resultLine(r);
  if (!line) return `<div class="mn-res out"><b>${tr('outOfTable')}</b></div>`;
  const stops = lineStops(line);
  return `<div class="mn-res">
    <div><span>${tr('stops')}</span><b>${stops.length ? stops.map(([d, t]) => `${d} m${lang() === 'fr' ? ' :' : ':'} ${t} min`).join(' · ') : tr('noStop')}</b></div>
    <div title="${tr('dtrHelp')}"><span>${tr('dtr')}</span><b>${line[2]} min</b></div>
    <div title="${tr('gpsHelp')}"><span>${tr('gps')}</span><b class="mn-gps">${line[1]}</b></div>
  </div>`;
}

/** Tableau I step of a repetitive dive. */
function t1Step(s: Mn90Successive): string {
  if (!s.gps || s.gps === '*' || s.column === null) return '';
  const vars = { g: s.gps, i: span(s.interval), c: span(TABLE_I_INTERVALS[s.column]), n: s.n === null ? '' : num(s.n) };
  return `<li>${tr(s.n === null ? 't1Blank' : 't1Step', vars)}</li>`;
}

/** The steps that place a dive in the tables. */
function steps(d: Mn90Dive, r: Mn90Result, live: boolean): string {
  const items: string[] = [];
  const kind = d.immersions > 1 ? 'consecutive' : d.successive ? 'successive' : 'single';
  let head = `<b>${tr(kind)}</b>`;
  if (d.successive) head += ` · ${tr('interval')} ${span(d.successive.interval)} · ${tr('prevGps')} ${d.successive.gps ?? '—'}`;
  items.push(`<li>${head}${d.immersions > 1 ? `<br><span class="muted">${tr('immersions', { n: d.immersions })}</span>` : ''}</li>`);
  if (d.successive) items.push(t1Step(d.successive));
  if (r.majoration && d.successive?.n != null) {
    const { row, col, minutes } = r.majoration;
    items.push(`<li>${tr('t2Step', { n: num(d.successive.n), r: num(TABLE_II[row][0]), d: m(d.eqDepth), c: `${TABLE_II_DEPTHS[col]} m`, m: `${minutes} min` })}</li>`);
  }
  if (d.nitrox) items.push(`<li>${tr('depthNitrox', { gas: gasLabel(d.gas), x: num(1 - d.gas.o2), pe: m(d.eqDepth) })}</li>`);
  items.push(`<li>${tr('depthStep', { p: m(d.maxDepth), pe: d.nitrox ? ` (PE ${m(d.eqDepth)})` : '', t: r.depth === null ? '—' : `${r.depth} m` })}</li>`);
  const line = resultLine(r);
  const maj = r.majoration ? tr('timeMaj', { m: `${r.majoration.minutes} min`, tot: `${r.minutes} min` }) : '';
  let time = tr(line ? 'timeStep' : 'timeOut', { real: `${r.realMinutes} min`, maj, line: line ? dur(line[0]) : '' });
  // While the time counts, when it moves on to the next line.
  if (live && line && d.frozenAt === null) {
    const left = (line[0] - (r.minutes - r.realMinutes)) * 60 - d.seconds;
    if (left > 0) time += ` <span class="muted">(${tr('nextLine', { t: mmss(left) })})</span>`;
  }
  items.push(`<li>${time}</li>`);
  return `<ol class="mn-steps">${items.filter(Boolean).join('')}</ol>`;
}

function issues(d: Mn90Dive, r: Mn90Result): string {
  const list = r.issues.map((i) => tr(`issue_${i}` as keyof typeof L));
  if (d.rapid) list.push(tr('rapid', { v: `${Math.round(d.rapid)} m/min` }));
  if (session.decoGases.length) list.push(tr('decoGas'));
  return list.length ? `<ul class="mn-issues">${list.map((x) => `<li>⚠ ${esc(x)}</li>`).join('')}</ul>` : '';
}

/** At the surface: what the last dive leaves for the next one. */
function nextDive(d: Mn90Dive): string {
  const now = session.clock;
  const { kind, interval } = mn90.kindAt(now);
  const i = span(interval ?? 0);
  let body = '';
  const warn: string[] = [];
  const r = assessDive(d);
  if (kind === 'consecutive') body = `<p>${tr('nextConsec', { i, t: `${r.realMinutes} min`, p: m(d.maxDepth) })}</p>`;
  else if (kind === 'single') body = `<p>${tr('nextSingle', { i })}</p>`;
  else {
    const s = mn90.successiveAt(now)!;
    body = `<p>${tr('nextSucc', { i })}</p><ol class="mn-steps">${t1Step(s)}</ol>`;
    if (s.gps === null) warn.push(tr('issue_prevOut'));
    else if (s.gps === '*') warn.push(tr('issue_noGps'));
    else if (s.n !== null) {
      const row = TABLE_II.findIndex(([v]) => v >= s.n! - 1e-9);
      if (row >= 0) {
        body += `<p class="small">${tr('majRow')}</p><div class="mn-scroll"><table class="mn-t mn-mini"><tr>${TABLE_II_DEPTHS.map((x) => `<th>${x} m</th>`).join('')}</tr>
          <tr>${TABLE_II[row][1].map((v) => `<td>${v}</td>`).join('')}</tr></table></div><p class="muted small">${tr('majNote')}</p>`;
      }
    }
    if (r.depth !== null && r.depth > MN90_MAX_DEPTH) warn.push(tr('issue_emergencyTable'));
  }
  if (kind !== 'consecutive' && (interval ?? Infinity) < 24 * 60 && mn90.dives.filter((x) => now - x.start < 24 * 3600).length >= 2) warn.push(tr('issue_twoPer24h'));
  return `<section class="mn-card"><h3>${tr('nextDive')}</h3>${body}${warn.length ? `<ul class="mn-issues">${warn.map((x) => `<li>⚠ ${esc(x)}</li>`).join('')}</ul>` : ''}</section>`;
}

/** "{x}" when the table has that value, "{x} → {chosen} (next value up/down)" otherwise. */
function pick(exact: boolean, chosen: string, dir: 'lower' | 'upper'): string {
  return exact ? '' : ` → ${chosen} (${tr(dir)})`;
}

/** What a table page highlights: the row and column entered, where they cross (the value read). */
interface GridHit {
  row?: number;
  col?: number;
}
const cls = (row: boolean, col: boolean) => (row && col ? 'cell' : row ? 'row' : col ? 'col' : '');

function tableI(hit: GridHit): string {
  const head = `<tr><th>${tr('t1Head')}</th>${TABLE_I_INTERVALS.map((v, c) => `<th class="${cls(false, hit.col === c)}">${span(v).replace(' 00', '')}</th>`).join('')}</tr>`;
  const rows = GROUPS.map((g, r) => `<tr><th class="${cls(hit.row === r, false)}">${g}</th>${TABLE_I_INTERVALS.map((_, c) => {
    const v = TABLE_I[g][c];
    return `<td class="${cls(hit.row === r, hit.col === c)}">${v === undefined ? '' : num(v)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="mn-scroll"><table class="mn-t mn-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="muted small">${tr('t1Note')}</p>`;
}

function tableII(hit: GridHit): string {
  const head = `<tr><th>${tr('t2Head')}</th>${TABLE_II_DEPTHS.map((d, c) => `<th class="${cls(false, hit.col === c)}">${d} m</th>`).join('')}</tr>`;
  const rows = TABLE_II.map(([n, vals], r) => `<tr><th class="${cls(hit.row === r, false)}">${num(n)}</th>${vals.map((v, c) => `<td class="${cls(hit.row === r, hit.col === c)}">${v}</td>`).join('')}</tr>`).join('');
  return `<div class="mn-scroll"><table class="mn-t mn-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div><p class="muted small">${tr('t2Note')}</p>`;
}

/** One depth's table as in the booklet (Prof. | Durée | stops | DTR | GPS), with a thumb index of
 *  the depths: the table chosen, the line chosen, the results read on it. */
function stopsTable(depth: number, hit: number | null): string {
  const lines = MN90[depth];
  const deepest = Math.max(1, ...lines.map((l) => l.length - 3));
  const cols = Array.from({ length: deepest }, (_, i) => (deepest - i) * 3);
  const index = `<div class="mn-thumbs" aria-hidden="true">${MN90_DEPTHS.map((x) => `<span class="${x === depth ? 'col' : ''} ${x > MN90_MAX_DEPTH ? 'sos' : ''}">${x}</span>`).join('')}</div>`;
  const head = `<tr><th class="col">${tr('depth')}</th><th>${tr('duration')}</th>${cols.map((c) => `<th>${c} m</th>`).join('')}<th title="${tr('dtrHelp')}">${tr('dtr')}</th><th title="${tr('gpsHelp')}">${tr('gps')}</th></tr>`;
  const rows = lines.map((l, i) => {
    const stops = l.slice(3) as number[];
    const on = i === hit;
    const out = on ? 'cell' : '';
    return `<tr class="${on ? 'hit' : ''}">${i === 0 ? `<th class="col mn-pdepth" rowspan="${lines.length}">${depth} m</th>` : ''}<td class="${on ? 'row' : ''}">${dur(l[0])}</td>${cols.map((c) => `<td class="${stops[c / 3 - 1] ? out : on ? 'row' : ''}">${stops[c / 3 - 1] || ''}</td>`).join('')}<td class="${out}">${l[2]}</td><td class="mn-gps ${out}">${l[1]}</td></tr>`;
  }).join('');
  return `${index}<div class="mn-scroll mn-tall"><table class="mn-t mn-stops"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

interface Page {
  tab: string;
  title: string;
  how: string[];
  legend: 'grid' | 'stops' | null;
  body: string;
}

const li = (items: string[]) => `<ol class="mn-how-read">${items.map((x) => `<li>${x}</li>`).join('')}</ol>`;

/** Tableau I page: GPS row, interval column, residual nitrogen. */
function t1Page(s: Mn90Successive, tab: string): Page | null {
  if (!s.gps || s.gps === '*' || s.column === null) return null;
  const c = TABLE_I_INTERVALS[s.column];
  const how = [
    tr('howRowGps', { g: s.gps }),
    tr('howColInterval', { i: span(s.interval), pick: pick(Math.floor(s.interval) === c, span(c), 'lower') }),
    s.n === null ? tr('howCellBlank') : tr('howCellN', { n: num(s.n) }),
  ];
  return { tab, title: tr('t1Title'), how, legend: 'grid', body: tableI({ row: GROUPS.indexOf(s.gps), col: s.column }) };
}

/** Tableau II page: nitrogen row, depth column (unknown before the dive), penalty time. */
function t2Page(n: number, depth: number | null, tab: string): Page | null {
  const row = TABLE_II.findIndex(([v]) => v >= n - 1e-9);
  if (row < 0) return null;
  const how = [tr('howRowN', { n: num(n), pick: pick(Math.abs(TABLE_II[row][0] - n) < 1e-9, num(TABLE_II[row][0]), 'upper') })];
  let col: number | undefined;
  if (depth === null) how.push(tr('howColAny'));
  else {
    const cell = majorationCell(n, depth);
    if (cell) {
      col = cell.col;
      const cd = TABLE_II_DEPTHS[col];
      how.push(tr('howColDepth', { p: m(depth), pick: pick(Math.abs(cd - depth) < 0.05, `${cd} m`, 'upper') }));
      how.push(tr('howCellMaj', { m: cell.minutes }));
    } else how.push(tr('issue_deep'));
  }
  return { tab, title: tr('t2Title'), how, legend: 'grid', body: tableII({ row, col }) };
}

/** Stop table page: depth table, time line, results. */
function stopsPage(d: Mn90Dive, r: Mn90Result): Page | null {
  if (r.depth === null) return null;
  const line = resultLine(r);
  const shownDepth = d.nitrox ? d.eqDepth : d.maxDepth;
  const how = [
    tr('howDepthBlock', { p: m(shownDepth) + (d.nitrox ? ' (PE)' : ''), pick: '', t: r.depth }),
    line
      ? tr('howRowTime', { d: r.majoration ? `${r.realMinutes} + ${r.majoration.minutes} = ${r.minutes} min` : `${r.minutes} min`, pick: line[0] === r.minutes ? '' : ` (${tr('upper')})`, l: dur(line[0]) })
      : tr('howNoLine'),
  ];
  if (line) {
    const stops = lineStops(line);
    how.push(tr('howResult', { s: stops.length ? stops.map(([x, t]) => `${x} m ${t} min`).join(', ') : tr('noStop').toLowerCase(), dtr: line[2], g: line[1] }));
  }
  return { tab: tr('pStops'), title: tr('stopsTitle'), how, legend: 'stops', body: stopsTable(r.depth, r.line) };
}

/** The pages of the book: the dive, then each table used, in the order they are read; at the
 *  surface, the tables to read before diving again. */
function pages(): Page[] {
  const d = mn90.last;
  const cover = (html: string): Page => ({ tab: tr('pCover'), title: tr('coverTitle'), how: [], legend: null, body: `<p class="muted small">${tr('coverHint')}</p>${html}` });
  if (!d) return [cover(`<section class="mn-card"><p>${tr('none')}</p></section>`)];
  const inDive = d.end === null;
  const r = inDive ? mn90.current()! : assessDive(d);
  const title = !inDive ? tr('lastDive') : d.frozenAt === null ? tr('nowDive') : d.frozenAt > 0 ? tr('nowStop') : tr('nowSurf');
  let html = `<section class="mn-card ${inDive ? 'live' : ''}"><h3>${title}</h3>${steps(d, r, inDive)}${resultCard(r)}${issues(d, r)}</section>`;
  if (!inDive) html += nextDive(d);
  const list: (Page | null)[] = [cover(html)];
  const s = d.successive;
  if (s) {
    list.push(t1Page(s, tr('pT1')));
    if (s.n !== null) list.push(t2Page(s.n, d.eqDepth, tr('pT2')));
  }
  list.push(stopsPage(d, r));
  if (!inDive) {
    const next = mn90.successiveAt(session.clock);
    if (next) {
      list.push(t1Page(next, tr('pNextT1')));
      if (next.n !== null) list.push(t2Page(next.n, null, tr('pNextT2')));
    }
  }
  return list.filter((p): p is Page => p !== null);
}

const written = new WeakMap<Element, string>();
function setHtml(el: Element, html: string): void {
  if (written.get(el) === html) return;
  written.set(el, html);
  el.innerHTML = html;
}

const book = { page: 0, turn: '' as '' | 'next' | 'prev', scrolled: '' };

function legend(kind: Page['legend']): string {
  if (!kind) return '';
  const first = kind === 'stops' ? tr('lgTable') : tr('lgCol');
  return `<div class="mn-legend"><span class="lg-row">${tr('lgRow')}</span><span class="lg-col">${first}</span><span class="lg-cell">${tr('lgVal')}</span></div>`;
}

/** Redraws the dialog (only what changed). Called by refresh() while it is open. */
export function renderMn90(): void {
  const dlg = $<HTMLDialogElement>('mn90');
  if (!dlg.open) return;
  const list = pages();
  book.page = Math.min(book.page, list.length - 1);
  const p = list[book.page];
  setHtml($('mn90-index'), list.map((x, i) => `<button data-mn-page="${i}" class="${i === book.page ? 'on' : ''}"><i>${i + 1}</i> ${esc(x.tab)}</button>`).join(''));
  setHtml($('mn90-page'), `<h3 class="mn-ptitle">${esc(p.title)}</h3>${p.how.length ? li(p.how) : ''}${legend(p.legend)}${p.body}`);
  setHtml($('mn90-nav'), `<button class="btn" data-mn-go="-1" ${book.page === 0 ? 'disabled' : ''}>◀ ${tr('prev')}</button>
    <span class="muted small">${book.page + 1} / ${list.length}</span>
    <button class="btn primary" data-mn-go="1" ${book.page === list.length - 1 ? 'disabled' : ''}>${tr('next')} ▶</button>`);
  const sheet = $('mn90-page');
  if (book.turn) {
    sheet.classList.remove('turn-next', 'turn-prev');
    void sheet.offsetWidth; // restarts the animation
    sheet.classList.add(`turn-${book.turn}`);
    book.turn = '';
  }
  // Bring the value read into view when it moves (new page, new line).
  const target = sheet.querySelector<HTMLElement>('td.cell, tr.hit td, th.cell') ?? sheet.querySelector<HTMLElement>('td.row, th.row');
  const key = `${book.page}:${target ? [...sheet.querySelectorAll('td, th')].indexOf(target) : -1}`;
  if (target && key !== book.scrolled) {
    book.scrolled = key;
    target.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}

function go(page: number): void {
  const n = pages().length;
  const to = Math.max(0, Math.min(n - 1, page));
  if (to === book.page) return;
  book.turn = to > book.page ? 'next' : 'prev';
  book.page = to;
  renderMn90();
}

export function openMn90(): void {
  const dlg = $<HTMLDialogElement>('mn90');
  dlg.innerHTML = `
    <header class="mn-head">
      <div><h2 id="mn90-title">${tr('title')}</h2><p class="muted small">${tr('sub')}</p></div>
      <form method="dialog"><button class="mn-x" aria-label="✕">✕</button></form>
    </header>
    <nav class="mn-index" id="mn90-index"></nav>
    <div class="mn-book"><article class="mn-page" id="mn90-page"></article></div>
    <div class="mn-nav" id="mn90-nav"></div>
    <details class="mn-how"><summary>${lang() === 'fr' ? 'Règles appliquées' : 'Rules applied'}</summary><p>${tr('howTime')}</p><p>${tr('source')}</p></details>`;
  book.page = 0;
  book.scrolled = '';
  dlg.showModal();
  renderMn90();
}

export function setupMn90(): void {
  const dlg = $<HTMLDialogElement>('mn90');
  $('mn90-open').addEventListener('click', openMn90);
  dlg.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) return dlg.close();
    const el = e.target as HTMLElement;
    const page = el.closest<HTMLElement>('[data-mn-page]');
    if (page) go(Number(page.dataset.mnPage));
    const step = el.closest<HTMLButtonElement>('[data-mn-go]');
    if (step && !step.disabled) go(book.page + Number(step.dataset.mnGo));
  });
  // Arrow keys turn the pages (and must not steer the diver meanwhile).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    go(book.page + (e.key === 'ArrowRight' ? 1 : -1));
  });
}

// Compare tab: every computer's reading of the same dive; a click on a row shows that computer.
import type { ComputerView, DiveComputer } from '../computers/base';
import { MN90, lineStops, resultLine } from '../engine/mn90';
import { t } from '../i18n';
import { openMn90 } from './mn90';
import { savePrefs } from './prefs';
import { refresh } from './render';
import { renderControls } from './settings';
import { $, app, computers, mn90 } from './state';

export function renderCompare(views: (readonly [DiveComputer, ComputerView])[]): void {
  const note = $('compare-note');
  if (note.dataset.lang !== t('compareNote')) {
    note.innerHTML = t('compareNote');
    note.dataset.lang = t('compareNote');
  }
  const head = `<thead><tr><th>${t('computer')}</th><th>${t('algorithm')}</th><th>GF</th><th>${t('ndl')}</th><th>${t('stop')}</th><th>${t('tts')}</th><th>${t('gasTime')}</th></tr></thead>`;
  const rows = views
    .map(([c, cv]) => {
      const s = c.summary(cv);
      // ≈ models: the NDL is fitted to the published tables, but their deco stops and TTS would only be
      // extrapolated — shown on hover, flagged as unverified, never as a figure in the table.
      const guess = !c.exact && cv.inDeco && !cv.locked;
      const tip = guess ? ` title="${t('extrapolated')} — ${s.stop} · ${t('tts')} ${s.tts}"` : '';
      const stop = guess ? `<span class="extrapolated">${t('stopRequired')}</span>` : s.stop;
      const tts = guess ? '<span class="muted">—</span>' : s.tts;
      return `<tr data-id="${c.id}" class="${c === app.active ? 'active' : ''}">
        <td>${c.name}</td>
        <td><span class="badge small ${c.exact ? 'exact' : 'approx'}">${c.exact ? '✓' : '≈'}</span> ${c.algorithm}</td>
        <td class="num">${c.exact ? `${cv.gfLow}/${cv.gfHigh}` : `≈${cv.gfLow}/${cv.gfHigh}`}</td>
        <td class="num">${s.ndl}</td><td class="num ${cv.inDeco ? 'deco' : ''}"${tip}>${stop}</td><td class="num"${tip}>${tts}</td>
        <td class="num">${cv.tank.gasTime !== null ? `${cv.tank.gasTime} <span class="muted">${c.gasTimeName}</span>` : '—'}</td></tr>`;
    })
    .join('');
  $('compare-table').innerHTML = head + `<tbody>${rows}${mn90Row()}</tbody>`;
}

/** The MN90 tables' reading of the same dive, if the diver left the bottom now (app/mn90.ts). Depths
 *  in metres, as in the tables. */
function mn90Row(): string {
  const d = mn90.last;
  const r = d && d.end === null ? mn90.current() : null;
  const line = r ? resultLine(r) : null;
  let ndl = '—';
  let stop = '—';
  let dtr = '—';
  let gps = '';
  if (r && !line) stop = t('mn90Out');
  if (r && line) {
    const stops = lineStops(line);
    dtr = String(line[2]);
    gps = ` <span class="muted">· GPS ${line[1]}</span>`;
    if (stops.length) stop = `${stops[0][0]} m · ${stops[0][1]}'`;
    else {
      // No-stop time: the last line without a stop at that depth, minus the time already counted.
      const lines = MN90[r.depth!];
      const k = lines.findIndex((l) => l.length > 3);
      const left = (k < 0 ? lines[lines.length - 1][0] : lines[k - 1][0]) - r.minutes;
      ndl = left > 99 ? '>99' : String(Math.max(0, left));
    }
  }
  return `<tr class="mn90-row" data-mn90 title="${t('mn90Row')}">
    <td>${t('mn90Name')}${gps}</td>
    <td><span class="badge small exact">✓</span> ${t('mn90Algo')}</td>
    <td class="num">—</td><td class="num">${ndl}</td><td class="num ${line && line.length > 3 ? 'deco' : ''}">${stop}</td>
    <td class="num">${dtr}</td><td class="num">—</td></tr>`;
}

export function setupCompare(): void {
  $('compare-table').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-mn90]')) return openMn90();
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!row) return;
    app.active = computers.find((c) => c.id === row.dataset.id) ?? app.active;
    savePrefs();
    renderControls();
    refresh(true);
  });
}

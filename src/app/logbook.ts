// Logbook tab: the closed dives, saved in the browser (app/diveStore.ts), most recent first; a click on
// a row draws its profile, its recap button opens its recap (app/recap.ts), its replay button replays it (app/replay.ts). Export / import with the configuration
// (app/backup.ts), clear.
import { hmm } from '../computers/base';
import { gasLabel } from '../engine/buhlmann';
import { isI18nKey, lang, t, type I18nKey } from '../i18n';
import { icon } from '../ui/icons';
import { depthLabel, pressText, pressUnit, tempUnit, tempVal } from '../units';
import { allRecords, clearRecords, persistent } from './diveStore';
import { savePrefs } from './prefs';
import { openRecap } from './recap';
import { refresh } from './render';
import { startReplay } from './replay';
import { $, app } from './state';

/** Dive type from the surface interval before it (s): under 15 min consecutive, under 12 h repetitive. */
function diveType(si: number | null): I18nKey {
  if (si === null || si >= 12 * 3600) return 'diveSingle';
  return si < 15 * 60 ? 'diveConsecutive' : 'diveRepetitive';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Clear" clicked once: the button asks for confirmation for a few seconds. */
let confirmClear = 0;

export function renderLog(): void {
  const el = $('logbook');
  const list = allRecords();
  const tools = `<div class="log-tools">
      <button type="button" class="btn small" data-backup="export" title="${t('logExportHelp')}">${icon('download')}${t('logExportShort')}</button>
      <button type="button" class="btn small" data-backup="import" title="${t('logImportHelp')}">${icon('upload')}${t('logImport')}</button>
      <button type="button" class="btn small ${confirmClear ? 'danger' : ''}" data-log-act="clear" title="${t('logClear')}" ${list.length ? '' : 'disabled'}>${icon('trash')}${t(confirmClear ? 'logClearConfirm' : 'logClearShort')}</button>
      <label class="log-auto"><input type="checkbox" data-log-act="auto" ${app.recapAuto ? 'checked' : ''}> ${t('logAuto')}</label>
    </div>
    <p class="muted small">${t(persistent() ? 'logSaved' : 'logMemory')}</p>`;
  if (!list.length) {
    el.innerHTML = `${tools}<p class="muted">${t('noDives')}</p>`;
    return;
  }
  const head = `<thead><tr><th>#</th><th>${t('logDate')}</th><th>${t('logComputer')}</th><th>${t('duration')}</th><th>${t('maxDepth')}</th><th>${t('avgDepth')}</th><th>${t('gas')}</th><th>${t('minTemp')}</th><th>${t('si')}</th><th title="${t('diveTypeHelp')}">${t('diveType')}</th><th>${t('tankCol')}</th><th>CNS</th><th>${t('alarms')}</th><th></th></tr></thead>`;
  const locale = lang() === 'fr' ? 'fr-FR' : 'en-GB';
  const rows = list
    .map((r, i) => {
      const d = r.entry;
      const date = new Date(r.savedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
      const cut = d.interrupted ? `<span class="log-cut" title="${t('logInterrupted')}" aria-label="${t('logInterrupted')}">⛔</span>` : '';
      return `<tr data-log="${esc(r.id)}" class="${r.id === app.selectedDive ? 'active' : ''}${d.interrupted ? ' interrupted' : ''}">
      <td>${cut}${i + 1}</td><td class="num">${esc(date)}</td><td>${esc(r.computer.name)}</td><td class="num">${Math.round(d.duration / 60)} min</td><td class="num">${depthLabel(d.maxDepth)}</td>
      <td class="num">${depthLabel(d.avgDepth)}</td><td>${(d.gasesUsed ?? [d.gas]).map((g) => (g.o2 >= 0.995 ? 'O₂' : gasLabel(g))).join(' + ')}</td><td class="num">${tempVal(d.minTemp).toFixed(0)} ${tempUnit()}</td>
      <td class="num">${d.surfaceIntervalBefore === null ? '—' : hmm(d.surfaceIntervalBefore / 60)}</td><td>${t(diveType(d.surfaceIntervalBefore))}</td>
      <td class="num">${pressText(d.tankStart)} → ${pressText(d.tankEnd)} ${pressUnit()}</td><td class="num">${d.cnsEnd.toFixed(0)} %</td>
      <td>${d.alarms.length ? d.alarms.map((a) => esc(isI18nKey(a) ? t(a) : a)).join(', ') : t('none')}</td>
      <td class="log-acts"><button type="button" class="btn small log-recap" data-recap="${esc(r.id)}" title="${t('logRecap')}" aria-label="${t('logRecap')}">${icon('recap')}</button>${
        r.replay ? `<button type="button" class="btn small log-recap" data-log-replay="${esc(r.id)}" title="${t('rcReplay')} — ${t('rcReplayHelp')}" aria-label="${t('rcReplay')}">${icon('replay')}</button>` : ''
      }</td></tr>`;
    })
    .reverse()
    .join('');
  el.innerHTML = `${tools}<table class="compare">${head}<tbody>${rows}</tbody></table>`;
}

export function setupLogbook(): void {
  const el = $('logbook');
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const recap = target.closest<HTMLElement>('[data-recap]');
    if (recap) {
      app.selectedDive = recap.dataset.recap!;
      renderLog();
      refresh();
      openRecap(app.selectedDive);
      return;
    }
    const replay = target.closest<HTMLButtonElement>('[data-log-replay]');
    if (replay) {
      startReplay(replay.dataset.logReplay!, false); // does nothing during an exercise, the guided tour or another replay
      return;
    }
    const act = target.closest<HTMLElement>('[data-log-act]')?.dataset.logAct;
    if (act === 'clear') {
      if (confirmClear) {
        window.clearTimeout(confirmClear);
        confirmClear = 0;
        clearRecords();
        app.selectedDive = null;
        refresh();
      } else {
        confirmClear = window.setTimeout(() => {
          confirmClear = 0;
          renderLog();
        }, 4000);
      }
      renderLog();
      return;
    }
    if (act) return;
    const row = target.closest<HTMLElement>('[data-log]');
    if (!row) return;
    app.selectedDive = row.dataset.log!;
    renderLog();
    refresh();
  });
  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.logAct !== 'auto') return;
    app.recapAuto = input.checked;
    savePrefs();
  });
}

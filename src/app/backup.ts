// Backup file: everything the browser keeps, to carry it to another browser or computer — the logbook
// (app/diveStore.ts), the configuration (computer shown, settings of every computer, dive parameters,
// display, language, floating gauge) and the passed exercises. The diver's state (tissues, surface
// interval, simulated clock) is not saved anywhere and stays out of it. On import, a dialog lets the
// user choose what to take: dives are added (no duplicates), exercises merged, the configuration
// replaces the current one; it is applied as at every start, by reloading the page.
import { lang, setLang, t } from '../i18n';
import { fillIcons } from '../ui/icons';
import { allRecords, importDives } from './diveStore';
import { exerciseProgress, mergeExerciseProgress } from './exercises';
import { renderLog } from './logbook';
import { cleanPrefs, currentPrefs, storePrefs, type Prefs } from './prefs';
import { refresh } from './render';
import { $, computers, session } from './state';

const FILE_TAG = 'divesim-backup';
/** Files of the first version: the logbook only. */
const OLD_TAG = 'divesim-logbook';
const SPG_KEY = 'divesim.spgFloat';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

interface Config {
  prefs: Partial<Prefs>;
  lang?: 'fr' | 'en';
  spgFloat?: unknown;
}

/** What a file holds, once read and checked. */
interface Contents {
  name: string;
  exported: string | null;
  dives: unknown[];
  config: Config | null;
  exercises: Record<string, unknown> | null;
}

export function exportAll(): void {
  let spgFloat: unknown = null;
  try {
    spgFloat = JSON.parse(localStorage.getItem(SPG_KEY) ?? 'null');
  } catch {
    /* none */
  }
  const data = {
    app: FILE_TAG,
    version: 2,
    exported: new Date().toISOString(),
    dives: allRecords(),
    config: { prefs: currentPrefs(), lang: lang(), spgFloat },
    exercises: exerciseProgress(),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `divesim-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function read(file: File): Promise<Contents | null> {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(await file.text());
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || (o.app !== FILE_TAG && o.app !== OLD_TAG)) return null;
  const c = o.config as { prefs?: unknown; lang?: unknown; spgFloat?: unknown } | undefined;
  const prefs = cleanPrefs(c?.prefs);
  const ex = o.exercises;
  return {
    name: file.name,
    exported: typeof o.exported === 'string' ? o.exported : null,
    dives: Array.isArray(o.dives) ? o.dives : [],
    config: prefs ? { prefs, lang: c?.lang === 'fr' || c?.lang === 'en' ? c.lang : undefined, spgFloat: c?.spgFloat } : null,
    exercises: ex && typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).length ? (ex as Record<string, unknown>) : null,
  };
}

let pending: Contents | null = null;
/** A configuration was imported: the page must reload before anything saves the preferences again. */
let mustReload = false;

function option(key: string, label: string, detail: string): string {
  return `<label class="bk-opt"><input type="checkbox" data-bk="${key}" checked><span><b>${label}</b><br><span class="muted small">${detail}</span></span></label>`;
}

/** The import dialog: what the file holds, to choose. */
function renderChoice(c: Contents): void {
  const dlg = $<HTMLDialogElement>('backup');
  const date = c.exported ? new Date(c.exported).toLocaleString(lang() === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' }) : '—';
  const opts: string[] = [];
  if (c.dives.length) opts.push(option('dives', t('bkDives'), fill(t('bkDivesHelp'), { n: c.dives.length })));
  if (c.config) {
    const name = computers.find((x) => x.id === c.config!.prefs.computer)?.name ?? '—';
    opts.push(option('config', t('bkConfig'), fill(t('bkConfigHelp'), { c: name })));
  }
  if (c.exercises) opts.push(option('exercises', t('bkEx'), fill(t('bkExHelp'), { n: Object.keys(c.exercises).length })));
  dlg.innerHTML = `<h2>${t('bkTitle')}</h2>
    <p class="muted small">${esc(fill(t('bkFile'), { f: c.name, d: date }))}</p>
    ${opts.length ? `<div class="bk-opts">${opts.join('')}</div>` : `<p>${t('bkNothing')}</p>`}
    <p class="bk-reload" ${c.config ? '' : 'hidden'}>⚠ ${t(session.inDive ? 'bkReloadDive' : 'bkReload')}</p>
    <div class="modal-actions">
      <button type="button" class="btn" data-bk="cancel">${t('bkCancel')}</button>
      ${opts.length ? `<button type="button" class="btn primary" data-bk="go">${t('bkGo')}</button>` : ''}
    </div>`;
  if (!dlg.open) dlg.showModal();
}

function checked(key: string): boolean {
  return !!$('backup').querySelector<HTMLInputElement>(`[data-bk="${key}"]:checked`);
}

function apply(): void {
  const c = pending;
  if (!c) return;
  const lines: string[] = [];
  if (c.dives.length && checked('dives')) {
    const r = importDives(c.dives);
    lines.push(fill(t('logImported'), { a: r.added, s: r.skipped }));
    renderLog();
  }
  if (c.exercises && checked('exercises')) {
    mergeExerciseProgress(c.exercises);
    lines.push(t('bkExDone'));
  }
  const reload = !!c.config && checked('config');
  if (reload) {
    mustReload = true;
    storePrefs(c.config!.prefs);
    try {
      if (c.config!.spgFloat) localStorage.setItem('divesim.spgFloat', JSON.stringify(c.config!.spgFloat));
    } catch {
      /* storage unavailable */
    }
    lines.push(t('bkConfigDone'));
  }
  pending = null;
  if (!reload) refresh(true);
  $('backup').innerHTML = `<h2>${t('bkTitle')}</h2>
    ${lines.length ? `<ul class="bk-done">${lines.map((l) => `<li>✓ ${esc(l)}</li>`).join('')}</ul>` : `<p>${t('bkNothing')}</p>`}
    <div class="modal-actions">${reload
      ? `<button type="button" class="btn primary" data-bk="reload">${t('bkReloadNow')}</button>`
      : `<button type="button" class="btn primary" data-bk="cancel">${t('close')}</button>`}</div>`;
  // The imported language, once this result is written in the current one (it applies on reloading).
  if (reload && c.config!.lang) setLang(c.config!.lang);
}

/** Chooses a file, then the dialog. */
export function pickImport(): void {
  $<HTMLInputElement>('backup-file').click();
}

export function setupBackup(): void {
  fillIcons();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.id = 'backup-file';
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const c = await read(file);
    if (!c) {
      const dlg = $<HTMLDialogElement>('backup');
      dlg.innerHTML = `<h2>${t('bkTitle')}</h2><p>${t('logImportBad')}</p>
        <div class="modal-actions"><button type="button" class="btn primary" data-bk="cancel">${t('close')}</button></div>`;
      dlg.showModal();
      return;
    }
    pending = c;
    renderChoice(c);
  });
  const dlg = $<HTMLDialogElement>('backup');
  dlg.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) return dlg.close();
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-bk]')?.dataset.bk;
    if (act === 'cancel') dlg.close();
    else if (act === 'go') apply();
    else if (act === 'reload') location.reload();
  });
  dlg.addEventListener('change', () => {
    dlg.querySelector<HTMLElement>('.bk-reload')!.hidden = !checked('config');
    const go = dlg.querySelector<HTMLButtonElement>('[data-bk="go"]');
    if (go) go.disabled = !dlg.querySelector('.bk-opts input:checked');
  });
  dlg.addEventListener('close', () => {
    pending = null;
    if (mustReload) location.reload();
  });
  // The export / import buttons of the Settings and Logbook tabs.
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-backup]');
    if (b?.dataset.backup === 'export') exportAll();
    else if (b?.dataset.backup === 'import') pickImport();
  });
}

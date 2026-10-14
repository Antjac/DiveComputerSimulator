// Replay of a closed dive, from its recap: the dive is played again on the computers, in 2D, from the
// state before the descent and the commands given (engine/replay.ts). The diver can no longer be steered;
// the time controls of the page (pause, speed) and the bar of this module go forward, back, or to a given
// moment; any computer can be looked at. The live state is put back when the replay is left, and the
// recap opens again.
import { Replayer, captureState, restoreState, type DiveState } from '../engine/replay';
import { lang, t } from '../i18n';
import { findRecord, type DiveRecord } from './diveStore';
import { setView } from './diveControls';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { closeRecapForReplay, openRecap } from './recap';
import { profileChart, refresh } from './render';
import { renderControls } from './settings';
import { $, app, computers, session } from './state';

interface Run {
  rp: Replayer;
  rec: DiveRecord;
  /** The live state, put back when the replay is left. */
  live: DiveState;
  liveRunning: boolean;
  speed: number;
  view: '2d' | '3d';
}

let run: Run | null = null;

/** Speed at which a replay starts (× real time). */
const START_SPEED = 10;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Whether a replay may start now: not during an exercise, the guided tour or a rescue alert. */
export function canReplay(): boolean {
  return !app.replaying && !exerciseBusy() && !tourRunning() && !session.emergency;
}

/** The dive being replayed (null: none). */
export function replayRecord(): DiveRecord | null {
  return run?.rec ?? null;
}

export function startReplay(id: string): void {
  const rec = findRecord(id);
  if (!rec?.replay || !canReplay()) return;
  const liveRunning = closeRecapForReplay();
  const live = captureState(session, computers);
  const view = app.view;
  const rp = new Replayer(session, computers, rec.replay.start, rec.replay.events, rec.replay.endClock);
  run = { rp, rec, live, liveRunning, speed: app.speed, view };
  app.replaying = true;
  app.selectedDive = rec.id;
  document.body.classList.add('replaying');
  app.speed = START_SPEED;
  app.paused = false;
  if (view === '3d') void setView('2d'); // the replay is drawn in 2D only
  renderControls();
  refresh(true);
}

/** Leaves the replay: the live state comes back, and the recap of the dive opens again. */
export function stopReplay(reopen = true): void {
  if (!run) return;
  const r = run;
  run = null;
  r.rp.stop();
  restoreState(session, computers, r.live);
  app.replaying = false;
  document.body.classList.remove('replaying');
  app.speed = r.speed;
  app.paused = !r.liveRunning;
  profileChart.cursor = null;
  lockFields(false);
  if (r.view === '3d') void setView('3d');
  renderControls();
  refresh(true);
  if (reopen) openRecap(r.rec.id);
}

/** Advances the replay by `simDt` simulated seconds (from the loop). At the end it pauses; resuming starts again. */
export function tickReplay(simDt: number): void {
  if (!run) return;
  const { rp } = run;
  if (rp.atEnd) rp.seek(0);
  rp.seek(rp.pos + simDt);
  if (rp.atEnd) {
    app.paused = true;
    renderControls();
  }
}

/** Goes to replay time `pos` (s from the start of the replay). */
function goTo(pos: number): void {
  if (!run) return;
  run.rp.seek(pos);
  refresh();
}

/** Replay time of dive time `d` (s since the dive started). */
const posOfDive = (d: number): number => (run ? d + run.rec.entry.start - run.rp.startClock : 0);

/** Dive time now (s), kept within the dive. */
function diveNow(): number {
  return run ? Math.min(run.rec.entry.duration, Math.max(0, session.clock - run.rec.entry.start)) : 0;
}

function barHtml(rec: DiveRecord, rp: Replayer): string {
  const n = rec.entry.number;
  return `
    <div class="rp-head">
      <span class="rp-badge">${t('rpBadge')}</span>
      <span class="rp-title">${t('rcDiveN').replace('{n}', String(n))}</span>
      <span class="rp-gap"></span>
      <button type="button" class="btn" data-rp="exit">${t('rpExit')}</button>
    </div>
    <div class="rp-seek">
      <span class="rp-time" id="rp-time">0:00</span>
      <input type="range" id="rp-range" min="0" max="${Math.ceil(rp.duration)}" step="1" value="0" aria-label="${t('rpSeek')}">
      <span class="rp-time" id="rp-total">${mmss(rec.entry.duration)}</span>
    </div>
    <div class="rp-ctl">
      <button type="button" class="btn" data-rp="start" title="${t('rpStart')}">|◀</button>
      <button type="button" class="btn" data-rp="-60">−1&nbsp;min</button>
      <button type="button" class="btn" data-rp="-10">−10&nbsp;s</button>
      <button type="button" class="btn" data-rp="+10">+10&nbsp;s</button>
      <button type="button" class="btn" data-rp="+60">+1&nbsp;min</button>
      <button type="button" class="btn" data-rp="end" title="${t('rpEnd')}">▶|</button>
      <span class="rp-gap"></span>
      <button type="button" class="btn" data-rp="prev-alert" ${rec.alerts.length ? '' : 'disabled'} title="${t('rpPrevAlert')}">⚠ ◀</button>
      <button type="button" class="btn" data-rp="next-alert" ${rec.alerts.length ? '' : 'disabled'} title="${t('rpNextAlert')}">▶ ⚠</button>
    </div>
    <p class="rp-note">${t('rpNote')}</p>`;
}

/** What is chosen about the dive itself (the settings tab): fixed while the dive is replayed. */
const DIVE_FIELDS = ['site-select', 'gas-select', 'tank-select', 'stage-select', 'rmv-select', 'tx-select', 'rescue-select'];

function lockFields(on: boolean): void {
  for (const id of DIVE_FIELDS) $<HTMLSelectElement>(id).disabled = on;
  $('deco-gas-fields').toggleAttribute('inert', on);
}

let builtFor = '';
/** The slider is held: it is not moved by the replay meanwhile. */
let sliding = false;

/** Called on every refresh: shows the bar while a replay is on, and keeps its slider and time up to date. */
export function updateReplayBar(): void {
  const bar = $('replay-bar');
  bar.hidden = !run;
  if (!run) {
    builtFor = '';
    return;
  }
  lockFields(true);
  const key = `${run.rec.id}|${lang()}`;
  if (builtFor !== key) {
    builtFor = key;
    bar.innerHTML = barHtml(run.rec, run.rp);
  }
  const range = $<HTMLInputElement>('rp-range');
  if (!sliding) range.value = String(Math.round(run.rp.pos));
  $('rp-time').textContent = mmss(diveNow());
  profileChart.cursor = session.clock - run.rec.entry.start;
}

export function setupReplay(): void {
  // The state the session is in before each descent is kept with the dive (see JournalEvent).
  session.onJournalStart = () => captureState(session, computers, true);

  profileChart.onSeek = (d) => goTo(posOfDive(d));

  const bar = $('replay-bar');
  bar.addEventListener('pointerdown', (e) => (sliding = (e.target as HTMLElement).id === 'rp-range'));
  window.addEventListener('pointerup', () => (sliding = false));
  bar.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'rp-range') goTo(Number(el.value));
  });
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rp]');
    if (!b || !run) return;
    const act = b.dataset.rp!;
    const { rp, rec } = run;
    if (act === 'exit') return stopReplay();
    if (act === 'start') return goTo(0);
    if (act === 'end') return goTo(rp.duration);
    if (act === 'prev-alert' || act === 'next-alert') {
      const now = diveNow();
      const times = rec.alerts.map((a) => a.t).sort((a, b) => a - b);
      // A second of margin: the alert just reached is not "the next one".
      const to = act === 'next-alert' ? times.find((x) => x > now + 1) : [...times].reverse().find((x) => x < now - 1);
      if (to !== undefined) goTo(posOfDive(to));
      return;
    }
    goTo(rp.pos + Number(act));
  });

  window.addEventListener('keydown', (e) => {
    if (!run || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') goTo(run.rp.pos + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 60 : 10));
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(run.rp.duration);
    else if (e.key === 'Escape') stopReplay();
    else return;
    e.preventDefault();
  });
}

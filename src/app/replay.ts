// Replay of a dive, from its recap (a closed dive) or by itself when the dive in progress is paused: the dive is played again on the computers, in 2D, from the
// state before the descent and the commands given (engine/replay.ts). The diver can no longer be steered;
// the time controls of the page (pause, speed) and the bar of this module go forward, back, or to a given
// moment; any computer can be looked at. The live state is put back when the replay is left, and the
// recap opens again.
import { Replayer, captureState, restoreState, type DiveState } from '../engine/replay';
import { lang, t } from '../i18n';
import { diveAlerts } from './alertHelp';
import { findRecord, type DiveRecord } from './diveStore';
import { setView } from './diveControls';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { closeRecapForReplay, openRecap } from './recap';
import { profileChart, refresh } from './render';
import { renderControls } from './settings';
import { $, app, computers, session } from './state';

/** What a replay needs of the dive: a record of the logbook, or the dive in progress as it stands. */
export type ReplayedDive = Pick<DiveRecord, 'id' | 'entry' | 'alerts'>;

interface Run {
  rp: Replayer;
  rec: ReplayedDive;
  /** The live state, put back when the replay is left. */
  liveState: DiveState;
  liveRunning: boolean;
  speed: number;
  view: '2d' | '3d';
  /** The replay of the dive in progress, started from the pause: the dive itself stays open and resumes where it was. */
  ongoing: boolean;
  /** Ongoing replay only: the replay is playing (the pause button of the page is then the dive's own). */
  playing: boolean;
}

let run: Run | null = null;

/** Speed at which a replay starts (× real time). */
const START_SPEED = 10;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Whether a replay may start now: not during an exercise or the guided tour (a dive cut short by the rescue alert can be replayed). */
export function canReplay(): boolean {
  return !app.replaying && !exerciseBusy() && !tourRunning();
}

/** Whether the dive in progress, just paused, can be replayed (it starts by itself on the pause). */
export function canReplayLive(): boolean {
  return app.paused && session.inDive && !session.emergency && canReplay() && !!session.openJournal() && !document.querySelector('dialog[open]');
}

/** The dive being replayed (null: none). */
export function replayRecord(): ReplayedDive | null {
  return run?.rec ?? null;
}

/** The replay of the dive in progress is on: the page's pause button resumes the dive. */
export function replayOngoing(): boolean {
  return !!run?.ongoing;
}

/** Whether the replay is playing (it has its own play button when it is of the dive in progress). */
export function replayPlaying(): boolean {
  return !!run && (run.ongoing ? run.playing : !app.paused);
}

function begin(r: Run): void {
  run = r;
  app.replaying = true;
  document.body.classList.add('replaying');
  document.body.classList.toggle('replaying-live', r.ongoing);
  if (r.view === '3d') void setView('2d'); // the replay is drawn in 2D only
  renderControls();
  refresh(true);
}

export function startReplay(id: string): void {
  const rec = findRecord(id);
  if (!rec?.replay || !canReplay()) return;
  const liveRunning = closeRecapForReplay();
  const liveState = captureState(session, computers);
  const view = app.view;
  const rp = new Replayer(session, computers, rec.replay.start, rec.replay.events, rec.replay.endClock);
  const speed = app.speed;
  app.selectedDive = rec.id;
  app.speed = START_SPEED;
  app.paused = false;
  begin({ rp, rec, liveState, liveRunning, speed, view, ongoing: false, playing: false });
}

/** From the pause: the dive in progress is replayed from its start, at the moment it was paused. */
export function startLiveReplay(): void {
  const j = session.openJournal();
  const entry = session.currentEntry();
  if (!j || !entry || !canReplayLive()) return;
  const liveState = captureState(session, computers);
  const rec: ReplayedDive = { id: 'live', entry, alerts: diveAlerts(session.diveStart) };
  const rp = new Replayer(session, computers, j.token as DiveState, j.events, j.endClock, liveState);
  begin({ rp, rec, liveState, liveRunning: false, speed: app.speed, view: app.view, ongoing: true, playing: false });
}

/**
 * Leaves the replay: the live state comes back. A closed dive's recap opens again; the dive in progress
 * stays paused, or resumes where it was (`resume`).
 */
export function stopReplay(reopen = true, resume = false): void {
  if (!run) return;
  const r = run;
  run = null;
  r.rp.stop();
  restoreState(session, computers, r.liveState);
  app.replaying = false;
  document.body.classList.remove('replaying', 'replaying-live');
  app.speed = r.speed;
  app.paused = resume ? false : !r.liveRunning;
  profileChart.cursor = null;
  lockFields(false);
  if (r.view === '3d') void setView('3d');
  renderControls();
  refresh(true);
  if (reopen && !r.ongoing) openRecap(r.rec.id);
}

/** The page's pause button (or the space bar) in the replay of the dive in progress: the dive resumes. Tells whether it did. */
export function resumeFromReplay(): boolean {
  if (!run?.ongoing) return false;
  stopReplay(false, true);
  return true;
}

/** Advances the replay by `simDt` simulated seconds (from the loop). At the end it pauses; playing again starts over. */
export function tickReplay(simDt: number): void {
  if (!run) return;
  const { rp } = run;
  if (rp.atEnd) rp.seek(0);
  rp.seek(rp.pos + simDt);
  if (rp.atEnd) {
    if (run.ongoing) run.playing = false;
    else app.paused = true;
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

function barHtml(rec: ReplayedDive, rp: Replayer, ongoing: boolean): string {
  const n = rec.entry.number;
  return `
    <div class="rp-head">
      <span class="rp-badge" title="${t('rpNote')}">${t('rpBadge')}</span>
      <span class="rp-title">${ongoing ? t('rpOngoing') : t('rcDiveN').replace('{n}', String(n))}</span>
      <span class="rp-gap"></span>
      ${ongoing ? `<button type="button" class="btn primary" data-rp="resume" title="${t('rpResume')}" aria-label="${t('rpResume')}">▶<span class="lbl"> ${t('rpResume')}</span><span class="lbl-s"> ${t('rpResumeShort')}</span></button>` : ''}
      <button type="button" class="btn" data-rp="exit" title="${t('rpExit')}" aria-label="${t('rpExit')}">✕<span class="lbl"> ${t('rpExit')}</span></button>
    </div>
    <div class="rp-seek">
      <span class="rp-time" id="rp-time">0:00</span>
      <input type="range" id="rp-range" min="0" max="${Math.ceil(rp.duration)}" step="1" value="0" aria-label="${t('rpSeek')}">
      <span class="rp-time" id="rp-total">${mmss(rec.entry.duration)}</span>
    </div>
    <div class="rp-ctl">
      ${ongoing ? `<button type="button" class="btn" data-rp="toggle" id="rp-toggle"></button>` : ''}
      <button type="button" class="btn" data-rp="start" title="${t('rpStart')}">|◀</button>
      <button type="button" class="btn rp-min" data-rp="-60">−1&nbsp;min</button>
      <button type="button" class="btn" data-rp="-10">−10&nbsp;s</button>
      <button type="button" class="btn" data-rp="+10">+10&nbsp;s</button>
      <button type="button" class="btn rp-min" data-rp="+60">+1&nbsp;min</button>
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
  const key = `${run.rec.id}|${lang()}|${run.ongoing}`;
  if (builtFor !== key) {
    builtFor = key;
    bar.innerHTML = barHtml(run.rec, run.rp, run.ongoing);
  }
  if (run.ongoing) {
    // Phones: the icon only (the label is hidden by replay.css), the label as a tooltip.
    const lbl = run.playing ? t('pause') : t('rpPlay');
    const tg = $('rp-toggle');
    tg.innerHTML = `${run.playing ? '❚❚' : '▶'}<span class="lbl"> ${lbl}</span>`;
    tg.title = lbl;
    tg.setAttribute('aria-label', lbl);
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
    if (act === 'resume') return void resumeFromReplay();
    if (act === 'toggle') {
      run.playing = !run.playing;
      return refresh();
    }
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

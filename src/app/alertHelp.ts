// Alert explanations: when an alarm of the shown computer appears, a bubble points at the computer
// and the alarm under it, and says what is happening and what to do (generic texts in i18n.ts, plus
// what this model does, from its alertHelp()). Header button, three positions saved with the
// preferences: off / bubble / bubble + pause on serious alerts. Each alert is explained once per
// dive; "don't explain again" mutes it until the explanations are turned off and on again. Never
// during an exercise (it would give the answer), the guided tour or a rescue alert.
// Debrief: every alert of the shown computer is also recorded with its time and depth, drawn as a
// marker on the dive profile (during the dive and for the logbook's dives); clicking one explains it.
import type { AlarmCode, ComputerView } from '../computers/base';
import type { ProfileMarker } from '../ui/charts';
import { lang, t, type I18nKey } from '../i18n';
import { depthLabel } from '../units';
import { Tour } from '../ui/tour';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { savePrefs } from './prefs';
import { renderControls } from './settings';
import { $, app, computers, q, session } from './state';

export type AlertHelpMode = 'off' | 'bubble' | 'pause';

/** Severity of an alarm: the colour of its label under the computer, and whether it pauses. */
export function alarmSeverity(a: AlarmCode): 'crit' | 'serious' | 'warn' {
  return ['ASCENT', 'CEILING', 'PPO2_HIGH', 'LOCKED', 'OUT_OF_GAS'].includes(a) ? 'crit' : a === 'DECO' ? 'serious' : 'warn';
}

const RANK = { crit: 2, serious: 1, warn: 0 };

const tour = new Tour(() => ({ prev: '', next: '', done: '', close: t('close'), counter: () => '' }));

/** An alert shown by the computer on screen during a dive. */
interface AlertEvent {
  /** Dive time (s) and depth (m) when it appeared. */
  t: number;
  depth: number;
  code: AlarmCode;
  /** Id of the computer that showed it. */
  computer: string;
}

/** Alerts of each dive, by the dive's start (session clock): the current one and the logbook's. */
const events = new Map<number, AlertEvent[]>();
/** An alert back within this many seconds of its end is the same one (no new marker). */
const MERGE = 30;
/** Dive time each alarm was last seen at, in the current dive. */
let lastSeen = new Map<AlarmCode, number>();
let activeNow = new Set<AlarmCode>();

/** Alarms already explained during this dive. */
let explained = new Set<AlarmCode>();
let wasInDive = false;
/**
 * Alarm of the bubble on screen (null: none), the recorded alert when it was opened from the
 * profile, and whether it paused the simulation.
 */
let showing: AlarmCode | null = null;
let showingEvent: AlertEvent | null = null;
let pausedByUs = false;
/** The bubble is being replaced: its end must not resume the dive. */
let replacing = false;

function close(): void {
  tour.end();
}

/** Explains `code`: live (pointing at the computer, may pause), or from a profile marker (`ev`). */
function open(code: AlarmCode, ev: AlertEvent | null = null): void {
  const sev = alarmSeverity(code);
  const pause = !ev && app.alertHelp === 'pause' && sev === 'crit';
  if (tour.running) {
    // A more serious alarm replaces the bubble; the pause stays if it was ours.
    replacing = true;
    tour.end();
    replacing = false;
  }
  showing = code;
  showingEvent = ev;
  if (!ev) explained.add(code);
  if (pause && !app.paused) {
    app.paused = true;
    pausedByUs = true;
    renderControls();
  }
  const computer = (ev && computers.find((c) => c.id === ev.computer)) || app.active;
  const model = computer.alertHelp(code)?.[lang()];
  const icon = sev === 'crit' ? '⛔' : '⚠';
  const when = ev ? ` <span class="ah-when">${mmss(ev.t)} · ${depthLabel(ev.depth)}</span>` : '';
  tour.start(
    [
      {
        targets: () => (ev ? [$('profile')] : [$('device').firstElementChild, q(`#device-alarms [data-alarm="${code}"]`)]),
        title: () => `${icon} ${t(code as I18nKey)}${when}`,
        body: () => `<div class="ah-body">
          <p><b>${t('ahWhatT')} :</b> ${t(`ahWhat_${code}` as I18nKey)}</p>
          <p><b>${t('ahDoT')} :</b> ${t(`ahDo_${code}` as I18nKey)}</p>
          ${model ? `<p class="ah-model"><b>${t('ahOnModel')} (${computer.name}) :</b> ${model}</p>` : ''}
          ${pausedByUs ? `<p><b>${t('ahPaused')}</b></p>` : ''}
          <p class="ah-note">${t('ahNote')}</p></div>`,
        actions: () => [
          ...(ev ? [] : [{ id: 'mute', label: t('ahMute') }]),
          { id: 'ok', label: t(pausedByUs ? 'ahResume' : 'ahOk'), primary: true },
        ],
      },
    ],
    () => {
      showing = null;
      showingEvent = null;
      if (replacing || !pausedByUs) return;
      pausedByUs = false;
      app.paused = false;
      renderControls();
    },
    {
      passive: !pausedByUs,
      fitBeside: true,
      className: sev === 'crit' ? 'crit' : undefined,
      onAction: (id) => {
        if (id === 'mute') {
          app.alertHelpMuted = [...new Set([...app.alertHelpMuted, code])];
          savePrefs();
        }
        close();
      },
    },
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Records the alerts that appear on the shown computer during a dive (profile markers). */
function record(v: ComputerView): void {
  if (!session.inDive) return;
  let list = events.get(session.diveStart);
  if (!list) events.set(session.diveStart, (list = []));
  const now = session.diveTime;
  for (const a of v.alarms) {
    if (!activeNow.has(a) && now - (lastSeen.get(a) ?? -Infinity) > MERGE) list.push({ t: now, depth: session.depth, code: a, computer: app.active.id });
    lastSeen.set(a, now);
  }
  activeNow = new Set(v.alarms);
}

/** Called on every refresh with the active computer's view. */
export function updateAlertHelp(v: ComputerView): void {
  if (session.inDive && !wasInDive) {
    // A new dive: every alert will be explained again, and recorded anew.
    explained = new Set();
    lastSeen = new Map();
    activeNow = new Set();
    events.set(session.diveStart, []);
  }
  wasInDive = session.inDive;
  record(v);
  const blocked = app.alertHelp === 'off' || exerciseBusy() || tourRunning() || !!session.emergency;
  if (blocked) {
    // An exercise or the guided tour starting, or the explanations turned off: the live bubble goes
    // away (one opened from the profile stays: the user asked for it).
    if (tour.running && !pausedByUs && !showingEvent) close();
    return;
  }
  const fresh = v.alarms.filter((a) => !explained.has(a) && !app.alertHelpMuted.includes(a));
  if (!fresh.length) return;
  const next = fresh.reduce((a, b) => (RANK[alarmSeverity(b)] > RANK[alarmSeverity(a)] ? b : a));
  // Several at once: the most serious first, the others once the bubble is closed (if still active).
  if (showing && RANK[alarmSeverity(next)] <= RANK[alarmSeverity(showing)]) return;
  open(next);
}

/** The alerts of the dive drawn on the profile: the current dive, or the logbook dive shown. */
export function alertMarkers(depthOf: (m: number) => number): ProfileMarker[] {
  const start = session.inDive ? session.diveStart : session.log[app.selectedLog]?.start;
  const list = start === undefined ? [] : (events.get(start) ?? []);
  return list.map((e, i) => ({ t: e.t, depth: depthOf(e.depth), level: alarmSeverity(e.code), label: t(e.code as I18nKey), id: `${start}:${i}` }));
}

/** A profile marker was clicked: its explanation, pointing at the profile. */
export function explainMarker(m: ProfileMarker): void {
  const [start, i] = m.id.split(':').map(Number);
  const ev = events.get(start)?.[i];
  if (ev) open(ev.code, ev);
}

function renderButton(): void {
  const b = $<HTMLButtonElement>('alert-help-toggle');
  b.setAttribute('aria-pressed', String(app.alertHelp !== 'off'));
  b.dataset.mode = app.alertHelp;
  const label = t(app.alertHelp === 'off' ? 'ahOff' : app.alertHelp === 'bubble' ? 'ahBubble' : 'ahPause');
  b.title = label;
  b.setAttribute('aria-label', label);
}

export function setupAlertHelp(): void {
  renderButton();
  $('alert-help-toggle').addEventListener('click', () => {
    app.alertHelp = app.alertHelp === 'off' ? 'bubble' : app.alertHelp === 'bubble' ? 'pause' : 'off';
    // Turned on again: the alerts muted with "don't explain again" are explained again.
    if (app.alertHelp === 'bubble') app.alertHelpMuted = [];
    if (app.alertHelp === 'off' && tour.running) close();
    renderButton();
    savePrefs();
  });
}

/** Also re-labels the button when the language changes. */
export function renderAlertHelp(): void {
  renderButton();
  if (showing) {
    // The bubble in the new language.
    const code = showing;
    const ev = showingEvent;
    replacing = true;
    tour.end();
    replacing = false;
    explained.delete(code);
    open(code, ev);
  }
}

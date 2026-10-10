// Alert explanations: when an alert of the shown computer appears, a bubble points at the computer
// and says what is happening and what to do. Two sources: the common alarms (ComputerView.alarms,
// generic texts in i18n.ts) and the model's own alerts (its alert cues, explained by its
// alertExplain(), from its manual); a model alert that is the device's form of a common alarm shows
// both texts in one bubble. Header button, three positions saved with the preferences: off / bubble
// / bubble + pause on serious alerts. Each alert is explained once per dive; "don't explain again"
// mutes it until the explanations are turned off and on again. Never during an exercise (it would
// give the answer), the guided tour or a rescue alert. An accelerated time goes back to ×1 when an
// alert is explained, to leave time to react. Phones (compactMq): a bubble would cover the water
// column and its controls, so the alert first shows as a one-line banner under the computer; tapping
// it opens the bubble and pauses while it is read (serious alerts in pause mode open it at once).
// Debrief: every alert is also recorded with its time and depth, drawn as a marker on the dive
// profile (during the dive and for the logbook's dives); clicking one explains it.
import type { AlarmCode, AlertExplain, ComputerView, DiveComputer } from '../computers/base';
import { lang, t, type I18nKey } from '../i18n';
import { depthLabel } from '../units';
import type { ProfileMarker } from '../ui/charts';
import { Tour } from '../ui/tour';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { savePrefs } from './prefs';
import { renderControls } from './settings';
import { $, app, compactMq, computers, q, session } from './state';

export type AlertHelpMode = 'off' | 'bubble' | 'pause';
type Severity = 'crit' | 'serious' | 'warn' | 'info';

/** Severity of a common alarm: the colour of its label under the computer, and whether it pauses. */
export function alarmSeverity(a: AlarmCode): 'crit' | 'serious' | 'warn' {
  return ['ASCENT', 'CEILING', 'PPO2_HIGH', 'LOCKED', 'OUT_OF_GAS'].includes(a) ? 'crit' : a === 'DECO' ? 'serious' : 'warn';
}

const RANK: Record<Severity, number> = { crit: 3, serious: 2, warn: 1, info: 0 };
const ICON: Record<Severity, string> = { crit: '⛔', serious: '⚠', warn: '⚠', info: 'ℹ' };

/** An alert active on a computer: a common alarm, or one of the model's own alerts. */
interface Item {
  /** Unique among the computers: the alarm code, or "computer:id" for a model alert. */
  id: string;
  /** The alert cue key (model alert) or the alarm code: what alertExplain() takes. */
  key: string;
  code: AlarmCode | null;
  severity: Severity;
  computer: string;
}

/** The alerts active on computer `c`, each with its explanation (model alerts without one are left out). */
function activeItems(c: DiveComputer, v: ComputerView): Item[] {
  const items: Item[] = [];
  const keys = [...c.alertCues(v, true), ...c.screenAlerts.map((m) => ({ key: `msg:${m}`, level: 'info' as const }))];
  for (const cue of keys) {
    const e = c.alertExplain(cue.key);
    if (!e) continue;
    const id = `${c.id}:${e.id ?? cue.key}`;
    if (items.some((i) => i.id === id)) continue;
    // A cue below the alarm level (a pre-warning sharing the alarm's code) does not count as critical.
    const fromCode = e.code ? alarmSeverity(e.code) : null;
    const downgraded = fromCode === 'crit' && !cue.key.startsWith('msg:') && cue.level !== 'alarm';
    const severity: Severity = e.critical ? 'crit' : fromCode ? (downgraded ? 'warn' : fromCode) : cue.level === 'alarm' ? 'serious' : cue.level === 'warning' ? 'warn' : 'info';
    items.push({ id, key: cue.key, code: e.code ?? null, severity, computer: c.id });
  }
  // The common alarms not already shown in the model's own form.
  for (const a of v.alarms) {
    const shown = items.find((i) => i.code === a);
    // The common alarm being on keeps its severity (the model's cue may be a lower-level one).
    if (shown) shown.severity = RANK[alarmSeverity(a)] > RANK[shown.severity] ? alarmSeverity(a) : shown.severity;
    else items.push({ id: a, key: a, code: a, severity: alarmSeverity(a), computer: c.id });
  }
  return items;
}

/** The alert's name: as the device shows it, with the common alarm's name when it differs. */
function itemLabel(it: Item, e: AlertExplain | null): string {
  const common = it.code ? t(it.code as I18nKey) : e?.title?.[lang()] ?? '';
  if (!e?.screen) return common;
  return common ? `${e.screen} · ${common}` : e.screen;
}

const tour = new Tour(() => ({ prev: '', next: '', done: '', close: t('close'), counter: () => '' }));

/** An alert shown by a computer during a dive. */
interface AlertEvent {
  /** Dive time (s) and depth (m) when it appeared. */
  t: number;
  depth: number;
  item: Item;
}

/** Alerts of each dive, by the dive's start (session clock): the current one and the logbook's. */
const events = new Map<number, AlertEvent[]>();
/** An alert back within this many seconds of its end is the same one (no new marker). */
const MERGE = 30;
/** Dive time each alert was last seen at, in the current dive. */
let lastSeen = new Map<string, number>();
let activeNow = new Set<string>();

/** Alerts already explained during this dive. */
let explained = new Set<string>();
let wasInDive = false;
/**
 * Alert of the bubble on screen (null: none), the recorded alert when it was opened from the
 * profile, and whether it paused the simulation.
 */
let showing: Item | null = null;
let showingEvent: AlertEvent | null = null;
let pausedByUs = false;
/** The bubble is being replaced: its end must not resume the dive. */
let replacing = false;
/** The phone banner's alert (shown instead of the bubble until tapped). */
let banner: Item | null = null;
/** The last live alert brought the time speed back to ×1 (said in the bubble). */
let slowed = false;

function close(): void {
  tour.end();
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function bodyHtml(it: Item, c: DiveComputer, e: AlertExplain | null): string {
  const L = lang();
  // The model's text for the common alarm itself, when the bubble comes from one of its own alerts.
  const forCode = it.code && it.key !== it.code ? c.alertExplain(it.code) : null;
  const model = [e?.what[L], forCode?.what[L]].filter(Boolean).join(' ');
  const todo = [e?.todo?.[L], forCode?.todo?.[L]].filter(Boolean).join(' ');
  const parts: string[] = [];
  if (it.code) {
    parts.push(`<p><b>${t('ahWhatT')} :</b> ${t(`ahWhat_${it.code}` as I18nKey)}</p>`);
    if (model) parts.push(`<p class="ah-model"><b>${t('ahOnModel')} (${c.name}) :</b> ${model}</p>`);
    parts.push(`<p><b>${t('ahDoT')} :</b> ${t(`ahDo_${it.code}` as I18nKey)}${todo ? ` ${todo}` : ''}</p>`);
  } else {
    parts.push(`<p class="ah-model"><b>${t('ahWhatT')} (${c.name}) :</b> ${model}</p>`);
    if (todo) parts.push(`<p><b>${t('ahDoT')} :</b> ${todo}</p>`);
  }
  return parts.join('');
}

/** A new alert to explain: time back to ×1, then the bubble, or the banner on a phone. */
function live(it: Item): void {
  slowed = app.speed > 1;
  if (slowed) {
    app.speed = 1;
    renderControls();
  }
  if (compactMq.matches && !(app.alertHelp === 'pause' && it.severity === 'crit')) {
    if (tour.running && !pausedByUs && !showingEvent) close();
    explained.add(it.id);
    banner = it;
    renderBanner();
  } else open(it);
}

function hideBanner(): void {
  banner = null;
  renderBanner();
}

/** The alarm label under the computer that the banner already says is hidden (one line saved). */
function syncChip(): void {
  document.querySelectorAll<HTMLElement>('#device-alarms [data-alarm]').forEach((el) => {
    el.style.display = banner?.code && el.dataset.alarm === banner.code ? 'none' : '';
  });
}

function renderBanner(): void {
  syncChip();
  const el = $('ah-banner');
  el.hidden = !banner;
  if (!banner) {
    el.innerHTML = '';
    return;
  }
  const c = computers.find((x) => x.id === banner!.computer) ?? app.active;
  el.className = `ah-banner ${banner.severity}`;
  el.innerHTML = `<button type="button" class="ah-why"><span aria-hidden="true">${ICON[banner.severity]}</span>
    <span class="ah-lbl">${itemLabel(banner, c.alertExplain(banner.key))}</span><span class="ah-more">${t('ahWhy')}</span></button>
    <button type="button" class="ah-x" title="${t('ahBannerClose')}" aria-label="${t('ahBannerClose')}">✕</button>`;
}

/**
 * Explains alert `it`: live (pointing at the computer, may pause), or from a profile marker (`ev`).
 * `read`: opened from the phone banner, paused while it is read.
 */
function open(it: Item, ev: AlertEvent | null = null, read = false): void {
  const pause = !ev && (read || (app.alertHelp === 'pause' && it.severity === 'crit'));
  if (!ev && banner) hideBanner();
  if (tour.running) {
    // A more serious alert replaces the bubble; the pause stays if it was ours.
    replacing = true;
    tour.end();
    replacing = false;
  }
  showing = it;
  showingEvent = ev;
  if (!ev) explained.add(it.id);
  if (pause && !app.paused) {
    app.paused = true;
    pausedByUs = true;
    renderControls();
  }
  const computer = computers.find((c) => c.id === it.computer) ?? app.active;
  const e = computer.alertExplain(it.key);
  const when = ev ? ` <span class="ah-when">${mmss(ev.t)} · ${depthLabel(ev.depth)}</span>` : '';
  tour.start(
    [
      {
        targets: () => (ev ? [$('profile')] : [$('device').firstElementChild, it.code ? q(`#device-alarms [data-alarm="${it.code}"]`) : null]),
        title: () => `${ICON[it.severity]} ${itemLabel(it, e)}${when}`,
        body: () => `<div class="ah-body">${bodyHtml(it, computer, e)}
          ${pausedByUs ? `<p><b>${t(read ? 'ahPausedRead' : 'ahPaused')}</b></p>` : ''}
          ${!ev && slowed ? `<p>⏱ ${t('ahSlowed')}</p>` : ''}
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
      className: it.severity === 'crit' ? 'crit' : undefined,
      onAction: (id) => {
        if (id === 'mute') {
          app.alertHelpMuted = [...new Set([...app.alertHelpMuted, it.id])];
          savePrefs();
        }
        close();
      },
    },
  );
}

/** Records the alerts that appear on the shown computer during a dive (profile markers). */
function record(items: Item[]): void {
  if (!session.inDive) return;
  let list = events.get(session.diveStart);
  if (!list) events.set(session.diveStart, (list = []));
  const now = session.diveTime;
  for (const it of items) {
    if (!activeNow.has(it.id) && now - (lastSeen.get(it.id) ?? -Infinity) > MERGE) list.push({ t: now, depth: session.depth, item: it });
    lastSeen.set(it.id, now);
  }
  activeNow = new Set(items.map((i) => i.id));
}

/** Called on every refresh with the active computer's view. */
export function updateAlertHelp(v: ComputerView): void {
  syncChip();
  if (session.inDive && !wasInDive) {
    // A new dive: every alert will be explained again, and recorded anew.
    explained = new Set();
    lastSeen = new Map();
    activeNow = new Set();
    events.set(session.diveStart, []);
  }
  wasInDive = session.inDive;
  const items = activeItems(app.active, v);
  record(items);
  const blocked = app.alertHelp === 'off' || exerciseBusy() || tourRunning() || !!session.emergency;
  if (blocked) {
    // An exercise or the guided tour starting, or the explanations turned off: the live bubble goes
    // away (one opened from the profile stays: the user asked for it).
    if (tour.running && !pausedByUs && !showingEvent) close();
    if (banner) hideBanner();
    return;
  }
  // The banner goes once its alert has been gone for a while (or after the dive).
  if (banner && (!session.inDive || session.diveTime - (lastSeen.get(banner.id) ?? -Infinity) > MERGE)) hideBanner();
  const fresh = items.filter((i) => !explained.has(i.id) && !app.alertHelpMuted.includes(i.id));
  if (!fresh.length) return;
  const next = fresh.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));
  // Several at once: the most serious first, the others once the bubble is closed (if still active).
  const current = showing ?? banner;
  if (current && RANK[next.severity] <= RANK[current.severity]) return;
  live(next);
}

/** The alerts of the dive drawn on the profile: the current dive, or the logbook dive shown. */
export function alertMarkers(depthOf: (m: number) => number): ProfileMarker[] {
  const start = session.inDive ? session.diveStart : session.log[app.selectedLog]?.start;
  const list = start === undefined ? [] : (events.get(start) ?? []);
  return list.map((ev, i) => {
    const c = computers.find((x) => x.id === ev.item.computer) ?? app.active;
    const level = ev.item.severity === 'info' ? 'warn' : ev.item.severity;
    return { t: ev.t, depth: depthOf(ev.depth), level, label: itemLabel(ev.item, c.alertExplain(ev.item.key)), id: `${start}:${i}` };
  });
}

/** A profile marker was clicked: its explanation, pointing at the profile. */
export function explainMarker(m: ProfileMarker): void {
  const [start, i] = m.id.split(':').map(Number);
  const ev = events.get(start)?.[i];
  if (ev) open(ev.item, ev);
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
  $('ah-banner').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const it = banner;
    if (!b || !it) return;
    hideBanner();
    if (b.classList.contains('ah-why')) open(it, null, true);
  });
  $('alert-help-toggle').addEventListener('click', () => {
    app.alertHelp = app.alertHelp === 'off' ? 'bubble' : app.alertHelp === 'bubble' ? 'pause' : 'off';
    // Turned on again: the alerts muted with "don't explain again" are explained again.
    if (app.alertHelp === 'bubble') app.alertHelpMuted = [];
    if (app.alertHelp === 'off') {
      if (tour.running) close();
      hideBanner();
    }
    renderButton();
    savePrefs();
  });
}

/** Also re-labels the button when the language changes. */
export function renderAlertHelp(): void {
  renderButton();
  renderBanner();
  if (showing) {
    // The bubble in the new language.
    const it = showing;
    const ev = showingEvent;
    replacing = true;
    tour.end();
    replacing = false;
    explained.delete(it.id);
    open(it, ev);
  }
}

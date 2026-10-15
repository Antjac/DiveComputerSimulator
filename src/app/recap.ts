// Dive recap: when a dive is closed, a dialog sums it up on a paper sheet — key figures, key points,
// profile with the alerts, saturation, the 16 compartments, each alert with the computer's display at
// that moment and its explanation, and the dive in the MN90 tables. It can be printed, and reopened
// from the logbook (records of app/diveStore.ts), going from one dive to the previous or next one.
// It opens by itself at the end of a dive (option saved with the preferences), never during an
// exercise, the guided tour or a rescue alert; the dive is paused while it is read, as for the tables.
import { hmm, type ComputerView } from '../computers/base';
import { SURFACE_PRESSURE, COMPARTMENTS, gasLabel } from '../engine/buhlmann';
import type { DiveState } from '../engine/replay';
import { RAPID_RATE, type DiveLogEntry } from '../engine/session';
import { lang, t, type I18nKey } from '../i18n';
import { icon } from '../ui/icons';
import { CHART_W, profileSvg, saturationSvg, tissuesSvg, type RecapMarker } from '../ui/recapCharts';
import { depthLabel, depthUnit, depthVal, pressText, pressUnit, rateLabel, tempUnit, tempVal, volumeLabel } from '../units';
import { closeAlertBubble, diveAlerts, recAlertLabel } from './alertHelp';
import { addRecord, allRecords, findRecord, newRecordId, type DiveRecord, type RecAlert } from './diveStore';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { renderLog } from './logbook';
import { mn90Summary } from './mn90';
import { savePrefs } from './prefs';
import { canReplay, startReplay } from './replay';
import { renderControls, settingGroup, settingShown } from './settings';
import { $, app, mn90, session } from './state';

/** Usual reserve taught to recreational divers (bar): a teaching choice for the key points, not a computer setting. */
const RESERVE_BAR = 50;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const r1 = (v: number) => Math.round(v * 10) / 10;

// --- Gathered during the dive, from the shown computer --------------------------------------------

const track = { safetyAsked: false, safetyDone: false, deco: false, ttsMax: 0, ceilingSec: 0, locked: false, lastTime: 0, gfLow: 0, gfHigh: 0 };

/** A new dive starts (session 'start'). */
export function resetRecapTrack(): void {
  if (app.replaying) return;
  Object.assign(track, { safetyAsked: false, safetyDone: false, deco: false, ttsMax: 0, ceilingSec: 0, locked: false, lastTime: 0 });
}

/** Called on every refresh with the shown computer's view. */
export function trackRecap(v: ComputerView): void {
  if (!session.inDive || app.replaying) return;
  const dt = session.diveTime - track.lastTime;
  track.lastTime = session.diveTime;
  const st = v.safety.state;
  if (st === 'pending' || st === 'active' || st === 'paused') track.safetyAsked = true;
  if (st === 'done') track.safetyDone = true;
  if (v.inDeco) {
    track.deco = true;
    track.ttsMax = Math.max(track.ttsMax, v.tts);
  }
  if (v.ceilingViolation > 0 && dt > 0 && dt < 60) track.ceilingSec += dt;
  if (v.locked) track.locked = true;
  track.gfLow = v.gfLow;
  track.gfHigh = v.gfHigh;
}

// --- The record of a closed dive --------------------------------------------------------------------

function buildRecord(entry: DiveLogEntry): DiveRecord {
  const c = app.active;
  // The compartments at the surface, on the Tissues tab's scale.
  const pAmb = SURFACE_PRESSURE;
  const gf = session.tissues.gradientPercents(pAmb);
  const tissues = Array.from({ length: COMPARTMENTS }, (_, i) => {
    const p = session.tissues.n2[i] + session.tissues.he[i];
    return r1(p <= pAmb ? (p / pAmb - 1) * 100 : gf[i]);
  });
  const settings = c.settingDefs
    .filter((d) => settingGroup(d) === 'deco' && settingShown(c, d))
    .flatMap((d) => {
      const o = d.options.find((x) => x.value === c.settings[d.key]);
      if (!o) return [];
      return [{ label: d.label, value: typeof o.label === 'string' ? { fr: o.label, en: o.label } : o.label }];
    });
  const last = entry.profile[entry.profile.length - 1];
  const m = mn90.last;
  // The replay: the state before the descent and the commands given (engine/replay.ts).
  const j = session.lastJournal;
  const replay = j && j.token ? { start: j.token as DiveState, events: j.events, endClock: j.endClock } : null;
  return {
    id: newRecordId(),
    savedAt: Date.now(),
    entry: {
      ...entry,
      // Rounded: the logbook is kept in the browser.
      profile: entry.profile.map((p) => ({
        t: Math.round(p.t),
        depth: Math.round(p.depth * 100) / 100,
        ceiling: Math.round(p.ceiling * 100) / 100,
        ...(p.gf99 === undefined ? {} : { gf99: r1(p.gf99) }),
        ...(p.surfGf === undefined ? {} : { surfGf: r1(p.surfGf) }),
      })),
    },
    computer: { id: c.id, name: c.name, algorithm: c.algorithm, settings },
    gfLow: track.gfLow,
    gfHigh: track.gfHigh,
    alerts: diveAlerts(entry.start),
    tissues,
    facts: {
      safety: track.safetyDone ? 'done' : track.safetyAsked ? 'missed' : null,
      deco: track.deco,
      ttsMax: track.ttsMax,
      ceilingSec: Math.round(track.ceilingSec),
      locked: track.locked,
      rapid: session.rapidAscent ? { ...session.rapidAscent } : null,
      surfGfOut: r1(last?.surfGf ?? 0),
    },
    mn90: m && m.end !== null ? { dive: structuredClone(m), decoGases: (entry.decoGases?.length ?? 0) > 0 } : null,
    ...(replay ? { replay } : {}),
  };
}

/** The session closed a dive (after the MN90 tracker saw it end): its record, and the recap. */
export function onDiveClosed(cut: DiveLogEntry | null = null): void {
  if (app.replaying) return; // the replay of a dive ends too
  const entry = cut ?? session.log[session.log.length - 1];
  if (!entry) return;
  const rec = buildRecord(entry);
  addRecord(rec);
  app.selectedDive = rec.id;
  renderLog();
  const busy = exerciseBusy() || tourRunning() || !!document.querySelector('dialog[open]');
  if (app.recapAuto && !busy) openRecap(rec.id);
}

/** The logbook dive drawn on the profile at the surface (null: none). */
export function shownRecord(): DiveRecord | null {
  return findRecord(app.selectedDive);
}

// --- The sheet ----------------------------------------------------------------------------------------

function diveType(si: number | null): I18nKey {
  if (si === null || si >= 12 * 3600) return 'diveSingle';
  return si < 15 * 60 ? 'diveConsecutive' : 'diveRepetitive';
}

function keyPoints(r: DiveRecord): { ok: boolean; text: string }[] {
  const e = r.entry;
  const f = r.facts;
  const bad = (text: string) => ({ ok: false, text });
  const good = (text: string) => ({ ok: true, text });
  const list: { ok: boolean; text: string }[] = [];
  if (e.interrupted) {
    const why = e.interrupted.map((x) => t(({ OUT_OF_AIR: 'rescueAirT', RAPID_ASCENT: 'rescueRapidT', MISSED_DECO: 'rescueDecoT' } as const)[x]).toLowerCase()).join(', ');
    list.push(bad(fill(t('kpInterrupted'), { why })));
  }
  if (f.rapid) {
    list.push(bad(fill(t('kpRapid'), { rate: rateLabel(f.rapid.rate), from: depthLabel(f.rapid.fromDepth), to: depthLabel(f.rapid.toDepth), max: rateLabel(RAPID_RATE) })));
  }
  if (f.surfGfOut > 100) list.push(bad(fill(t('kpMissed'), { gf: `${Math.round(f.surfGfOut)} %` })));
  if (f.ceilingSec >= 5) list.push(bad(fill(t('kpCeiling'), { d: f.ceilingSec < 60 ? `${f.ceilingSec} s` : `${mmss(f.ceilingSec)} min` })));
  if (f.locked) list.push(bad(t('kpLocked')));
  if (e.alarms.includes('OUT_OF_GAS')) list.push(bad(t('kpOutOfGas')));
  else if (e.tankEnd < RESERVE_BAR) list.push(bad(fill(t('kpLowGas'), { p: `${pressText(e.tankEnd)} ${pressUnit()}`, r: `${pressText(RESERVE_BAR)} ${pressUnit()}` })));
  if (r.alerts.some((a) => a.code === 'PPO2_HIGH')) list.push(bad(t('kpPpo2')));
  if (r.alerts.some((a) => a.code === 'CNS')) list.push(bad(t('kpCns')));
  const ascents = r.alerts.filter((a) => a.code === 'ASCENT').length;
  if (ascents) list.push(bad(fill(t('kpAscent'), { n: ascents })));
  if (f.safety === 'missed' && !f.deco) list.push(bad(t('kpSafetyMissed')));
  if (f.deco) list.push(good(fill(t('kpDeco'), { tts: Math.round(f.ttsMax) })));
  if (f.safety === 'done') list.push(good(t('kpSafetyDone')));
  const type = diveType(e.surfaceIntervalBefore);
  if (type === 'diveRepetitive') list.push(good(fill(t('kpRepetitive'), { si: hmm(e.surfaceIntervalBefore! / 60) })));
  if (type === 'diveConsecutive') list.push(good(t('kpConsecutive')));
  if (!r.alerts.length) list.push(good(t('kpNone')));
  return list;
}

function fig(label: string, value: string, extra = ''): string {
  return `<div class="rc-fig"><span>${esc(label)}</span><b>${value}</b>${extra}</div>`;
}

function alertHtml(a: RecAlert, i: number, r: DiveRecord): string {
  const L = lang();
  const parts: string[] = [];
  if (a.code) parts.push(`<p><b>${t('ahWhatT')} :</b> ${esc(t(`ahWhat_${a.code}` as I18nKey))}</p>`);
  if (a.what) parts.push(`<p class="rc-model"><b>${a.code ? t('ahOnModel') : t('ahWhatT')} (${esc(a.computer)}) :</b> ${esc(a.what[L])}</p>`);
  const todo = [a.code ? t(`ahDo_${a.code}` as I18nKey) : '', a.todo?.[L] ?? ''].filter(Boolean).join(' ');
  if (todo) parts.push(`<p><b>${t('ahDoT')} :</b> ${esc(todo)}</p>`);
  const screen = a.screen
    ? `<div class="rc-screen" aria-hidden="true"><div class="rc-dev">${a.screen}</div></div>`
    : `<div class="rc-screen rc-noscreen">${t('rcNoScreen')}</div>`;
  const other = a.computer && a.computer !== r.computer.name ? ` · ${esc(a.computer)}` : '';
  return `<section class="rc-alert ${a.severity}" id="rc-alert-${i}">
    <h4><span class="rc-num">${i + 1}</span> <span class="rc-when">${mmss(a.t)} · ${depthLabel(a.depth)}</span> ${esc(recAlertLabel(a))}${other}</h4>
    <div class="rc-alert-body">${screen}<div class="rc-alert-text">${parts.join('')}</div></div>
  </section>`;
}

/** `chartW`: the width the charts are drawn at (that of the sheet, at most CHART_W). */
function sheetHtml(r: DiveRecord, chartW = CHART_W): string {
  const L = lang();
  const list = allRecords();
  const n = list.indexOf(r) + 1;
  const e = r.entry;
  const prev = list[n - 2];
  const date = new Date(r.savedAt).toLocaleString(L === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const si = e.surfaceIntervalBefore;
  const siVal = si === null ? `— <small>(${t('rcFirst')})</small>` : `${hmm(si / 60)} <small>(${t(diveType(si)).toLowerCase()})</small>`;
  const seePrev = prev ? `<button type="button" class="rc-link" data-rc-go="${esc(prev.id)}">◀ ${t('rcSeePrev')}</button>` : '';
  const gases = (e.gasesUsed ?? [e.gas]).map((g) => (g.o2 >= 0.995 ? 'O₂' : gasLabel(g))).join(' + ');
  const figs = [
    fig(t('duration'), `${Math.round(e.duration / 60)} min`),
    fig(t('maxDepth'), depthLabel(e.maxDepth)),
    fig(t('avgDepth'), depthLabel(e.avgDepth)),
    fig(t('surfaceSince'), siVal, seePrev),
    fig(t('gas'), esc(gases)),
    fig(t('minTemp'), `${tempVal(e.minTemp).toFixed(0)} ${tempUnit()}`),
    fig(t('tankCol'), `${pressText(e.tankStart)} → ${pressText(e.tankEnd)} ${pressUnit()}`),
    fig(t('rcGasUsed'), volumeLabel(e.gasUsed)),
    fig(t('rcCns'), `${e.cnsEnd.toFixed(0)} %`),
    ...(r.gfLow > 0 && r.gfHigh > 0 ? [fig('GF', `${Math.round(r.gfLow)}/${Math.round(r.gfHigh)}`)] : []),
    ...(r.facts.deco ? [fig(t('rcTtsMax'), `${Math.round(r.facts.ttsMax)} min`)] : []),
  ].join('');
  const settings = r.computer.settings.length
    ? `<p class="rc-settings"><b>${t('rcDecoSettings')} :</b> ${r.computer.settings.map((s) => `${esc(s.label[L])} ${esc(s.value[L])}`).join(' · ')}</p>`
    : '';
  const kp = keyPoints(r).map((k) => `<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✓' : '⚠'} ${esc(k.text)}</li>`).join('');
  // Profile in the display unit; markers numbered as the alerts.
  const unit = depthUnit();
  const points = e.profile.map((p) => ({ t: p.t, depth: depthVal(p.depth), ceiling: depthVal(p.ceiling) }));
  const markers: RecapMarker[] = r.alerts.map((a, i) => ({ t: a.t, depth: depthVal(a.depth), level: a.severity === 'info' ? 'warn' : a.severity, n: i + 1 }));
  const sat = e.profile.filter((p) => p.surfGf !== undefined).map((p) => ({ t: p.t, gf99: p.gf99 ?? 0, surfGf: p.surfGf ?? 0 }));
  const alerts = r.alerts.length ? r.alerts.map((a, i) => alertHtml(a, i, r)).join('') : `<p>${t('rcNoAlert')}</p>`;
  const tables = r.mn90
    ? `<section class="rc-sec rc-mn90"><h3>${t('rcMn90')}</h3><p class="rc-help">${t('rcMn90Note')}</p><div class="mn-page rc-mnpage"><div class="mn-card">${mn90Summary(r.mn90.dive, r.mn90.decoGases)}</div></div></section>`
    : '';
  return `<header class="rc-title">
      <h2>${t('rcTitle')} · ${fill(t('rcDiveN'), { n })}${e.interrupted ? ` <span class="rc-cut">⛔ ${t('rcInterrupted')}</span>` : ''}</h2>
      <p>${esc(date)} · ${esc(r.computer.name)} · ${t('rcAlgo')} : ${esc(r.computer.algorithm)}</p>
    </header>
    <section class="rc-sec"><h3>${t('rcSummary')}</h3><div class="rc-figs">${figs}</div>${settings}</section>
    <section class="rc-sec"><h3>${t('rcKey')}</h3><ul class="rc-key">${kp}</ul></section>
    <section class="rc-sec"><h3>${t('profile')}</h3><p class="rc-help">${t('rcProfileHelp')}</p>
      ${profileSvg(points, markers, unit, { depth: t('depth'), ceiling: t('ceiling') }, chartW)}</section>
    ${sat.length > 1 ? `<section class="rc-sec"><h3>${t('rcSat')}</h3><p class="rc-help">${t('rcSatHelp')}</p>
      ${saturationSvg(sat, Math.round(r.gfHigh), { mValue: t('rcMValue'), gfHigh: t('rcGfHigh') }, chartW)}</section>` : ''}
    ${r.tissues.length === COMPARTMENTS ? `<section class="rc-sec"><h3>${t('rcTissues')}</h3><p class="rc-help">${t('rcTissuesHelp')}</p>
      ${tissuesSvg(r.tissues, Math.round(r.gfHigh) || 100, chartW)}</section>` : ''}
    <section class="rc-sec"><h3>${t('rcAlerts')} (${r.alerts.length})</h3>${alerts}</section>
    ${tables}
    <p class="rc-foot">${t('rcFooter')}</p>`;
}

/** Scales each kept display to its box (the computers have their own sizes). */
function fitScreens(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.rc-dev').forEach((wrap) => {
    const dev = wrap.firstElementChild as HTMLElement | null;
    if (!dev) return;
    wrap.style.transform = '';
    const w = dev.offsetWidth;
    const h = dev.offsetHeight;
    if (!w || !h) return;
    const s = Math.min(230 / w, 250 / h, 1);
    wrap.style.transform = `scale(${s})`;
    const box = wrap.parentElement!;
    box.style.width = `${Math.ceil(w * s)}px`;
    box.style.height = `${Math.ceil(h * s)}px`;
  });
}

// --- The dialog ---------------------------------------------------------------------------------------

let shownId: string | null = null;
/** The simulation was running when the recap opened: resumed when it closes. */
let resumeOnClose = false;

function render(scrollTo: number | null = null): void {
  const r = findRecord(shownId);
  const dlg = $<HTMLDialogElement>('recap');
  if (!r) return dlg.close();
  const list = allRecords();
  const i = list.indexOf(r);
  const prev = list[i - 1];
  const next = list[i + 1];
  dlg.innerHTML = `
    <div class="rc-bar">
      <button type="button" class="btn" data-rc-go="${prev ? esc(prev.id) : ''}" ${prev ? '' : 'disabled'}>◀ <span class="rc-bar-lbl">${t('rcPrev')}</span></button>
      <span class="muted small">${i + 1} / ${list.length}</span>
      <button type="button" class="btn" data-rc-go="${next ? esc(next.id) : ''}" ${next ? '' : 'disabled'}><span class="rc-bar-lbl">${t('rcNext')}</span> ▶</button>
      <span class="rc-bar-gap"></span>
      ${r.replay && canReplay() ? `<button type="button" class="btn" data-rc="replay" title="${t('rcReplayHelp')}">${icon('replay')}<span class="rc-bar-lbl">${t('rcReplay')}</span></button>` : ''}
      <button type="button" class="btn" data-rc="print">${icon('print')}<span class="rc-bar-lbl">${t('rcPrint')}</span></button>
      <form method="dialog"><button class="mn-x" aria-label="${t('close')}" title="${t('close')}">✕</button></form>
    </div>
    <article class="rc-sheet" id="recap-sheet" tabindex="-1">${sheetHtml(r)}</article>
    <label class="rc-auto"><input type="checkbox" data-rc="auto" ${app.recapAuto ? 'checked' : ''}> ${t('logAuto')}</label>`;
  const sheet = $('recap-sheet');
  // Narrower than the charts (a phone): drawn again at the sheet's width, their text kept at its size.
  const chartW = Math.floor(sheet.querySelector('.rc-chart')?.getBoundingClientRect().width ?? CHART_W);
  if (chartW > 0 && chartW < CHART_W) sheet.innerHTML = sheetHtml(r, chartW);
  fitScreens(dlg);
  sheet.focus({ preventScroll: true });
  const target = scrollTo === null ? null : sheet.querySelector<HTMLElement>(`#rc-alert-${scrollTo}`);
  if (target) target.scrollIntoView({ block: 'start' });
  else sheet.scrollTop = 0;
}

/** Opens the recap of dive `id`, scrolled to its alert `alert` if given. */
export function openRecap(id: string, alert: number | null = null): void {
  const dlg = $<HTMLDialogElement>('recap');
  shownId = id;
  if (!dlg.open) {
    closeAlertBubble();
    resumeOnClose = !app.paused;
    app.paused = true;
    renderControls();
    dlg.showModal();
  }
  render(alert);
}

/** Closes the recap to replay the dive; tells whether the simulation was running before the recap opened. */
export function closeRecapForReplay(): boolean {
  const was = resumeOnClose;
  resumeOnClose = false;
  $<HTMLDialogElement>('recap').close();
  return was;
}

/** Language or units changed: the open recap follows. */
export function renderRecap(): void {
  if ($<HTMLDialogElement>('recap').open) render();
}

function printRecap(): void {
  const root = $('print-root');
  const sheet = $('recap-sheet');
  root.innerHTML = '';
  root.appendChild(sheet.cloneNode(true)); // the displays keep the scale computed on screen
  document.body.classList.add('print-recap');
  window.print();
}

export function setupRecap(): void {
  const dlg = $<HTMLDialogElement>('recap');
  dlg.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) return dlg.close();
    const el = e.target as HTMLElement;
    const go = el.closest<HTMLButtonElement>('[data-rc-go]');
    if (go && !go.disabled && go.dataset.rcGo) {
      shownId = go.dataset.rcGo;
      app.selectedDive = shownId;
      renderLog();
      render();
      return;
    }
    if (el.closest('[data-rc="print"]')) printRecap();
    else if (el.closest('[data-rc="replay"]') && shownId) startReplay(shownId);
  });
  dlg.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    if (box.dataset.rc !== 'auto') return;
    app.recapAuto = box.checked;
    savePrefs();
    renderLog();
  });
  dlg.addEventListener('close', () => {
    shownId = null;
    if (resumeOnClose) app.paused = false; // after a rescue alert too: the simulation is stopped by it anyway
    resumeOnClose = false;
    renderControls();
  });
  // The dive keys stay inactive while the recap is read; the arrows go from one dive to the next.
  dlg.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', ' ', '+', '=', '-', '0', 'Enter'].includes(e.key)) {
      e.stopPropagation();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    dlg.querySelectorAll<HTMLButtonElement>('.rc-bar [data-rc-go]')[e.key === 'ArrowLeft' ? 0 : 1]?.click();
  });
  // Turning the phone: the charts follow the sheet's new width, the reading place kept (not when only
  // the height changes, as when a phone's address bar hides).
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (!dlg.open) return;
      const top = $('recap-sheet').scrollTop;
      render();
      $('recap-sheet').scrollTop = top;
    }, 200);
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-recap');
    $('print-root').innerHTML = '';
  });
}

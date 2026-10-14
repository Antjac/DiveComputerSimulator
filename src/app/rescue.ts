// Rescue alert (session.emergency): blue beacon over the water column, simulation stopped until a
// reset. Judged on the diver's state, not on the computer (see engine/session.ts).
import { DIVE_START_DEPTH, RAPID_RATE, type EmergencyReason, type RapidAscent } from '../engine/session';
import { lang, t, type I18nKey } from '../i18n';
import { depthLabel, imperial, rateLabel, units } from '../units';
import { resetAll } from './diveControls';
import { findRecord } from './diveStore';
import { openRecap } from './recap';
import { renderControls } from './settings';
import { $, app, session } from './state';

/** "{rate} from {from} to {to} (above {max})" with the speed and depths of a rapid ascent. */
export function fillRapid(text: string, r: RapidAscent): string {
  return text
    .replace('{rate}', rateLabel(r.rate))
    .replace('{from}', depthLabel(r.fromDepth, 0))
    // Ascent judged at a stop in the last metres (palier de principe…) or at the surface.
    .replace('{to}', r.toDepth < DIVE_START_DEPTH ? t('rescueToSurface') : depthLabel(r.toDepth, 0))
    .replace('{max}', imperial() ? rateLabel(RAPID_RATE) : `${RAPID_RATE} m/min`);
}
let rescueShown = '';

export function renderRescue(): void {
  const e = session.emergency;
  $('scene-panel').classList.toggle('emergency', !!e);
  $('rescue').hidden = !e;
  // The dive cut short is in the logbook: its recap can be opened (not while it is replayed).
  $('rescue-recap').hidden = !e || !findRecord(app.selectedDive)?.entry.interrupted;
  if (!e) {
    rescueShown = '';
    return;
  }
  const key = `${lang()}|${units()}|${e.clock}`;
  if (key === rescueShown) return;
  rescueShown = key;
  renderControls();
  const line: Record<EmergencyReason, () => string> = {
    OUT_OF_AIR: () => t('rescueAirB').replace('{depth}', depthLabel(e.depth)),
    RAPID_ASCENT: () => fillRapid(t('rescueRapidB'), { rate: e.rate ?? 0, fromDepth: e.fromDepth ?? 0, toDepth: e.toDepth ?? 0 }),
    MISSED_DECO: () => t('rescueDecoB').replace('{gf}', String(Math.round(e.surfGf ?? 0))),
  };
  const title: Record<EmergencyReason, I18nKey> = { OUT_OF_AIR: 'rescueAirT', RAPID_ASCENT: 'rescueRapidT', MISSED_DECO: 'rescueDecoT' };
  $('rescue-title').textContent = e.reasons.map((r) => t(title[r])).join(' · ');
  $('rescue-body').innerHTML = e.reasons.map((r) => `<p>${line[r]()}</p>`).join('') + `<p class="muted">${t('rescueFoot')}</p>`;
}

export function setupRescue(): void {
  $('rescue-reset').addEventListener('click', () => {
    // A new dive starts running, whatever paused the simulation meanwhile (the recap, an explanation bubble).
    app.paused = false;
    resetAll();
  });
  $('rescue-recap').addEventListener('click', () => {
    if (app.selectedDive) openRecap(app.selectedDive);
  });
}

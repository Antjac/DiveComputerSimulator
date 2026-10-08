// Boat at the surface: BOAT_DELAY s after surfacing during a dive (or after the dive, until the next
// descent), a boat comes alongside and offers three choices:
// - a break on board for a chosen time: the diver climbs aboard (session.boardBoat: the dive ends,
//   the tank is refilled), the surface interval runs by, then they are put back in the water;
// - a full tank handed down in the water: the dive goes on if the diver goes back down before it is
//   closed (DIVE_END_TIMEOUT), as for the computers, whose surfacing mode lasts a few minutes;
// - carry on with the same tank: the boat leaves.
// It also leaves if the diver goes back down. Offered once per surfacing. After an ascent judged too
// fast (session.rapidAscent, the rescue alert's criterion), it first says so: the diver should start
// the procedure of their training (a teaching reminder, the procedures differ between agencies).
import { DIVE_END_TIMEOUT, DIVE_START_DEPTH } from '../engine/session';
import type { RapidAscent } from '../engine/session';
import { lang, t } from '../i18n';
import type { Lang } from '../i18n';
import { BOARD_BACK, BOARD_TIME } from '../ui/scene';
import { pressText, pressUnit } from '../units';
import { advance } from './loop';
import { refresh, scene } from './render';
import { randomJoke } from './jokes';
import { fillRapid } from './rescue';
import { $, app, session } from './state';

const BOAT_DELAY = 5; // s at the surface (simulated time)
/** Lengths of the break on board, minutes: from 15 min, longer than any computer's surfacing mode,
 *  so that every computer closes the dive. */
const BREAKS = [15, 30, 45, 60, 90, 120, 180, 240];
/** Real-time phases of the break, ms: climbing aboard (scenes' BOARD_TIME), the surface interval
 *  going by, back in the water (played BOARD_BACK times faster). */
const CLIMB_MS = BOARD_TIME * 1000;
const PAUSE_MS = 4500;
const BACK_MS = (BOARD_TIME / BOARD_BACK) * 1000;

/** ask: the three choices; aboard: break in progress; reply: a short answer before leaving. */
let boat: 'away' | 'ask' | 'aboard' | 'reply' = 'away';
let boatAsked = false;
/** Rapid ascent reported by the boat now alongside. */
let rapid: RapidAscent | null = null;
let boatTimer = 0;
let breakMin = 30;
/** Break on board: simulated seconds still to run, and the interval that runs them. */
let breakLeft = 0;
let breakTimer = 0;
/** Divers' joke shown during the break on board. */
let joke: Record<Lang, string> | null = null;

const tankText = () => `${pressText(session.tankPressure)} ${pressUnit()}`;
const durText = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h${min % 60 >= 1 ? ` ${String(Math.floor(min % 60)).padStart(2, '0')}` : ''}`);

function setBoat(state: typeof boat, text = ''): void {
  boat = state;
  scene.boatWanted = state !== 'away';
  if (app.scene3d) app.scene3d.boatWanted = scene.boatWanted;
  clearTimeout(boatTimer);
  // Time to read the answer.
  if (state === 'reply') boatTimer = window.setTimeout(() => setBoat('away'), Math.max(2600, text.length * 55));
  if (state !== 'ask') rapid = null;
  $('boat-text').textContent = text;
  $('boat-choices').hidden = state !== 'ask';
  renderBoatText();
}

/** Texts of the boat alongside (again at each refresh: the language or the units may change). */
function renderBoatText(): void {
  const warn = $('boat-warn');
  warn.hidden = !rapid;
  if (rapid) warn.textContent = fillRapid(t('boatRapid'), rapid);
  if (boat === 'ask') $('boat-text').textContent = t('boatAsk').replace('{p}', tankText());
  if (boat === 'aboard') {
    const left = breakLeft > 0 ? ` ${t('boatAboardLeft').replace('{d}', durText(Math.ceil(breakLeft / 60)))}` : '';
    $('boat-text').textContent = t('boatAboard').replace('{d}', durText(breakMin)).replace('{p}', tankText()) + left;
  }
  const j = $('boat-joke');
  j.hidden = boat !== 'aboard' || !joke;
  if (joke) j.textContent = joke[lang()];
  // Options built once: rebuilding them at each refresh while the list is open froze Chrome on macOS
  // (issue #20; the native menu is modal).
  const sel = $<HTMLSelectElement>('boat-dur');
  if (!sel.options.length) {
    sel.innerHTML = BREAKS.map((m) => `<option value="${m}">${durText(m)}</option>`).join('');
    sel.value = String(breakMin);
  }
}

/** Puts the diver aboard for `min` minutes of surface interval, shown as a short animation. */
function takeBreak(min: number): void {
  if (boat !== 'ask') return; // one break at a time
  clearInterval(breakTimer);
  breakMin = min;
  joke = randomJoke();
  session.boardBoat();
  scene.aboard = true;
  if (app.scene3d) app.scene3d.aboard = true;
  breakLeft = min * 60;
  setBoat('aboard');
  refresh(true);
  const steps = PAUSE_MS / 100;
  const chunk = breakLeft / steps;
  boatTimer = window.setTimeout(() => {
    const id = window.setInterval(() => {
      if (boat !== 'aboard') return clearInterval(id); // interrupted (reset)
      const dt = Math.min(chunk, breakLeft);
      advance(dt, 5);
      breakLeft -= dt;
      renderBoatText();
      refresh();
      if (breakLeft <= 1e-6) {
        clearInterval(id);
        backInWater();
      }
    }, 100);
    breakTimer = id;
  }, CLIMB_MS);
}

function backInWater(): void {
  breakLeft = 0;
  scene.aboard = false;
  if (app.scene3d) app.scene3d.aboard = false;
  boatTimer = window.setTimeout(() => {
    session.leaveBoat();
    boatAsked = true; // not offered again until the next descent
    setBoat('reply', t('boatBack'));
    refresh(true);
  }, BACK_MS);
}

/** Break interrupted (reset): the diver is back in the water at once. */
function cancelBreak(): void {
  clearInterval(breakTimer);
  breakLeft = 0;
  scene.aboard = false;
  if (app.scene3d) app.scene3d.aboard = false;
  session.leaveBoat();
  setBoat('away');
}

export function updateBoat(): void {
  const s = session;
  if (boat === 'aboard') {
    if (!s.aboard) cancelBreak(); // reset during the break
    return;
  }
  const underwater = s.depth >= DIVE_START_DEPTH;
  if (underwater) boatAsked = false;
  // Gone back down, rescue alert, or reset.
  if (boat === 'ask' && (underwater || s.emergency || (!s.inDive && s.lastDiveEnd === null))) setBoat('away');
  // At the surface during a dive, or after one (the dive may have been closed between two checks at
  // high time speeds).
  const surfaced = s.inDive ? s.surfaceTimer >= BOAT_DELAY : s.lastDiveEnd !== null;
  if (boat === 'away' && !boatAsked && !underwater && surfaced && !s.emergency) {
    boatAsked = true;
    rapid = s.rapidAscent;
    setBoat('ask');
  }
  if (boat === 'ask') renderBoatText();
  if (app.scene3d) {
    app.scene3d.boatWanted = scene.boatWanted; // the 3D view may have been opened since
    app.scene3d.aboard = scene.aboard;
  }
}

/** Vertical placement of the bubble, kept while nothing changes its layout: the boat rides the swell,
 *  the bubble does not (it would seem to float). */
let bubbleAt: { key: string; top: number; y: number; below: boolean; fits: boolean } | null = null;
/** Moves of the boat's anchor ignored, px: the swell; beyond (camera turned in 3D), the bubble follows. */
const BOB = 30;

/** The speech bubble points at the boat once it is alongside: above it if there is room, else below. */
export function placeBoatBubble(): void {
  const el = $('boat-offer');
  const a = boat === 'away' ? null : app.view === '3d' && app.scene3d ? app.scene3d.boatAnchor() : scene.boatAnchor();
  el.hidden = !a;
  if (!a) {
    bubbleAt = null;
    return;
  }
  const pr = $('scene-panel').getBoundingClientRect();
  const cr = $(app.view === '3d' ? 'scene3d' : 'scene').getBoundingClientRect();
  const ax = cr.left - pr.left + a.x;
  const top = cr.top - pr.top + a.top;
  const bottom = cr.top - pr.top + a.bottom;
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;
  const key = `${app.view}|${bh}|${Math.round(pr.height)}|${Math.round(cr.top - pr.top)}`;
  if (bubbleAt?.key !== key || Math.abs(top - bubbleAt.top) > BOB) {
    const below = top - 14 - bh < 8;
    const y = below ? bottom + 14 : top - 14 - bh;
    // Short water column (phones): no room above or below, the bubble stays whole, without its tail.
    const fits = y + bh <= pr.height - 8;
    bubbleAt = { key, top, y: fits ? y : Math.max(8, pr.height - bh - 8), below, fits };
  }
  const { y, below, fits } = bubbleAt;
  const x = Math.max(8, Math.min(ax - bw * 0.65, pr.width - bw - 8));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--tail', `${Math.max(14, Math.min(ax - x, bw - 14))}px`);
  el.classList.toggle('above', !below);
  el.classList.toggle('no-tail', !fits);
}

export function setupBoat(): void {
  $('boat-dur').addEventListener('change', (e) => (breakMin = Number((e.target as HTMLSelectElement).value)));
  $('boat-board').addEventListener('click', () => takeBreak(breakMin));
  $('boat-swap').addEventListener('click', () => {
    session.refillTank();
    let text = t('boatSwapReply').replace('{p}', tankText());
    if (session.inDive) text += ` ${t('boatSwapSame').replace('{m}', String(DIVE_END_TIMEOUT / 60))}`;
    setBoat('reply', text);
    refresh(true);
  });
  $('boat-stay').addEventListener('click', () => setBoat('reply', t('boatStayReply')));
}

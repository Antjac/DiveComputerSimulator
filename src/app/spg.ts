// Analog pressure gauge (rendered by render.ts into #spg-dial): small beside the computer; a click or
// a tap turns it into a floating gauge the user can drag anywhere and resize from its corner, to
// follow it next to the computer (issue #21: checking a gas planning rule during the ascent). A tap
// without moving it, or its ✕ button, puts it back. Position and size are kept for this viewer.
import { t } from '../i18n';
import { $ } from './state';

const STORE = 'divesim.spgFloat';
const MIN_W = 140;
const MARGIN = 4; // px kept inside the window

interface Float {
  x: number;
  y: number;
  w: number;
}

function load(): Float | null {
  try {
    const f = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Float | null;
    return f && [f.x, f.y, f.w].every(Number.isFinite) ? f : null;
  } catch {
    return null;
  }
}

function save(f: Float): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(f));
  } catch {
    /* storage unavailable: the gauge just opens centred next time */
  }
}

export function setupSpg(): void {
  const el = $('spg');
  const home = el.parentElement!;
  const next = el.nextSibling;
  let float: Float | null = null;

  /** Keeps the gauge inside the window and applies its position and size. */
  const place = () => {
    if (!float) return;
    const maxW = Math.max(MIN_W, Math.min(window.innerWidth, window.innerHeight) - 2 * MARGIN);
    float.w = Math.min(maxW, Math.max(MIN_W, float.w));
    el.style.width = `${float.w}px`;
    // Layout size (offsetWidth): the opening animation scales the gauge.
    float.x = Math.min(window.innerWidth - el.offsetWidth - MARGIN, Math.max(MARGIN, float.x));
    float.y = Math.min(window.innerHeight - el.offsetHeight - MARGIN, Math.max(MARGIN, float.y));
    el.style.left = `${float.x}px`;
    el.style.top = `${float.y}px`;
  };

  const open = () => {
    // In the page's body: positioned against the window, above everything else.
    document.body.appendChild(el);
    el.classList.add('big');
    el.title = t('spgFloatHelp');
    const saved = load();
    const w = saved?.w ?? Math.min(300, window.innerWidth * 0.76, window.innerHeight * 0.7);
    float = saved ?? { x: 0, y: 0, w };
    el.style.width = `${w}px`;
    if (!saved) {
      float.x = (window.innerWidth - el.offsetWidth) / 2;
      float.y = (window.innerHeight - el.offsetHeight) / 2;
    }
    place();
  };

  const close = () => {
    float = null;
    el.classList.remove('big');
    el.removeAttribute('style');
    el.title = '';
    home.insertBefore(el, next);
  };

  // Drag (anywhere on the gauge) or resize (corner handle), with the mouse or a finger.
  let drag: { mode: 'move' | 'size'; x0: number; y0: number; start: Float; moved: boolean } | null = null;
  /** The last press on the floating gauge: a tap on its face (not a drag, nor on the corner handle). */
  let tapped = false;
  el.addEventListener('pointerdown', (e) => {
    if (!float || (e.target as HTMLElement).closest('.spg-close')) return;
    e.preventDefault();
    const mode = (e.target as HTMLElement).closest('.spg-resize') ? 'size' : 'move';
    drag = { mode, x0: e.clientX, y0: e.clientY, start: { ...float }, moved: false };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || !float) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === 'move') {
      float.x = drag.start.x + dx;
      float.y = drag.start.y + dy;
    } else {
      float.w = drag.start.w + Math.max(dx, dy); // the dial stays round
    }
    place();
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    tapped = e.type === 'pointerup' && !drag.moved && drag.mode === 'move';
    if (drag.moved && float) save(float);
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('click', (e) => {
    if (!float) open();
    // ✕, or a tap without moving it: back beside the computer, as it opened.
    else if ((e.target as HTMLElement).closest('.spg-close') || tapped) close();
    tapped = false;
  });
  window.addEventListener('resize', place);
}

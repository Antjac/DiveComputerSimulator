// Resizable panes (wide screens only): the width of the water column and of the side panel, and the
// height of the profile chart under the computer, set by dragging the handles placed in the gaps
// between them; a double-click goes back to the default size. Sizes are kept with the preferences.
// The computer, the scenes and the charts already follow the size of their box.
import { savePrefs } from './prefs';
import { app, q } from './state';

/** The three-column layout (layout.css: the tablet and phone layouts stack the panes). */
const wide = window.matchMedia('(min-width: 1101px) and (min-height: 501px)');

type Pane = 'scene' | 'side' | 'profile';

/** Limits of each size (px): every pane keeps room for its content. */
const MIN = { scene: 200, side: 290, profile: 80, device: 320 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Puts the saved sizes on the page as CSS variables (layout.css), or removes them. */
export function applyPanes(): void {
  const root = (q('.app') as HTMLElement);
  const set = (name: string, v: number | undefined) => (v ? root.style.setProperty(name, `${Math.round(v)}px`) : root.style.removeProperty(name));
  set('--col-scene', app.panes.scene);
  set('--col-side', app.panes.side);
  set('--profile-h', app.panes.profile);
  root.classList.toggle('profile-sized', !!app.panes.profile);
  placeHandles();
}

const handles: Partial<Record<Pane, HTMLElement>> = {};

/** Handles in the middle of the gaps between the panes. */
function placeHandles(): void {
  const root = (q('.app') as HTMLElement);
  const on = wide.matches;
  for (const h of Object.values(handles)) h!.hidden = !on;
  if (!on) return;
  const r = root.getBoundingClientRect();
  const scene = q('.scene-area')!.getBoundingClientRect();
  const device = q('.device-panel')!.getBoundingClientRect();
  const side = q('.side-panel')!.getBoundingClientRect();
  const profile = q('.profile-box')!.getBoundingClientRect();
  const v = (h: HTMLElement, x: number, top: number, bottom: number) => {
    h.style.left = `${x - r.left}px`;
    h.style.top = `${top - r.top}px`;
    h.style.height = `${bottom - top}px`;
  };
  v(handles.scene!, (scene.right + device.left) / 2, device.top, device.bottom);
  v(handles.side!, (device.right + side.left) / 2, device.top, device.bottom);
  const p = handles.profile!;
  p.style.left = `${profile.left - r.left}px`;
  p.style.width = `${profile.width}px`;
  p.style.top = `${profile.top - r.top - 5}px`;
}

function drag(pane: Pane, e: PointerEvent): void {
  const h = handles[pane]!;
  h.setPointerCapture(e.pointerId);
  h.classList.add('dragging');
  document.body.classList.add(pane === 'profile' ? 'resizing-v' : 'resizing-h');
  const move = (ev: PointerEvent) => {
    const r = q('.app')!.getBoundingClientRect();
    const gap = 3 * 12; // room for the gaps and the padding (layout.css)
    if (pane === 'scene') {
      const side = q('.side-panel')!.getBoundingClientRect().width;
      app.panes.scene = clamp(ev.clientX - r.left - 16, MIN.scene, r.width - side - MIN.device - gap);
    } else if (pane === 'side') {
      const scene = q('.scene-area')!.getBoundingClientRect().width;
      app.panes.side = clamp(r.right - 16 - ev.clientX, MIN.side, r.width - scene - MIN.device - gap);
    } else {
      const panel = q('.device-panel')!.getBoundingClientRect();
      app.panes.profile = clamp(panel.bottom - ev.clientY, MIN.profile, panel.height - 220);
    }
    applyPanes();
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', up);
    h.removeEventListener('pointercancel', up);
    h.classList.remove('dragging');
    document.body.classList.remove('resizing-h', 'resizing-v');
    savePrefs();
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
  h.addEventListener('pointercancel', up);
}

export function setupPanes(): void {
  const root = (q('.app') as HTMLElement);
  for (const pane of ['scene', 'side', 'profile'] as Pane[]) {
    const h = document.createElement('div');
    h.className = `pane-handle ${pane === 'profile' ? 'row' : 'col'}`;
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', pane === 'profile' ? 'horizontal' : 'vertical');
    h.dataset.i18nTitle = 'paneResize'; // applyI18n (language.ts)
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      drag(pane, e);
    });
    h.addEventListener('dblclick', () => {
      delete app.panes[pane];
      applyPanes();
      savePrefs();
    });
    root.append(h);
    handles[pane] = h;
  }
  new ResizeObserver(placeHandles).observe(root);
  wide.addEventListener('change', placeHandles);
  applyPanes();
}

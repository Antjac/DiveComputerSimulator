// New versions of the app (PWA, see vite.config.ts). The service worker keeps every file of the build
// for offline use; a new version waits ('prompt' mode) instead of replacing the files of the page still
// open (in 'autoUpdate' mode an open page lost its lazy three.js chunk: "3D view unavailable").
// The browser looks for a new version on each page load; an app left open on a phone is only resumed,
// so it is also looked for when the app comes back to the foreground, and every hour.
// The live dive is not saved: a new version is put in by itself only when nothing would be lost (no dive
// since the page was loaded, no replay, exercise or guided tour); otherwise a banner offers it.
import { registerSW } from 'virtual:pwa-register';
import { exerciseBusy } from './exercises';
import { tourRunning } from './guidedTour';
import { $, app, session } from './state';

let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;

/** Reloading loses nothing: no dive (nor its surface interval) since the page was loaded. */
const safe = (): boolean =>
  !session.inDive && session.surfaceInterval === null && !app.replaying && !exerciseBusy() && !tourRunning();

function offer(): void {
  if (!waiting || !apply) return;
  if (safe()) {
    void apply(true);
    return;
  }
  $('update-bar').hidden = false;
  // In or after a dive, the banner says that the dive in memory will be lost.
  $('update-lose').hidden = !(session.inDive || session.surfaceInterval !== null);
}

export function setupUpdate(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true;
      offer();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => void reg.update().catch(() => {}); // offline: next time
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (waiting) offer();
        else check();
      });
    },
  });
  $('update-apply').addEventListener('click', () => void apply?.(true));
  $('update-later').addEventListener('click', () => ($('update-bar').hidden = true));
}

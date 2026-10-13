// "Install the app" button of the welcome notice (the app is a PWA, see vite.config.ts).
// Android / desktop Chrome and Edge: the browser's own install prompt (beforeinstallprompt).
// iPhone / iPad: Safari has no such API, so the button shows the steps to follow. Hidden once installed.
import { $ } from './state';

/** The event is not in lib.dom.ts. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** iPadOS 13+ presents itself as a Mac, with a touch screen. */
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

function render(): void {
  $('install-open').hidden = standalone() || !(deferred || isIos());
}

export function setupInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keeps the prompt for the button
    deferred = e as InstallPromptEvent;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    render();
  });
  $('install-open').addEventListener('click', async () => {
    if (deferred) {
      const ev = deferred;
      deferred = null; // a prompt can be used once
      await ev.prompt();
      await ev.userChoice;
      render();
    } else {
      $<HTMLDialogElement>('install-help').showModal();
    }
  });
  $('install-help-ok').addEventListener('click', () => $<HTMLDialogElement>('install-help').close());
  render();
}

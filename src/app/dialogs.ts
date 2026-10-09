// First-visit notice and "About" dialog.
import { startTour } from './guidedTour';
import { renderControls } from './settings';
import { $, app } from './state';

/**
 * Notice shown on every page load: educational use, approximated algorithms, no affiliation. Time is
 * paused while it is shown.
 */
export function showIntro(): void {
  const dlg = $<HTMLDialogElement>('intro');
  const wasPaused = app.paused;
  app.paused = true;
  renderControls();
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // must be acknowledged with the button
  const close = () => {
    dlg.close();
    app.paused = wasPaused;
    renderControls();
  };
  $('intro-ok').addEventListener('click', close);
  $('intro-tour').addEventListener('click', () => {
    close();
    startTour();
  });
  dlg.showModal();
}

export function setupDialogs(): void {
  // Opens at the top: the autofocused Close button, at the bottom, would otherwise scroll the dialog down.
  const openAbout = () => {
    const dlg = $<HTMLDialogElement>('about');
    dlg.showModal();
    dlg.scrollTop = 0;
  };
  $('about-open').addEventListener('click', openAbout);
  // "Terms of use" links (welcome notice, Settings tab): the About dialog, opened at the top too.
  document.querySelectorAll<HTMLAnchorElement>('[data-terms]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openAbout();
  }));
  // Close when clicking the backdrop.
  $('about').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $<HTMLDialogElement>('about').close();
  });
}

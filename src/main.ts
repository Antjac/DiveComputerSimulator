// Entry point: restores the preferences, wires the interface modules (src/app/), then starts the
// simulation. Each module only declares at load time; everything runs from here, in this order.
import './style.css';
import { setupAlertHelp } from './app/alertHelp';
import { setupSound } from './app/alertSounds';
import { setupBackup } from './app/backup';
import { setupBoat } from './app/boat';
import { setupSpg } from './app/spg';
import { setupCompare } from './app/compare';
import { installDevHook } from './app/devHook';
import { showIntro, setupDialogs } from './app/dialogs';
import { setupInstall } from './app/install';
import { setupModelInfo } from './app/modelInfo';
import { setupExercises } from './app/exercises';
import { setView, setupDiveControls } from './app/diveControls';
import { setupDevice } from './app/device';
import { setupTour } from './app/guidedTour';
import { applyI18n, setupLanguage } from './app/language';
import { loadRecords } from './app/diveStore';
import { renderLog, setupLogbook } from './app/logbook';
import { setupMn90 } from './app/mn90';
import { startLoop } from './app/loop';
import { applyPrefs } from './app/prefs';
import { onDiveClosed, resetRecapTrack, setupRecap } from './app/recap';
import { refresh } from './app/render';
import { setupReplay } from './app/replay';
import { setupRescue } from './app/rescue';
import { renderControls, setupSettings } from './app/settings';
import { app, computers, session } from './app/state';
import { setupTabs } from './app/tabs';
import { setupTissues } from './app/tissues';
import { setupUpdate } from './app/update';
import { setupPanes } from './app/panes';

applyPrefs();

session.on((e) => {
  // A dive cut short by the rescue alert is not over for the computers (the simulation just stops): only the logbook hears of it.
  if (e !== 'interrupt') {
    for (const c of computers) {
      if (e === 'start') c.onDiveStart(session);
      else c.onDiveEnd(session);
    }
  }
  if (e === 'start') resetRecapTrack();
  // The recap once the step is over: the MN90 tracker sees the dive end right after the session.
  if (e === 'end') queueMicrotask(() => onDiveClosed());
  if (e === 'interrupt') queueMicrotask(() => onDiveClosed(session.interruptedEntry));
  renderControls();
});

setupSettings();
setupDiveControls();
setupDialogs();
setupInstall();
setupModelInfo();
setupLanguage();
setupTabs();
setupTour();
setupDevice();
setupTissues();
setupLogbook();
setupCompare();
setupMn90();
setupExercises();
setupRescue();
setupBoat();
setupSpg();
setupSound();
setupAlertHelp();
setupRecap();
setupReplay();
setupBackup();
setupUpdate();
setupPanes();
if (import.meta.env.DEV) installDevHook();

applyI18n();
refresh(true);
void loadRecords().then(() => {
  renderLog();
  refresh();
});
showIntro();
if (app.view === '3d') void setView('3d');
startLoop();

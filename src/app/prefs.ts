// Preferences saved in the browser: computer and its settings, dive parameters, view.
import type { Environment } from '../ui/scene3d';
import { setUnits, units, type UnitSystem } from '../units';
import { DECO_GASES, ENVS, STAGES, TANKS, applyDecoGases, applyTank } from './options';
import { $, app, computers, session } from './state';

export interface Prefs {
  computer: string;
  settings: Record<string, Record<string, string>>;
  o2: number;
  site: number;
  units: UnitSystem;
  tank: string;
  decoO2?: number[];
  stage?: string;
  rmv: number;
  transmitter: boolean;
  spgWithTx: boolean;
  rescue: boolean;
  view: '2d' | '3d';
  env: Environment;
  advanced: boolean;
  sound: boolean;
  tips: boolean;
  alertHelp: 'off' | 'bubble' | 'pause';
  alertHelpMuted: string[];
  recapAuto: boolean;
}

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem('divesim.prefs') ?? '{}');
  } catch {
    return {};
  }
}

/** The preferences as they are now (what savePrefs() writes, and what a backup file holds). */
export function currentPrefs(): Prefs {
  return {
    computer: app.active.id,
    settings: Object.fromEntries(computers.map((c) => [c.id, c.settings])),
    o2: Math.round(session.backGas.o2 * 100),
    decoO2: app.decoO2,
    stage: app.stageId,
    site: session.siteDepth,
    units: units(),
    tank: app.tankId,
    rmv: session.rmv,
    transmitter: session.transmitterOn,
    spgWithTx: app.spgWithTx,
    rescue: session.rescueAlert,
    view: app.view,
    env: app.env,
    advanced: $<HTMLDetailsElement>('advanced').open,
    sound: app.sound,
    tips: app.tips,
    alertHelp: app.alertHelp,
    alertHelpMuted: app.alertHelpMuted,
    recapAuto: app.recapAuto,
  };
}

export function savePrefs(): void {
  storePrefs(currentPrefs());
}

/** Writes preferences to the browser (read back by applyPrefs() on the next page load). */
export function storePrefs(prefs: Partial<Prefs>): void {
  try {
    localStorage.setItem('divesim.prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Preferences read from a backup file (app/backup.ts): only the known fields, with the right types.
 * The values themselves (a computer, a setting option, a tank…) are checked by applyPrefs() as at
 * every page load. null: nothing usable.
 */
export function cleanPrefs(v: unknown): Partial<Prefs> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (k: string) => typeof o[k] === 'string' && (out[k] = (o[k] as string).slice(0, 100));
  const bool = (k: string) => typeof o[k] === 'boolean' && (out[k] = o[k]);
  const num = (k: string, min: number, max: number) => typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= min && (o[k] as number) <= max && (out[k] = o[k]);
  ['computer', 'units', 'tank', 'stage', 'view', 'env', 'alertHelp'].forEach(str);
  ['transmitter', 'spgWithTx', 'rescue', 'advanced', 'sound', 'tips', 'recapAuto'].forEach(bool);
  num('o2', 5, 100);
  num('site', 1, 200);
  num('rmv', 5, 60);
  if (Array.isArray(o.decoO2)) out.decoO2 = o.decoO2.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, 4);
  if (Array.isArray(o.alertHelpMuted)) out.alertHelpMuted = o.alertHelpMuted.filter((x) => typeof x === 'string').slice(0, 500);
  if (o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings)) {
    const settings: Record<string, Record<string, string>> = {};
    for (const [id, vals] of Object.entries(o.settings as Record<string, unknown>)) {
      if (!vals || typeof vals !== 'object' || Array.isArray(vals)) continue;
      settings[id] = Object.fromEntries(Object.entries(vals as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
    out.settings = settings;
  }
  return Object.keys(out).length ? (out as Partial<Prefs>) : null;
}

/** Restores the saved preferences (at start). */
export function applyPrefs(): void {
  const prefs = loadPrefs();
  for (const c of computers) {
    const saved = prefs.settings?.[c.id];
    if (saved) for (const def of c.settingDefs) if (def.options.some((o) => o.value === saved[def.key])) c.settings[def.key] = saved[def.key];
  }
  app.active = computers.find((c) => c.id === prefs.computer) ?? app.active;
  if (prefs.o2) session.gas = { o2: prefs.o2 / 100, he: 0 };
  if (prefs.site) session.siteDepth = prefs.site;
  app.tankId = TANKS.some((k) => k.id === prefs.tank) ? prefs.tank! : '12-200';
  if (prefs.units === 'imperial') setUnits('imperial');
  if (prefs.rmv) session.rmv = prefs.rmv;
  if (prefs.transmitter === false) session.transmitterOn = false;
  app.spgWithTx = prefs.spgWithTx === true; // off unless chosen
  session.rescueAlert = prefs.rescue === true; // off unless chosen
  applyTank();
  app.stageId = STAGES.some((k) => k.id === prefs.stage) ? prefs.stage! : '7-200';
  app.decoO2 = (prefs.decoO2 ?? []).filter((o2) => DECO_GASES.includes(o2));
  applyDecoGases();
  app.view = prefs.view === '3d' ? '3d' : '2d';
  app.env = ENVS.some((e) => e.id === prefs.env) ? prefs.env! : 'reef';
  $<HTMLDetailsElement>('advanced').open = prefs.advanced === true;
  app.sound = prefs.sound === true;
  app.tips = prefs.tips !== false; // on unless turned off
  app.alertHelp = prefs.alertHelp === 'off' || prefs.alertHelp === 'pause' ? prefs.alertHelp : 'bubble'; // bubble unless changed
  app.recapAuto = prefs.recapAuto !== false; // on unless turned off
  app.alertHelpMuted = Array.isArray(prefs.alertHelpMuted) ? prefs.alertHelpMuted.filter((a) => typeof a === 'string') : [];
}

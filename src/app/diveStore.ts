// Logbook saved in the browser: every closed dive with what its recap shows (app/recap.ts), kept across
// page loads in IndexedDB (screens of the computer make it too big for localStorage), exported and
// imported with the configuration (app/backup.ts). Without IndexedDB (private browsing in some
// browsers) the logbook lives in memory only. Records are separate from session.log, the physical
// state the computers read (it starts empty with fresh tissues on every page load).
import type { AlarmCode, Bi } from '../computers/base';
import type { Gas } from '../engine/buhlmann';
import type { Mn90Dive } from '../engine/mn90';
import type { DiveLogEntry, ProfileSample, RapidAscent } from '../engine/session';

/** An alert shown by the computer during the dive, with its explanation in both languages. */
export interface RecAlert {
  /** Dive time (s) and depth (m) when it appeared. */
  t: number;
  depth: number;
  severity: 'crit' | 'serious' | 'warn' | 'info';
  /** The common alarm it is (generic explanation in i18n.ts), if any. */
  code: AlarmCode | null;
  /** Name of the computer that showed it. */
  computer: string;
  /** The alert as the device shows it, or its name when the device shows no wording. */
  screenText?: string;
  title?: Bi;
  /** The model's own explanation and advice (its alertExplain(), from its manual). */
  what?: Bi;
  todo?: Bi;
  /** The computer's display when the alert appeared (its HTML). */
  screen?: string;
}

/** What the recap's "key points" are drawn from, gathered during the dive (app/recap.ts). */
export interface RecFacts {
  /** Safety stop: requested by the computer and completed, requested but not completed, or never requested. */
  safety: 'done' | 'missed' | null;
  /** Mandatory stops at some point of the dive, and the longest time to surface (min). */
  deco: boolean;
  ttsMax: number;
  /** Time spent above the computer's ceiling (s). */
  ceilingSec: number;
  /** The computer locked itself. */
  locked: boolean;
  /** Ascent judged too fast by the simulator (session.rapidAscent). */
  rapid: RapidAscent | null;
  /** Highest SurfGF when the diver surfaced (%): over 100 % stops were missed. */
  surfGfOut: number;
}

export interface DiveRecord {
  id: string;
  /** When the dive was closed (ms since 1970, the browser's clock: the simulated clock restarts on every page load). */
  savedAt: number;
  entry: DiveLogEntry;
  computer: { id: string; name: string; algorithm: string; settings: { label: Bi; value: Bi }[] };
  /** The computer's gradient factors at the end of the dive (%). */
  gfLow: number;
  gfHigh: number;
  alerts: RecAlert[];
  /** The 16 compartments when the dive was closed, Tissues tab scale (surface): below 0, tissue
   *  pressure relative to atmospheric (%); above, % of the M-value gradient. */
  tissues: number[];
  facts: RecFacts;
  /** The dive in the MN90 tables (consecutive immersions merged), and whether deco gases were carried. */
  mn90: { dive: Mn90Dive; decoGases: boolean } | null;
}

const DB_NAME = 'divesim';
const STORE = 'dives';

let records: DiveRecord[] = [];
let db: IDBDatabase | null = null;

/** The dives, oldest first. */
export function allRecords(): readonly DiveRecord[] {
  return records;
}

export function findRecord(id: string | null): DiveRecord | null {
  return records.find((r) => r.id === id) ?? null;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function sortRecords(): void {
  records.sort((a, b) => a.savedAt - b.savedAt);
}

/** Reads the saved logbook (at start). */
export async function loadRecords(): Promise<void> {
  db = await openDb();
  if (!db) return;
  const saved = await new Promise<unknown[]>((resolve) => {
    try {
      const req = db!.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  // Dives closed while the database was opening are kept.
  const known = new Set(records.map((r) => r.id));
  for (const raw of saved) {
    const r = cleanRecord(raw);
    if (r && !known.has(r.id)) records.push(r);
  }
  sortRecords();
}

function write(fn: (store: IDBObjectStore) => void): void {
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    fn(tx.objectStore(STORE));
  } catch {
    /* storage unavailable or full: the dive stays in memory */
  }
}

export function addRecord(r: DiveRecord): void {
  records.push(r);
  sortRecords();
  write((s) => s.put(r));
}

export function clearRecords(): void {
  records = [];
  write((s) => s.clear());
}

/** Whether the logbook is saved in the browser (false: memory only). */
export function persistent(): boolean {
  return !!db;
}

export function newRecordId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Adds the dives of a backup file (those already in the logbook, or unreadable, are skipped). */
export function importDives(list: unknown[]): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const raw of list) {
    const r = cleanRecord(raw);
    if (!r || records.some((x) => x.id === r.id)) {
      skipped++;
      continue;
    }
    records.push(r);
    write((s) => s.put(r));
    added++;
  }
  sortRecords();
  return { added, skipped };
}

// --- Checking what is read back (a file may have been edited, or come from someone else) -----------

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 4000) : undefined);
const bi = (v: unknown): Bi | undefined => {
  const o = v as Bi | null;
  return o && typeof o === 'object' && typeof o.fr === 'string' && typeof o.en === 'string' ? { fr: o.fr.slice(0, 4000), en: o.en.slice(0, 4000) } : undefined;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const gas = (v: unknown): Gas => {
  const g = (v ?? {}) as Partial<Gas>;
  return { o2: Math.min(1, Math.max(0, num(g.o2, 0.21))), he: Math.min(1, Math.max(0, num(g.he, 0))) };
};
const ALARMS: AlarmCode[] = ['ASCENT', 'ASCENT_WARN', 'CEILING', 'PPO2_HIGH', 'CNS', 'NDL_LOW', 'DECO', 'LOCKED', 'LOW_GAS', 'OUT_OF_GAS', 'STAGE_EMPTY'];

/** Elements a computer's display never uses and that could load or run something. */
const BAD_TAGS = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'style', 'form', 'input',
  'textarea', 'select', 'img', 'image', 'picture', 'video', 'audio', 'source', 'track', 'foreignobject', 'animate', 'set',
  'animatemotion', 'animatetransform', 'a', 'use', 'portal', 'template']);

/** Keeps a stored display harmless: no script, no event handler, no external resource. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (el: Element): void => {
    for (const child of [...el.children]) {
      if (BAD_TAGS.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value.toLowerCase();
        const external = /url\(\s*['"]?(?!#)/.test(v) || v.includes('javascript:') || v.includes('data:') || v.includes('@import');
        if (n.startsWith('on') || ((n === 'href' || n.endsWith(':href') || n === 'src' || n === 'srcset') && !v.startsWith('#')) || external) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(tpl.content as unknown as Element);
  return tpl.innerHTML;
}

function cleanSample(v: unknown): ProfileSample {
  const p = (v ?? {}) as Partial<ProfileSample>;
  const s: ProfileSample = { t: num(p.t), depth: num(p.depth), ceiling: num(p.ceiling) };
  if (typeof p.gf99 === 'number') s.gf99 = num(p.gf99);
  if (typeof p.surfGf === 'number') s.surfGf = num(p.surfGf);
  return s;
}

function cleanAlert(v: unknown): RecAlert | null {
  const a = (v ?? {}) as Partial<RecAlert>;
  const severity = (['crit', 'serious', 'warn', 'info'] as const).find((s) => s === a.severity);
  if (!severity) return null;
  return {
    t: num(a.t),
    depth: num(a.depth),
    severity,
    code: ALARMS.find((c) => c === a.code) ?? null,
    computer: str(a.computer) ?? '',
    screenText: str(a.screenText),
    title: bi(a.title),
    what: bi(a.what),
    todo: bi(a.todo),
    screen: typeof a.screen === 'string' && a.screen ? sanitizeHtml(a.screen.slice(0, 400_000)) : undefined,
  };
}

function cleanMn90(v: unknown): DiveRecord['mn90'] {
  const o = v as { dive?: Partial<Mn90Dive>; decoGases?: unknown } | null;
  const d = o?.dive;
  if (!o || !d || typeof d !== 'object') return null;
  const s = d.successive as Partial<NonNullable<Mn90Dive['successive']>> | null | undefined;
  const gps = typeof s?.gps === 'string' && /^[A-P*]$/.test(s.gps) ? (s.gps as NonNullable<Mn90Dive['successive']>['gps']) : null;
  return {
    decoGases: o.decoGases === true,
    dive: {
      start: num(d.start),
      end: d.end === null ? null : num(d.end),
      immersions: Math.max(1, Math.round(num(d.immersions, 1))),
      maxDepth: num(d.maxDepth),
      eqDepth: num(d.eqDepth),
      gas: gas(d.gas),
      nitrox: d.nitrox === true,
      trimix: d.trimix === true,
      seconds: num(d.seconds),
      successive: s && typeof s === 'object'
        ? { gps, interval: num(s.interval), column: typeof s.column === 'number' ? Math.round(s.column) : null, n: typeof s.n === 'number' ? s.n : null }
        : null,
      divesBefore24h: num(d.divesBefore24h),
      rapid: typeof d.rapid === 'number' ? d.rapid : null,
      frozenAt: typeof d.frozenAt === 'number' ? d.frozenAt : null,
    },
  };
}

/** A well-formed record from what was read back, or null. */
function cleanRecord(v: unknown): DiveRecord | null {
  const r = v as Partial<DiveRecord> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.entry || typeof r.entry !== 'object') return null;
  const e = r.entry as Partial<DiveLogEntry>;
  const c = (r.computer ?? {}) as Partial<DiveRecord['computer']>;
  const f = (r.facts ?? {}) as Partial<RecFacts>;
  const rapid = f.rapid as Partial<RapidAscent> | null | undefined;
  const entry: DiveLogEntry = {
    number: Math.round(num(e.number, 1)),
    start: num(e.start),
    duration: num(e.duration),
    maxDepth: num(e.maxDepth),
    avgDepth: num(e.avgDepth),
    gas: gas(e.gas),
    decoGases: arr(e.decoGases).map(gas),
    gasesUsed: arr(e.gasesUsed).map(gas),
    minTemp: num(e.minTemp, 20),
    surfaceIntervalBefore: typeof e.surfaceIntervalBefore === 'number' ? num(e.surfaceIntervalBefore) : null,
    profile: arr(e.profile).slice(0, 50_000).map(cleanSample),
    cnsEnd: num(e.cnsEnd),
    tankStart: num(e.tankStart),
    tankEnd: num(e.tankEnd),
    gasUsed: num(e.gasUsed),
    alarms: arr(e.alarms).filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 200)),
  };
  return {
    id: r.id.slice(0, 100),
    savedAt: num(r.savedAt),
    entry,
    computer: {
      id: str(c.id) ?? '',
      name: str(c.name) ?? '',
      algorithm: str(c.algorithm) ?? '',
      settings: arr(c.settings).flatMap((x) => {
        const o = x as { label?: unknown; value?: unknown };
        const label = bi(o?.label);
        const value = bi(o?.value);
        return label && value ? [{ label, value }] : [];
      }),
    },
    gfLow: num(r.gfLow),
    gfHigh: num(r.gfHigh),
    alerts: arr(r.alerts).slice(0, 500).map(cleanAlert).filter((a): a is RecAlert => !!a),
    tissues: arr(r.tissues).slice(0, 16).map((x) => num(x)),
    facts: {
      safety: f.safety === 'done' || f.safety === 'missed' ? f.safety : null,
      deco: f.deco === true,
      ttsMax: num(f.ttsMax),
      ceilingSec: num(f.ceilingSec),
      locked: f.locked === true,
      rapid: rapid && typeof rapid === 'object' ? { rate: num(rapid.rate), fromDepth: num(rapid.fromDepth), toDepth: num(rapid.toDepth) } : null,
      surfGfOut: num(f.surfGfOut),
    },
    mn90: cleanMn90(r.mn90),
  };
}

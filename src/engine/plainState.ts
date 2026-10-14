// State of an object (the session, a computer) as plain data and back: the replay of a dive (app/replay.ts)
// starts from the state the session and the computers were in when the descent began, and puts the live
// state back afterwards. The data survives the logbook's storage (IndexedDB) and the JSON backup:
// Infinity, sets, maps and typed arrays become tagged objects.

/** Keys never read from stored data: they would reach the prototype chain. */
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** Deepest nesting kept; anything deeper (or cyclic) is left out. */
const MAX_DEPTH = 10;

/** A value that cannot be stored as data (function, cycle…): its whole key is left out. */
class NotPlain extends Error {}

type Tagged = { $: 'num'; v: 'inf' | '-inf' | 'nan' } | { $: 'set'; v: unknown[] } | { $: 'map'; v: [unknown, unknown][] } | { $: 'f64'; v: number[] };

function enc(v: unknown, depth: number, seen: Set<object>): unknown {
  switch (typeof v) {
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new NotPlain();
    case 'undefined':
      return undefined;
    case 'number':
      if (Number.isFinite(v)) return v;
      return { $: 'num', v: Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf' } satisfies Tagged;
    case 'object': {
      if (v === null) return null;
      if (depth > MAX_DEPTH || seen.has(v)) throw new NotPlain();
      seen.add(v);
      try {
        if (v instanceof Float64Array) return { $: 'f64', v: Array.from(v) } satisfies Tagged;
        if (v instanceof Set) return { $: 'set', v: [...v].map((x) => enc(x, depth + 1, seen) ?? null) } satisfies Tagged;
        if (v instanceof Map) return { $: 'map', v: [...v].map(([k, x]) => [enc(k, depth + 1, seen) ?? null, enc(x, depth + 1, seen) ?? null] as [unknown, unknown]) } satisfies Tagged;
        if (Array.isArray(v)) return v.map((x) => enc(x, depth + 1, seen) ?? null);
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
          if (UNSAFE.has(k)) continue;
          const e = enc(x, depth + 1, seen);
          if (e !== undefined) out[k] = e;
        }
        return out;
      } finally {
        seen.delete(v);
      }
    }
    default:
      return v;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function dec(v: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH + 2) return null;
  if (Array.isArray(v)) return v.map((x) => dec(x, depth + 1));
  if (!isRecord(v)) return v;
  switch (v.$) {
    case 'num':
      return v.v === 'inf' ? Infinity : v.v === '-inf' ? -Infinity : NaN;
    case 'set':
      return new Set(Array.isArray(v.v) ? v.v.map((x) => dec(x, depth + 1)) : []);
    case 'map':
      return new Map(Array.isArray(v.v) ? v.v.filter(Array.isArray).map((p) => [dec(p[0], depth + 1), dec(p[1], depth + 1)] as [unknown, unknown]) : []);
    case 'f64':
      return new Float64Array(Array.isArray(v.v) ? v.v.map((x) => (typeof x === 'number' ? x : 0)) : []);
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!UNSAFE.has(k)) out[k] = dec(x, depth + 1);
  return out;
}

/** The own fields of `obj` as plain data, except `skip`; a field holding a function (anywhere inside) is left out. */
export function plainState(obj: object, skip: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k) || UNSAFE.has(k)) continue;
    try {
      const e = enc(v, 0, new Set());
      if (e !== undefined) out[k] = e;
    } catch (err) {
      if (!(err instanceof NotPlain)) throw err;
    }
  }
  return out;
}

const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof Set ? 'set' : v instanceof Map ? 'map' : v instanceof Float64Array ? 'f64' : typeof v);

/** Instance of a class (Tissues…): data is merged into it, to keep its methods. */
const isInstance = (v: unknown): v is object => isRecord(v) && Object.getPrototypeOf(v) !== Object.prototype && !(v instanceof Set) && !(v instanceof Map) && !(v instanceof Float64Array);

/**
 * Puts stored data back into `target`. Only fields `target` already has and that are not methods are
 * written, with a value of the same kind: stored data (a backup file) cannot add or replace code.
 */
export function applyState(target: object, data: Record<string, unknown>, skip: readonly string[] = []): void {
  merge(target, dec(data) as Record<string, unknown>, skip);
}

/** `data` is already decoded. */
function merge(target: object, data: Record<string, unknown>, skip: readonly string[]): void {
  const t = target as Record<string, unknown>;
  for (const [k, val] of Object.entries(data)) {
    if (UNSAFE.has(k) || skip.includes(k) || !(k in t) || typeof t[k] === 'function') continue;
    const cur = t[k];
    if (isInstance(cur) && isRecord(val) && isPlainRecord(val)) merge(cur, val, []);
    else if (cur === null || cur === undefined || val === null || kind(cur) === kind(val)) t[k] = val;
  }
}

/** A decoded object (not a set, a map or a typed array). */
const isPlainRecord = (v: Record<string, unknown>): boolean => !(v instanceof Set) && !(v instanceof Map) && !(v instanceof Float64Array);

/** Whether `v` could come out of plainState (a stored object is checked before it is trusted): plain JSON data of bounded size. */
export function looksPlain(v: unknown, budget = { n: 400_000 }, depth = 0): boolean {
  if (--budget.n < 0 || depth > MAX_DEPTH + 2) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => looksPlain(x, budget, depth + 1));
  if (isRecord(v)) return Object.entries(v).every(([k, x]) => !UNSAFE.has(k) && looksPlain(x, budget, depth + 1));
  return false;
}

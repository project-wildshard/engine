import * as v from 'valibot';
import { saves } from '../../../shared/engine/saves/runtime';
import type { SaveScope, SaveSlot } from '../../../shared/engine/saves/store';

export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export const jsonSchema: v.GenericSchema<unknown, Json> = v.lazy(() => v.union([v.null(), v.string(), v.pipe(v.number(), v.finite()), v.boolean(), v.array(jsonSchema), v.record(v.string(), jsonSchema)]));
export const jsonRecord: v.RecordSchema<v.StringSchema<undefined>, v.GenericSchema<unknown, Json>, undefined> = v.record(v.string(), jsonSchema);
const jsonArray: v.ArraySchema<v.GenericSchema<unknown, Json>, undefined> = v.array(jsonSchema);
/** Own keys valibot's record leaves out of its output: a value holding one goes through the schema. */
const DROPPED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);
/** `value` is JSON that `jsonSchema` passes unchanged: null, a string, a boolean, a finite number, or a plain array or object
 *  of such values (no holes, no class instances, none of `DROPPED_KEYS`). False is only "ask the schema". Allocates nothing. */
export function plainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    for (let i = 0; i < value.length; i++) if (!(i in value) || !plainJson(value[i])) return false;
    return true;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const key in value) {
    if (!Object.hasOwn(value, key) || DROPPED_KEYS.has(key) || !plainJson((value as Record<string, unknown>)[key])) return false;
  }
  return true;
}
const plainJsonRecord = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value) && plainJson(value);
const plainJsonArray = (value: unknown): boolean => Array.isArray(value) && plainJson(value);
const slots = new Map<string, SaveSlot<Json>>();
export function jsonSlot(key: string, scope: SaveScope, initial: () => Json = () => null, schema: v.GenericSchema<unknown, Json> = jsonSchema): SaveSlot<Json> {
  const id = `${scope}/${key}`;
  const found = slots.get(id); if (found) return found;
  // MG10 (J410): the JSON schemas' writes take the allocation-free check first (`SaveKeyDef.accepts`)
  const accepts = schema === jsonSchema ? plainJson : schema === jsonRecord ? plainJsonRecord : schema === jsonArray ? plainJsonArray : undefined;
  const slot = saves.define({ key, scope, version: 1, schema, initial, ...accepts === undefined ? {} : { accepts } }); slots.set(id, slot); return slot;
}
const strings = new Set(['perf.probe', 'perf.rec', 'perf.lap', 'resume.shot', 'boot.selfReload', 'boot.staleBuild']);
const records = new Set(['settings', 'gfx', 'ui.fold', 'ktx2set', 'boot.times']);
const arrays = new Set(['hints', 'debug.open', 'boot.reports', 'err.queue', 'err.reloads', 'gpu.reloads', 'review.queue']);
const global = ['settings', 'gfx', 'hints', 'review', 'review.queue'];
const session = ['life.alive', 'life.hid', 'err.session', 'err.reloads', 'gpu.reloads', 'resume.shot', 'resume.brand', 'clearDownloads.report', 'titleArrival', 'loadAttempt', 'boot.selfReload', 'boot.staleBuild', 'boot.lowPower', 'boot.force-cache.j383'];
const device = ['devMode', 'debug.open', 'ui.fold', 'perf.probe', 'perf.rec', 'perf.lap', 'ktx2set', 'boot.times', 'life.lastUnload', 'life.lastEnd', 'life.alive.once', 'boot.trace', 'boot.reports', 'err.queue', 'titleArrival.once', 'storage.persisted'];
for (const [scope, keys] of [['global', global], ['session', session], ['device', device]] as const) for (const key of keys) {
  const schema = strings.has(key) ? v.nullable(v.string()) : records.has(key) ? jsonRecord : arrays.has(key) ? jsonArray : key === 'devMode' || key === 'storage.persisted' ? v.boolean() : jsonSchema;
  jsonSlot(key, scope, () => records.has(key) ? {} : arrays.has(key) ? [] : key === 'devMode' || key === 'storage.persisted' ? false : null, schema);
}
/** String codec for injected diagnostics APIs. Values still validate and persist through defined SaveSlots. */
export function saveStorage(scope: 'global' | 'device' | 'session'): { getItem: (key: string) => string | null; setItem: (key: string, raw: string) => void; removeItem: (key: string) => void } {
  const resolve = (key: string): { slot: SaveSlot<Json>; suffix: string | undefined } => {
    const separator = key.indexOf(':');
    const name = separator === -1 ? key : key.slice(0, separator), suffix = separator === -1 ? undefined : key.slice(separator + 1);
    const slot = slots.get(`${scope}/${name}`);
    if (!slot) throw new Error(`Undefined save key ${scope}/${name}`);
    return { slot, suffix };
  };
  return {
    getItem: (key) => { const { slot, suffix } = resolve(key); const whole = slot.read(); const data = suffix === undefined ? whole : typeof whole === 'object' && whole !== null && !Array.isArray(whole) ? whole[suffix] ?? null : null;
      return data === null ? null : strings.has(key) || key.startsWith('ui.fold:') || key.startsWith('ktx2set:') ? typeof data === 'string' ? data : JSON.stringify(data) : key === 'devMode' ? data === true ? '1' : null : JSON.stringify(data); },
    // MG10 (J410): JSON.parse yields only JSON values, and `slot.write` validates them against the slot's schema before it
    // keeps anything (a non-finite number from an overflowing literal is refused there). Parsing it with `jsonSchema` here
    // too made every boot-trace write validate its record twice: ~80 MB of garbage on Nine's boot.
    setItem: (key, raw) => { const { slot, suffix } = resolve(key); const data: Json = key === 'devMode' ? raw === '1' : strings.has(key) || key.startsWith('ui.fold:') || key.startsWith('ktx2set:') ? raw : JSON.parse(raw) as Json;
      let persisted: boolean;
      if (suffix === undefined) persisted = slot.write(data); else { const whole = slot.read(); persisted = slot.write({ ...(typeof whole === 'object' && whole !== null && !Array.isArray(whole) ? whole : {}), [suffix]: data }); }
      if (!persisted) throw new Error('Save storage unavailable or full'); },
    removeItem: (key) => { const { slot, suffix } = resolve(key); if (suffix === undefined) slot.reset(); else { const whole = slot.read(); if (typeof whole === 'object' && whole !== null && !Array.isArray(whole)) { delete whole[suffix]; slot.write(whole); } } },
  };
}

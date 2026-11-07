import * as v from 'valibot';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { TIER } from '@wildshard/engine/core/tier';
import { timeClientPreparation } from './preparationTiming';
import { HomeGeometrySnapshotSchema, homeGeometryBytes, restoreHomeGeometry, snapshotHomeGeometry,
  type HomeGeometryView, type HomeGeometrySnapshot } from './homeGeometrySnapshot';

declare const __BUILD_ID__: string;
/** One home's completed static geometry: at most 64 MiB of payload and 256 entries, shared across all builds. */
export const HOME_BUILD_CACHE_BYTES: number = 64 * 1024 * 1024;
const homes = new WeakMap<Shardfile, string>();
const size = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(HOME_BUILD_CACHE_BYTES));
const metadata = v.strictObject({ identity: v.string(), bytes: size, entries: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(256)) });
const record = v.strictObject({ identity: v.string(), bytes: size, snapshot: HomeGeometrySnapshotSchema });
let database: Promise<IDBDatabase | null> | undefined;

/** The composition root calls this only for its actual Home instance, never a neighbour. */
export function bindHomeBuildCache(source: Shardfile): void {
  if (typeof __BUILD_ID__ !== 'string' || typeof indexedDB === 'undefined') return;
  homes.set(source, JSON.stringify([__BUILD_ID__, source.identity.slug, source.identity.revision, TIER]));
}

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('ws-built-home-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('geometry'); };
      request.onerror = () => { resolve(null); };
      request.onblocked = () => { resolve(null); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    } catch { resolve(null); }
  });
  return database;
}
function requestValue(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { const result: unknown = request.result; resolve(result); };
    request.onerror = () => { reject(request.error ?? new Error('Home cache request failed')); };
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve(); };
    transaction.onerror = transaction.onabort = () => { reject(transaction.error ?? new Error('Home cache transaction failed')); };
  });
}

/** A small key census prevents speculative wire reads for already built Home models. Corrupt/missing entries still refill normally. */
export function homeBuildGeometryKeys(source: Shardfile | undefined): Promise<ReadonlySet<string>> | undefined {
  const identity = source === undefined ? undefined : homes.get(source);
  return identity === undefined ? undefined : readKeys(identity);
}
async function readKeys(identity: string): Promise<ReadonlySet<string>> {
  try {
    const db = await open(); if (db === null) return new Set();
    const transaction = db.transaction('geometry', 'readonly'), store = transaction.objectStore('geometry');
    const done = completed(transaction);
    const values = await Promise.allSettled([requestValue(store.get('identity')), requestValue(store.getAllKeys()), done]);
    const [head, keys] = values;
    if (values.some(result => result.status === 'rejected') || head?.status !== 'fulfilled' || keys?.status !== 'fulfilled') return new Set();
    const meta = v.safeParse(metadata, head.value);
    return meta.success && meta.output.identity === identity && Array.isArray(keys.value)
      ? new Set(keys.value.filter((key): key is string => typeof key === 'string')) : new Set();
  } catch { return new Set(); }
}

/** Reads are optional acceleration only. Wrong-build, unavailable or malformed records use the original verified decoder. */
export async function readHomeBuildGeometry(source: Shardfile, key: string): Promise<Map<string, HomeGeometryView> | null> {
  const identity = homes.get(source); if (identity === undefined) return null;
  try {
    const db = await open(); if (db === null) return null;
    const transaction = db.transaction('geometry', 'readonly'), store = transaction.objectStore('geometry');
    const done = completed(transaction);
    const values = await Promise.allSettled([requestValue(store.get('identity')), requestValue(store.get(key)), done]);
    const [head, value] = values;
    if (values.some(result => result.status === 'rejected') || head?.status !== 'fulfilled' || value?.status !== 'fulfilled') return null;
    const meta = v.safeParse(metadata, head.value), row = v.safeParse(record, value.value);
    if (!meta.success || !row.success || meta.output.identity !== identity || row.output.identity !== identity
      || meta.output.bytes > HOME_BUILD_CACHE_BYTES || row.output.bytes !== homeGeometryBytes(row.output.snapshot)) return null;
    const restored = await timeClientPreparation(source.identity.slug, key.startsWith('whole:') ? 'home.cache.whole' : 'home.cache.owned', () => restoreHomeGeometry(row.output.snapshot));
    return restored;
  } catch { return null; }
}

async function write(identity: string, key: string, snapshot: HomeGeometrySnapshot): Promise<void> {
  const bytes = homeGeometryBytes(snapshot) + key.length * 2;
  if (bytes > HOME_BUILD_CACHE_BYTES || key.length > 16384) return;
  const db = await open(); if (db === null) return;
  const transaction = db.transaction('geometry', 'readwrite'), store = transaction.objectStore('geometry'), done = completed(transaction);
  try {
    const prior = v.safeParse(metadata, await requestValue(store.get('identity')));
    let total = 0, entries = 0;
    if (prior.success && prior.output.identity === identity) { total = prior.output.bytes; entries = prior.output.entries; }
    else store.clear(); // One Home, one build/profile. Older records never accumulate.
    const previous = v.safeParse(record, await requestValue(store.get(key)));
    if (previous.success && previous.output.identity === identity) { total -= previous.output.bytes + key.length * 2; entries--; }
    if (total + bytes <= HOME_BUILD_CACHE_BYTES && entries < 256) {
      store.put({ identity, bytes: homeGeometryBytes(snapshot), snapshot }, key);
      store.put({ identity, bytes: total + bytes, entries: entries + 1 }, 'identity');
    }
    await done;
  } catch { await done.catch(() => undefined); }
}

/** Snapshot only successful completed construction; quota/private-mode failures never change loading or ownership. */
export async function saveHomeBuildGeometry(source: Shardfile, key: string, views: ReadonlyMap<string, HomeGeometryView>): Promise<void> {
  const identity = homes.get(source); if (identity === undefined) return;
  const snapshot = snapshotHomeGeometry(views); if (snapshot === null) return;
  await write(identity, key, snapshot).catch(() => undefined);
}

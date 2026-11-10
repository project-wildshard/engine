// J130: where a server's saves live on a page. A session outgrows localStorage at its first cell, so the server's documents
// are in IndexedDB; this file is also what Settings reaches for them, because New Game and export must see what the server saw.
import type { ImportReport, SaveStorage } from '../../../shared/engine/saves/store';
import { installedIdentity, saveEpoch } from '../../../shared/engine/app/identity';
import { deviceIdentity } from '../../../shared/engine/net/identity';

/** A server's saves on a page: the same documents localStorage would hold. */
export interface IndexedSaves { readonly storage: SaveStorage; readonly write: (key: string, value: string | null) => Promise<boolean>; readonly close?: () => void }
/** The database the page's server keeps its saves in. */
export const SERVER_SAVES = 'wildshard-saves';
const epochDatabase = (epoch: number): string => epoch === 0 ? SERVER_SAVES : `${SERVER_SAVES}@${epoch}`;
/** Cached older builds cannot enumerate the current epoch's database. */
export function serverSaveDatabase(prefix: string | undefined = installedIdentity()?.savePrefix): string {
  return epochDatabase(saveEpoch(prefix));
}
/** The database an earlier row kept them in, apart from the real saves. Nothing reads it now. */
const RETIRED_SAVES = 'wildshard-worker-saves';
const SAVES = 'saves';
const requested = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = (): void => { resolve(request.result); };
  request.onerror = (): void => { reject(request.error ?? new Error('Save storage refused')); };
});

/** Every save document under `prefix`, to pre-fill the worker's storage (§6.3.3). */
export function saveDocuments(storage: SaveStorage, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index), value = key === null ? null : storage.getItem(key);
    if (key?.startsWith(prefix) === true && value !== null) out[key] = value;
  }
  return out;
}

/** Read every save at boot, so a page starts a worker with them as it does from localStorage; a write is durable when its transaction commits. */
export async function openIndexedSaves(name: string): Promise<IndexedSaves> {
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = (): void => { opening.result.createObjectStore(SAVES); };
  const database = await requested(opening), reading = database.transaction(SAVES).objectStore(SAVES);
  const [keys, values] = await Promise.all([requested(reading.getAllKeys()), requested(reading.getAll())]);
  const documents = new Map<string, string>();
  keys.forEach((key, index) => { const value: unknown = values[index]; if (typeof key === 'string' && typeof value === 'string') documents.set(key, value); });
  const write = (key: string, value: string | null): Promise<boolean> => new Promise(resolve => {
    if (value === null) documents.delete(key); else documents.set(key, value);
    const transaction = database.transaction(SAVES, 'readwrite', { durability: 'strict' }), store = transaction.objectStore(SAVES);
    if (value === null) store.delete(key); else store.put(value, key);
    // Now, not when the put's answer comes back: once the storage process holds the commit, a killed page no longer stops it.
    transaction.commit();
    transaction.oncomplete = (): void => { resolve(true); };
    transaction.onerror = transaction.onabort = (): void => { resolve(false); };
  });
  const app = installedIdentity();
  if (name === serverSaveDatabase() && saveEpoch() > 0 && app?.identityPrefix !== undefined) {
    const key = `device:${app.identityPrefix}identity`;
    if (!documents.has(key)) {
      // The key namespace is stable; its newest record lives with the preceding epoch's saves.
      const previous = await openIndexedSaves(epochDatabase(saveEpoch() - 1));
      try {
        const identity = previous.storage.getItem(key);
        if (identity !== null && !await write(key, identity)) throw new Error('Device identity carry failed');
      } finally { previous.close?.(); }
    }
  }
  return { write, close: () => database.close(), storage: { get length() { return documents.size; }, key: index => [...documents.keys()][index] ?? null, getItem: key => documents.get(key) ?? null,
    setItem: (key, value) => { void write(key, value); }, removeItem: key => { void write(key, null); } } };
}

/** Marks a store as holding the page's saves. It sits outside the prefix, because no server reads it. */
const IMPORTED = 'imported-page-saves';
/**
 * Copy a page's saves in, once, so a server opens the session the page had. The copy leaves the page's alone. A key the store has already
 * stands: it is newer. A failed write leaves the mark off, and the next boot finishes the job. The earlier row's database goes with it.
 */
export async function importPageSaves({ storage, write }: IndexedSaves, page: SaveStorage, prefix: string): Promise<void> {
  if (storage.getItem(IMPORTED) !== null) return;
  const held = saveDocuments(page, prefix), wrote = await Promise.all(Object.entries(held).map(async ([key, value]) => storage.getItem(key) !== null || await write(key, value)));
  if (!wrote.every(Boolean)) return;
  await write(IMPORTED, '1');
  if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(RETIRED_SAVES);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether a site document names a place: a grid's session stands in one cell, and that cell's New Game moves it home. */
function siteNames(raw: string | null, instance: string): boolean {
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw), keys = isRecord(parsed) ? parsed['keys'] : null, entry = isRecord(keys) ? keys['continuationSite'] : null;
    return isRecord(entry) && isRecord(entry['data']) && entry['data']['site'] === instance;
  } catch { return false; }
}
/** One site document's place and save count, or null for one that is absent or unreadable. */
function siteRow(raw: unknown): { readonly tick: number; readonly site: string | null } | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw), keys = isRecord(parsed) ? parsed['keys'] : null, entry = isRecord(keys) ? keys['continuationSite'] : null;
    const data = isRecord(entry) ? entry['data'] : null, tick = isRecord(data) ? data['tick'] : null, site = isRecord(data) ? data['site'] : undefined;
    return typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 0 && (site === null || typeof site === 'string') ? { tick, site } : null;
  } catch { return null; }
}
/**
 * SR4: where the grid session's durable continuation stands, newest first, from its two site documents (`siteDocuments('grid')` in
 * src/server/host/standalone/continuation.ts). Two reads, not the whole store: a page asks this before it trusts its own place after
 * an unexpected end, because Chromium can lose a killed page's newest localStorage writes while these commit strictly. The server's
 * schema is its own (client ↛ server), so this read is looser: it keeps every document the server could boot from, and maybe more.
 */
export async function readServerSites(prefix: string = installedIdentity()?.savePrefix ?? '', name: string = serverSaveDatabase(prefix)): Promise<{ readonly tick: number; readonly site: string | null }[]> {
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = (): void => { opening.result.createObjectStore(SAVES); };
  const database = await requested(opening);
  try {
    const store = database.transaction(SAVES).objectStore(SAVES);
    const raws = await Promise.all(['standalonesite-grid', 'standalonesitealt-grid'].map(doc => requested(store.get(`${prefix}${doc}`))));
    return raws.flatMap(raw => { const row = siteRow(raw); return row === null ? [] : [row]; }).sort((a, b) => b.tick - a.tick);
  } finally { database.close(); }
}
/**
 * New Game on a server's saves: every continuation that holds this instance, and any site that stands in it. Run the same reset over the
 * instance's own document first; it keeps what New Game keeps.
 */
export async function forgetServerInstance({ storage, write }: IndexedSaves, prefix: string, instance: string): Promise<boolean> {
  const own = new Set([`standalone-${instance}`, `standalonealt-${instance}`, `standalone-lone-${instance}`, `standalonealt-lone-${instance}`, `standalonesite-lone-${instance}`, `standalonesitealt-lone-${instance}`]);
  const gone = Object.entries(saveDocuments(storage, prefix)).filter(([key, value]) => {
    const name = key.slice(prefix.length);
    return own.has(name.replace(/\.corrupt\..*$/u, '')) || (name.startsWith('standalonesite') && siteNames(value, instance));
  });
  return (await Promise.all(gone.map(([key]) => write(key, null)))).every(Boolean);
}

/** Every server document, as a page's export writes its own. A save file is one file, whichever store it came from. */
export async function exportServerSaves(prefix: string, format: string): Promise<string> {
  const { storage } = await openIndexedSaves(serverSaveDatabase(prefix)), docs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saveDocuments(storage, prefix))) {
    const scope = key.slice(prefix.length);
    if (scope !== 'device' && scope !== 'session' && !scope.includes('.corrupt.')) docs[scope] = JSON.parse(value); // as a page's export leaves them out
  }
  return JSON.stringify({ format, version: 2, saveEpoch: saveEpoch(prefix), server: true, exported: new Date().toISOString(), docs }, null, 2);
}
let stopServer: () => void = () => undefined;
/** The running server, which would write over an import at its next save. */
export function serverStopsForImport(stop: () => void): () => void {
  stopServer = stop;
  return () => { if (stopServer === stop) stopServer = (): void => undefined; };
}
/** A page's store: it holds what a page's file needs checked and migrated. */
export interface PageSaves { readonly importAll: (json: string) => ImportReport; readonly storage: SaveStorage | null }
/**
 * A file exported before the flip. The page's store checks and migrates it key by key, as it always did, and its documents go where a first
 * boot's `importPageSaves` puts them. The server keeps a world it has already saved over any page document, so that world goes too, and the
 * next boot takes the player's progress from these documents as a first boot does.
 */
async function importPageFile(json: string, prefix: string, page: PageSaves): Promise<ImportReport> {
  const report = page.importAll(json), { storage } = page;
  const scopes = [...new Set(report.imported.map(identity => identity.slice(0, identity.indexOf('/'))))];
  if (scopes.length === 0 || storage === null) return report;
  stopServer();
  const saves = await openIndexedSaves(serverSaveDatabase(prefix));
  for (const scope of scopes) {
    const doc = storage.getItem(`${prefix}${scope}`);
    if (doc === null || !await saves.write(`${prefix}${scope}`, doc) || !await forgetServerInstance(saves, prefix, scope)) return { imported: [], skipped: [...report.skipped, { key: scope, reason: 'Storage unavailable or full' }] };
  }
  await saves.write(IMPORTED, '1');
  return report;
}
/** Take a file back. A server's export comes back whole: a world's continuation is only readable by the server, which reads it next boot. */
export async function importServerSaves(json: string, prefix: string, format: string, page: PageSaves): Promise<ImportReport> {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || value['format'] !== format || !isRecord(value['docs'])) return { imported: [], skipped: [{ key: '*', reason: 'Unknown save format' }] };
  if ((value['saveEpoch'] ?? 0) !== saveEpoch(prefix)) return { imported: [], skipped: [{ key: '*', reason: 'Save belongs to another progress epoch' }] };
  if (value['server'] !== true) return importPageFile(json, prefix, page);
  stopServer();
  const saves = await openIndexedSaves(serverSaveDatabase(prefix)), rows = Object.entries(value['docs']);
  const app = installedIdentity(), rebind = app?.savePrefix === prefix ? app.importPlayerDocument : undefined;
  const player = rebind === undefined ? null : deviceIdentity(saves.storage, prefix).player;
  const wrote = await Promise.all(rows.map(async ([scope, doc]) => saves.write(`${prefix}${scope}`, JSON.stringify(rebind === undefined || player === null ? doc : await rebind(doc, player)))));
  await saves.write(IMPORTED, '1');
  return { imported: rows.flatMap(([scope], index) => wrote[index] === true ? [scope] : []), skipped: rows.flatMap(([scope], index) => wrote[index] === true ? [] : [{ key: scope, reason: 'Storage unavailable or full' }]) };
}

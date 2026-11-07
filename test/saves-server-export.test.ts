// Settings' export and import at the flip: the server's store is the only one, so its file is the only file. A round trip keeps what the
// server wrote and leaves out what a page's export leaves out. A file from before the flip goes through the page's own checks and takes the
// place of the world the server had, so its next boot starts from the file as a first boot does.
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as v from 'valibot';
import { exportServerSaves, importServerSaves, openIndexedSaves, SERVER_SAVES, serverStopsForImport } from '../src/client/engine/saves/indexed';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { installSaveEnvironment } from '../src/shared/engine/saves/environment';
import { SaveStore, type SaveStorage } from '../src/shared/engine/saves/store';

/** The little of IndexedDB a save store uses: one object store of strings, every transaction committing on the next task. */
function fakeIndexedDb(): { rows: Map<string, string>; api: unknown } {
  const rows = new Map<string, string>();
  const done = <T>(result: () => T): { result: T | undefined; onsuccess: (() => void) | null; onerror: (() => void) | null } => {
    const request: { result: T | undefined; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: undefined, onsuccess: null, onerror: null };
    queueMicrotask(() => { request.result = result(); request.onsuccess?.(); }); return request;
  };
  const transaction = (): unknown => {
    const row: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; commit: () => void; objectStore: () => unknown } = { oncomplete: null, onerror: null, onabort: null, commit: () => undefined, objectStore: () => ({
      getAllKeys: () => done(() => [...rows.keys()]), getAll: () => done(() => [...rows.values()]),
      put: (value: string, key: string) => { rows.set(key, value); }, delete: (key: string) => { rows.delete(key); } }) };
    setTimeout(() => { row.oncomplete?.(); }, 0); return row;
  };
  return { rows, api: { deleteDatabase: () => undefined, open: () => {
    const request = done(() => ({ transaction, objectStoreNames: { contains: () => true } }));
    return Object.assign(request, { onupgradeneeded: null });
  } } };
}
const NO_PAGE = { importAll: () => { throw new Error('A server file needs no page'); }, storage: null };
let fake: ReturnType<typeof fakeIndexedDb>;
beforeEach(() => { fake = fakeIndexedDb(); Reflect.set(globalThis, 'indexedDB', fake.api); });
afterEach(() => { Reflect.deleteProperty(globalThis, 'indexedDB'); });

test('an export carries the server\'s documents, and an import puts them back whole', async () => {
  const saves = await openIndexedSaves(SERVER_SAVES);
  await saves.write('ws.global', '{"keys":{"a":1}}'); await saves.write('ws.standalone-pine', '{"tick":40}');
  await saves.write('ws.device', '{"keys":{"mine":1}}'); await saves.write('ws.session', '{}'); await saves.write('ws.global.corrupt.1', '{}'); await saves.write('other.global', '{}');
  const file = await exportServerSaves('ws.', 'wildshard');
  const parsed = JSON.parse(file) as { format: string; version: number; server: boolean; docs: Record<string, unknown> };
  expect(parsed).toMatchObject({ format: 'wildshard', version: 2, server: true });
  expect(parsed.docs).toEqual({ global: { keys: { a: 1 } }, 'standalone-pine': { tick: 40 } });
  fake.rows.clear();
  const report = await importServerSaves(file, 'ws.', 'wildshard', NO_PAGE);
  expect(report.imported.sort()).toEqual(['global', 'standalone-pine']); expect(report.skipped).toEqual([]);
  expect(JSON.parse(fake.rows.get('ws.standalone-pine') ?? 'null')).toEqual({ tick: 40 });
  expect(fake.rows.has('imported-page-saves'), 'the page\'s copy is not run over it next boot').toBe(true);
});

test('a file of another format changes nothing', async () => {
  const report = await importServerSaves(JSON.stringify({ format: 'other', server: true, docs: { global: {} } }), 'ws.', 'wildshard', NO_PAGE);
  expect(report.skipped).toEqual([{ key: '*', reason: 'Unknown save format' }]); expect(fake.rows.size).toBe(0);
});

class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
test('a page\'s file from before the flip imports through the page\'s checks, and the world it replaces goes', async () => {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'ws.', saveFormat: 'wildshard', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  installSaveEnvironment({ storage: () => null, persistent: () => true, persist: () => Promise.resolve(true) });
  const local = new PageStorage(), store = new SaveStore({ local, session: local }), flags = store.define({ key: 'flags', scope: 'shard', version: 2, schema: v.array(v.string()), initial: () => [], migrate: { 1: old => [...(old as string[]), 'migrated'] } });
  const page = { importAll: (file: string) => store.importAll(file), storage: local };
  const saves = await openIndexedSaves(SERVER_SAVES);
  for (const name of ['ws.standalone-pine', 'ws.standalonealt-pine', 'ws.standalone-lone-pine', 'ws.standalone-nalati']) await saves.write(name, '{"tick":40}');
  let stopped = 0; const release = serverStopsForImport(() => { stopped++; });
  const file = JSON.stringify({ format: 'wildshard', version: 2, build: 'old', exported: 'then', docs: { pine: { keys: { flags: { v: 1, data: ['chapter.done'] }, gone: { v: 1, data: 1 } } } } });
  try {
    const report = await importServerSaves(file, 'ws.', 'wildshard', page);
    expect(report.imported).toEqual(['pine/flags']); expect(report.skipped).toEqual([{ key: 'pine/gone', reason: 'Unknown key or invalid entry' }]);
    expect(stopped, 'a running server would save over it').toBe(1);
    expect(flags.read('pine')).toEqual(['chapter.done', 'migrated']);
    expect(JSON.parse(fake.rows.get('ws.pine') ?? 'null')).toMatchObject({ keys: { flags: { v: 2, data: ['chapter.done', 'migrated'] } } });
    expect([...fake.rows.keys()].filter(key => key.includes('standalone')), 'another world stays').toEqual(['ws.standalone-nalati']);
    expect(fake.rows.has('imported-page-saves')).toBe(true);

    const refused = await importServerSaves(JSON.stringify({ format: 'wildshard', version: 2, docs: { device: { keys: {} } } }), 'ws.', 'wildshard', page);
    expect(refused.imported).toEqual([]); expect(stopped, 'nothing to take: the server plays on').toBe(1);
  } finally { release(); }
});

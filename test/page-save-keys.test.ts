import { expect, test } from 'vitest';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { installSaveEnvironment } from '../src/shared/engine/saves/environment';
import { SaveStore, type SaveStorage } from '../src/shared/engine/saves/store';
import { definePageSaveKeys } from '../src/client/game/pageSaveKeys';
import { buildingSave } from '../src/shared/game/shardfile/buildingDoor';

class Local implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
test('a file from before the flip keeps what only a server reads, on a page that opens none of it', () => {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'ws.', saveFormat: 'wildshard', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  installSaveEnvironment({ storage: () => null, persistent: () => true, persist: () => Promise.resolve(true) });
  const local = new Local(), store = new SaveStore({ local, session: local });
  definePageSaveKeys(store);
  const keys = { 'platform.continuation': { v: 1, data: { flags: ['door'] } }, 'platform.encounters': { v: 1, data: { boss: { defeated: true } } },
    'platform.region': { v: 1, data: { revision: 3, snapshot: null } }, 'platform.runtime-logical': { v: 1, data: { revision: 3, actors: [] } } };
  const report = store.importAll(JSON.stringify({ format: 'wildshard', version: 2, build: 'old', exported: 'then', docs: { 'pastel-plain': { keys } } }));
  expect(report.skipped).toEqual([]);
  expect(new Set(report.imported)).toEqual(new Set(Object.keys(keys).map(key => `pastel-plain/${key}`)));
  expect(JSON.parse([...local.items.values()].find(doc => doc.includes('platform.region')) ?? 'null')).toMatchObject({ keys });
});
test('a page on a shard that reads a key still takes it over, and a file for another shard keeps it', () => {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'ws.', saveFormat: 'wildshard', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  installSaveEnvironment({ storage: () => null, persistent: () => true, persist: () => Promise.resolve(true) });
  const local = new Local(), store = new SaveStore({ local, session: local });
  definePageSaveKeys(store);
  const doors = { 'platform.buildings': { v: 1, data: { cabins: { doors: [] } } }, 'platform.grid-position': { v: 1, data: null }, 'platform.runtime-state': { v: 1, data: null } };
  const before = store.importAll(JSON.stringify({ format: 'wildshard', version: 2, build: 'old', exported: 'then', docs: { 'pine-hollow': { keys: doors } } }));
  expect(before.skipped).toEqual([]);
  expect(() => { store.define(buildingSave); }).not.toThrow();
});

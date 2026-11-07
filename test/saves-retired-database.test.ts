import { afterEach, expect, test, vi } from 'vitest';
import { importPageSaves, type IndexedSaves } from '../src/client/engine/saves/indexed';
import type { SaveStorage } from '../src/shared/engine/saves/store';

// SESSION's unverified list: the row's earlier database goes once a page's saves are safely in the new one, and not before.
const page = (): SaveStorage => { const rows = new Map([['ws.global', '{}']]); return { get length() { return rows.size; }, key: at => [...rows.keys()][at] ?? null, getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); } }; };
function store(ok: boolean): IndexedSaves {
  const storage = page();
  storage.removeItem('ws.global');
  return { storage, write: (key, value) => { if (ok && value !== null) storage.setItem(key, value); return Promise.resolve(ok); } };
}
afterEach(() => { Reflect.deleteProperty(globalThis, 'indexedDB'); });

test('the old database goes once the copy has landed', async () => {
  const deleteDatabase = vi.fn(); Reflect.set(globalThis, 'indexedDB', { deleteDatabase });
  await importPageSaves(store(true), page(), 'ws');
  expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith('wildshard-worker-saves');
});

test('a copy that failed keeps it', async () => {
  const deleteDatabase = vi.fn(); Reflect.set(globalThis, 'indexedDB', { deleteDatabase });
  await importPageSaves(store(false), page(), 'ws');
  expect(deleteDatabase).not.toHaveBeenCalled();
});

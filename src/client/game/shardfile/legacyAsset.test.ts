import { expect, test, vi } from 'vitest';
import { legacyAsset } from './legacyAsset';
import { readAsset } from './readAsset';
import { ASSET_CACHE_NAME } from '@wildshard/engine/pwa/cacheNames';

const hash = 'a'.repeat(64), url = `https://cache.test/shardfiles/world/blobs/bin/${hash}.bin`;
function fixture() {
  const stores = new Map<string, Map<string, Response>>(), opened: string[] = [];
  const address = (input: RequestInfo | URL): string => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const storage = {
    keys: () => Promise.resolve([...stores.keys()]),
    open: (name: string) => {
      opened.push(name);
      return Promise.resolve({ match: (input: RequestInfo | URL) => Promise.resolve(stores.get(name)?.get(address(input))?.clone()),
        put: (input: RequestInfo | URL, response: Response) => {
          let rows = stores.get(name); if (rows === undefined) { rows = new Map(); stores.set(name, rows); }
          rows.set(address(input), response.clone()); return Promise.resolve();
        } });
    },
  };
  return { stores, opened, storage };
}

test('offline old hash bytes migrate once to their native URL without changing the old cache', async () => {
  const f = fixture(), bytes = new Uint8Array([7, 8, 9]);
  const oldKey = `https://cache.test/__ws_content__/v0/${hash}`;
  f.stores.set('ws-content-v0', new Map([[oldKey, new Response(bytes)]]));
  const read = vi.fn(() => legacyAsset(f.storage, url, hash));
  const result = await readAsset(url, 3, { fetch: () => Promise.reject(new TypeError('Offline')),
    legacy: { read, store: f.storage } });
  expect(result).toEqual(bytes); expect(read).toHaveBeenCalledTimes(1);
  expect([...f.stores.keys()].sort()).toEqual([ASSET_CACHE_NAME, 'ws-content-v0'].sort());
  const old = f.stores.get('ws-content-v0')?.get(oldKey);
  if (old === undefined) throw new Error('Old offline bytes were removed');
  expect(new Uint8Array(await old.clone().arrayBuffer())).toEqual(bytes);
  const migrated = f.stores.get(ASSET_CACHE_NAME)?.get(url);
  if (migrated === undefined) throw new Error('Missing canonical migration');
  expect(new Uint8Array(await migrated.arrayBuffer())).toEqual(bytes);
});

test('native hits never open, enumerate or hash legacy storage', async () => {
  const read = vi.fn(() => Promise.reject(new Error('No legacy work on native hit')));
  const f = fixture();
  expect(await readAsset(url, 1, { fetch: () => Promise.resolve(new Response(new Uint8Array([5]))), legacy: { read, store: f.storage } }))
    .toEqual(new Uint8Array([5]));
  expect(read).not.toHaveBeenCalled(); expect(f.opened).toEqual([]);
});

test('a visited root must name the exact current index hash before offline migration', async () => {
  const f = fixture(), root = 'https://cache.test/shardfiles/world/shard.json?v=aaaaaaaa';
  const key = 'https://cache.test/shardfiles/world/__visited_shardfile__';
  const source = { format: 'wildshard.shardfile', formatVersion: 2, identity: { slug: 'old-visit' } };
  f.stores.set('ws-shardfile-products-v2', new Map([[key, Response.json({ firstParty: true, source, validation: { indexHash: 'b'.repeat(64) } })]]));
  expect(await legacyAsset(f.storage, root, hash)).toBeUndefined();
  f.stores.get('ws-shardfile-products-v2')?.set(key, Response.json({ firstParty: true, source, validation: { indexHash: hash } }));
  const bytes = await readAsset(root, undefined, { fetch: () => Promise.reject(new TypeError('Offline')),
    legacy: { read: () => legacyAsset(f.storage, root, hash), store: f.storage } });
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(source);
  expect(f.stores.get(ASSET_CACHE_NAME)?.has(root)).toBe(true);
});

test('migration does not create missing old caches or scan their body keys', async () => {
  const f = fixture(); expect(await legacyAsset(f.storage, url, hash)).toBeUndefined();
  expect(f.opened).toEqual([]); expect(f.stores.size).toBe(0);
});

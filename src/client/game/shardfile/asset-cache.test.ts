import { expect, test, vi } from 'vitest';
import { assetCacheName } from '@wildshard/engine/pwa/cacheNames';
import { cachedAsset, hasCachedAsset } from './assetCache';

const address = `https://cache.test/assets/grid-road/${'a'.repeat(64)}.bin`;
function fixture(response: () => Response | undefined) {
  const match = vi.fn((_input: RequestInfo | URL, _options?: CacheQueryOptions) => Promise.resolve(response()));
  const cache: Cache = {
    match, put: () => Promise.reject(new Error('Unexpected write')),
    add: () => Promise.reject(new Error('Unexpected fetch')), addAll: () => Promise.reject(new Error('Unexpected fetches')),
    delete: () => Promise.reject(new Error('Unexpected deletion')), keys: () => Promise.reject(new Error('Unexpected inventory')),
    matchAll: () => Promise.reject(new Error('Unexpected bodies')),
  };
  const open = vi.fn((_name: string) => Promise.resolve(cache));
  return { match, open };
}

test('direct reads select only the original cache and retain owned complete body bytes', async () => {
  const body = Uint8Array.of(0, 128, 255), old = fixture(() => { throw new Error('Unexpected cache reopen'); });
  const match = vi.fn((_input: RequestInfo | URL, _options?: MultiCacheQueryOptions) => Promise.resolve(new Response(body)));
  const storage = { open: old.open, match };
  const first = await cachedAsset(storage, address, 3);
  expect(first).toEqual(body); first?.fill(7);
  expect(await cachedAsset(storage, address, 3)).toEqual(body);
  expect(match).toHaveBeenCalledTimes(2);
  for (const call of match.mock.calls) expect(call).toEqual([address, { cacheName: assetCacheName(), ignoreVary: true }]);
  expect(old.open).not.toHaveBeenCalled();
});

test('a direct miss stays a miss rather than searching another cache or fetching', async () => {
  const old = fixture(() => new Response(Uint8Array.of(99)));
  const match = vi.fn(() => Promise.resolve(undefined)), storage = { open: old.open, match };
  expect(await cachedAsset(storage, address, 1)).toBeNull(); expect(await hasCachedAsset(storage, address)).toBe(false);
  expect(match).toHaveBeenCalledTimes(2); expect(old.open).not.toHaveBeenCalled();
});

test('open-only hosts and refused direct queries keep the original read and presence ports', async () => {
  for (const direct of ['absent', 'reject', 'accessor'] as const) {
    const old = fixture(() => new Response(Uint8Array.of(5, 6)));
    const storage = direct === 'absent' ? { open: old.open } : { open: old.open, get match(): CacheStorage['match'] {
      if (direct === 'accessor') throw new Error('Direct port unavailable');
      return () => Promise.reject(new Error('Direct query unavailable'));
    } };
    expect(await cachedAsset(storage, address, 2)).toEqual(Uint8Array.of(5, 6));
    expect(await hasCachedAsset(storage, address)).toBe(true);
    expect(old.open.mock.calls).toEqual([[assetCacheName()], [assetCacheName()]]);
    expect(old.match.mock.calls).toEqual([[address, { ignoreVary: true }], [address, { ignoreVary: true }]]);
  }
});

test('direct reads retain status, truncation, oversized-body and storage refusals', async () => {
  const old = fixture(() => { throw new Error('Unexpected fallback after a completed query'); });
  for (const response of [() => new Response(Uint8Array.of(1, 2), { status: 206 }),
    () => new Response(Uint8Array.of(1)), () => new Response(Uint8Array.of(1, 2, 3))]) {
    expect(await cachedAsset({ open: old.open, match: () => Promise.resolve(response()) }, address, 2)).toBeNull();
  }
  const refused = { open: () => Promise.reject(new Error('Storage denied')), match: () => Promise.reject(new Error('Storage denied')) };
  expect(await cachedAsset(refused, address, 2)).toBeNull(); expect(await hasCachedAsset(refused, address)).toBe(false);
  expect(old.open).not.toHaveBeenCalled();
});

test('presence checks and invalid body reads still cancel the native response stream', async () => {
  for (const [status, presence] of [[200, true], [206, false]] as const) {
    let cancelled = 0;
    const storage = { ...fixture(() => undefined), match: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      cancel: () => { cancelled++; },
    }), { status })) };
    expect(await hasCachedAsset(storage, address)).toBe(presence); expect(cancelled).toBe(1);
  }
  let cancelled = 0;
  const storage = { ...fixture(() => undefined), match: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
    start: controller => { controller.enqueue(Uint8Array.of(1, 2, 3)); }, cancel: () => { cancelled++; },
  }))) };
  expect(await cachedAsset(storage, address, 2)).toBeNull(); expect(cancelled).toBe(1);
});

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ASSET_CACHE_NAME } from '../pwa/cacheNames';
import { publishBootResponse } from './bootCache';

let restore = (): void => undefined;
beforeEach(() => {
  const previous = ['caches', 'location'].map(key => ({key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key)}));
  restore = () => {for (const {key, descriptor} of previous) {if (descriptor === undefined) Reflect.deleteProperty(globalThis, key); else Object.defineProperty(globalThis, key, descriptor);}};
});
afterEach(() => { restore(); });
function disk() {
  const entries = new Map<string, Uint8Array>();
  const put = vi.fn(async (path: string, response: Response) => {entries.set(path, new Uint8Array(await response.arrayBuffer()));});
  const open = vi.fn(() => Promise.resolve({put}));
  Object.defineProperty(globalThis, 'caches', {configurable: true, value: {open}});
  Object.defineProperty(globalThis, 'location', {configurable: true, value: new URL('https://boot-cache.test/')});
  return {entries, put, open};
}

test('a complete uncontrolled part publishes exact native bytes at its shared absolute URL without a digest', async () => {
  const f = disk(), bytes = Uint8Array.of(0, 1, 127, 128, 254, 255), path = '/assets/packs/test.phone-1234abcd.bin';
  const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('No write digest'));
  try {
    await publishBootResponse(path, new Response(bytes));
    expect(f.open).toHaveBeenCalledExactlyOnceWith(ASSET_CACHE_NAME); expect(f.put).toHaveBeenCalledOnce();
    expect(f.entries.get(new URL(path, location.href).href)).toEqual(bytes); expect(digest).not.toHaveBeenCalled();
  } finally { digest.mockRestore(); }
});

test('quota refusal consumes its publication copy without rejecting the complete read', async () => {
  const f = disk(), response = new Response(Uint8Array.of(1, 2));
  f.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  await expect(publishBootResponse('/assets/packs/test.phone-1234abcd.bin', response)).resolves.toBeUndefined();
  expect(f.entries.size).toBe(0); expect(response.bodyUsed).toBe(true);
});

test('unversioned, foreign, partial, HTML and explicit bypass responses never enter the shared cache', async () => {
  const f = disk();
  await publishBootResponse('/assets/packs/loose.bin', new Response('loose'));
  await publishBootResponse('https://foreign.test/file-1234abcd.bin', new Response('foreign'));
  await publishBootResponse('/assets/file-1234abcd.bin?sw=0', new Response('bypass'));
  await publishBootResponse('/assets/file-1234abcd.bin', new Response('partial', {status: 206}));
  await publishBootResponse('/assets/file-1234abcd.bin', new Response('range', {headers: {'content-range': 'bytes 0-4/9'}}));
  await publishBootResponse('/assets/file-1234abcd.bin', new Response('<html>', {headers: {'content-type': 'text/html'}}));
  expect(f.open).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
});

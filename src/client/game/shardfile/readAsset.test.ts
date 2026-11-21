import { expect, test, vi } from 'vitest';
import { readAsset } from './readAsset';
import { assetCacheName } from '@wildshard/engine/pwa/cacheNames';

const url = `https://assets.test/shardfiles/world/blobs/bin/${'a'.repeat(64)}.bin`;

test('native hits use their exact bytes with no page cache open or hash worker', async () => {
  const calls: RequestInit[] = [];
  const bytes = await readAsset(url, 3, { fetch: (_url, init) => {
    calls.push(init); return Promise.resolve(new Response(new Uint8Array([7, 8, 9])));
  } });
  expect(bytes).toEqual(new Uint8Array([7, 8, 9])); expect(calls).toEqual([{}]);
});

test('controllerless cold publishes one complete response to the existing URL store', async () => {
  const stored: { name: string; url: string; bytes: number[]; type: string | null }[] = [];
  const bytes = await readAsset(url, 3, { fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'application/octet-stream' },
  })) }, { open: name => Promise.resolve({ put: async (key: RequestInfo | URL, response: Response) => {
    stored.push({ name, url: typeof key === 'string' ? key : key instanceof URL ? key.href : key.url,
      bytes: [...new Uint8Array(await response.arrayBuffer())], type: response.headers.get('content-type') });
  } }) });
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(stored).toEqual([{ name: assetCacheName(), url, bytes: [1, 2, 3], type: 'application/octet-stream' }]);
});

test.each([new Uint8Array([9]), new Uint8Array([9, 9, 9])])('a stale response refetches once and only the correct complete body is published', async stale => {
  const calls: RequestInit[] = [], stored: number[][] = [];
  const bytes = await readAsset(url, 2, { fetch: (_url, init) => {
    calls.push(init); return Promise.resolve(new Response(calls.length === 1 ? stale : new Uint8Array([1, 2])));
  } }, { open: () => Promise.resolve({ put: async (_key: RequestInfo | URL, response: Response) => {
    stored.push([...new Uint8Array(await response.arrayBuffer())]);
  } }) });
  expect(bytes).toEqual(new Uint8Array([1, 2])); expect(calls).toEqual([{}, { cache: 'reload' }]); expect(stored).toEqual([[1, 2]]);
});

test('storage refusal keeps online bytes usable and never creates another cache', async () => {
  const names: string[] = [];
  const bytes = await readAsset(url, 1, { fetch: () => Promise.resolve(new Response(new Uint8Array([1]))) }, {
    open: name => { names.push(name); return Promise.reject(new Error('Quota denied')); },
  });
  expect(bytes).toEqual(new Uint8Array([1])); expect(names).toEqual([assetCacheName()]);
});

test('an index without a declared size uses the source cap without inventing a length', async () => {
  expect(await readAsset(url, undefined, { fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))) }))
    .toEqual(new Uint8Array([1, 2, 3]));
});

// FS30: hosted Nine Explorer held one controllerless read open for 60 s with no request pending. The read is one branch of
// the publication tee; Chromium can leave a tee branch's final BYOB read unsettled. That branch reads by its default reader,
// and the publication still receives the complete body.
test('the controllerless read branch uses its default reader; a plain read keeps BYOB', async () => {
  const modes: unknown[] = [], getReader: unknown = Reflect.get(ReadableStream.prototype, 'getReader');
  if (typeof getReader !== 'function') throw new Error('Missing ReadableStream getReader');
  const spy = vi.spyOn(ReadableStream.prototype, 'getReader').mockImplementation(function recordMode(this: ReadableStream, ...args: unknown[]) {
    modes.push((args[0] as { mode?: string } | undefined)?.mode ?? 'default');
    return Reflect.apply(getReader, this, args) as ReturnType<ReadableStream['getReader']>;
  });
  try {
    const stored: number[][] = [];
    const bytes = await readAsset(url, 3, { fetch: () => Promise.resolve(new Response(new Uint8Array([4, 5, 6]))) },
      { open: () => Promise.resolve({ put: async (_key: RequestInfo | URL, response: Response) => { stored.push([...new Uint8Array(await response.arrayBuffer())]); } }) });
    expect(bytes).toEqual(new Uint8Array([4, 5, 6])); expect(stored).toEqual([[4, 5, 6]]);
    expect(modes[0]).toBe('default');
    modes.length = 0;
    expect(await readAsset(url, 1, { fetch: () => Promise.resolve(new Response(new Uint8Array([1]))) })).toEqual(new Uint8Array([1]));
    expect(modes[0]).toBe('byob');
  } finally { spy.mockRestore(); }
});

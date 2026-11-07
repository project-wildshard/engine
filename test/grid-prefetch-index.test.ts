// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { readPrefetchIndex } from '../src/client/game/grid/prefetchIndex';
import type { OutputDownloadIndex } from '@wildshard/format/outputDownload';

const hash = 'a'.repeat(64), url = `http://localhost/shard.json?v=${hash.slice(0, 8)}`;
const index = { format: 'wildshard.shardfile', formatVersion: 2, sections: [], schemas: [], files: [], runtime: null } satisfies
  OutputDownloadIndex & { format: 'wildshard.shardfile'; formatVersion: 2 };
afterEach(() => { vi.unstubAllGlobals(); });

test('index scheduling reads real native bytes without a persistence worker or RPC', async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(index)));
  const worker = vi.fn(() => { throw new Error('No page persistence worker'); });
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('Worker', worker); vi.stubGlobal('caches', undefined);
  const result = await readPrefetchIndex({ url, indexHashes: [hash], phone: false });
  expect(result).toEqual(index); expect(fetch).toHaveBeenCalledTimes(1); expect(worker).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0]?.length).toBe(2);
});

test('malformed escaping download schedules still refuse', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ ...index, files: [{ path: '../escape', hash, compressed: 1 }] })));
  vi.stubGlobal('caches', undefined);
  await expect(readPrefetchIndex({ url, indexHashes: [hash], phone: false })).rejects.toThrow();
});

test('retired estimates abort their native read and cannot publish a late response', async () => {
  let release: ((response: Response) => void) | undefined;
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  const fetch = vi.fn(() => delayed), owner = new Scope('offline-estimate-test');
  const open = vi.fn(() => Promise.reject(new Error('No late publication')));
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('caches', { open });
  try {
    const pending = readPrefetchIndex({ url, indexHashes: [hash], phone: false }, owner);
    const refused = expect(pending).rejects.toThrow('Prefetch index owner ended');
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    owner.dispose(); await refused;
    release?.(Response.json(index));
    await expect(readPrefetchIndex({ url, indexHashes: [hash], phone: false }, owner)).rejects.toThrow('Prefetch index owner ended');
    expect(fetch).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});

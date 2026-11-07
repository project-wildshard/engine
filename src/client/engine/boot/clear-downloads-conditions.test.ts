import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the defining clear operation with native completion ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase types from the actual operation, not a copied implementation.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolate destructive storage and navigation ports from the real origin.
import { runInNewContext } from 'node:vm';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let complete = (_value: T): void => { throw new Error('Missing request'); };
  const promise = new Promise<T>(resolve => { complete = resolve; });
  return { promise, resolve: complete };
}

test('clear waits for actual stop, deletion and HTTP completion and retains player data', async () => {
  vi.useFakeTimers();
  const source = readFileSync(new URL('clearDownloads.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function storageUsed('), end = source.indexOf('/** the last clear', start);
  if (start === -1 || end < start) throw new Error('Missing clear operation');
  const stop = deferred<boolean>(), deleted = deferred<boolean>(), response = deferred<Response>();
  const sawDelete = deferred<boolean>(), sawHttp = deferred<boolean>();
  const calls: string[] = [], remaining = new Set(['downloaded']);
  const saves = new Map([['player.keep', 'retained']]);
  const functions: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end).replaceAll('export ', '')}\n({clearDownloads,storageUsed})`), {
    Date, REPORT_KEY: 'clear.report', CLEAR_HTTP_URL: '/clear-cache.json?sw=0',
    navigator: { storage: { estimate: () => Promise.resolve({ usage: 42 }) }, serviceWorker: {
      getRegistrations: () => { calls.push('registrations'); return Promise.resolve([{unregister: () => Promise.resolve(true)}]); },
    } },
    window: { __ws_prefetch: { stop: () => { calls.push('stop'); return stop.promise; } },
      __ws_sw: { version: () => Promise.resolve({ build: 'fixture' }) } },
    caches: { keys: () => Promise.resolve([...remaining]), delete: async (key: string) => {
      calls.push('delete'); sawDelete.resolve(true); const done = await deleted.promise;
      if (done) remaining.delete(key); return done;
    } },
    fetch: (url: string) => { expect(url).toBe('/clear-cache.json?sw=0'); calls.push('http'); sawHttp.resolve(true); return response.promise; },
    jsonSlot: () => ({ read: () => ({ oldDownload: true }), write: () => { calls.push('markers'); } }),
    saveStorage: () => ({ setItem: (key: string, value: string) => { saves.set(key, value); } }),
  });
  if (typeof functions !== 'object' || functions === null) throw new Error('Missing clear functions');
  const clear: unknown = Reflect.get(functions, 'clearDownloads'); if (typeof clear !== 'function') throw new Error('Missing clear');
  let completed = false;
  const result = (async () => { const value: unknown = Reflect.apply(clear, undefined, []); const done = await value; completed = true; return done; })();
  try {
    await vi.advanceTimersByTimeAsync(180_000); expect(calls).toEqual(['stop']); expect(completed).toBe(false);
    stop.resolve(true); await sawDelete.promise;
    await vi.advanceTimersByTimeAsync(180_000); expect(calls).toEqual(['stop', 'registrations', 'delete']); expect(completed).toBe(false);
    deleted.resolve(true); await sawHttp.promise;
    await vi.advanceTimersByTimeAsync(180_000); expect(completed).toBe(false); expect(saves.has('clear.report')).toBe(false);
    response.resolve(new Response(null, { status: 204 }));
    expect(await result).toMatchObject({ workers: 1, caches: 1, markers: 1, httpCache: true });
    expect(remaining.size).toBe(0); expect(saves.get('player.keep')).toBe('retained'); expect(saves.has('clear.report')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally { stop.resolve(true); deleted.resolve(true); response.resolve(new Response(null, {status: 204})); await result; vi.useRealTimers(); }
});

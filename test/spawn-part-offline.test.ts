// @vitest-environment happy-dom
// STAGING-BUGBASH SB28 (meta docs/plans/STAGING-BUGBASH-PLAN.md): offline for 5 s mid cold load, a spawn part spent its three
// reads (DL20) in about two seconds while the device had no network, so the download failed and the boot ended on "could not
// load" even after the network came back. A read that fails while the device says it is offline is no read spent: the part
// waits for `online`, then reads again.
import {afterEach, expect, test, vi} from 'vitest';
import {downloadSpawnManifest, releaseSpawnMembers} from '../src/client/game/boot/spawnDownload';

const hash = 'c'.repeat(64), base = 'https://example.test/';
const bin = {url: `/shardfiles/example/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const glb = {url: `/shardfiles/example/blobs/glb/${'b'.repeat(64)}.glb`, bytes: 5, hash: '7dfd2b6c5b422920757984cf2cbce642dca9a05207c57af24ad995b2d90fb4e9'};
const code = {url: '/assets/code-12345678.js', bytes: 3, hash: 'd'.repeat(64)};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 21, hash, members: [[0, 0], [1, 16]]};
const partBytes: Uint8Array<ArrayBuffer> = Uint8Array.from({length: 21}, (_, at) => at < 4 ? 1 : at >= 16 ? 2 : 0);
const manifest = {version: 1, shard: 'example', tier: 'phone', flow: 'grid', files: [bin, glb, code], totalBytes: 12, parts: [part]};
const text = JSON.stringify(manifest), address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 12, files: 3};
afterEach(() => {releaseSpawnMembers(); vi.restoreAllMocks();});

test('SB28: a part read that fails offline spends no read, waits for online, then completes', async () => {
  let online = false, partReads = 0;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: url => {
      const path = new URL(url).pathname;
      if (path === part.url) { partReads++; return online ? Promise.resolve(new Response(partBytes)) : Promise.reject(new TypeError('Failed to fetch')); }
      return Promise.resolve(new Response(path === address.url ? text : new Uint8Array(3)));
    }}, base);
  let settled: unknown = 'pending';
  download.ready.then(() => { settled = 'ready'; }, (error: unknown) => { settled = error; });
  await new Promise(resolve => { setTimeout(resolve, 3500); });
  expect(settled, 'offline: the download waits instead of failing').toBe('pending');
  const offlineReads = partReads;
  online = true; window.dispatchEvent(new Event('online'));
  await download.ready;
  expect(partReads).toBe(offlineReads + 1);
  expect(download.snapshot()).toMatchObject({complete: true, error: null});
}, 10_000);

test('SB28: offline, an HTTP answer still spends its reads (a device that says offline while its server answers)', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  let partReads = 0;
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: url => {
      const path = new URL(url).pathname;
      if (path === part.url) { partReads++; return Promise.resolve(new Response('missing', {status: 503})); }
      return Promise.resolve(new Response(path === address.url ? text : new Uint8Array(3)));
    }}, base);
  await expect(download.ready).rejects.toThrow(`Spawn part unavailable: ${part.url}`);
  expect(partReads).toBe(3);
}, 10_000);

test('SB28: a transport failure waits offline at most two minutes, then counts', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  try {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    // DL20's pause between reads is an AbortSignal timeout: run it on the fake clock too
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => { stop.abort(); }, ms); return stop.signal; });
    let partReads = 0;
    const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
      fetch: url => {
        const path = new URL(url).pathname;
        if (path === part.url) { partReads++; return Promise.reject(new TypeError('Failed to fetch')); }
        return Promise.resolve(new Response(path === address.url ? text : new Uint8Array(3)));
      }}, base);
    let settled: unknown = 'pending';
    download.ready.then(() => { settled = 'ready'; }, (error: unknown) => { settled = error; });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(settled).toBe('pending'); expect(partReads).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * 121_000 + 5_000);
    expect(settled).toBeInstanceOf(TypeError);
    expect(partReads).toBe(3);
  } finally { vi.useRealTimers(); }
}, 10_000);

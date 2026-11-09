// @vitest-environment happy-dom
// LD4 (J208): the warm check runs a few native lookups at a time, and a page read of a listed file is looked up next, so it
// never queues behind the whole list (Jake's iPhone, d91507e: selected discovery sat behind every lookup of 480 files).
import {expect, test, vi} from 'vitest';
import {startSpawnDownload} from '../src/client/game/boot/spawnDownload';

const files = Array.from({length: 40}, (_, index) => ({url: `/shardfiles/lanes/blobs/bin/${index.toString(16).padStart(64, '0')}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
const text = JSON.stringify({version: 1, shard: 'lanes', tier: 'phone', flow: 'client', files, totalBytes: 160});
const address = {url: '/assets/spawn/lanes-1234567890abcdef.json', bytes: text.length, totalBytes: 160, files: files.length};

test('a page read of the last listed file is answered long before the warm check ends, with at most eight check lookups in flight', async () => {
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'lanes-assets', client: {lanes: {phone: address}}}})}</script>`;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve(new Response(String(input).endsWith('.json') ? text : 'network'))));
  // One native queue, one answer a macrotask, as a phone's cache storage answered Jake's 480 lookups.
  const queue: (() => void)[] = [];
  let inFlight = 0, most = 0, answered = 0;
  const pump = setInterval(() => { queue.shift()?.(); }, 1);
  const match = (url: string): Promise<Response | undefined> => {
    inFlight++; most = Math.max(most, inFlight);
    return new Promise(resolve => { queue.push(() => {
      inFlight--; answered++;
      resolve(url.endsWith('.json') ? undefined : new Response(new Uint8Array(4), {headers: {'content-type': 'application/octet-stream'}}));
    }); });
  };
  vi.stubGlobal('caches', {open: () => Promise.resolve({match, put: () => Promise.resolve()}), match});
  try {
    const download = startSpawnDownload('lanes', 'client', 'phone');
    if (download === null) throw new Error('No download for the test bank');
    await download.listed;
    const last = files.at(-1);
    if (last === undefined) throw new Error('Empty list');
    await window.fetch(new URL(last.url, document.baseURI).href);
    const answeredAtRead = answered;
    await download.ready;
    expect(answeredAtRead).toBeLessThan(files.length / 2);
    expect(most).toBeLessThanOrEqual(9); // eight lanes, plus the page read's own copy from the store
    expect(download.snapshot()).toMatchObject({complete: true, filesDone: files.length});
  } finally { clearInterval(pump); vi.unstubAllGlobals(); }
});

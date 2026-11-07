// @vitest-environment happy-dom
// DL11 (sp-x2's reviews of e189c45834 and c8862f94d1), through the page's own entry point. Own file: the module's first
// fetch layer captures the network beneath it once per page, so every test here stubs the same network function. Page
// reads name URLs against document.baseURI, as the downloads do (happy-dom's location is another origin).
import {expect, test, vi} from 'vitest';
import {releaseSpawnMembers, reportSpawnOutcomes, startSpawnDownload, type SpawnOutcome} from '../src/client/game/boot/spawnDownload';
import {jsonSlot} from '../src/client/engine/saves/slots';

const file = (slug: string, kind: string, fill: string, bytes: number): {url: string; bytes: number; hash: string} =>
  ({url: `/shardfiles/${slug}/blobs/${kind}/${fill.repeat(64)}.${kind}`, bytes, hash: fill.repeat(64)});
const entry = (slug: string, files: readonly {url: string; bytes: number; hash: string}[]): {text: string; address: {url: string; bytes: number; totalBytes: number; files: number}} => {
  const totalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
  const text = JSON.stringify({version: 1, shard: slug, tier: 'phone', flow: 'client', files, totalBytes});
  return {text, address: {url: `/assets/spawn/${slug}-1234567890abcdef.json`, bytes: text.length, totalBytes, files: files.length}};
};
const ktx2 = file('overlap', 'ktx2', 'e', 6), x = file('first', 'bin', 'a', 4), y = file('second', 'bin', 'b', 4);
const x2 = file('third', 'bin', 'c', 4), y2 = file('fourth', 'bin', 'd', 4);
const o1 = file('dl20done', 'bin', 'f', 4), o2 = file('dl20stop', 'bin', '0', 4);
const entries = {overlap: entry('overlap', [ktx2]), first: entry('first', [x]), second: entry('second', [y]), third: entry('third', [x2]), fourth: entry('fourth', [y2]),
  dl20done: entry('dl20done', [o1]), dl20stop: entry('dl20stop', [o2])};
// Requests the test holds until it releases them; a held download read still ends when its download is cancelled.
const holds = new Map<string, Promise<void>>();
const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname, signal = init?.signal;
  signal?.throwIfAborted();
  const held = signal === undefined || signal === null ? undefined : holds.get(path);
  if (held !== undefined && signal !== undefined && signal !== null) {
    await Promise.race([held, new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')); }); })]);
  }
  const named = Object.values(entries).find(row => row.address.url === path);
  if (named !== undefined) return new Response(named.text);
  const listed = [ktx2, x, y, x2, y2, o1, o2].find(row => row.url === path);
  return new Response(listed === undefined || signal === undefined || signal === null ? 'network' : new Uint8Array(listed.bytes).fill(7));
});
const bank = (): void => {
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'test-assets', client: Object.fromEntries(
    Object.entries(entries).map(([slug, row]) => [slug, {phone: row.address}]))}})}</script>`;
};

test('a later layer that re-issues a listed read under its own signal cannot make the download wait for itself', async () => {
  // The byte counter's texture-pack reader (texturePack.ts `direct`) re-issues a read to the layer beneath under a new
  // signal: the download must never read through such a layer, or its own request waits for itself.
  vi.stubGlobal('fetch', network); bank();
  const download = startSpawnDownload('overlap', 'client', 'phone');
  if (download === null) throw new Error('No spawn download');
  const inner = window.fetch, reissued: string[] = [];
  window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.endsWith('.ktx2')) return inner(input, init);
    reissued.push(new URL(url).pathname);
    return inner(url, {signal: new AbortController().signal});
  };
  await download.ready;
  expect(download.snapshot()).toMatchObject({complete: true, filesDone: 1});
  // the download never entered the later layer; a page read through it waits for the file, then reaches the network
  expect(reissued).toEqual([]);
  expect((await (await window.fetch(new URL(ktx2.url, document.baseURI).href)).arrayBuffer()).byteLength).toBe(6);
  expect(reissued).toEqual([ktx2.url]);
  releaseSpawnMembers(); download.cancel();
  vi.unstubAllGlobals();
});

test('a cancelled entry\'s file waits leave the page: the next entry holds a file it does not list until its set lands', async () => {
  vi.stubGlobal('fetch', network); bank();
  let release = (): void => undefined, listSecond = (): void => undefined;
  holds.set(x.url, new Promise(() => { /* the first entry's file never arrives */ }));
  holds.set(y.url, new Promise(resolve => { release = resolve; }));
  // the second entry's list arrives late: a read between the cancel and that list must not find the first's waits
  holds.set(entries.second.address.url, new Promise(resolve => { listSecond = resolve; }));
  const first = startSpawnDownload('first', 'client', 'phone');
  if (first === null) throw new Error('No first download');
  await first.listed;
  // a new entry replaces it (spawnDownload cancels the current one)
  const second = startSpawnDownload('second', 'client', 'phone');
  if (second === null) throw new Error('No second download');
  await expect(first.ready).rejects.toThrow();
  let read: string | undefined;
  const reading = (async () => { read = await (await window.fetch(new URL(x.url, document.baseURI).href)).text(); })();
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(read).toBeUndefined(); // held by the second entry's set, not answered by the first's settled wait
  listSecond(); await second.listed;
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(read).toBeUndefined();
  release(); await second.ready; await reading;
  expect(read).toBe('network');
  releaseSpawnMembers(); holds.clear();
  vi.unstubAllGlobals();
});

test('an entry cancelled during its manifest store leaves nothing: the next entry behaves as if it never ran (wildshard-new)', async () => {
  vi.stubGlobal('fetch', network); bank();
  // A worker cache whose put of the first entry's manifest stalls (an unabortable storage call).
  // Once that put returns, any later cache census stalls too: a cancelled entry that went on would stay alive there.
  let storeReturns = (): void => undefined, storing = false, returned = false;
  const stalled = new Promise<void>(resolve => { storeReturns = resolve; });
  const census = (): Promise<Response[]> => returned ? new Promise(() => { /* stalls */ }) : Promise.resolve([]);
  const cache = {match: () => Promise.resolve(undefined), matchAll: census, keys: () => Promise.resolve([]),
    put: (request: RequestInfo | URL) => {
      if (new URL(request instanceof Request ? request.url : request instanceof URL ? request.href : request).pathname !== entries.third.address.url) return Promise.resolve();
      storing = true; return stalled;
    }};
  vi.stubGlobal('caches', {open: () => Promise.resolve(cache), match: () => Promise.resolve(undefined)});
  let release = (): void => undefined;
  holds.set(y2.url, new Promise(resolve => { release = resolve; }));
  const first = startSpawnDownload('third', 'client', 'phone');
  if (first === null) throw new Error('No first download');
  await vi.waitFor(() => { expect(storing).toBe(true); });
  const second = startSpawnDownload('fourth', 'client', 'phone'); // cancels the first mid-store
  if (second === null) throw new Error('No second download');
  await expect(first.ready).rejects.toThrow(); await second.listed;
  await new Promise(resolve => { setTimeout(resolve, 10); }); // the second entry's census is done
  returned = true; storeReturns(); await new Promise(resolve => { setTimeout(resolve, 10); });
  // The second entry's own file and a file only the first listed both wait for the second entry's set.
  const read = (url: string): {done: () => boolean; text: Promise<string>} => {
    let finished = false;
    const text = (async () => { const body = await (await window.fetch(new URL(url, document.baseURI).href)).text(); finished = true; return body; })();
    return {done: () => finished, text};
  };
  const own = read(y2.url), unlisted = read(x2.url);
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect([own.done(), unlisted.done()]).toEqual([false, false]);
  release(); await second.ready;
  expect(await unlisted.text).toBe('network');
  expect((await own.text).length).toBeGreaterThan(0);
  releaseSpawnMembers(); holds.clear();
  vi.unstubAllGlobals();
});

// DL20 (sp-x1's coverage matrix): every boot's download reports one outcome, queued until telemetry's sink exists
test('each foreground download reports one outcome: complete, or cancelled, queued until a sink is installed', async () => {
  vi.stubGlobal('fetch', network); bank();
  const done = startSpawnDownload('dl20done', 'client', 'phone');
  if (done === null) throw new Error('No spawn download');
  await done.ready;
  holds.set(o2.url, new Promise<void>(() => { /* held: the second download is cancelled mid-read */ }));
  const stopped = startSpawnDownload('dl20stop', 'client', 'phone'); // cancels nothing: the first has settled
  if (stopped === null) throw new Error('No spawn download');
  stopped.cancel();
  await expect(stopped.ready).rejects.toThrow();
  // with no sink yet (a boot failing before its session) they are kept in the device save, for the next boot to report
  const kept = jsonSlot('download.outcomes', 'device', () => []);
  const stored = kept.read();
  expect(Array.isArray(stored) ? stored.filter(row => JSON.stringify(row).includes('"dl20')).length : 0).toBe(2);
  const seen: SpawnOutcome[] = [];
  const confirm = reportSpawnOutcomes(outcome => { seen.push(outcome); });
  const mine = seen.filter(row => row.level.startsWith('dl20'));
  expect(mine.map(({id: _id, ...row}) => row)).toEqual([
    {level: 'dl20done', outcome: 'complete', packs: false, parts: 0, failed: 0, fallbackFiles: 0, fetched: 0},
    {level: 'dl20stop', outcome: 'cancelled', packs: false, parts: 0, failed: 0, fallbackFiles: 0, fetched: 0},
  ]);
  expect(new Set(mine.map(row => row.id)).size).toBe(2);
  // sp-x6's review: delivered is not yet recorded; they stay in the save (a boot dying here replays them) until confirmed
  const left = (): number => { const rows = kept.read(); return Array.isArray(rows) ? rows.filter(row => JSON.stringify(row).includes('"dl20')).length : 0; };
  expect(left()).toBe(2);
  reportSpawnOutcomes(outcome => { seen.push(outcome); });
  expect(seen.filter(row => row.level.startsWith('dl20'))).toHaveLength(2); // a second install delivers nothing twice
  confirm();
  expect(left()).toBe(0);
  releaseSpawnMembers(); holds.delete(o2.url);
  vi.unstubAllGlobals();
});

// sp-x1's review of be2df44ec8: rows b28a44a5e6 saved carry no id; each keeps its place (two identical rows stay two),
// takes a persisted id before replay, and leaves only on confirm
test('outcomes saved without an id survive the upgrade, each with its own id, and clear on confirm', () => {
  const kept = jsonSlot('download.outcomes', 'device', () => []);
  const legacy = {level: 'dl20legacy', outcome: 'failed', packs: true, parts: 2, failed: 1, fallbackFiles: 3, fetched: 3};
  kept.write([legacy, legacy]);
  const seen: SpawnOutcome[] = [];
  const confirm = reportSpawnOutcomes(outcome => { seen.push(outcome); });
  const mine = seen.filter(row => row.level === 'dl20legacy');
  expect(mine).toHaveLength(2);
  expect(new Set(mine.map(row => row.id)).size).toBe(2);
  const stored = kept.read();
  expect(Array.isArray(stored) && stored.every(row => typeof row === 'object' && row !== null && typeof Reflect.get(row, 'id') === 'string')).toBe(true);
  confirm();
  expect(kept.read()).toEqual([]);
});

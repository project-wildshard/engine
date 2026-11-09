// @vitest-environment happy-dom
import {afterEach, expect, test, vi} from 'vitest';
import {downloadSpawnManifest, releaseSpawnMembers, type HeldParts} from '../src/client/game/boot/spawnDownload';
import {progressOfCard, watchStuckStep} from '../src/client/engine/boot/stuckStep';

const hash = 'c'.repeat(64), base = 'https://example.test/';
// Real sha256 of each body: the reader checks every member against its manifest row.
const bin = {url: `/shardfiles/example/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const glb = {url: `/shardfiles/example/blobs/glb/${'b'.repeat(64)}.glb`, bytes: 5, hash: '7dfd2b6c5b422920757984cf2cbce642dca9a05207c57af24ad995b2d90fb4e9'};
const code = {url: '/assets/code-12345678.js', bytes: 3, hash: 'd'.repeat(64)};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 21, hash, members: [[0, 0], [1, 16]]};
// The part holds bin at 0 and glb at 16 (16-byte aligned); the JS module stays loose.
const partBytes: Uint8Array<ArrayBuffer> = Uint8Array.from({length: 21}, (_, at) => at < 4 ? 1 : at >= 16 ? 2 : 0);
const manifest = {version: 1, shard: 'example', tier: 'phone', flow: 'grid', files: [bin, glb, code], totalBytes: 12, parts: [part]};
const text = JSON.stringify(manifest), address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 12, files: 3};
const body = (url: string): Uint8Array<ArrayBuffer> => url.endsWith('.js') ? new Uint8Array(3) : url.endsWith('.bin') ? new Uint8Array(4).fill(1) : new Uint8Array(5).fill(2);
afterEach(() => {releaseSpawnMembers(); vi.restoreAllMocks();});

test('until control, a page read of a member is answered from its part; retries and other URLs reach the network', async () => {
  const network = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network')));
  // First in this file: the module's one fetch layer installs over this page's (stubbed) network.
  vi.stubGlobal('fetch', network);
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname;
    return Promise.resolve(new Response(path === address.url ? text : path === part.url ? partBytes : body(path)));
  }}, base);
  await download.ready;
  const member = await window.fetch(new URL(glb.url, base).href);
  expect(new Uint8Array(await member.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
  expect(member.headers.get('content-type')).toBe('model/gltf-binary');
  expect(network).not.toHaveBeenCalled();
  await window.fetch(new URL(glb.url, base).href, {cache: 'reload'}); expect(network).toHaveBeenCalledTimes(1);
  releaseSpawnMembers();
  await window.fetch(new URL(glb.url, base).href); expect(network).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

test('packs read each part once, cut its members, keep them under their own URLs and leave code loose', async () => {
  const reads: string[] = [], kept = new Map<string, Uint8Array>();
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    keep: async (url, response) => {kept.set(new URL(url).pathname, new Uint8Array(await response.arrayBuffer()));},
    fetch: url => {
      const path = new URL(url).pathname; reads.push(path);
      return Promise.resolve(new Response(path === address.url ? text : path === part.url ? partBytes : body(path)));
    }}, base);
  await download.ready;
  expect(reads).toEqual([address.url, part.url, code.url]);
  expect(kept.get(bin.url)).toEqual(new Uint8Array(4).fill(1)); expect(kept.get(glb.url)).toEqual(new Uint8Array(5).fill(2));
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 12, filesDone: 3, error: null});
});

test('DL20: a part that fails is read again past the HTTP cache, and no loose copy is asked for', async () => {
  const reads: string[] = [], inits: (RequestInit | undefined)[] = [];
  let failures = 1;
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: (url, _signal, init) => {
      const path = new URL(url).pathname; reads.push(path);
      if (path === part.url) {
        inits.push(init);
        if (failures-- > 0) return Promise.resolve(new Response('missing', {status: 503}));
        return Promise.resolve(new Response(partBytes));
      }
      return Promise.resolve(new Response(path === address.url ? text : body(path)));
    }}, base);
  await download.ready;
  expect(reads.filter(path => path === part.url)).toHaveLength(2);
  expect(inits).toEqual([undefined, {cache: 'reload'}]);
  expect(reads).not.toContain(bin.url);
  expect(reads).not.toContain(glb.url);
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 12, filesDone: 3, parts: {parts: 1, failed: 1, fallbackFiles: 0, fetched: 0}});
});

test('DL20: a part that keeps failing fails the download by name, with no loose fallback', async () => {
  const reads: string[] = [];
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: url => {
      const path = new URL(url).pathname; reads.push(path);
      if (path === part.url) return Promise.resolve(new Response('missing', {status: 404}));
      return Promise.resolve(new Response(path === address.url ? text : body(path)));
    }}, base);
  await expect(download.ready).rejects.toThrow(`Spawn part unavailable: ${part.url}`);
  expect(reads.filter(path => path === part.url)).toHaveLength(3);
  expect(reads).not.toContain(bin.url);
  expect(reads).not.toContain(glb.url);
  expect(download.snapshot()).toMatchObject({complete: false, error: `Spawn part unavailable: ${part.url}`, parts: {parts: 0, failed: 3, fallbackFiles: 0, fetched: 0}});
});

test('DL20: a corrupt part keeps nothing wrong, and its second read credits only what the first left', async () => {
  const kept: string[] = [];
  let reads = 0;
  const corrupt = partBytes.map(byte => byte === 2 ? 3 : byte); // same length, wrong glb bytes
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
    keep: url => {kept.push(new URL(url).pathname); return Promise.resolve();},
    fetch: url => {
      const path = new URL(url).pathname;
      if (path === part.url) return Promise.resolve(new Response(reads++ === 0 ? corrupt : partBytes));
      return Promise.resolve(new Response(path === address.url ? text : body(path)));
    }}, base);
  await download.ready;
  expect(kept).toEqual([bin.url, glb.url]); // bin once, from the first read; glb only from the good one
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 12, filesDone: 3, parts: {parts: 1, failed: 1}});
});

test('DL18: a warm visit answers every packed member from the held-parts index, with no part request or bulk read; an unfit entry refetches its part', async () => {
  // One in-memory asset cache shared by a cold visit and the warm visit after it.
  const disk = new Map<string, Response>(), reads: string[] = [], lookups: string[] = [];
  let index: HeldParts = {['f'.repeat(64)]: ['https://example.test/old-release.bin']}, bulk = 0;
  const ports = () => ({packs: true, whole: true,
    cached: (url: string) => { lookups.push(new URL(url).pathname); return Promise.resolve(disk.get(url)?.clone()); },
    present: (urls: readonly string[]) => { bulk++; return Promise.resolve(new Set(urls.filter(url => disk.has(url)))); },
    keep: (url: string, response: Response) => { disk.set(url, response); return Promise.resolve(); },
    store: (url: string, response: Response) => { disk.set(url, response); return Promise.resolve(); },
    held: {read: () => Promise.resolve(index), write: (next: HeldParts) => { index = next; return Promise.resolve(); },
      keys: () => Promise.resolve(new Set(disk.keys()))},
    fetch: (url: string) => {
      const path = new URL(url).pathname; reads.push(path);
      return Promise.resolve(new Response(path === address.url ? text : path === part.url ? partBytes : body(path)));
    }});
  await downloadSpawnManifest(address, ports(), base).ready;
  expect(reads).toEqual([address.url, part.url, code.url]);
  expect(index).toEqual({[hash]: [new URL(bin.url, base).href, new URL(glb.url, base).href]});
  reads.length = 0; lookups.length = 0; bulk = 0;
  const warm = downloadSpawnManifest(address, ports(), base);
  await warm.ready;
  // Every file is answered by its own cache lookup (each held member is checked: a 200, not a page, its exact length).
  expect(reads).toEqual([]); expect(bulk).toBe(0);
  expect(lookups.sort()).toEqual([address.url, bin.url, glb.url, code.url].sort());
  expect(warm.snapshot()).toMatchObject({complete: true, cachedBytes: 12, filesDone: 3});
  // The worker pruned a member, or its entry is unfit (sp-x9's review of 77f9b5489f): the part is fetched again, the
  // member re-kept and the part re-listed; the download is complete only with the right bytes.
  const glbURL = new URL(glb.url, base).href;
  for (const unfit of [undefined, new Response('gone', {status: 404}), new Response('<!doctype html>', {headers: {'content-type': 'text/html'}}),
    new Response(new Uint8Array(4), {headers: {'content-length': '4'}}), new Response(new Uint8Array(4))]) {
    if (unfit === undefined) disk.delete(glbURL); else disk.set(glbURL, unfit);
    reads.length = 0;
    const again = downloadSpawnManifest(address, ports(), base);
    await again.ready;
    expect(reads).toEqual([part.url]);
    expect(new Uint8Array(await (disk.get(glbURL)?.clone().arrayBuffer() ?? new ArrayBuffer(0)))).toEqual(new Uint8Array(5).fill(2));
    expect(again.snapshot()).toMatchObject({complete: true, filesDone: 3});
    expect(index[hash]).toEqual([new URL(bin.url, base).href, glbURL]);
  }
});

test('warm packed reads verify every member without enumerating native cache keys', async () => {
  const disk = new Map<string, Response>(), reads: string[] = [];
  let index: HeldParts = {};
  const ports = (keys: () => Promise<ReadonlySet<string>>) => ({packs: true, whole: true,
    cached: (url: string) => Promise.resolve(disk.get(url)?.clone()),
    keep: (url: string, response: Response) => { disk.set(url, response); return Promise.resolve(); },
    store: (url: string, response: Response) => { disk.set(url, response); return Promise.resolve(); },
    held: {read: () => Promise.resolve(index), write: (next: HeldParts) => { index = next; return Promise.resolve(); }, keys},
    fetch: (url: string) => {
      const path = new URL(url).pathname; reads.push(path);
      return Promise.resolve(new Response(path === address.url ? text : path === part.url ? partBytes : body(path)));
    }});
  await downloadSpawnManifest(address, ports(() => Promise.resolve(new Set(disk.keys()))), base).ready;
  reads.length = 0;
  let scans = 0;
  const warm = downloadSpawnManifest(address, ports(() => { scans++; return Promise.reject(new DOMException('Operation too large', 'UnknownError')); }), base);
  await warm.ready;
  expect(reads).not.toContain(part.url);
  expect(warm.snapshot().complete).toBe(true);
  expect(scans).toBe(0);
});

test('quota-denied manifest or member publication keeps verified network bytes usable without cached credit', async () => {
  for (const failing of ['manifest', 'member']) {
    const reads: string[] = [];
    let attempts = 0, indexes = 0;
    const denied = (): Promise<void> => { attempts++; return Promise.reject(new DOMException('Disk full', 'QuotaExceededError')); };
    const download = downloadSpawnManifest(address, {
      packs: true, whole: true, cached: () => Promise.resolve(undefined),
      store: failing === 'manifest' ? denied : () => Promise.resolve(), keep: denied,
      held: {read: () => Promise.resolve({}), write: () => { indexes++; return Promise.resolve(); }},
      fetch: url => {
        const path = new URL(url).pathname; reads.push(path);
        return Promise.resolve(new Response(path === address.url ? text : path === part.url ? partBytes : body(path)));
      },
    }, base);
    await download.ready;
    expect(download.snapshot()).toMatchObject({complete: true, cachedBytes: 0, completedBytes: 12, filesDone: 3, error: null, parts: {failed: 0}});
    expect(attempts).toBe(1); expect(indexes).toBe(0);
    expect(reads.filter(path => path === part.url)).toHaveLength(1);
    const member = await window.fetch(new URL(glb.url, base).href);
    expect(new Uint8Array(await member.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
    const loose = await window.fetch(new URL(code.url, base).href);
    expect(new Uint8Array(await loose.arrayBuffer())).toEqual(body(code.url));
    expect(reads.filter(path => path === code.url)).toHaveLength(1);
    releaseSpawnMembers();
  }
});

test('non-quota cache publication faults remain explicit download failures', async () => {
  const download = downloadSpawnManifest(address, {
    packs: true, cached: () => Promise.resolve(undefined),
    store: () => Promise.reject(new TypeError('Broken cache protocol')),
    fetch: () => Promise.resolve(new Response(text)),
  }, base);
  await expect(download.ready).rejects.toThrow('Broken cache protocol');
  expect(download.snapshot()).toMatchObject({complete: false, filesDone: 0, error: 'Broken cache protocol'});
});

test('DL15: on the packs path the wire facts are the parts\' q11 bodies plus the loose files', async () => {
  // Loose q3 estimates: bin 3, glb 4, code 2 (9). The part's q11 body is 6 bytes, so the wire is 6 + 2.
  const files = [{...bin, wireBytes: 3}, {...glb, wireBytes: 4}, {...code, wireBytes: 2}];
  const wired = JSON.stringify({...manifest, files, wireBytes: 9, parts: [{...part, wireBytes: 6}]});
  const at = {...address, url: '/assets/spawn/example-wire-1234567890abcdef.json', bytes: wired.length, wireBytes: 9};
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname;
    return Promise.resolve(new Response(path === at.url ? wired : path === part.url ? partBytes : body(path)));
  }}, base);
  await download.ready;
  expect(download.snapshot().wire).toEqual({totalBytes: 8, completedBytes: 8, cachedBytes: 0, arrivingBytes: 0});
});

test('DL21: the card\'s MB moves with a part\'s chunks before its first member verifies, and nets out when it lands', async () => {
  // Jake's 69fa647 phone shot: 'Spawn view · 0.00 MB of 31.5 MB' at 16 s, the wire figure credited only landed files
  const files = [{...bin, wireBytes: 3}, {...glb, wireBytes: 4}, {...code, wireBytes: 2}];
  const wired = JSON.stringify({...manifest, files, wireBytes: 9, parts: [{...part, wireBytes: 6}]});
  const at = {...address, url: '/assets/spawn/example-wire-1234567890abcdef.json', bytes: wired.length, wireBytes: 9};
  let push = (_bytes: Uint8Array<ArrayBuffer>): void => { throw new Error('Part stream not started'); }, close = (): void => undefined;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({start: controller => {push = bytes => {controller.enqueue(bytes);}; close = () => {controller.close();};}});
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname;
    return Promise.resolve(new Response(path === at.url ? wired : path === part.url ? stream : body(path)));
  }}, base);
  await vi.waitFor(() => {expect(download.snapshot().progressKnown).toBe(true);});
  push(partBytes.slice(0, 2));
  await vi.waitFor(() => {expect(download.snapshot().wire?.arrivingBytes).toBeGreaterThan(0);});
  expect(download.snapshot().completedBytes).toBe(0);
  push(partBytes.slice(2)); close(); await download.ready;
  expect(download.snapshot().wire).toEqual({totalBytes: 8, completedBytes: 8, cachedBytes: 0, arrivingBytes: 0});
});

test('DL21: a part streaming one byte every 50 s, before any member verifies, keeps the stuck watch quiet', async () => {
  let push = (_bytes: Uint8Array<ArrayBuffer>): void => { throw new Error('Part stream not started'); }, close = (): void => undefined, started = false;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({start: controller => {push = bytes => {controller.enqueue(bytes);}; close = () => {controller.close();};}});
  const download = downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname; if (path === part.url) started = true;
    return Promise.resolve(new Response(path === address.url ? text : path === part.url ? stream : body(path)));
  }}, base);
  // the card as the download paints it (paintSpawnDownload's data-streamed-bytes / data-read-bytes)
  const dataset: Record<string, string> = {step: 'modules'};
  download.subscribe(row => {dataset['streamedBytes'] = String(row.streamedBytes ?? row.completedBytes); dataset['readBytes'] = String(row.completedBytes);});
  let now = 0, tick = (): void => undefined;
  const stalls: [string, number][] = [];
  watchStuckStep(download.ready, {progress: () => progressOfCard({dataset}), now: () => now,
    every: (_ms, run) => {tick = run; return () => {tick = () => undefined;};}, stalled: (step, ms) => {stalls.push([step, ms]);}}, 60_000);
  const wait = (seconds: number): void => {for (let s = 0; s < seconds; s++) {now += 1000; tick();}};
  await vi.waitFor(() => {expect(started).toBe(true);});
  // bin (bytes 0..3) verifies only once all four land: three single bytes move the stream but no verified byte
  for (let at = 0; at < 3; at++) {
    const before = dataset['streamedBytes'];
    push(partBytes.slice(at, at + 1));
    await vi.waitFor(() => {expect(dataset['streamedBytes']).not.toBe(before);});
    expect(dataset['readBytes']).toBe('0');
    wait(50);
  }
  expect(stalls).toEqual([]);
  wait(61); expect(stalls).toEqual([['modules', 60_000]]);
  push(partBytes.slice(3)); close(); await download.ready;
});

test('DL13 default-path slice: until control, an uncontrolled page re-reads a stored file from the store, not the network', async () => {
  // Pine's cold first visit (DL22) re-fetched 25.4 MB of files the spawn download had already stored. The page's fetch
  // layer wraps the stubbed network below, which answers 'network' for anything the layer passes through.
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const disk = new Map<string, Response>(), plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-plain-1234567890abcdef.json', bytes: plain.length };
  const download = downloadSpawnManifest(at, {
    cached: url => Promise.resolve(disk.get(url)?.clone()),
    store: (url, response) => { disk.set(url, response); return Promise.resolve(); },
    fetch: url => { const path = new URL(url).pathname; return Promise.resolve(new Response(path === at.url ? plain : body(path))); },
  }, base);
  await download.ready;
  const binURL = new URL(bin.url, base).href, read = async (init?: RequestInit): Promise<Uint8Array> => new Uint8Array(await (await window.fetch(binURL, init)).arrayBuffer());
  expect(await read()).toEqual(new Uint8Array(4).fill(1));
  // A retry still reaches the network; after control every read does.
  expect(new TextDecoder().decode(await read({ cache: 'reload' }))).toBe('network');
  releaseSpawnMembers();
  expect(new TextDecoder().decode(await read())).toBe('network');
  vi.unstubAllGlobals();
});

test('DL13 read-once serves only the manifest\'s exact file; a fetch replaced mid-page is wrapped again (sp-x2\'s review)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const disk = new Map<string, Response>(), plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-check-1234567890abcdef.json', bytes: plain.length };
  const ports = {
    cached: (url: string) => Promise.resolve(disk.get(url)?.clone()),
    store: (url: string, response: Response) => { disk.set(url, response); return Promise.resolve(); },
    fetch: (url: string) => { const path = new URL(url).pathname; return Promise.resolve(new Response(path === at.url ? plain : body(path))); },
  };
  await downloadSpawnManifest(at, ports, base).ready;
  const binURL = new URL(bin.url, base).href, glbURL = new URL(glb.url, base).href;
  const read = async (url: string): Promise<string> => new TextDecoder().decode(new Uint8Array(await (await window.fetch(url)).arrayBuffer()));
  // Same length, wrong bytes; a short body; a page: each goes to the network.
  disk.set(binURL, new Response(new Uint8Array(4).fill(9))); expect(await read(binURL)).toBe('network');
  disk.set(glbURL, new Response(new Uint8Array(3).fill(2))); expect(await read(glbURL)).toBe('network');
  disk.set(binURL, new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })); expect(await read(binURL)).toBe('network');
  // Something replaces fetch mid-page: the next download's serve wraps it again.
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  disk.clear();
  await downloadSpawnManifest({ ...at, url: '/assets/spawn/example-check2-1234567890abcdef.json' }, { ...ports,
    fetch: (url: string) => { const path = new URL(url).pathname; return Promise.resolve(new Response(path.endsWith('.json') ? plain : body(path))); } }, base).ready;
  expect(new Uint8Array(await (await window.fetch(glbURL)).arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
  vi.unstubAllGlobals();
});

test('DL11: after the list is known, a page read of a listed file waits for that file alone, then reads the store', async () => {
  // Setup overlaps the download: a loader asks for its file mid-download and gets the stored copy, never a second fetch.
  const network = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network')));
  vi.stubGlobal('fetch', network);
  const disk = new Map<string, Response>(), plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-overlap-1234567890abcdef.json', bytes: plain.length };
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const download = downloadSpawnManifest(at, {
    cached: url => Promise.resolve(disk.get(url)?.clone()),
    store: (url, response) => { disk.set(url, response); return Promise.resolve(); },
    fetch: async url => { const path = new URL(url).pathname; if (path === glb.url) await held; return new Response(path === at.url ? plain : body(path)); },
  }, base);
  await download.listed;
  let glbRead: Uint8Array | undefined;
  const reading = (async () => { glbRead = new Uint8Array(await (await window.fetch(new URL(glb.url, base).href)).arrayBuffer()); })();
  // the bin arrives while glb is held: its read is answered at once
  await vi.waitFor(() => { expect(disk.has(new URL(bin.url, base).href)).toBe(true); });
  expect(new Uint8Array(await (await window.fetch(new URL(bin.url, base).href)).arrayBuffer())).toEqual(new Uint8Array(4).fill(1));
  expect(glbRead).toBeUndefined();
  release(); await reading; await download.ready;
  expect(glbRead).toEqual(new Uint8Array(5).fill(2));
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('DL11: a read waiting on a file the download will not store falls through to the network', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-overlap-fail-1234567890abcdef.json', bytes: plain.length };
  // glb never arrives; the download is cancelled (a new entry, a refusal) while a loader waits on it
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: async (url, signal) => {
      const path = new URL(url).pathname;
      if (path === glb.url) await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')); }); });
      return new Response(path === at.url ? plain : body(path));
    },
  }, base);
  await download.listed;
  const reading = window.fetch(new URL(glb.url, base).href);
  download.cancel();
  await expect(download.ready).rejects.toThrow();
  expect(await (await reading).text()).toBe('network');
  vi.unstubAllGlobals();
});

test('DL11: a cancel settles every waiting read at once, even while a storage call never returns (sp-x2\'s review)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-overlap-held-1234567890abcdef.json', bytes: plain.length };
  // the cache census after the list hangs (an unabortable storage call)
  const download = downloadSpawnManifest(at, {
    cached: url => url.endsWith('.json') ? Promise.resolve(undefined) : new Promise<Response | undefined>(() => { /* never settles */ }),
    store: () => Promise.resolve(),
    fetch: url => Promise.resolve(new Response(new URL(url).pathname === at.url ? plain : body(new URL(url).pathname))),
  }, base);
  await download.listed;
  const reading = window.fetch(new URL(bin.url, base).href);
  download.cancel();
  await expect(download.ready).rejects.toThrow();
  expect(await (await reading).text()).toBe('network');
  vi.unstubAllGlobals();
});

test('DL11: a read made before its part starts waits for the file, then gets the member, not the network (sp-x2\'s review)', async () => {
  const network = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network')));
  vi.stubGlobal('fetch', network);
  const at = { ...address, url: '/assets/spawn/example-overlap-parts-1234567890abcdef.json' };
  let census = (): void => undefined;
  const held = new Promise<void>(resolve => { census = resolve; });
  const download = downloadSpawnManifest(at, {packs: true,
    cached: async url => { if (!url.endsWith('.json')) await held; return undefined; },
    fetch: url => { const path = new URL(url).pathname; return Promise.resolve(new Response(path === at.url ? text : path === part.url ? partBytes : body(path))); },
  }, base);
  await download.listed;
  // listed, but the census holds the parts loop: no member is keyed yet
  const reading = window.fetch(new URL(glb.url, base).href);
  census();
  expect(new Uint8Array(await (await reading).arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
  await download.ready;
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('DL11: a download cancelled during its manifest store publishes no file waits (sp-x2\'s re-review)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-overlap-store-1234567890abcdef.json', bytes: plain.length };
  let stored = (): void => undefined, storeCalled = false;
  const storing = new Promise<void>(resolve => { stored = resolve; });
  const download = downloadSpawnManifest(at, {
    cached: url => url.endsWith('.json') ? Promise.resolve(undefined) : new Promise<Response | undefined>(() => { /* the census never returns */ }),
    store: url => { if (!url.endsWith('.json')) return Promise.resolve(); storeCalled = true; return storing; },
    fetch: url => Promise.resolve(new Response(new URL(url).pathname === at.url ? plain : body(new URL(url).pathname))),
  }, base);
  await vi.waitFor(() => { expect(storeCalled).toBe(true); });
  download.cancel(); await expect(download.ready).rejects.toThrow();
  stored(); await new Promise(resolve => { setTimeout(resolve, 0); });
  // the store returned after the cancel: a later read of a listed file is not held by the cancelled job
  expect(await (await window.fetch(new URL(bin.url, base).href)).text()).toBe('network');
  vi.unstubAllGlobals();
});

test('DL13: a download cancelled during a file\'s store never serves it after control (sp-x2\'s re-read of c93770ee65)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const disk = new Map<string, Response>(), plain = JSON.stringify({ ...manifest, parts: undefined });
  const at = { ...address, url: '/assets/spawn/example-overlap-blob-1234567890abcdef.json', bytes: plain.length };
  const binURL = new URL(bin.url, base).href;
  let storeReturns = (): void => undefined, storing = false;
  const stalled = new Promise<void>(resolve => { storeReturns = resolve; });
  const download = downloadSpawnManifest(at, {
    cached: url => Promise.resolve(disk.get(url)?.clone()),
    // the bin's store stalls (an unabortable storage call); the store itself lands when it returns
    store: async (url, response) => { if (url === binURL) { storing = true; await stalled; } disk.set(url, response); },
    fetch: url => Promise.resolve(new Response(new URL(url).pathname === at.url ? plain : body(new URL(url).pathname))),
  }, base);
  await vi.waitFor(() => { expect(storing).toBe(true); });
  download.cancel(); await expect(download.ready).rejects.toThrow();
  releaseSpawnMembers(); // control
  storeReturns(); await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(await (await window.fetch(binURL)).text()).toBe('network');
  vi.unstubAllGlobals();
});

test('DL11: a page read waiting on a listed file moves it to the front of the download (Pine\'s boot tables were 649th of 651)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 10}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 40});
  const at = {url: '/assets/spawn/example-demand-1234567890abcdef.json', bytes: plain.length, totalBytes: 40, files: 10};
  const order: string[] = [];
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: url => { const path = new URL(url).pathname; if (path !== at.url) order.push(path); return Promise.resolve(new Response(path === at.url ? plain : new Uint8Array(4))); },
  }, base);
  await download.listed;
  const last = rows[9]; if (last === undefined) throw new Error('Missing row');
  const reading = window.fetch(new URL(last.url, base).href);
  await download.ready; await reading;
  expect(order[0]).toBe(last.url);
  expect(new Set(order).size).toBe(10);
  vi.unstubAllGlobals();
});

test('DL11: two demanded files are fetched first in the order asked, once each (sp-x9\'s review of 62502f386c)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 10}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 40});
  const at = {url: '/assets/spawn/example-demand-two-1234567890abcdef.json', bytes: plain.length, totalBytes: 40, files: 10};
  const order: string[] = [];
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: url => { const path = new URL(url).pathname; if (path !== at.url) order.push(path); return Promise.resolve(new Response(path === at.url ? plain : new Uint8Array(4))); },
  }, base);
  await download.listed;
  const [eighth, ninth] = [rows[8], rows[9]]; if (eighth === undefined || ninth === undefined) throw new Error('Missing row');
  const reads = [window.fetch(new URL(ninth.url, base).href), window.fetch(new URL(eighth.url, base).href), window.fetch(new URL(ninth.url, base).href)];
  await download.ready; await Promise.all(reads);
  expect(order.slice(0, 2)).toEqual([ninth.url, eighth.url]);
  expect(order).toHaveLength(10);
  vi.unstubAllGlobals();
});

test('DL11: a page read of a versioned file\'s bare path waits for that file and reads its stored copy (Pine\'s card art)', async () => {
  // The build lists unhashed /assets files with ?v=<hash>; the page reads the bare path. It is the listed file, not an
  // unlisted read that waits for the whole set.
  const network = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network')));
  vi.stubGlobal('fetch', network);
  const disk = new Map<string, Response>();
  const real = '5d7c2f3d9613121977266f80ec7258fa83cb534f57aadebdf4e41b8dfd8aaa53'; // sha256 of the four 3s every file here holds
  const rows = [{url: '/assets/card.jpg?v=bf08299f', bytes: 4, hash: real}, {url: '/shardfiles/example/blobs/bin/'.concat('1'.repeat(64), '.bin'), bytes: 4, hash: real}];
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 8});
  const at = {url: '/assets/spawn/example-bare-1234567890abcdef.json', bytes: plain.length, totalBytes: 8, files: 2};
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const download = downloadSpawnManifest(at, {
    cached: url => Promise.resolve(disk.get(url)?.clone()),
    store: (url, response) => { disk.set(url, response); return Promise.resolve(); },
    fetch: async url => { const path = new URL(url).pathname; if (path === '/assets/card.jpg') await held; return new Response(path === at.url ? plain : new Uint8Array(4).fill(3)); },
  }, base);
  await download.listed;
  let done = false;
  const reading = (async () => { const card = new Uint8Array(await (await window.fetch(new URL('/assets/card.jpg', base).href)).arrayBuffer()); done = true; return card; })();
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(done).toBe(false); // waits for the listed file
  release(); await download.ready;
  expect(network).not.toHaveBeenCalled();
  expect((await reading).byteLength).toBe(4);
  vi.unstubAllGlobals();
});

test('DL11: a cancelled job\'s versioned routes never answer for the next job\'s bare file (sp-x2\'s review of c7e739c346)', async () => {
  // A lists /assets/card.jpg?v=aaaaaaaa and stores it, then stays busy; B lists the bare /assets/card.jpg and is still
  // fetching it when A is cancelled. A read of the bare path waits for B's file and gets B's bytes.
  const network = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network')));
  vi.stubGlobal('fetch', network);
  const disk = new Map<string, Response>(), one = new Uint8Array(4).fill(1), two = new Uint8Array(4).fill(2);
  const oneHash = '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1', twoHash = 'bb72b4e4eb29dc59328668f32e0511e3ac0e5ce4026b1591965216e49ca1f5d7';
  const manifestOf = (slug: string, rows: readonly {url: string; bytes: number; hash: string}[]): {text: string; at: {url: string; bytes: number; totalBytes: number; files: number}} => {
    const json = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: rows.length * 4});
    return {text: json, at: {url: `/assets/spawn/example-${slug}-1234567890abcdef.json`, bytes: json.length, totalBytes: rows.length * 4, files: rows.length}};
  };
  const busy = '/shardfiles/example/blobs/bin/'.concat('9'.repeat(64), '.bin');
  const first = manifestOf('route-a', [{url: '/assets/card.jpg?v=aaaaaaaa', bytes: 4, hash: oneHash}, {url: busy, bytes: 4, hash: oneHash}]);
  const second = manifestOf('route-b', [{url: '/assets/card.jpg', bytes: 4, hash: twoHash}]);
  const store = (url: string, response: Response): Promise<void> => { disk.set(url, response); return Promise.resolve(); };
  const cached = (url: string): Promise<Response | undefined> => Promise.resolve(disk.get(url)?.clone());
  const a = downloadSpawnManifest(first.at, {cached, store, fetch: async (url, signal) => {
    const path = new URL(url).pathname;
    if (path === busy) await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')); }); });
    return new Response(path === first.at.url ? first.text : one);
  }}, base);
  await vi.waitFor(() => { expect(disk.has(new URL('/assets/card.jpg?v=aaaaaaaa', base).href)).toBe(true); });
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const b = downloadSpawnManifest(second.at, {cached, store, fetch: async url => {
    const path = new URL(url).pathname;
    if (path === '/assets/card.jpg') await held;
    return new Response(path === second.at.url ? second.text : two);
  }}, base);
  await b.listed;
  a.cancel(); await expect(a.ready).rejects.toThrow(); // A's late cleanup
  let done = false;
  const reading = (async () => { const card = new Uint8Array(await (await window.fetch(new URL('/assets/card.jpg', base).href)).arrayBuffer()); done = true; return card; })();
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(done).toBe(false); // waits for B's file
  release(); await b.ready;
  expect(await reading).toEqual(two);
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('DL11: while a demanded file is in flight, manifest-order files run on at most two lanes', async () => {
  // Pine's sky models crawled at an eighth of the link: a demand must get the bandwidth, not only the next free lane.
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 12}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 48});
  const at = {url: '/assets/spawn/example-floor-1234567890abcdef.json', bytes: plain.length, totalBytes: 48, files: 12};
  const started: string[] = [], release = new Map<string, () => void>();
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: async url => {
      const path = new URL(url).pathname;
      if (path === at.url) return new Response(plain);
      started.push(path); await new Promise<void>(resolve => { release.set(path, resolve); });
      return new Response(new Uint8Array(4));
    },
  }, base);
  const path = (index: number): string => rows[index]?.url ?? '';
  const free = async (index: number): Promise<void> => { await vi.waitFor(() => { expect(release.has(path(index))).toBe(true); }); release.get(path(index))?.(); };
  await vi.waitFor(() => { expect(started).toHaveLength(8); }); // eight lanes on files 0-7
  const reading = window.fetch(new URL(path(11), base).href); // the page needs the last file
  await free(0);
  await vi.waitFor(() => { expect(started).toContain(path(11)); });
  for (let index = 1; index < 8; index++) await free(index);
  await vi.waitFor(() => { expect(started).toHaveLength(11); });
  await new Promise(resolve => { setTimeout(resolve, 10); });
  // the demand (11) plus at most two manifest-order files (8, 9); file 10 waits for the demand to land
  expect(started).not.toContain(path(10));
  await free(11);
  await vi.waitFor(() => { expect(started).toContain(path(10)); });
  for (const index of [8, 9, 10]) await free(index);
  await download.ready; await reading;
  vi.unstubAllGlobals();
});

test('DL11: a page read of a file a lane already took in manifest order still gets the link (sp-x9\'s review)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 12}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 48});
  const at = {url: '/assets/spawn/example-promote-1234567890abcdef.json', bytes: plain.length, totalBytes: 48, files: 12};
  const started: string[] = [], release = new Map<string, () => void>();
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: async url => {
      const path = new URL(url).pathname;
      if (path === at.url) return new Response(plain);
      started.push(path); await new Promise<void>(resolve => { release.set(path, resolve); });
      return new Response(new Uint8Array(4));
    },
  }, base);
  const path = (index: number): string => rows[index]?.url ?? '';
  const free = async (index: number): Promise<void> => { await vi.waitFor(() => { expect(release.has(path(index))).toBe(true); }); release.get(path(index))?.(); };
  await vi.waitFor(() => { expect(started).toHaveLength(8); });
  const reading = window.fetch(new URL(path(7), base).href); // already in flight as a manifest-order file
  for (let index = 0; index < 7; index++) await free(index);
  await vi.waitFor(() => { expect(started).toHaveLength(10); });
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(started).not.toContain(path(10)); // two manifest lanes beside the promoted demand
  await free(7);
  await vi.waitFor(() => { expect(started).toHaveLength(12); });
  for (const index of [8, 9, 10, 11]) await free(index);
  await download.ready; await reading;
  vi.unstubAllGlobals();
});

test('DL11: duplicate demands while lanes sleep at the floor fetch each file once (sp-x9\'s coverage gap)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 12}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 48});
  const at = {url: '/assets/spawn/example-dupes-1234567890abcdef.json', bytes: plain.length, totalBytes: 48, files: 12};
  const started: string[] = [], release = new Map<string, () => void>();
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined), store: () => Promise.resolve(),
    fetch: async url => {
      const path = new URL(url).pathname;
      if (path === at.url) return new Response(plain);
      started.push(path); await new Promise<void>(resolve => { release.set(path, resolve); });
      return new Response(new Uint8Array(4));
    },
  }, base);
  const path = (index: number): string => rows[index]?.url ?? '';
  const free = async (index: number): Promise<void> => { await vi.waitFor(() => { expect(release.has(path(index))).toBe(true); }); release.get(path(index))?.(); };
  await vi.waitFor(() => { expect(started).toHaveLength(8); });
  // the same two files asked for three times each while every lane is busy, then lanes free up one by one
  const reads = [11, 10, 11, 10, 11, 10].map(index => window.fetch(new URL(path(index), base).href));
  for (let index = 0; index < 8; index++) await free(index);
  await vi.waitFor(() => { expect(started).toEqual(expect.arrayContaining([path(10), path(11)])); });
  await free(11); await free(10);
  for (const index of [8, 9]) await free(index);
  await download.ready; await Promise.all(reads);
  expect(started.filter(row => row === path(10) || row === path(11))).toHaveLength(2);
  expect(new Set(started).size).toBe(started.length);
  vi.unstubAllGlobals();
});

test('DL11: a cancel while every store hangs settles at once and frees waiting reads (sp-x9\'s coverage gap)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const rows = Array.from({length: 4}, (_, at) => ({url: `/shardfiles/example/blobs/bin/${at.toString(16).repeat(64)}.bin`, bytes: 4, hash: 'f'.repeat(64)}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 16});
  const at = {url: '/assets/spawn/example-hung-store-1234567890abcdef.json', bytes: plain.length, totalBytes: 16, files: 4};
  let stores = 0;
  const download = downloadSpawnManifest(at, {
    cached: () => Promise.resolve(undefined),
    store: url => { if (!url.endsWith('.json')) stores++; return url.endsWith('.json') ? Promise.resolve() : new Promise<void>(() => { /* never returns */ }); },
    fetch: url => Promise.resolve(new Response(new URL(url).pathname === at.url ? plain : new Uint8Array(4))),
  }, base);
  await vi.waitFor(() => { expect(stores).toBe(4); }); // every lane is inside its store
  const reading = window.fetch(new URL(rows[3]?.url ?? '', base).href);
  download.cancel();
  await expect(download.ready).rejects.toThrow();
  expect(await (await reading).text()).toBe('network');
  vi.unstubAllGlobals();
});

test('DL20: a packs download counts parts read and failed reads', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const at = {...address, url: '/assets/spawn/example-dl20-ok-1234567890abcdef.json'};
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined), fetch: url => {
    const path = new URL(url).pathname;
    return Promise.resolve(new Response(path === at.url ? text : path === part.url ? partBytes : body(path)));
  }}, base);
  await download.ready;
  expect(download.snapshot().parts).toEqual({parts: 1, failed: 0, fallbackFiles: 0, fetched: 0});
  vi.unstubAllGlobals();
});

// sp-x1's coverage matrix: a fully cached packed boot returned before its counts existed, so it reported nothing
test('DL20: a fully cached packs download reports zero parts, not no parts', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const at = {...address, url: '/assets/spawn/example-dl20-cached-1234567890abcdef.json'};
  const download = downloadSpawnManifest(at, {packs: true, cached: url => Promise.resolve(new URL(url).pathname === at.url ? undefined : new Response('cached')),
    fetch: url => Promise.resolve(new Response(new URL(url).pathname === at.url ? text : 'unexpected'))}, base);
  await download.ready;
  expect(download.snapshot().parts).toEqual({parts: 0, failed: 0, fallbackFiles: 0, fetched: 0});
  vi.unstubAllGlobals();
});

test('DL11 slice 4: parts run on two lanes in order, and a read of a later part\'s member moves that part ahead', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const fills = [1, 2, 7, 1], hashes: Record<number, string> = {1: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1',
    2: 'bb72b4e4eb29dc59328668f32e0511e3ac0e5ce4026b1591965216e49ca1f5d7', 7: 'b451d8a7cc6defde9cb05a0bdc0b13e9c01860479d86fce7db4d093e0793b349'};
  const rows = fills.map((fill, at) => ({url: `/shardfiles/example/blobs/bin/${(at + 3).toString(16).repeat(64)}.bin`, bytes: 4, hash: hashes[fill] ?? ''}));
  const partRows = rows.map((_, at) => ({url: `/assets/spawn/parts/${(at + 10).toString(16).repeat(16).slice(0, 16)}.pack.br`, bytes: 4, hash: (at + 10).toString(16).repeat(64).slice(0, 64), members: [[at, 0]]}));
  const plain = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: rows, totalBytes: 16, parts: partRows});
  const at = {url: '/assets/spawn/example-part-lanes-1234567890abcdef.json', bytes: plain.length, totalBytes: 16, files: 4};
  const started: string[] = [], release = new Map<string, () => void>();
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: async url => {
      const path = new URL(url).pathname;
      if (path === at.url) return new Response(plain);
      started.push(path); await new Promise<void>(resolve => { release.set(path, resolve); });
      const index = partRows.findIndex(row => row.url === path);
      return new Response(new Uint8Array(4).fill(fills[index] ?? 0));
    }}, base);
  const free = async (index: number): Promise<void> => { const path = partRows[index]?.url ?? ''; await vi.waitFor(() => { expect(release.has(path)).toBe(true); }); release.get(path)?.(); };
  await vi.waitFor(() => { expect(started).toHaveLength(2); }); // two lanes: parts 0 and 1
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(started).toEqual([partRows[0]?.url, partRows[1]?.url]);
  const reading = window.fetch(new URL(rows[3]?.url ?? '', base).href); // the page needs the last part's member
  await free(0);
  await vi.waitFor(() => { expect(started).toHaveLength(3); });
  expect(started[2]).toBe(partRows[3]?.url); // the demanded part goes before part 2
  await free(3); await free(1); await free(2);
  await download.ready; await reading;
  vi.unstubAllGlobals();
});

test('DL13: a cancel while a member\'s keep stalls keeps nothing more from the same chunk (sp-x1\'s review)', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const at = {...address, url: '/assets/spawn/example-keep-cancel-1234567890abcdef.json'};
  const kept: string[] = [];
  let keepReturns = (): void => undefined;
  const stalled = new Promise<void>(resolve => { keepReturns = resolve; });
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined),
    // the whole part arrives in one chunk, so both members are cut from it; the first keep stalls
    keep: async url => { kept.push(new URL(url).pathname); if (kept.length === 1) await stalled; },
    fetch: url => { const path = new URL(url).pathname; return Promise.resolve(new Response(path === at.url ? text : path === part.url ? partBytes : body(path))); },
  }, base);
  await vi.waitFor(() => { expect(kept).toHaveLength(1); });
  download.cancel(); await expect(download.ready).rejects.toThrow();
  keepReturns(); await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(kept).toEqual([bin.url]); // the glb is never kept
  vi.unstubAllGlobals();
});

test('DL11 slice 4: a loose file a page read waits on is read while the parts run; manifest-order loose files wait for them', async () => {
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response('network'))));
  const header = {url: '/shardfiles/example/shard.json?v=12345678', bytes: 3, hash: 'e'.repeat(64)};
  const plain = JSON.stringify({...manifest, files: [bin, glb, code, header], totalBytes: 15});
  const at = {url: '/assets/spawn/example-loose-first-1234567890abcdef.json', bytes: plain.length, totalBytes: 15, files: 4};
  const started: string[] = [];
  let releasePart = (): void => undefined;
  const held = new Promise<void>(resolve => { releasePart = resolve; });
  const download = downloadSpawnManifest(at, {packs: true, cached: () => Promise.resolve(undefined),
    fetch: async url => {
      const path = new URL(url).pathname;
      if (path === at.url) return new Response(plain);
      started.push(path);
      if (path === part.url) { await held; return new Response(partBytes); }
      return new Response(new Uint8Array(3));
    }}, base);
  await vi.waitFor(() => { expect(started).toContain(part.url); });
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(started).toEqual([part.url]); // the loose code is not read beside the part
  const reading = window.fetch(new URL(header.url, base).href); // setup reads the product header
  await vi.waitFor(() => { expect(started).toContain('/shardfiles/example/shard.json'); }); // before the part lands
  expect((await reading).status).toBe(200);
  expect(started).not.toContain(code.url);
  releasePart();
  await download.ready;
  expect(started).toEqual([part.url, '/shardfiles/example/shard.json', code.url]);
  vi.unstubAllGlobals();
});

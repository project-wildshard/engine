// @vitest-environment happy-dom
// Standalone shardfiles SF11: no pin copies a zone's mounts under public/, so a page with no zone table (local build:game, the
// dev server, nightly-heads' cold cooks) reads a zone's file past its download from the zone's whole-level parts, as a
// zone-table page reads its cooked member (PV4). Every mount is in one tier's whole set: a phone-only one in the phone's
// (cook 1.19.0), any other in the desktop's. So a phone read of Pine's sky or Nine's lab texture, outside the phone sets,
// comes from the desktop part that holds it. The addresses are the row's own whole manifests, so a head nightly-heads swaps
// to its cold cook (here a placed row over a baked one) reads the cold cook's parts, never the baked build's.
import {createHash} from 'node:crypto';
import {expect, test, vi} from 'vitest';
import {installPlacedSpawn, clearPlacedSpawns} from '../src/client/game/boot/placedSpawn';
import {currentSpawnDownload, prefetchSpawnDownload, setSpawnPacks, spawnMountSize} from '../src/client/game/boot/spawnDownload';

// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', cold = 'https://cold.example.test/', baked = 'https://baked.example.test/';
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fence = Uint8Array.from([1, 2, 3, 4]), sky = new TextEncoder().encode('a made-up sky past the fence');
// a desktop fence file the whole manifest lists with no part: it sits loose beside the parts (Nalati's cover textures)
const cover = new TextEncoder().encode('a made-up loose cover texture');
const file = (url: string, bytes: Uint8Array) => ({url, bytes: bytes.length, hash: hash(bytes)});
const fenceUrl = '/assets/example/props/fenced.bin', skyUrl = '/assets/example/hdri/dusk.sky.jpg', coverUrl = '/assets/example/baked/cover.webp';
const coverListed = `${coverUrl}?v=${hash(cover).slice(0, 8)}`;
// a part: members at 16-byte steps
const packed = (bodies: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(bodies.length * 32); bodies.forEach((body, at) => { out.set(body, at * 32); }); return out;
};
const phonePart = packed([fence]), desktopPart = packed([fence, sky]);
const partRow = (_name: string, body: Uint8Array, count: number) => ({url: `/assets/spawn/parts/${hash(body).slice(0, 16)}.pack.br`, bytes: body.length, hash: hash(body),
  members: Array.from({length: count}, (_, at) => [at, at * 32])});
const manifest = (tier: string, files: ReturnType<typeof file>[], parts?: ReturnType<typeof partRow>[]) => JSON.stringify({version: 1, shard: 'example', tier, flow: 'client', files,
  totalBytes: files.reduce((sum, row) => sum + row.bytes, 0), ...parts === undefined ? {} : {parts}});
const entryPhone = manifest('phone', [file(fenceUrl, fence)]), entryDesktop = manifest('desktop', [file(fenceUrl, fence)]);
const wholePhone = manifest('phone', [file(fenceUrl, fence)], [partRow('a', phonePart, 1)]);
const wholeDesktop = manifest('desktop', [file(fenceUrl, fence), file(skyUrl, sky), file(coverListed, cover)], [partRow('b', desktopPart, 2)]);
const address = (name: string, text: string, files: number, total: number) => ({url: `/assets/spawn/example-${name}-1234567890abcdef.json`, bytes: text.length, totalBytes: total, files});

test("a phone page with no zone table reads a zone's file past its phone sets from the cold cook's desktop part", async () => {
  const reads: string[] = [];
  vi.stubGlobal('__BUILD_ID__', 'proof');
  // the baked build's own row names other manifests, at another base; the cold row placed over it wins
  const bakedRow = {phone: address('baked-entry-phone', entryPhone, 1, fence.length), desktop: address('baked-entry-desktop', entryDesktop, 1, fence.length)};
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {example: bakedRow}, home: {base: baked, shards: ['example']}}})}</script>`;
  // one asset cache, as a browser keeps it: a part's members are kept there and answered from it
  const kept = new Map<string, ArrayBuffer>();
  const store = {match: (url: string) => Promise.resolve(kept.has(url) ? new Response(kept.get(url)) : undefined), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: async (url: string, response: Response) => { kept.set(url, await response.arrayBuffer()); }};
  vi.stubGlobal('caches', {open: () => Promise.resolve(store)});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  const served = new Map<string, Uint8Array | string>([
    [`${cold}assets/spawn/example-entry-phone-1234567890abcdef.json`, entryPhone],
    [`${cold}assets/spawn/example-entry-desktop-1234567890abcdef.json`, entryDesktop],
    [`${cold}assets/spawn/example-whole-phone-1234567890abcdef.json`, wholePhone],
    [`${cold}assets/spawn/example-whole-desktop-1234567890abcdef.json`, wholeDesktop],
    [`${cold}${partRow('a', phonePart, 1).url.slice(1)}`, phonePart],
    [`${cold}${partRow('b', desktopPart, 2).url.slice(1)}`, desktopPart],
    [`${cold}${fenceUrl.slice(1)}`, fence],
    [`${cold}${coverListed.slice(1)}`, cover],
  ]);
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input).href; reads.push(url);
    const body = served.get(url);
    return Promise.resolve(body === undefined ? new Response('', {status: 404}) : new Response(typeof body === 'string' ? body : new Uint8Array(body)));
  }));
  installPlacedSpawn({slug: 'example', entry: {phone: address('entry-phone', entryPhone, 1, fence.length), desktop: address('entry-desktop', entryDesktop, 1, fence.length)},
    whole: {phone: address('whole-phone', wholePhone, 1, fence.length), desktop: address('whole-desktop', wholeDesktop, 3, fence.length + sky.length + cover.length)},
    base: cold, loose: cold, programs: false});
  setSpawnPacks(true); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  expect(currentSpawnDownload()?.snapshot()).toMatchObject({complete: true, error: null});
  // sized and read from the desktop part, a member the phone sets lack, never from the page or the baked base
  expect(await spawnMountSize(skyUrl)).toBe(sky.length);
  const response = await window.fetch(`${page}${skyUrl.slice(1)}`);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(sky);
  expect(reads).toContain(`${cold}${partRow('b', desktopPart, 2).url.slice(1)}`);
  // a loose file of that manifest is sized from its row and read beside the cold cook's parts, at its listed version
  expect(await spawnMountSize(coverUrl)).toBe(cover.length);
  const loose = await window.fetch(`${page}${coverUrl.slice(1)}`);
  expect(loose.status).toBe(200);
  expect(new Uint8Array(await loose.arrayBuffer())).toEqual(cover);
  expect(reads).toContain(`${cold}${coverListed.slice(1)}`);
  expect(reads.some(url => url.startsWith(baked) || url === `${page}${skyUrl.slice(1)}` || url === `${page}${coverUrl.slice(1)}`)).toBe(false);
  // a file no part holds still answers the page's 404, so its reader refuses it by name
  expect((await window.fetch(`${page}assets/example/hdri/gone.sky.jpg`)).status).toBe(404);
  expect(await spawnMountSize('/assets/example/hdri/gone.sky.jpg')).toBeUndefined();
  clearPlacedSpawns(); vi.unstubAllGlobals();
});

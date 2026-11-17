// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {currentSpawnDownload, dropStoredSpawnMembers, heldSpawnMembers, prefetchSpawnDownload, setSpawnPacks, spawnHeldBytes} from '../src/client/game/boot/spawnDownload';

// mini QA 2026-11-17 row 19 (Jake's iPhone 17 Pro, staging v0.1.36, Nine): the page was killed for memory right after the shaders
// step. Every part the spawn download read stayed whole in the page until control (48 parts, 106.5 MB at firstFrame in a Chromium
// heap snapshot), though each member was already in the store. A stored member leaves memory on its first read, and every
// stored member before the shaders step; later reads come from the store, checked against the manifest as before.
// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', hash = 'c'.repeat(64);
const bin = {url: `/shardfiles/example/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const glb = {url: `/shardfiles/example/blobs/glb/${'b'.repeat(64)}.glb`, bytes: 5, hash: '7dfd2b6c5b422920757984cf2cbce642dca9a05207c57af24ad995b2d90fb4e9'};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 21, hash, members: [[0, 0], [1, 16]]};
const partBytes: Uint8Array<ArrayBuffer> = Uint8Array.from({length: 21}, (_, at) => at < 4 ? 1 : at >= 16 ? 2 : 0);
const text = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: [bin, glb], totalBytes: 9, parts: [part]});
const address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 9, files: 2};

test('QA19: a stored part member leaves memory on its first read and before the shaders step, and still reads exactly', async () => {
  const reads: string[] = [], stored = new Map<string, Response>();
  vi.stubGlobal('__BUILD_ID__', 'proof');
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {example: {phone: {...address, url: '/assets/spawn/default.json'}}}}})}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: (url: string) => Promise.resolve(stored.get(url)?.clone()), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: (url: string, response: Response) => { stored.set(url, response); return Promise.resolve(); }})});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    const path = new URL(input).pathname; reads.push(path);
    if (path.endsWith('packs-proof.json')) return Promise.resolve(Response.json({book: 'packs', build: 'proof', client: {example: {phone: address}}}));
    if (path === address.url) return Promise.resolve(new Response(text));
    if (path === part.url) return Promise.resolve(new Response(partBytes));
    return Promise.resolve(new Response('', {status: 404}));
  }));
  setSpawnPacks(true); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  expect(heldSpawnMembers()).toBe(2);
  // the first read answers from the part, and the member goes: the store holds it
  const first = await fetch(`${page}${bin.url.slice(1)}`);
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(4).fill(1));
  expect(heldSpawnMembers()).toBe(1);
  reads.length = 0;
  // a second read of it is the store's verified copy, never the network
  const again = await fetch(`${page}${bin.url.slice(1)}`);
  expect(new Uint8Array(await again.arrayBuffer())).toEqual(new Uint8Array(4).fill(1));
  expect(reads).toEqual([]);
  // before the shaders step every stored member goes, read or not
  expect(dropStoredSpawnMembers()).toBe(1);
  expect(heldSpawnMembers()).toBe(0);
  const glbRead = await fetch(`${page}${glb.url.slice(1)}`);
  expect(new Uint8Array(await glbRead.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
  expect(new Uint8Array(await spawnHeldBytes(`${page}${glb.url.slice(1)}`) ?? new ArrayBuffer(0))).toEqual(new Uint8Array(5).fill(2));
  expect(reads).toEqual([]);
  vi.unstubAllGlobals();
});

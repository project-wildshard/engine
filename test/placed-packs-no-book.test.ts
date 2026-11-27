// @vitest-environment happy-dom
// Fix preview PV3 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a zoneless preview page ships no zone's
// row in its packs book (its zones are placed from the cook, PV4), so with Runtime packs on a placed zone's whole-level row is
// read without the book: a 404 book never holds its entry. Found by the headless entry proof (test/cooked-zones-browser.proof.mjs).
import {expect, test, vi} from 'vitest';
import {installPlacedSpawn, clearPlacedSpawns} from '../src/client/game/boot/placedSpawn';
import {currentSpawnDownload, prefetchSpawnDownload, setSpawnPacks} from '../src/client/game/boot/spawnDownload';

// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', hash = 'c'.repeat(64);
const bin = {url: `/shardfiles/example/sections/world/collision-${'a'.repeat(64)}.json`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 4, hash, members: [[0, 0]]};
const text = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: [bin], totalBytes: 4, parts: [part]});
const address = {url: '/assets/spawn/example-whole-phone-1234567890abcdef.json', bytes: text.length, totalBytes: 4, files: 1};

test('a placed zone\'s whole-level row downloads with Runtime packs on and never asks the page\'s book', async () => {
  const reads: string[] = [];
  vi.stubGlobal('__BUILD_ID__', 'proof');
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {}}})}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: () => Promise.resolve()})});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    const path = new URL(input).pathname; reads.push(path);
    if (path === address.url) return Promise.resolve(new Response(text));
    if (path === part.url) return Promise.resolve(new Response(Uint8Array.from([1, 1, 1, 1])));
    return Promise.resolve(new Response('', {status: 404}));
  }));
  installPlacedSpawn({slug: 'example', entry: {phone: {...address, url: '/assets/spawn/example-entry-phone-1234567890abcdef.json'}}, whole: {phone: address}, base: page, loose: page, programs: false});
  setSpawnPacks(true); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  expect(currentSpawnDownload()?.snapshot()).toMatchObject({complete: true, error: null, filesDone: 1});
  expect(reads.filter(path => path.includes('/packs-'))).toEqual([]);
  expect(reads).toContain(part.url);
  clearPlacedSpawns(); vi.unstubAllGlobals();
});

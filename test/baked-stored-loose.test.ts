// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {currentSpawnDownload, prefetchSpawnDownload, releaseSpawnMembers, setSpawnPacks} from '../src/client/game/boot/spawnDownload';

// SA48 (4de1e703e): a stored cook keeps its loose files only under its upload's folder. A build that baked it names that folder in
// `spawnManifests.home.loose`, and the page's reads of `/shardfiles/<slug>/` go there, as a placed slug's do (the boundaries red:
// cook-to-play's Brasscap asked the store for `shardfiles/brasscap-mesa/shard.json` and got 404).
// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', store = 'https://store.test/', hash = 'c'.repeat(64), loose = `loose/${hash}/`;
const bin = {url: '/shardfiles/example/sections/world/collision.json', bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 4, hash, members: [[0, 0]]};
const text = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: [bin], totalBytes: 4, parts: [part]});
const address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 4, files: 1};

test('a baked stored cook reads its loose files from its upload folder on the store', async () => {
  const reads: string[] = [];
  vi.stubGlobal('__BUILD_ID__', 'proof');
  const bank = {spawnManifests: {cacheName: 'assets', client: {example: {phone: {...address, url: '/assets/spawn/default.json'}}}, home: {base: store, shards: ['example'], loose: {example: loose}}}};
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify(bank)}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: () => Promise.resolve()})});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    const url = new URL(input); reads.push(url.origin + url.pathname);
    if (url.pathname.endsWith('packs-proof.json')) return Promise.resolve(Response.json({book: 'packs', build: 'proof', client: {example: {phone: address}}}));
    if (url.pathname === address.url) return Promise.resolve(new Response(text));
    if (url.pathname === part.url) return Promise.resolve(new Response(new Uint8Array(4).fill(1)));
    if (url.href === `${store}${loose}shardfiles/example/shard.json`) return Promise.resolve(new Response('header'));
    return Promise.resolve(new Response('', {status: 404}));
  }));
  setSpawnPacks(true); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  releaseSpawnMembers(); reads.length = 0;
  expect(await (await fetch(`${page}shardfiles/example/shard.json`)).text()).toBe('header');
  expect(reads.filter(read => read.includes('/shardfiles/'))).toEqual([`${store}${loose}shardfiles/example/shard.json`]);
  vi.unstubAllGlobals();
});

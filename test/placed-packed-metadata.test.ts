// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';
import {installPlacedSpawn,clearPlacedSpawns} from '../src/client/game/boot/placedSpawn';
import {currentSpawnDownload, prefetchSpawnDownload, releaseSpawnMembers, setSpawnPacks} from '../src/client/game/boot/spawnDownload';

// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', hash = 'c'.repeat(64);
const bin = {url: `/shardfiles/example/sections/world/collision-${'a'.repeat(64)}.json`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const glb = {url: `/shardfiles/example/sections/world/tiles-${'b'.repeat(64)}.json`, bytes: 5, hash: '7dfd2b6c5b422920757984cf2cbce642dca9a05207c57af24ad995b2d90fb4e9'};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 21, hash, members: [[0, 0], [1, 16]]};
const partBytes: Uint8Array<ArrayBuffer> = Uint8Array.from({length: 21}, (_, at) => at < 4 ? 1 : at >= 16 ? 2 : 0);
const text = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: [bin, glb], totalBytes: 9, parts: [part]});
const address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 9, files: 2};

test('a placed world reads packed metadata before probing a missing loose copy', async () => {
  const reads: string[] = [], stored = new Map<string, Response>();
  vi.stubGlobal('__BUILD_ID__', 'proof');
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {example: {phone: {...address, url: '/assets/spawn/default.json'}}}}})}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: (url: string) => Promise.resolve(stored.get(url)?.clone()), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: (url: string, response: Response) => { stored.set(url, response); return Promise.resolve(); }})});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    const path = new URL(input).pathname; reads.push(path);
    if (path.endsWith('packs-proof.json')) return Promise.resolve(Response.json({book: 'packs', build: 'proof', client: {}}));
    if (path === address.url) return Promise.resolve(new Response(text));
    if (path === part.url) return Promise.resolve(new Response(partBytes));
    if(path === '/loose/'+hash+'/shardfiles/example/shard.json')return Promise.resolve(new Response('header'));
    return Promise.resolve(new Response('', {status: 404}));
  }));
  installPlacedSpawn({slug:'example',entry:{phone:address},whole:{phone:address},base:page,loose:page+'loose/'+hash+'/',programs:false});
  setSpawnPacks(true); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  releaseSpawnMembers(); stored.clear(); reads.length = 0;
  const first = await fetch(`${page}${bin.url.slice(1)}`);
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(4).fill(1));
  expect(reads.filter(path => path === part.url)).toHaveLength(1);
  expect(reads.filter(path => path.startsWith('/loose/'))).toEqual([]);
  reads.length = 0;
  const second = await fetch(`${page}${glb.url.slice(1)}`);
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(5).fill(2));
  expect(reads).toEqual([]);
  expect(await(await fetch(page+'shardfiles/example/shard.json')).text()).toBe('header');
  expect(reads).toEqual(['/loose/'+hash+'/shardfiles/example/shard.json']);
  expect((await fetch(`${page}shardfiles/example/sections/world/collision-${'e'.repeat(64)}.json`)).status).toBe(404);
  clearPlacedSpawns(); vi.unstubAllGlobals();
});

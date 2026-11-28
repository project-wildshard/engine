// @vitest-environment happy-dom
// QA 11-28 row 2 (meta PLAY-IN-30S TP2): a cold Pine boot on staging fetched one 2.87 MB desktop part 33 times, once per
// member read through the zone's cooked `members` table (121 MB of repeats; ~30 s on a 2.8 MB/s phone link). Every reader
// of a cooked part's members now shares one read of it, and a later reader is answered from the kept copy.
import {createHash} from 'node:crypto';
import {expect, test, vi} from 'vitest';
import {clearCookedObjects, installCookedMembers} from '@wildshard/engine/boot/contentBase';
import {currentSpawnDownload, forgetCookedParts, prefetchSpawnDownload, releaseSpawnMembers, setSpawnPacks} from '../src/client/game/boot/spawnDownload';

// In a file of its own: the member layer keeps the first network it wraps, so this page's fetch has to be the first.
const page = 'https://example.test/', sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const loose = {url: `/shardfiles/example/sections/world/collision-${'a'.repeat(64)}.json`, bytes: 4};
const looseBytes = new Uint8Array(4).fill(1);
const text = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files: [{...loose, hash: sha(looseBytes)}], totalBytes: 4});
const address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 4, files: 1};
const part = 'https://cooked.example/shards/other/0.0.1/cooks/1.0.0/assets/spawn/parts/7f9f5ded40b52d6f.pack.br';
const missing = 'https://cooked.example/shards/other/0.0.1/cooks/1.0.0/assets/spawn/parts/0000000000000000.pack.br';
const partBytes = Uint8Array.from({length: 64}, (_, at) => at);
const models = Array.from({length: 8}, (_, at) => ({path: `/shardfiles/other/blobs/glb/${String(at).repeat(64)}.glb`, offset: at * 8, bytes: 8}));

test('every reader of a cooked part shares one read of it, and a later reader is answered without the network', async () => {
  const reads: string[] = [];
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('__BUILD_ID__', 'proof');
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {example: {phone: address}}}})}</script>`;
  const stored = new Map<string, Response>();
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: (url: string) => Promise.resolve(stored.get(url)?.clone()), keys: () => Promise.resolve([]), matchAll: () => Promise.resolve([]),
    put: (url: string, response: Response) => { stored.set(url, response); return Promise.resolve(); }}), match: () => Promise.resolve(undefined)});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(input instanceof URL ? input.href : input); reads.push(url.href);
    if (url.pathname.endsWith('packs-proof.json')) return Response.json({book: 'packs', build: 'proof', client: {}});
    if (url.pathname === address.url) return new Response(text);
    if (url.pathname === loose.url) return new Response(looseBytes);
    if (url.href === part) { await held; return new Response(partBytes); }
    return new Response('', {status: 404});
  }));
  setSpawnPacks(false); prefetchSpawnDownload('example', 'phone', 'client');
  await currentSpawnDownload()?.ready;
  releaseSpawnMembers(); forgetCookedParts(); reads.length = 0;
  installCookedMembers(models.map(model => [model.path, {part, offset: model.offset, bytes: model.bytes, hash: sha(partBytes.subarray(model.offset, model.offset + model.bytes))}]));
  installCookedMembers([['/shardfiles/other/blobs/glb/gone.glb', {part: missing, offset: 0, bytes: 8, hash: 'f'.repeat(64)}]]);

  // six readers at once (Spawn detail's model reads), one of which gives up: one network read of the part
  const quitter = new AbortController();
  const first = models.slice(0, 6).map((model, at) => fetch(`${page}${model.path.slice(1)}`, at === 5 ? {signal: quitter.signal} : {}));
  quitter.abort(new DOMException('gone', 'AbortError'));
  release();
  const answered = await Promise.allSettled(first);
  expect(answered.filter(row => row.status === 'fulfilled')).toHaveLength(5);
  expect(answered[5]?.status).toBe('rejected');
  for (const [at, row] of answered.slice(0, 5).entries()) {
    if (row.status !== 'fulfilled') throw new Error('unanswered read');
    expect(new Uint8Array(await row.value.arrayBuffer())).toEqual(partBytes.subarray(at * 8, at * 8 + 8));
  }
  expect(reads.filter(url => url === part)).toHaveLength(1);

  // later readers of the same part (the next step's models) are answered from the kept copy
  const later = await Promise.all(models.slice(6).map(model => fetch(`${page}${model.path.slice(1)}`)));
  expect(later.map(response => response.status)).toEqual([200, 200]);
  expect(reads.filter(url => url === part)).toHaveLength(1);

  // a part the bucket doesn't have keeps its status for the reader
  expect((await fetch(`${page}shardfiles/other/blobs/glb/gone.glb`)).status).toBe(404);
  clearCookedObjects(); forgetCookedParts(); vi.unstubAllGlobals();
});

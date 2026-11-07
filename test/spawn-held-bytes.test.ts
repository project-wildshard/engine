// @vitest-environment happy-dom
import {afterEach, expect, test, vi} from 'vitest';
import {downloadSpawnManifest, releaseSpawnMembers, spawnHeldBytes, type SpawnDownloadPorts} from '../src/client/game/boot/spawnDownload';

// DL25: what the server worker is lent. Bodies are real: every copy is checked against its manifest row.
const hash = 'c'.repeat(64), base = 'https://example.test/';
const bin = {url: `/shardfiles/held/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: '27ecd0a598e76f8a2fd264d427df0a119903e8eae384e478902541756f089dd1'};
const header = {url: '/shardfiles/held/shard.json?v=9f86d081', bytes: 4, hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'};
const part = {url: `/assets/spawn/parts/${hash.slice(0, 16)}.pack.br`, bytes: 4, hash, members: [[0, 0]]};
const manifest = {version: 1, shard: 'held', tier: 'phone', flow: 'client', files: [bin, header], totalBytes: 8, parts: [part]};
const text = JSON.stringify(manifest), address = {url: '/assets/spawn/held-1234567890abcdef.json', bytes: text.length, totalBytes: 8, files: 2};
const bytesOf = (path: string): Uint8Array<ArrayBuffer> => path === part.url ? new Uint8Array(4).fill(1) : new TextEncoder().encode('test');
const download = (ports: Partial<SpawnDownloadPorts> = {}, wait: Promise<void> = Promise.resolve()): ReturnType<typeof downloadSpawnManifest> => downloadSpawnManifest(address, {packs: true, cached: () => Promise.resolve(undefined),
  fetch: async url => { const path = new URL(url).pathname + new URL(url).search; if (path === part.url) await wait; return new Response(path === address.url ? text : bytesOf(path)); }, ...ports}, base);
afterEach(() => { releaseSpawnMembers(); vi.restoreAllMocks(); });

test('a member still arriving is waited for, and only its own bytes cross', async () => {
  let land = (): void => undefined;
  const job = download({}, new Promise(resolve => { land = resolve; }));
  await vi.waitFor(async () => { await job.listed; });
  const asked = spawnHeldBytes(new URL(bin.url, base).href);
  land();
  const bytes = await asked;
  expect(bytes === null ? null : [...new Uint8Array(bytes)]).toEqual([1, 1, 1, 1]);
  await job.ready;
});

test('a bare path finds the versioned file, and after control the store answers, its bytes checked', async () => {
  const store = new Map<string, Response>();
  const job = download({keep: (url, response) => { store.set(url, response); return Promise.resolve(); }, cached: url => Promise.resolve(store.get(url)?.clone())});
  await job.ready;
  store.set(new URL(header.url, base).href, new Response(bytesOf(header.url)));
  releaseSpawnMembers();
  const read = await spawnHeldBytes(`${base}shardfiles/held/shard.json`);
  expect(read === null ? null : new TextDecoder().decode(read)).toBe('test');
  expect(await spawnHeldBytes(new URL(bin.url, base).href)).not.toBeNull();
  store.set(new URL(bin.url, base).href, new Response(new Uint8Array(4).fill(9)));
  expect(await spawnHeldBytes(new URL(bin.url, base).href)).toBeNull(); // corrupt: the worker reads the network
  store.set(new URL(bin.url, base).href, new Response('<html>', {headers: {'content-type': 'text/html'}}));
  expect(await spawnHeldBytes(new URL(bin.url, base).href)).toBeNull();
});

test('a file no download listed is not the page\'s', async () => {
  expect(await spawnHeldBytes(`${base}shardfiles/server-class/held/server/a.bin`)).toBeNull();
});

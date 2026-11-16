// @vitest-environment happy-dom
// ZONE-ENTRY ZE14: offline, a gate to a cell this device never downloaded says "Not downloaded" and never starts an entry that
// would stop on its loading card (OF13: a cold shard stops at START). `spawnHeld` is the yes: the cell's grid manifest and
// every file it lists are in a cache.
import {afterEach, expect, test, vi} from 'vitest';
import {spawnHeld} from '../src/client/game/boot/spawnDownload';

const HASH = 'a'.repeat(64), MANIFEST = '/assets/spawn/grid/000/nalati-grasslands-phone.json';
const FILES = [{url: '/shardfiles/nalati-grasslands/shard.json', bytes: 10, hash: HASH}, {url: '/shardfiles/nalati-grasslands/blobs/glb/b.glb', bytes: 20, hash: HASH}];
function bank(): void {
  document.getElementById('boot-module-files')?.remove();
  const script = document.createElement('script');
  script.type = 'application/json'; script.id = 'boot-module-files';
  script.textContent = JSON.stringify({spawnManifests: {cacheName: 'assets-test', grid: {'000': {'nalati-grasslands': {phone: {url: MANIFEST, bytes: 100, totalBytes: 30, files: 2}}}}}});
  document.head.append(script);
}
function cached(urls: readonly string[]): void {
  const held = new Map<string, Response>();
  for (const url of urls) held.set(new URL(url, document.baseURI).href, url === MANIFEST
    ? Response.json({version: 1, shard: 'nalati-grasslands', tier: 'phone', flow: 'grid', totalBytes: 30, files: FILES})
    : new Response('x'));
  vi.stubGlobal('caches', {match: (url: string) => Promise.resolve(held.get(url)?.clone())});
}
afterEach(() => { vi.unstubAllGlobals(); });

test('a cell is downloaded only when its manifest and every file it lists are cached', async () => {
  bank();
  cached([]);
  expect(await spawnHeld('nalati-grasslands', 'grid', 'phone')).toBe(false);
  cached([MANIFEST, FILES[0]?.url ?? '']);
  expect(await spawnHeld('nalati-grasslands', 'grid', 'phone'), 'one file missing').toBe(false);
  cached([MANIFEST, ...FILES.map(file => file.url)]);
  expect(await spawnHeld('nalati-grasslands', 'grid', 'phone')).toBe(true);
  expect(await spawnHeld('far-reach', 'grid', 'phone'), 'a cell the build has no manifest for').toBe(false);
});

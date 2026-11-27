// @vitest-environment happy-dom
// Standalone shardfiles SF11: no pin copies a zone's mounts under public/, so the session sizes each boot file the page's tables
// don't list from the zone's cook before it totals them (session/data.ts). A fence zone's phone-only file past its fence (Pine's
// baked/rain.phone.bin) rides in its phone whole set (cook 1.19.0), so its size is that part table's row; a file no set carries
// stays unsized, and the boot refuses it by name.
import {expect, test, vi} from 'vitest';
import {installPlacedSpawn, clearPlacedSpawns} from '../src/client/game/boot/placedSpawn';
import {spawnMountSize} from '../src/client/game/boot/spawnDownload';

const page = 'https://example.test/', fence = '/assets/example/props/fenced.glb', rain = '/assets/example/baked/rain.phone.bin';
const files = [{url: fence, bytes: 7, hash: '7'.repeat(64)}, {url: rain, bytes: 79, hash: '9'.repeat(64)}];
const part = {url: `/assets/spawn/parts/${'c'.repeat(16)}.pack.br`, bytes: 96, hash: 'c'.repeat(64), members: [[0, 0], [1, 16]]};
const whole = JSON.stringify({version: 1, shard: 'example', tier: 'phone', flow: 'client', files, totalBytes: 86, parts: [part]});
const address = (name: string, text: string, total: number, count: number) =>
  ({url: `/assets/spawn/example-${name}-1234567890abcdef.json`, bytes: text.length, totalBytes: total, files: count});

test("a fence zone's phone-only file past its fence is sized from the phone whole set", async () => {
  vi.stubGlobal('__BUILD_ID__', 'proof');
  document.body.innerHTML = `<script id="boot-module-files" type="application/json">${JSON.stringify({spawnManifests: {cacheName: 'assets', client: {}}})}</script>`;
  vi.stubGlobal('caches', {open: () => Promise.resolve({match: () => Promise.resolve(undefined), keys: () => Promise.resolve([]), put: () => Promise.resolve()})});
  vi.stubGlobal('location', new URL(page));
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(page);
  const wholePhone = address('whole-phone', whole, 86, 2);
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => Promise.resolve(new URL(input).pathname === wholePhone.url ? new Response(whole) : new Response('', {status: 404}))));
  installPlacedSpawn({slug: 'example', entry: {phone: address('entry-phone', whole, 7, 1)}, whole: {phone: wholePhone}, base: page, loose: page, programs: false});
  expect(await spawnMountSize(rain)).toBe(79);
  expect(await spawnMountSize('/assets/example/baked/gone.phone.bin')).toBeUndefined();
  clearPlacedSpawns(); vi.unstubAllGlobals();
});

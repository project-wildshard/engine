// @vitest-environment happy-dom
// PAGE-SIZE PZ3 (J276): one boot-bank field, `contentBase`, moves every content read to the content origin; empty
// changes nothing. Each reader is pinned against a cross-origin base, and against no base.
import {afterEach, expect, test, vi} from 'vitest';
import {contentBase, contentURL, isContentOrigin, pageURL, readContentBase} from '../src/client/engine/boot/contentBase';
import {versionedUrl} from '../src/client/engine/boot/bytes';
import {downloadSpawnManifest, releaseSpawnMembers, setSpawnPacks, shardPackBase, spawnHeldBytes, startSpawnDownload} from '../src/client/game/boot/spawnDownload';
import {prefetchEntryReads} from '../src/client/game/grid/entryReadPrefetch';
import {readServerProduct} from '../src/server/host/standalone/serverProduct';
import type {Rapier} from '../src/shared/engine/physics/rapier';
import {installAssetTables} from '../src/shared/engine/boot/tables';

const CDN = 'https://packs.example.test/';
const page = (): string => new URL('/', document.baseURI).href;
function bank(fields: Record<string, unknown>): void {
  document.getElementById('boot-module-files')?.remove();
  const script = document.createElement('script');
  script.type = 'application/json'; script.id = 'boot-module-files'; script.textContent = JSON.stringify(fields);
  document.head.append(script);
}
installAssetTables({bytes: {}, versions: {'/assets/pine-hollow/v.jpg': 'abcd1234'}, music: {}, sfx: {}, packs: {}});
afterEach(() => { document.getElementById('boot-module-files')?.remove(); releaseSpawnMembers(); setSpawnPacks(false); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('the bank names an origin or nothing', () => {
  expect(readContentBase(undefined)).toBe('');
  expect(readContentBase('')).toBe('');
  expect(readContentBase('https://packs.wildshard.io')).toBe('https://packs.wildshard.io/');
  for (const bad of ['https://packs.wildshard.io/shards/', 'ftp://x.test/', 'https://x.test/?a', '/relative/', 7]) expect(() => readContentBase(bad)).toThrow(/contentBase/u);
});

test('empty: every reader keeps the page URL', () => {
  bank({});
  expect(contentBase()).toBe('');
  for (const url of ['/shardfiles/driftwood-isle/', '/assets/spawn/packs-b.json', '/assets/tex/a/diffuse.jpg']) expect(contentURL(url)).toBe(url);
  expect(versionedUrl('/assets/models/x/x.gltf')).toBe('/assets/models/x/x.gltf');
  expect(shardPackBase('driftwood-isle')).toBe(document.baseURI);
  expect(isContentOrigin(CDN.slice(0, -1))).toBe(false);
  bank({contentBase: ''});
  expect(contentURL('/shardfiles/driftwood-isle/shard.json')).toBe('/shardfiles/driftwood-isle/shard.json');
});

test('a base moves shard products, programs, books, parts and art; code and physics stay', () => {
  bank({contentBase: CDN});
  expect(contentURL('/shardfiles/driftwood-isle/')).toBe(`${CDN}shardfiles/driftwood-isle/`);
  expect(contentURL(`${page()}shardfiles/pine-hollow/blobs/glb/a.glb`)).toBe(`${CDN}shardfiles/pine-hollow/blobs/glb/a.glb`);
  expect(contentURL('/assets/spawn/parts/0123456789abcdef.pack.br')).toBe(`${CDN}assets/spawn/parts/0123456789abcdef.pack.br`);
  expect(contentURL('/programs/driftwood-isle.json')).toBe(`${CDN}programs/driftwood-isle.json`);
  expect(contentURL('/assets/pine-hollow/a.jpg?v=12345678')).toBe(`${CDN}assets/pine-hollow/a.jpg?v=12345678`);
  for (const stays of ['/assets/physics/rapier.wasm', '/b/build/standalone/shell.js', '/assets/x.js', '/version.json', '/basis/basis_transcoder.wasm', 'https://elsewhere.test/shardfiles/a/']) expect(contentURL(stays)).toBe(stays);
  // J138: a content URL stands for its page URL in the member store
  expect(pageURL(`${CDN}shardfiles/driftwood-isle/shard.json?v=1`)).toBe(`${page()}shardfiles/driftwood-isle/shard.json?v=1`);
  expect(pageURL('https://elsewhere.test/shardfiles/a/b.bin')).toBe('https://elsewhere.test/shardfiles/a/b.bin');
  expect(isContentOrigin(new URL(CDN).origin)).toBe(true);
  // the engine-art loader (D1): three's URL modifier and every versioned read
  expect(versionedUrl('/assets/models/x/x.gltf')).toBe(`${CDN}assets/models/x/x.gltf`);
  expect(versionedUrl('/assets/pine-hollow/v.jpg')).toBe(`${CDN}assets/pine-hollow/v.jpg?v=abcd1234`);
  // programs and cooked manifests (J138's home still wins for a shard it names)
  expect(shardPackBase('driftwood-isle')).toBe(CDN);
  bank({contentBase: CDN, spawnManifests: {home: {shards: ['cooked'], base: 'https://home.test/'}}});
  expect(shardPackBase('cooked')).toBe('https://home.test/');
  expect(shardPackBase('driftwood-isle')).toBe(CDN);
});

test('the runtime product reads from the content base', async () => {
  const {productBase} = await import('../src/client/game/shardfile/runtimeProduct');
  bank({});
  expect(productBase('driftwood-isle')).toBe(`${page()}shardfiles/driftwood-isle/`);
  bank({contentBase: CDN});
  expect(productBase('driftwood-isle')).toBe(`${CDN}shardfiles/driftwood-isle/`);
});

test('the entry-read record is read from the content base', async () => {
  bank({contentBase: CDN});
  const asked: string[] = [];
  await prefetchEntryReads('pine-hollow', 'phone', {source: {files: []}, readBlob: () => Promise.resolve(), fetchAsset: () => Promise.resolve(), reserve: () => null,
    fetchJson: url => { asked.push(url); return Promise.reject(new Error('none')); }}, new AbortController().signal);
  expect(asked).toEqual([`${CDN}assets/pine-hollow/entry-reads.json`]);
});

test('the spawn download reads its book, manifest and files from the base, keyed by page URL', async () => {
  const text = JSON.stringify({version: 1, shard: 'fixture', tier: 'phone', flow: 'client', totalBytes: 3,
    files: [{url: '/shardfiles/fixture/blobs/bin/a.bin', bytes: 3, hash: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'}]});
  const address = {url: '/assets/spawn/fixture-client-phone-0123456789abcdef.json', bytes: text.length, totalBytes: 3, files: 1};
  bank({contentBase: CDN, spawnManifests: {cacheName: 'ws-assets-v1', client: {fixture: {phone: address}}}});
  vi.stubGlobal('caches', undefined);
  const reads: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input); reads.push(url);
    const path = new URL(url).pathname;
    return Promise.resolve(path === address.url ? new Response(text) : path.endsWith('/a.bin') ? new Response(new Uint8Array([1, 2, 3])) : new Response(null, {status: 404}));
  });
  const download = startSpawnDownload('fixture', 'client', 'phone');
  if (download === null) throw new Error('Missing spawn download');
  await download.ready;
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(url => url.startsWith(CDN))).toBe(true);
  expect(download.resolve('/shardfiles/fixture/blobs/bin/a.bin')).toBe(`${page()}shardfiles/fixture/blobs/bin/a.bin`);
});

test('the packs book comes from the base', async () => {
  bank({contentBase: CDN, spawnManifests: {cacheName: 'ws-assets-v1', client: {booked: {phone: {url: '/assets/spawn/booked-client-phone-0123456789abcdef.json', bytes: 1, totalBytes: 1, files: 1}}}}});
  vi.stubGlobal('caches', undefined); vi.stubGlobal('__BUILD_ID__', 'build-booked');
  const reads: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL): Promise<Response> => { reads.push(input instanceof Request ? input.url : String(input)); return Promise.resolve(new Response(null, {status: 404})); });
  setSpawnPacks(true);
  const download = startSpawnDownload('booked', 'client', 'phone');
  await expect(download?.ready).rejects.toThrow(/Packs book unavailable/u);
  expect(reads).toEqual([`${CDN}assets/spawn/packs-build-booked.json`]);
});

test('a download whose files arrive by content URL still serves the member store by page URL', async () => {
  bank({contentBase: CDN});
  const file = {url: '/shardfiles/held/blobs/bin/b.bin', bytes: 4, hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'};
  const text = JSON.stringify({version: 1, shard: 'held', tier: 'phone', flow: 'client', files: [file], totalBytes: 4});
  const fetched: string[] = [], store = new Map<string, Response>();
  const job = downloadSpawnManifest({url: '/assets/spawn/held-1234567890abcdef.json', bytes: text.length, totalBytes: 4, files: 1}, {
    cached: url => Promise.resolve(store.get(url)?.clone()), store: (url, response) => { store.set(url, response); return Promise.resolve(); },
    fetch: url => { fetched.push(url); return Promise.resolve(new Response(new URL(url).pathname.endsWith('.json') ? text : 'test')); }}, document.baseURI, CDN);
  await job.ready;
  expect(fetched.every(url => url.startsWith(CDN))).toBe(true);
  expect(job.resolve(file.url)).toBe(`${page()}shardfiles/held/blobs/bin/b.bin`);
  expect([...store.keys()]).toContain(`${page()}shardfiles/held/blobs/bin/b.bin`);
  const held = await spawnHeldBytes(`${CDN}shardfiles/held/blobs/bin/b.bin`);
  expect(held === null ? null : new TextDecoder().decode(held)).toBe('test');
});

test('the solo server worker reads its book and parts from the base it is handed', async () => {
  bank({contentBase: CDN});
  const base = contentURL('/shardfiles/driftwood-isle/'), asked: string[] = [];
  expect(base).toBe(`${CDN}shardfiles/driftwood-isle/`);
  const book = JSON.stringify({book: 'server', build: 'b1', shards: {'driftwood-isle': {parts: [{url: '/assets/spawn/server/0123456789abcdef.pack.br', bytes: 1, hash: 'a'.repeat(64), files: [['shard.json', 0, 1, 'b'.repeat(64)]]}]}}});
  await readServerProduct(base, () => 'b1', url => { asked.push(url.href); return Promise.resolve(url.pathname.endsWith('.json') ? new TextEncoder().encode(book) : new Uint8Array([123])); }, {} as Rapier).catch(() => undefined);
  expect(asked[0]).toBe(`${CDN}assets/spawn/server-b1.json`);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every(url => url.startsWith(CDN))).toBe(true);
  // no base: the worker's base is the page path it always was
  bank({});
  expect(contentURL('/shardfiles/driftwood-isle/')).toBe('/shardfiles/driftwood-isle/');
});

test('on the content base the spawn download moves content only: code and rapier stay with the page', async () => {
  bank({contentBase: CDN});
  const files = [['/shardfiles/mixed/blobs/bin/c.bin', 'test'], ['/b/build/entry.js', 'code'], ['/assets/physics/rapier.wasm', 'wasm']].map(([url, body]) => ({url, bytes: 4, body}));
  const hashes = await Promise.all(files.map(async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.body))), byte => byte.toString(16).padStart(2, '0')).join('')));
  const text = JSON.stringify({version: 1, shard: 'mixed', tier: 'phone', flow: 'client', totalBytes: 12, files: files.map((file, at) => ({url: file.url, bytes: 4, hash: hashes[at]}))});
  const fetched: string[] = [];
  const job = downloadSpawnManifest({url: '/assets/spawn/mixed-1234567890abcdef.json', bytes: text.length, totalBytes: 12, files: 3}, {cached: () => Promise.resolve(undefined),
    fetch: url => { fetched.push(url); const path = new URL(url).pathname; return Promise.resolve(new Response(path.endsWith('.json') ? text : files.find(file => file.url === path)?.body ?? '')); }}, document.baseURI, CDN);
  await job.ready;
  expect(fetched.sort()).toEqual([`${CDN}assets/spawn/mixed-1234567890abcdef.json`, `${CDN}shardfiles/mixed/blobs/bin/c.bin`, `${page()}assets/physics/rapier.wasm`, `${page()}b/build/entry.js`].sort());
});

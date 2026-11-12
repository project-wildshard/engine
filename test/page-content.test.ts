// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a built page tree under the repository's tmp; the fake bucket hashes it.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is a built page tree under the repository's tmp.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under tmp.
import {dirname, join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A `.pack.br` part is stored Brotli and read back decoded.
import {brotliCompressSync, brotliDecompressSync} from 'node:zlib';
import {afterEach, expect, test} from 'vitest';
import {contentBaseOf, contentHeaders, contentKey, contentSet, publishContent, r2Content, scanContent, type ContentStore, type Put} from '../scripts/page-release/content.mjs';

const ORIGIN = 'https://play.wildshard.io';
const scratchRoot = resolve(import.meta.dirname, '../tmp/page-content-test');
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, {recursive: true, force: true}); });

function page(extra: Record<string, string | Uint8Array> = {}) {
  mkdirSync(scratchRoot, {recursive: true});
  const dir = mkdtempSync(join(scratchRoot, 'dist-'));
  made.push(dir);
  const files: Record<string, string | Uint8Array> = {
    'index.html': '<html></html>',
    'sw.js': 'self;',
    'b/abc/main-0123456789abcdef.js': 'code',
    'b/abc/main-0123456789abcdef.js.map': '{}',
    'assets/physics/rapier.wasm': 'wasm',
    'shardfiles/pine-hollow/shard.json': '{"slug":"pine-hollow"}',
    'shardfiles/pine-hollow/blobs/glb/aa.glb': 'glb',
    'assets/spawn/parts/0123456789abcdef.pack.br': brotliCompressSync(Buffer.from('part bytes')),
    'assets/spawn/server/fedcba9876543210.pack.br': brotliCompressSync(Buffer.from('server part')),
    'assets/spawn/server-build.json': '{"build":"x"}',
    'assets/spawn/packs-build.json': '{}',
    'programs/pine-hollow.json': '{}',
    'assets/grid-strip-mesh-0123456789abcdef.bin': 'grid',
    'assets/pine-hollow/tree.png': 'png',
    'assets/tex/rock.ktx2': 'ktx2',
    ...extra,
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

/** An in-memory bucket behind a CDN that answers the game's Origin, decoding `Content-Encoding: br` as a browser does. */
function fakeBucket(objects = new Map<string, {body: Uint8Array, headers: Put['headers']}>()) {
  const puts: string[] = [];
  let corrupt: string | undefined, cors: string | undefined;
  const store: ContentStore = {
    exists: key => Promise.resolve(objects.has(key)),
    put: items => {
      for (const item of items) { puts.push(item.key); objects.set(item.key, {body: readFileSync(item.file), headers: item.headers}); }
      return Promise.resolve();
    },
    read: (key, origin) => {
      const object = objects.get(key);
      if (object === undefined) return Promise.resolve({status: 404, cors: origin, bytes: new Uint8Array()});
      const decoded = object.headers.encoding === 'br' ? brotliDecompressSync(object.body) : object.body;
      return Promise.resolve({status: 200, cors: cors ?? origin, bytes: key === corrupt ? Buffer.from('other bytes') : decoded});
    },
  };
  return {store, objects, puts, corruptKey: (key: string) => { corrupt = key; }, answerCors: (value: string) => { cors = value; }};
}

const run = (dir: string, store: ContentStore) => publishContent({dir, store, scratch: join(scratchRoot, 'scratch'), origin: ORIGIN, log: () => undefined, sleep: () => Promise.resolve()});

test('keys: one content-named set mirrors page paths, S1 to S7 and engine art only, with the cook headers', () => {
  const dir = page(), files = scanContent(dir), set = contentSet(files);
  expect(set).toMatch(/^[0-9a-f]{16}$/u);
  expect(Object.fromEntries(files.map(file => [file.path, file.kind]))).toEqual({
    'assets/grid-strip-mesh-0123456789abcdef.bin': 'S6',
    'assets/pine-hollow/tree.png': 'S7',
    'assets/spawn/packs-build.json': 'S4',
    'assets/spawn/parts/0123456789abcdef.pack.br': 'S2',
    'assets/spawn/server-build.json': 'S3',
    'assets/spawn/server/fedcba9876543210.pack.br': 'S3',
    'assets/tex/rock.ktx2': 'E1',
    'programs/pine-hollow.json': 'S5',
    'shardfiles/pine-hollow/blobs/glb/aa.glb': 'S1',
    'shardfiles/pine-hollow/shard.json': 'S1',
  });
  expect(contentKey(set, 'shardfiles/pine-hollow/shard.json')).toBe(`content/${set}/shardfiles/pine-hollow/shard.json`);
  expect(contentBaseOf(set)).toBe(`https://packs.wildshard.io/content/${set}/`);
  expect(contentHeaders('assets/spawn/parts/0123456789abcdef.pack.br')).toEqual({type: 'application/octet-stream', encoding: 'br', cache: 'public, max-age=31536000, immutable'});
  expect(contentHeaders('shardfiles/pine-hollow/shard.json')).toEqual({type: 'application/json', cache: 'public, max-age=31536000, immutable'});
  // The same content names the same set; one changed byte names another.
  expect(contentSet(scanContent(page()))).toBe(set);
  expect(contentSet(scanContent(page({'shardfiles/pine-hollow/shard.json': '{"slug":"pine-hollow","v":2}'})))).not.toBe(set);
});

test('publish skips present keys, puts the rest with the index last, and a second run uploads nothing', async () => {
  const dir = page(), set = contentSet(scanContent(dir)), bucket = fakeBucket();
  const held = contentKey(set, 'assets/spawn/server/fedcba9876543210.pack.br');
  bucket.objects.set(held, {body: readFileSync(join(dir, 'assets/spawn/server/fedcba9876543210.pack.br')), headers: contentHeaders(held)});
  const first = await run(dir, bucket.store);
  expect(first).toMatchObject({set, files: 10, uploaded: 9, held: 1, base: contentBaseOf(set), cors: ORIGIN});
  expect(bucket.puts).not.toContain(held);
  expect(bucket.puts.at(-1)).toBe(contentKey(set, 'content.json'));
  expect(bucket.objects.get(contentKey(set, 'assets/spawn/parts/0123456789abcdef.pack.br'))?.headers.encoding).toBe('br');
  const index = JSON.parse(Buffer.from(bucket.objects.get(contentKey(set, 'content.json'))?.body ?? []).toString('utf8'));
  expect(index.files).toHaveLength(10);
  bucket.puts.length = 0;
  expect(await run(dir, bucket.store)).toMatchObject({uploaded: 0, uploadedBytes: 0, held: 10});
  expect(bucket.puts).toEqual([]);
});

test('a key that exists with other bytes is uploaded again, not skipped', async () => {
  const dir = page(), set = contentSet(scanContent(dir)), bucket = fakeBucket();
  const short = contentKey(set, 'assets/spawn/parts/0123456789abcdef.pack.br'), good = contentKey(set, 'assets/tex/rock.ktx2');
  bucket.objects.set(short, {body: brotliCompressSync(Buffer.from('part')), headers: contentHeaders(short)});
  bucket.objects.set(good, {body: readFileSync(join(dir, 'assets/tex/rock.ktx2')), headers: contentHeaders(good)});
  expect(await run(dir, bucket.store)).toMatchObject({uploaded: 9, held: 1});
  expect(bucket.puts).toContain(short);
  expect(bucket.puts).not.toContain(good);
  expect(brotliDecompressSync(bucket.objects.get(short)?.body ?? new Uint8Array()).toString()).toBe('part bytes');
});

test('a failed bulk put is retried with only the keys still missing', async () => {
  const dir = page(), bucket = fakeBucket(), put = bucket.store.put, batches: string[][] = [];
  let failed = false;
  bucket.store.put = items => {
    batches.push(items.map(item => item.key));
    if (failed) return put(items);
    failed = true;
    return put(items.slice(0, 4)).then(() => { throw new Error('wrangler r2 exited 1'); });
  };
  expect(await run(dir, bucket.store)).toMatchObject({uploaded: 10, held: 0});
  expect(batches[0]).toHaveLength(10);
  expect(batches[1]).toEqual(batches[0]?.slice(4));
});

test('a read-back with other bytes, or without the game CORS, fails the publish and writes no index', async () => {
  const dir = page(), set = contentSet(scanContent(dir));
  const bad = fakeBucket();
  bad.corruptKey(contentKey(set, 'shardfiles/pine-hollow/shard.json'));
  await expect(run(dir, bad.store)).rejects.toThrow(/shard\.json read back with different bytes/u);
  expect(bad.objects.has(contentKey(set, 'content.json'))).toBe(false);
  const closed = fakeBucket();
  closed.answerCors('https://elsewhere.example');
  await expect(run(dir, closed.store)).rejects.toThrow(/CORS is https:\/\/elsewhere\.example, not https:\/\/play\.wildshard\.io/u);
});

test('the real store reads through packs.wildshard.io cache-busted with the Origin, and never puts the token in argv', async () => {
  const token = ['cf', 'secret', 'marker'].join('-'), seen: {url: string, init?: RequestInit}[] = [], runs: {args: string[], secrets: string[], list: unknown}[] = [];
  const store = r2Content({
    root: '/repo', scratch: join(scratchRoot, 'store'), token,
    fetch: ((url: URL, init?: RequestInit) => { seen.push({url: url.href, init}); return Promise.resolve(new Response('x', {status: 200, headers: {'access-control-allow-origin': ORIGIN}})); }) as typeof fetch,
    exec: (_file, args, _options, secrets) => { runs.push({args, secrets, list: JSON.parse(readFileSync(args[args.indexOf('--filename') + 1] ?? '', 'utf8'))}); return ''; },
  });
  expect(await store.exists('content/s/a.json')).toBe(true);
  expect(await store.read('content/s/a.json', ORIGIN)).toMatchObject({status: 200, cors: ORIGIN});
  expect(seen[0]?.init?.method).toBe('HEAD');
  expect(seen[1]?.init?.headers).toEqual({Origin: ORIGIN});
  expect(new Set(seen.map(read => read.url)).size).toBe(2);
  for (const read of seen) expect(read.url).toMatch(/^https:\/\/packs\.wildshard\.io\/content\/s\/a\.json\?content=/u);
  await store.put([
    {key: 'content/s/a.json', file: '/d/a.json', headers: contentHeaders('a.json')},
    {key: 'content/s/p.pack.br', file: '/d/p.pack.br', headers: contentHeaders('p.pack.br')},
  ]);
  expect(runs).toHaveLength(2);
  expect(runs.map(call => call.list)).toEqual([[{key: 'content/s/a.json', file: '/d/a.json'}], [{key: 'content/s/p.pack.br', file: '/d/p.pack.br'}]]);
  expect(runs[1]?.args).toEqual(expect.arrayContaining(['bulk', 'put', 'wildshard-packs', '--remote', '--content-encoding', 'br']));
  for (const call of runs) { expect(call.args.join(' ')).not.toContain(token); expect(call.secrets).toEqual([token]); }
});

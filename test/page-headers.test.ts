// oxlint-disable-next-line import/no-nodejs-modules -- The fixtures write and remove only their owned ./tmp directories.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the pinned wrangler binary's local dev server.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned static HTTP fixtures.
import { dirname, join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Observe encoded HTTP bytes without fetch's transparent decoding.
import { request, type IncomingHttpHeaders } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the production quality-3 wire and decode the complete response.
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { previewServer } from './fixtures/preview-server';

function wire(url: URL, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }> {
  return new Promise((_resolve, reject) => {
    const call = request(url, { method, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => { _resolve({ status: response.statusCode ?? 0, headers: response.headers, bytes: Buffer.concat(chunks) }); });
    });
    call.on('error', reject);
    call.end();
  });
}

// OFF-VERCEL OV2 (J272): the pages Workers serve dist with public/_headers. Every vercel.json header rule must give the
// same answer from wrangler dev (pages/wrangler.jsonc, pages/worker.ts and a dist that holds _headers as the build
// copies it), until vercel.json goes in OV12. vercel.json lets the later rule win; _headers detaches (`! Name`).

/** vercel.json `source` → RegExp: literal text, `(.*)` and `(a|b)` groups, `\\.` a literal dot (the forms it uses). */
function vercelSource(source: string): RegExp {
  const parts = source.split(/(\(\.\*\)|\([a-z|]+\))/u);
  const body = parts.map(part => part === '(.*)' ? '.*' : /^\([a-z|]+\)$/u.test(part) ? part
    : part.replaceAll('\\.', '.').replaceAll(/[.*+?^${}()|[\]\\/]/gu, '\\$&')).join('');
  return new RegExp(`^${body}$`, 'u');
}

interface VercelRule { readonly source: string; readonly headers: readonly { readonly key: string; readonly value: string }[] }
const RULES = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: VercelRule[] }).headers;

/** What vercel.json sends for a path: every matching rule, the later one winning per header. */
function vercelHeaders(path: string, hit: Set<number>): Map<string, string> {
  const out = new Map<string, string>();
  RULES.forEach((rule, index) => {
    if (!vercelSource(rule.source).test(path)) return;
    hit.add(index);
    for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
  });
  return out;
}

// One path or more for each rule, in a fixture dist laid out like the real one.
const PART = Buffer.alloc(4096, 7);
const STORED = brotliCompressSync(PART, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
const PATHS = ['/', '/index.html', '/favicon.png', '/assets/a-1234.js', '/assets/music/folk/track.ogg', '/b/04e1/main-Ab_3.js',
  '/b/c/base-CHkx.css', '/assets/physics/rapier.wasm', '/assets/tex/bark/arm.jpg', '/assets/models/lantern/lantern.bin',
  '/assets/hdri/sky.hdr', '/assets/music/folk/music.json', '/assets/sfx/folk/sfx.json', '/assets/baked/drift/near.glb',
  '/basis/r186/basis_transcoder.wasm', '/assets/gpu/tex/giant.ktx2', '/assets/models/hatchet/hatchet.gltf',
  '/manifest.webmanifest', '/sw-core/4dbab5bd.js', '/sw.js', '/version.json', '/asset-index.json', '/asset-manifest.json',
  '/clear-cache.json', `/shardfiles/driftwood-isle/blobs/glb/${'a'.repeat(64)}.glb`, '/shardfiles/driftwood-isle/shard.json',
  '/assets/spawn/parts/aaaaaaaaaaaaaaaa.pack.br', '/assets/spawn/server/bbbbbbbbbbbbbbbb.pack.br',
  '/assets/spawn/driftwood-isle-client-desktop-0123456789abcdef.json',
  // iPhone downloads I6: a content-addressed blob never revalidates; sections keep fixed paths and do.
  '/shardfiles/driftwood-isle/sections/world/tiles.json'];
const COMPARED = ['cache-control', 'content-type', 'content-encoding', 'clear-site-data'];

let page: { readonly base: string; readonly root: string; readonly child: ChildProcessWithoutNullStreams } | undefined;

/** wrangler dev (production env) over `<root>/dist`, on a free port. */
async function pageServer(): Promise<NonNullable<typeof page>> {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/page-headers-'));
  mkdirSync(join(root, 'pages'));
  for (const file of ['wrangler.jsonc', 'worker.ts']) copyFileSync(resolve('pages', file), join(root, 'pages', file));
  for (const path of PATHS) {
    const file = join(root, 'dist', path === '/' ? 'index.html' : path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith('.pack.br') ? STORED : path === '/' ? '<!doctype html>' : 'x'.repeat(2048));
  }
  writeFileSync(join(root, 'dist/trailer-15.mp4'), Buffer.alloc(4096, 1));
  // The build copies public/ into dist (copyDeferredPublic), _headers with it.
  copyFileSync(resolve('public/_headers'), join(root, 'dist/_headers'));
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(root, 'logs'), CLOUDFLARE_API_TOKEN: '', CI: '1' };
  const child = spawn(resolve('node_modules/.bin/wrangler'), ['dev', '--env', '', '--ip', '127.0.0.1', '--port', '0',
    '--persist-to', join(root, 'state'), '--show-interactive-dev-session=false'], { cwd: join(root, 'pages'), env });
  let log = '';
  const base = await new Promise<string>((done, fail) => {
    const read = (data: Buffer): void => {
      log += String(data);
      const ready = /Ready on (http:\/\/127\.0\.0\.1:\d+)/u.exec(log);
      if (ready?.[1] !== undefined) done(`${ready[1]}/`);
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.once('exit', code => { fail(new Error(`wrangler dev exited ${String(code)}\n${log}`)); });
  });
  return { base, root, child };
}

beforeAll(async () => { page = await pageServer(); }, 90_000);
afterAll(() => { if (page !== undefined) { page.child.kill('SIGTERM'); rmSync(page.root, { recursive: true, force: true }); } });

function served(): string {
  if (page === undefined) throw new Error('wrangler dev did not start');
  return page.base;
}

test('wrangler dev with _headers answers every vercel.json header rule the same', async () => {
  const hit = new Set<number>();
  for (const path of PATHS) {
    const expected = vercelHeaders(path, hit);
    // identity: the stored part must still say br; everything else is compared unencoded.
    const response = await wire(new URL(path, served()), { 'accept-encoding': 'identity' });
    expect(response.status, path).toBe(200);
    for (const header of COMPARED) {
      const want = expected.get(header);
      // Without a vercel.json Content-Type, both hosts guess it from the extension; the parity script compares those.
      if (want === undefined && header === 'content-type') continue;
      // Vercel sent a text type with `; charset=utf-8` it was not told to add; _headers says it too (page-parity.mjs).
      const got = header === 'content-type' ? response.headers[header]?.replace(/; charset=utf-8$/u, '') : response.headers[header];
      expect(got, `${path} ${header}`).toBe(want);
    }
  }
  expect([...hit].sort((a, b) => a - b), 'every vercel.json header rule is exercised').toEqual(RULES.map((_, index) => index));
}, 60_000);

test('a spawn part goes out as its stored bytes with Content-Encoding: br, whatever the client accepts', async () => {
  for (const path of ['/assets/spawn/parts/aaaaaaaaaaaaaaaa.pack.br', '/assets/spawn/server/bbbbbbbbbbbbbbbb.pack.br']) {
    for (const accept of ['br', 'gzip, deflate', 'identity']) {
      const response = await wire(new URL(path, served()), { 'accept-encoding': accept });
      expect([response.status, response.headers['content-encoding'], response.headers['content-type']])
        .toEqual([200, 'br', 'application/octet-stream']);
      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(response.bytes.equals(STORED), `${path} ${accept}: raw bytes equal the file`).toBe(true);
      expect(brotliDecompressSync(response.bytes).equals(PART)).toBe(true);
    }
    const head = await wire(new URL(path, served()), { 'accept-encoding': 'br' }, 'HEAD');
    expect([head.status, head.headers['content-encoding'], head.bytes.length]).toEqual([200, 'br', 0]);
  }
  const missing = await wire(new URL('/assets/spawn/parts/cccccccccccccccc.pack.br', served()), { 'accept-encoding': 'br' });
  expect([missing.status, missing.headers['content-encoding']]).toEqual([404, undefined]);
}, 30_000);

test('JSON and JavaScript carry the content types Vercel sent', async () => {
  const types = await Promise.all(['/version.json', '/b/04e1/main-Ab_3.js', '/manifest.webmanifest'].map(async path =>
    (await wire(new URL(path, served()))).headers['content-type']));
  expect(types).toEqual(['application/json; charset=utf-8', 'application/javascript; charset=utf-8', 'application/manifest+json; charset=utf-8']);
}, 30_000);

test('the page: no-store, ?doctor 307 as Vercel answered, a missing chunk 404 with no HTML', async () => {
  for (const path of ['/', '/index.html']) {
    const response = await wire(new URL(path, served()));
    expect([response.status, response.headers['cache-control'], response.headers['content-type']])
      .toEqual([200, 'no-store', 'text/html; charset=utf-8']);
  }
  const doctor = await wire(new URL('/?doctor', served()));
  expect([doctor.status, doctor.headers.location]).toEqual([307, '/doctor/?doctor&sw=0']);
  const missing = await wire(new URL('/b/gone/main-x.js', served()));
  expect(missing.status).toBe(404);
  expect(missing.headers['content-type'] ?? '').not.toContain('text/html');
}, 30_000);

test('version URLs say noindex; the channel hosts do not', async () => {
  for (const path of ['/', '/assets/a-1234.js']) {
    const version = await wire(new URL(path, served()), { host: '0f1e2d3c-wildshard-play.raynos.workers.dev' });
    expect(version.headers['x-robots-tag'], path).toBe('noindex');
    const play = await wire(new URL(path, served()), { host: 'play.wildshard.io' });
    expect(play.headers['x-robots-tag'], path).toBeUndefined();
  }
}, 30_000);

// Workers static assets answer a Range request with the whole file (no 206). The trailers move to packs.wildshard.io
// (J272 answer 6), so nothing here serves a range; this pins the behavior so a change is seen.
test('a Range request gets the whole file, 200', async () => {
  const response = await wire(new URL('/trailer-15.mp4', served()), { range: 'bytes=0-9' });
  expect([response.status, response.bytes.length, response.headers['content-range']]).toEqual([200, 4096, undefined]);
}, 30_000);

// The local preview server (scripts/preview-server.mjs) still replays vercel.json for `pnpm preview` and e2e.

test('encoded responses follow file changes and concurrent readers receive complete bodies', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/preview-replacement-'));
  mkdirSync(join(root, 'dist'));
  const file = join(root, 'dist', 'mutable.bin');
  const oldBody = Buffer.alloc(4096, 17), currentBody = Buffer.alloc(8192, 23);
  writeFileSync(file, oldBody);
  const server = await previewServer(root);
  try {
    const url = new URL('mutable.bin', server.base);
    const readers = await Promise.all(Array.from({ length: 6 }, () => wire(url, { 'accept-encoding': 'br' })));
    for (const reader of readers) expect(brotliDecompressSync(reader.bytes)).toEqual(oldBody);
    writeFileSync(file, currentBody);
    const current = await wire(url, { 'accept-encoding': 'br' });
    expect(brotliDecompressSync(current.bytes)).toEqual(currentBody);
    expect(current.headers['content-length']).toBeUndefined();
    expect(current.headers.etag).not.toBe(readers[0]?.headers.etag);
  } finally {
    server.close(); rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

test('binary preview transport keeps exact quality-3 bytes, headers, ranges and HEAD semantics', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/preview-binary-'));
  writeFileSync(join(root, 'vercel.json'), readFileSync('vercel.json'));
  const file = `shardfiles/driftwood-isle/blobs/bin/${'b'.repeat(64)}.bin`;
  const body = Buffer.from(Uint8Array.from({ length: 256 * 1024 }, (_, index) => (index * 31 + (index >>> 8)) & 255));
  mkdirSync(dirname(join(root, 'dist', file)), { recursive: true });
  writeFileSync(join(root, 'dist', file), body);
  const server = await previewServer(root);
  try {
    const url = new URL(file, server.base), origin = 'http://localhost:4312';
    const br = await wire(url, { 'accept-encoding': 'gzip, br', origin });
    expect(br.status).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toBe('application/octet-stream');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(br.headers['access-control-allow-origin']).toBe('*');
    expect(br.headers['accept-ranges']).toBe('bytes');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(br.headers['content-length']).toBeUndefined();
    expect(Buffer.compare(br.bytes, brotliCompressSync(body, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 3, [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    } }))).toBe(0);
    expect(Buffer.compare(brotliDecompressSync(br.bytes), body)).toBe(0);
    const plain = await wire(url, { 'accept-encoding': 'br;q=0, gzip;q=0, *;q=1' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-length']).toBe(String(body.length));
    expect(Buffer.compare(plain.bytes, body)).toBe(0);
    const gzip = await wire(url, { 'accept-encoding': 'br;q=0, gzip' });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(Buffer.compare(gunzipSync(gzip.bytes), body)).toBe(0);
    const head = await wire(url, { 'accept-encoding': 'br' }, 'HEAD');
    expect(head.status).toBe(200); expect(head.bytes.length).toBe(0);
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.headers['content-length']).toBeUndefined();
    expect(head.headers.etag).toBe(br.headers.etag);
    const range = await wire(url, { 'accept-encoding': 'br', range: 'bytes=19-83' });
    expect(range.status).toBe(206); expect(range.headers['content-encoding']).toBeUndefined();
    expect(range.headers['content-range']).toBe(`bytes 19-83/${body.length}`);
    expect(range.headers['content-length']).toBe('65');
    expect(Buffer.compare(range.bytes, body.subarray(19, 84))).toBe(0);
    const rangeHead = await wire(url, { 'accept-encoding': 'br', range: 'bytes=19-83' }, 'HEAD');
    expect(rangeHead.status).toBe(206); expect(rangeHead.bytes.length).toBe(0);
    expect(rangeHead.headers['content-range']).toBe(range.headers['content-range']);
    expect(rangeHead.headers['content-length']).toBe('65');
    const etag = br.headers.etag;
    if (etag === undefined) throw new Error('Binary preview response lacks an ETag');
    const unchanged = await wire(url, { 'accept-encoding': 'br', 'if-none-match': etag });
    expect(unchanged.status).toBe(304); expect(unchanged.bytes.length).toBe(0);
    expect(unchanged.headers.vary).toBe('Accept-Encoding');
    const outside = await wire(url, { range: `bytes=${body.length}-`, 'accept-encoding': 'br' });
    expect(outside.status).toBe(416); expect(outside.headers['content-range']).toBe(`bytes */${body.length}`);
    expect(outside.headers['content-encoding']).toBeUndefined();
  } finally {
    server.close(); rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

// DL15 (sp-x9's review of 36550ecc1b): a part is served as its q11 body with Content-Encoding: br (the vercel.json rule
// now replays), decoded without that header for a client that refuses br, and a missing or broken part is an error
// response, never the page's fallback or a crashed server.
test('spawn parts: br as-is, gzip for gzip-only clients, decoded for identity, 404 and 500 instead of the fallback', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/vercel-parts-'));
  writeFileSync(join(root, 'vercel.json'), readFileSync('vercel.json'));
  const raw = Buffer.alloc(4096, 7), encoded = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  const good = `assets/spawn/parts/${'a'.repeat(16)}.pack.br`, broken = `assets/spawn/parts/${'b'.repeat(16)}.pack.br`;
  mkdirSync(join(root, 'dist/assets/spawn/parts'), { recursive: true });
  writeFileSync(join(root, 'dist', good), encoded); writeFileSync(join(root, 'dist', broken), 'not brotli');
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html>');
  const server = await previewServer(root);
  try {
    const { base } = server, all = { accept: '*/*' };
    const br = await wire(new URL(good, base), { ...all, 'accept-encoding': 'br' });
    expect([br.status, br.headers['content-encoding'], br.headers['content-type']]).toEqual([200, 'br', 'application/octet-stream']);
    expect(br.bytes.equals(encoded)).toBe(true); expect(brotliDecompressSync(br.bytes).equals(raw)).toBe(true);
    const plain = await wire(new URL(good, base), { ...all, 'accept-encoding': 'identity' });
    expect([plain.status, plain.headers['content-encoding']]).toEqual([200, undefined]); expect(plain.bytes.equals(raw)).toBe(true);
    // DL5: a client that refuses br but takes gzip (Safari over http) gets the part gzipped, not decoded at full size
    const gzipped = await wire(new URL(good, base), { ...all, 'accept-encoding': 'gzip, deflate' });
    expect([gzipped.status, gzipped.headers['content-encoding']]).toEqual([200, 'gzip']);
    expect(gzipped.bytes.length).toBeLessThan(raw.length); expect(gunzipSync(gzipped.bytes).equals(raw)).toBe(true);
    expect(gzipped.headers['content-length']).toBe(String(gzipped.bytes.length));
    expect((await wire(new URL(broken, base), { ...all, 'accept-encoding': 'gzip' })).status).toBe(500);
    // sp-x2's review: a HEAD of a broken part is a 500 too (its encode's rejection handled), and the server stays up
    expect((await wire(new URL(broken, base), { ...all, 'accept-encoding': 'gzip' }, 'HEAD')).status).toBe(500);
    const headOk = await wire(new URL(good, base), { ...all, 'accept-encoding': 'gzip' }, 'HEAD');
    expect([headOk.status, headOk.headers['content-encoding'], headOk.bytes.length]).toEqual([200, 'gzip', 0]);
    expect((await wire(new URL(good, base), { ...all, 'accept-encoding': 'gzip' })).status).toBe(200);
    const missing = await wire(new URL(`assets/spawn/parts/${'c'.repeat(16)}.pack.br`, base), all);
    expect([missing.status, missing.headers['content-encoding'], missing.bytes.length]).toEqual([404, undefined, 0]);
    expect((await wire(new URL(broken, base), { ...all, 'accept-encoding': 'identity' })).status).toBe(500);
    // The server is still up.
    expect((await wire(new URL(good, base), { ...all, 'accept-encoding': 'br' })).status).toBe(200);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});

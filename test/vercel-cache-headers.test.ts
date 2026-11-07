// oxlint-disable-next-line import/no-nodejs-modules -- The preview fixture writes and removes only its owned ./tmp directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned static HTTP fixture.
import { dirname, join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Observe encoded HTTP bytes without fetch's transparent decoding.
import { request, type IncomingHttpHeaders } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the production quality-3 wire and decode the complete response.
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
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

// iPhone downloads I6: a product blob is content-addressed (`blobs/<kind>/<hash>.<ext>`), so it never revalidates;
// sections keep fixed paths and Rapier keeps its fixed name (the boot lists name it), so both revalidate.
test('product blobs are immutable; sections and Rapier revalidate', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/vercel-headers-'));
  writeFileSync(join(root, 'vercel.json'), readFileSync('vercel.json'));
  const hash = 'a'.repeat(64), files = [`shardfiles/driftwood-isle/blobs/glb/${hash}.glb`,
    'shardfiles/driftwood-isle/sections/world/tiles.json', 'shardfiles/driftwood-isle/shard.json', 'assets/physics/rapier.wasm',
    'b/a3e7ef2-mw3ukc3m/main-Ab_3-xyz.js', 'b/a3e7ef2-mw3ukc3m/main-Ab_3-xyz.css', 'b/a3e7ef2-mw3ukc3m/standalone/shell.js', 'index.html'];
  for (const file of files) { mkdirSync(dirname(join(root, 'dist', file)), { recursive: true }); writeFileSync(join(root, 'dist', file), 'x'); }
  const server = await previewServer(root);
  try {
    const { base } = server;
    const control = await Promise.all(files.map(async file => (await fetch(new URL(file, base))).headers.get('cache-control')));
    expect(control).toEqual(['public, max-age=31536000, immutable', 'public, max-age=0, must-revalidate',
      'public, max-age=0, must-revalidate', 'public, max-age=0, must-revalidate',
      // J57: a build's folder never changes; the uncached document is the pointer that names it.
      'public, max-age=31536000, immutable', 'public, max-age=31536000, immutable', 'public, max-age=31536000, immutable', 'no-store']);
  } finally {
    server.close(); rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

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

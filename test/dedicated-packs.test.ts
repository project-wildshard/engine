// oxlint-disable-next-line import/no-nodejs-modules -- A pack cache is files.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- An origin is a real local server.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the local test listener address.
import type { AddressInfo } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch, under the repo's own tmp.
import { join, resolve as absolute } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Test the actual compressed pack boundary.
import { brotliCompressSync } from 'node:zlib';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the actual published part digest.
import { createHash } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { packRead, type PackReads } from '../src/server/host/dedicated/packReader';

// E7.3d: the Node reader against a real HTTP origin that stores `.br` parts and says nothing of it, as a bucket does.
const BODY = new TextEncoder().encode('a part of a pack, and then some more of the same part of a pack'), HASH = createHash('sha256').update(BODY).digest('hex'), WIRE = brotliCompressSync(BODY);
const fresh = (): PackReads => ({ fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 });
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });
async function origin(bytes: () => Uint8Array): Promise<string> {
  const server = createServer((_request, response) => { response.writeHead(200).end(bytes()); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  closers.push(() => { server.close(); });
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
}
function scratch(): string { const root = absolute('tmp/packs'); mkdirSync(root, { recursive: true }); const folder = mkdtempSync(join(root, 'packs-')); closers.push(() => { rmSync(folder, { recursive: true, force: true }); }); return folder; }

test('a cold cache reads the network and undoes `br`, a warm one reads the disk, and a bad byte is refused for the network\'s', async () => {
  const cache = scratch(), url = await origin(() => WIRE), reads = fresh(), read = packRead({ origin: url, cache }, reads), part = new URL('/assets/spawn/server/a.pack.br', url);
  expect(await read(part, part.pathname, HASH)).toEqual(BODY);
  expect(reads).toMatchObject({ fetched: 1, cached: 0 });
  expect(readdirSync(cache)).toEqual([HASH]);
  expect(await read(part, part.pathname, HASH)).toEqual(BODY);
  expect(reads).toMatchObject({ fetched: 1, cached: 1 });
  const file = join(cache, HASH, 'body'), bad = readFileSync(file);
  bad[0] = (bad[0] ?? 0) ^ 1;
  writeFileSync(file, bad);
  expect(await read(part, part.pathname, HASH)).toEqual(BODY);
  expect(reads).toMatchObject({ fetched: 2, cached: 1, refused: 1 });
  expect(readFileSync(file)).toEqual(Buffer.from(BODY));
});

test('an origin that serves the wrong bytes boots nothing', async () => {
  const cache = scratch(), url = await origin(() => new TextEncoder().encode('not it')), read = packRead({ origin: url, cache }, fresh()), part = new URL('/p.pack.br', url);
  await expect(read(part, part.pathname, HASH)).rejects.toThrow('hash mismatch');
  expect(readdirSync(cache)).toEqual([]);
});

test('eight concurrent cold-cache fills converge on one verified body', async () => {
  const cache = scratch(), url = await origin(() => WIRE), read = packRead({ origin: url, cache }, fresh()), part = new URL('/shared.pack.br', url);
  const answers = await Promise.allSettled(Array.from({ length: 8 }, () => read(part, part.pathname, HASH)));
  expect(answers.filter(answer => answer.status === 'rejected')).toHaveLength(0);
  expect(readFileSync(join(cache, HASH, 'body'))).toEqual(Buffer.from(BODY));
  expect(readdirSync(join(cache, HASH))).toEqual(['body']);
});

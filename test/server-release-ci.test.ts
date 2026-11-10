// oxlint-disable-next-line import/no-nodejs-modules -- Ephemeral Ed25519 keys and a real body digest.
import { createHash, generateKeyPairSync } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Real local publication boundary.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Test-owned bundle bytes.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest owns this temporary root.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths belong to this test run.
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, expect, test } from 'vitest';
import { createTempRepo } from '../src/test/helpers/git.ts';
import { bundleDescriptor, releasePublicKey, signRelease } from '../scripts/server-release/sign.mjs';
import { publishChannel, serverPacksReady } from '../scripts/server-release/publish.mjs';
import { readReleaseFile } from '../src/server/host/dedicated/releaseFile';
import { readSignedRelease } from '../src/client/host/online/release';
import type { ReleaseFile } from '../src/shared/host/releaseRows';

const pair = generateKeyPairSync('ed25519'), pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const history = createTempRepo();
const older = history.commit({ 'receipt.txt': 'first' }, 'First test build');
const sha = history.commit({ 'receipt.txt': 'second' }, 'Second test build');
afterAll(() => { history.cleanup(); });
const publicKey = releasePublicKey(pem);
const release = (build = sha): ReleaseFile => ({ channel: 'staging', serial: 1, engineBuild: build, saveEpoch: 1,
  shards: [{ slug: 'driftwood-isle', revision: 3 }], bundle: { name: `server-staging-${build}/engine-server-${build}.tar.gz`, sha256: 'a'.repeat(64) }, socket: 'wss://staging.example.test/' });

test('CI signer agrees with the server and WebCrypto for both complete channels', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'server-release-')), archive = join(directory, `engine-server-${sha}.tar.gz`);
  try {
    writeFileSync(archive, 'test-owned server bundle bytes');
    for (const channel of ['staging', 'production'] as const) {
      const tag = channel === 'staging' ? `server-staging-${sha}` : 'v1.2.3';
      const expected = { ...release(), channel, bundle: bundleDescriptor(archive, tag) }, signed = signRelease(expected, pem);
      expect(expected.bundle.name).toBe(`${tag}/engine-server-${sha}.tar.gz`);
      expect(readReleaseFile(signed, publicKey)).toEqual(expected);
      expect(await readSignedRelease(signed, publicKey)).toEqual(expected);
      const envelope = JSON.parse(signed) as { body: string; signature: string };
      envelope.body = envelope.body.replace('"saveEpoch":1', '"saveEpoch":2');
      expect(() => readReleaseFile(JSON.stringify(envelope), publicKey)).toThrow(/signature/u);
      await expect(readSignedRelease(JSON.stringify(envelope), publicKey)).rejects.toThrow(/signature/u);
    }
    expect(() => signRelease({ ...release(), saveEpoch: 0 }, pem)).toThrow();
    expect(() => signRelease({ ...release(), bundle: undefined }, pem)).toThrow();
    expect(() => signRelease({ ...release(), socket: undefined }, pem)).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real S3 HTTP conditional writes advance once, retry a race, and reject an older green build', async () => {
  let held: { body: string; etag: string } | null = null, writes = 0, conflicts = 0;
  const waiting: (() => void)[] = [];
  const server = createServer((request, response) => {
    expect(request.url?.split('?')[0]).toBe('/packs/releases/staging.json');
    if (request.method === 'GET') {
      if (held === null) { response.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
      const current = held;
      const answer = (): void => { response.writeHead(200, { ETag: current.etag, 'Content-Type': 'application/json' }).end(current.body); };
      if (writes === 1 && waiting.length < 2) {
        waiting.push(answer);
        if (waiting.length === 2) for (const respond of waiting) respond();
      } else answer();
      return;
    }
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      const matches = held === null ? request.headers['if-none-match'] === '*' : request.headers['if-match'] === held.etag;
      if (!matches) { conflicts++; response.writeHead(412, { 'Content-Type': 'application/xml' }).end('<Error><Code>PreconditionFailed</Code></Error>'); return; }
      const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
      held = { body, etag }; writes++;
      response.writeHead(200, { ETag: etag }).end();
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No listener');
  const client = new S3Client({ endpoint: `http://127.0.0.1:${String(address.port)}`, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' } });
  const isAncestor = (a: string, b: string): boolean => {
    try { history.git(['merge-base', '--is-ancestor', a, b]); return true; }
    catch { return false; }
  };
  const publish = (build: string): ReturnType<typeof publishChannel> => publishChannel({ client, bucket: 'packs', candidate: release(build), privateKey: pem, publicKey, isAncestor });
  try {
    expect((await publish(older)).release.serial).toBe(1);
    const raced = await Promise.all([publish(sha), publish(sha)]);
    expect(raced.map(row => row.status).sort()).toEqual(['published', 'unchanged']);
    expect(raced.every(row => row.release.serial === 2)).toBe(true);
    expect((await publish(older)).status).toBe('stale');
    expect(writes).toBe(2);
    expect(conflicts).toBe(1);
    const current = held as { body: string; etag: string } | null;
    expect(current).not.toBeNull();
    expect(readReleaseFile(current?.body ?? '', publicKey)).toMatchObject({ engineBuild: sha, serial: 2, saveEpoch: 1 });
  } finally { client.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); }
});

test('staging signs a build only after its server book and parts are in the bucket, and an alignment can roll it back', async () => {
  const objects = new Map<string, string>();
  let writes = 0;
  const server = createServer((request, response) => {
    const key = decodeURIComponent(request.url?.split('?')[0] ?? '').replace(/^\/packs\//u, '');
    const held = objects.get(key), etag = held === undefined ? '' : `"${createHash('sha256').update(held).digest('hex')}"`;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (held === undefined) { response.writeHead(404, { 'Content-Type': 'application/xml' }).end(request.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>'); return; }
      response.writeHead(200, { ETag: etag, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(held)) }).end(request.method === 'HEAD' ? undefined : held);
      return;
    }
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      const matches = held === undefined ? request.headers['if-none-match'] === '*' : request.headers['if-match'] === etag;
      if (!matches) { response.writeHead(412, { 'Content-Type': 'application/xml' }).end('<Error><Code>PreconditionFailed</Code></Error>'); return; }
      objects.set(key, body); writes++;
      response.writeHead(200, { ETag: `"${createHash('sha256').update(body).digest('hex')}"` }).end();
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No listener');
  const client = new S3Client({ endpoint: `http://127.0.0.1:${String(address.port)}`, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' } });
  const isAncestor = (a: string, b: string): boolean => {
    try { history.git(['merge-base', '--is-ancestor', a, b]); return true; }
    catch { return false; }
  };
  const part = (n: number): { url: string; bytes: number; hash: string; wireBytes: number; files: [] } => ({ url: `/assets/spawn/server/${String(n).repeat(16)}.pack.br`, bytes: 1, hash: 'b'.repeat(64), wireBytes: 1, files: [] });
  const shelve = (build: string, n: number): void => {
    objects.set(`assets/spawn/server-${build}.json`, JSON.stringify({ book: 'server', build, shards: { 'driftwood-isle': { ...part(n), more: [part(n + 1)] } }, grid: part(n + 2) }));
  };
  const publish = (build: string, align = false, channel: 'staging' | 'production' = 'staging'): ReturnType<typeof publishChannel> => publishChannel({ client, bucket: 'packs', candidate: { ...release(build), channel },
    privateKey: pem, publicKey, isAncestor, align, packsReady: next => serverPacksReady(client, 'packs', next) });
  const channel = (): ReleaseFile => readReleaseFile(objects.get('releases/staging.json') ?? '', publicKey);
  try {
    // No book: nothing is signed, and the first file is never written.
    expect(await publish(older)).toMatchObject({ status: 'held', reason: `no server book at assets/spawn/server-${older}.json` });
    expect(writes).toBe(0);
    shelve(older, 1);
    // The book alone is not enough: every part the pinned shards and the grid name must be there.
    expect((await publish(older)).reason).toBe('no server part at assets/spawn/server/1111111111111111.pack.br');
    for (const n of [1, 2, 3]) objects.set(part(n).url.slice(1), 'part');
    expect((await publish(older)).status).toBe('published');
    expect(channel()).toMatchObject({ engineBuild: older, serial: 1 });
    // A newer green build without packs holds: the channel keeps naming the build the server can play.
    expect(await publish(sha)).toMatchObject({ status: 'held', release: { engineBuild: older, serial: 1 } });
    expect(channel()).toMatchObject({ engineBuild: older, serial: 1 });
    shelve(sha, 4);
    for (const n of [4, 5, 6]) objects.set(part(n).url.slice(1), 'part');
    expect((await publish(sha)).status).toBe('published');
    expect(channel()).toMatchObject({ engineBuild: sha, serial: 2 });
    // Normal CI never moves back; an explicit staging alignment does, as a newer serial, and never on production.
    expect((await publish(older)).status).toBe('stale');
    expect((await publish(older, true)).status).toBe('published');
    expect(channel()).toMatchObject({ engineBuild: older, serial: 3 });
    await expect(publish(older, true, 'production')).rejects.toThrow(/Only staging/u);
    expect(writes).toBe(3);
  } finally { client.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); }
});

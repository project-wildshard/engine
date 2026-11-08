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
import { publishChannel } from '../scripts/server-release/publish.mjs';
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

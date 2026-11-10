// oxlint-disable-next-line import/no-nodejs-modules -- Ephemeral Ed25519 keys and a real body digest.
import { createHash, generateKeyPairSync } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real asset CLI on test-owned Git history.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real local publication boundary.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Test-owned bundle bytes and the workflow file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest owns this temporary root.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths belong to this test run.
import { join, resolve } from 'node:path';
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
const newest = history.commit({ 'receipt.txt': 'third' }, 'Third test build');
/** A commit on no branch of the channel's history. */
const unrelated = history.git(['commit-tree', `${sha}^{tree}`, '-m', 'Unrelated test build']);
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
  const publish = (build: string): ReturnType<typeof publishChannel> => publishChannel({ client, bucket: 'packs', candidate: release(build), privateKey: pem, publicKey, isAncestor,
    packsReady: () => Promise.resolve(null) });
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

test('J234: both channels sign a build only after its server book and parts are in the bucket, and alignment is forward-only', async () => {
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
  const channel = (name = 'staging'): ReleaseFile => readReleaseFile(objects.get(`releases/${name}.json`) ?? '', publicKey);
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
    // Once its packs land, a person's alignment signs the held build: forward, as the next serial.
    shelve(sha, 4);
    for (const n of [4, 5, 6]) objects.set(part(n).url.slice(1), 'part');
    expect((await publish(sha, true)).status).toBe('published');
    expect(channel()).toMatchObject({ engineBuild: sha, serial: 2 });
    // Fix forward (J234): normal CI never moves back, and an alignment naming an older build is refused, not signed.
    expect((await publish(older)).status).toBe('stale');
    await expect(publish(older, true)).rejects.toThrow(/forward-only/u);
    shelve(unrelated, 1);
    await expect(publish(unrelated, true)).rejects.toThrow(/unrelated history/u);
    expect(channel()).toMatchObject({ engineBuild: sha, serial: 2 });
    expect(writes).toBe(2);
    // Production holds the same way: a tag whose packs are missing writes no production file at all,
    expect(await publish(newest, false, 'production')).toMatchObject({ status: 'held', reason: `no server book at assets/spawn/server-${newest}.json` });
    expect(objects.has('releases/production.json')).toBe(false);
    expect((await publish(sha, false, 'production')).status).toBe('published');
    // and a live production file keeps its exact signed bytes while the next tag's packs are incomplete.
    const live = objects.get('releases/production.json');
    shelve(newest, 7);
    for (const n of [7, 8]) objects.set(part(n).url.slice(1), 'part');
    expect(await publish(newest, false, 'production')).toMatchObject({ status: 'held', release: { engineBuild: sha, serial: 1 }, reason: 'no server part at assets/spawn/server/9999999999999999.pack.br' });
    expect(objects.get('releases/production.json')).toBe(live);
    objects.set(part(9).url.slice(1), 'part');
    expect((await publish(newest, false, 'production')).status).toBe('published');
    expect(channel('production')).toMatchObject({ engineBuild: newest, serial: 2 });
    await expect(publish(newest, true, 'production')).rejects.toThrow(/Only staging/u);
    expect(writes).toBe(4);
  } finally { client.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); }
});

test('J234: every run signs with main\'s publisher and builds in the source\'s own tree', () => {
  const workflow = readFileSync('.github/workflows/server-release.yml', 'utf8'), publish = workflow.slice(workflow.indexOf('\n  publish:'));
  const checkouts = [...publish.matchAll(/- uses: actions\/checkout@[^\n]+\n\s+with:\n((?:\s{10}[^\n]+\n)+)/gu)].map(match => match[1] ?? '');
  expect(checkouts[0]).toMatch(/ref: main\n/u);
  expect(checkouts[1]).toMatch(/ref: \$\{\{ needs\.source\.outputs\.sha \}\}\n\s+path: source\n/u);
  for (const step of ['Build deterministic dedicated bundle', 'Upload immutable bundle to its tag release']) expect(publish.slice(publish.indexOf(step)).split('\n')[1]).toBe('        working-directory: source');
  const sign = publish.slice(publish.indexOf('Sign and advance the channel release file'));
  expect(sign).not.toMatch(/working-directory/u);
  expect(sign).toContain('node scripts/server-release/publish.mjs');
});

test('production release creation needs only the already-pushed tag and cannot create metadata for a different tag', () => {
  const repo = createTempRepo();
  try {
    const build = repo.commit({ 'entry.txt': 'published source' }, 'Tagged source');
    repo.git(['update-ref', 'refs/remotes/origin/main', build]);
    const archive = join(repo.dir, `engine-server-${build}.tar.gz`), transport = join(repo.dir, 'github-fixture.mjs');
    writeFileSync(archive, 'immutable bundle');
    writeFileSync(transport, `
import assert from 'node:assert/strict';
const sha = process.env.FIXTURE_SHA, mode = process.env.FIXTURE_MODE;
const tag = mode === 'staging' ? 'server-staging-' + sha : 'v1.2.3';
const tagObject = 'a'.repeat(40);
const record = { id: 1, upload_url: 'https://uploads.github.com/releases/1/assets{?name}', assets: [] };
let checked = 0, created = false;
globalThis.fetch = async (input, request = {}) => {
  const url = new URL(input), path = url.pathname.replace(/^\\/repos\\/project-wildshard\\/engine\\//u, '');
  const method = request.method ?? 'GET';
  assert.equal(new Headers(request.headers).get('authorization'), 'Bearer fixture');
  if (url.origin === 'https://uploads.github.com') {
    assert.equal(method, 'POST');
    assert.equal(url.searchParams.get('name'), 'engine-server-' + sha + '.tar.gz');
    assert.equal(request.body.toString(), 'immutable bundle');
    assert.equal(checked, mode === 'staging' ? 1 : 2);
    assert.ok(created);
    return Response.json({});
  }
  assert.equal(url.origin, 'https://api.github.com');
  if (path === 'releases/tags/' + tag) return new Response(null, { status: 404 });
  if (path === 'git/ref/tags/' + tag) {
    if (mode === 'missing') return new Response(null, { status: 404 });
    return Response.json({ object: { type: 'tag', sha: tagObject } });
  }
  if (path === 'git/tags/' + tagObject) {
    checked++;
    return Response.json({ object: { type: 'commit', sha: mode === 'foreign' ? 'b'.repeat(40) : sha } });
  }
  assert.equal(path, 'releases');
  assert.equal(method, 'POST');
  const body = JSON.parse(request.body);
  assert.equal(body.tag_name, tag);
  assert.equal(body.prerelease, mode === 'staging');
  if (mode === 'staging') assert.equal(body.target_commitish, sha);
  else {
    if (Object.hasOwn(body, 'target_commitish')) return new Response(null, { status: 403 });
    assert.equal(mode, 'production', 'Never create a release for an unverified version tag');
    assert.equal(checked, 1);
  }
  created = true;
  return Response.json(record);
};
`);
    for (const mode of ['production', 'staging', 'missing', 'foreign']) {
      const staging = mode === 'staging', tag = staging ? `server-staging-${build}` : 'v1.2.3';
      const result = spawnSync(process.execPath, ['--import', transport, resolve('scripts/server-release/github.mjs'), 'asset', tag, build, archive,
        staging ? 'staging' : 'production'], { cwd: repo.dir, encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env.PATH, GH_TOKEN: 'fixture', FIXTURE_SHA: build, FIXTURE_MODE: mode } });
      expect(result.error).toBeUndefined();
      if (mode === 'missing' || mode === 'foreign') {
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(mode === 'missing' ? /GET git\/ref\/tags.*404/u : /names another commit/u);
        expect(result.stdout).toBe('');
      } else {
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ tag, asset: `engine-server-${build}.tar.gz` });
      }
    }
  } finally { repo.cleanup(); }
});

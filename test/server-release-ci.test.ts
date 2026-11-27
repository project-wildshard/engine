// oxlint-disable-next-line import/no-nodejs-modules -- Ephemeral Ed25519 keys and a real body digest.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real asset CLI on test-owned Git history.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real local publication boundary.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Test-owned bundle bytes and the workflow file.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest owns this temporary root.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths belong to this test run.
import { join, resolve } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, expect, test } from 'vitest';
import { createTempRepo } from '../src/test/helpers/git.ts';
import { bundleDescriptor, releasePublicKey, releaseShards, signRelease } from '../src/scripts/server-release/sign.mjs';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { worldCells } from '../src/server/host/dedicated/gridCells';
import { publishChannel, serverPacksReady } from '../src/scripts/server-release/publish.mjs';
import { copyItemCatalogue } from '../src/scripts/server-release/items.mjs';
import { preparedReleaseFollows } from '../src/scripts/server-release/history.mjs';
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

test('QA58 signed release readers accept additive fields and validate the known rows', async () => {
  const expected: ReleaseFile = {...release(), channel:'production',
    shards:[{slug:'fixture',revision:11,shardVersion:'1.2.3'}]};
  const signedBody = (value: unknown): string => {
    const body = JSON.stringify(value);
    return JSON.stringify({body,signature:sign(null,Buffer.from(body),pair.privateKey).toString('hex')});
  };
  const extended = signedBody({...expected, futureReleaseField:1,
    shards:expected.shards.map(shard=>({...shard,futureShardField:1}))});
  expect(readReleaseFile(extended,publicKey)).toEqual(expected);
  expect(await readSignedRelease(extended,publicKey)).toEqual(expected);

  const malformed = signedBody({...expected,shards:[{slug:'fixture',revision:11,shardVersion:'bad-version'}]});
  expect(()=>readReleaseFile(malformed,publicKey)).toThrow();
  await expect(readSignedRelease(malformed,publicKey)).rejects.toThrow();
});

test('preview signs the same envelope without a socket or server bundle', async () => {
  const preview = {channel: 'preview' as const, serial: 1, engineBuild: sha, saveEpoch: 1, shards: release().shards};
  expect(await readSignedRelease(signRelease(preview, pem), publicKey)).toEqual(preview);
  expect(() => signRelease({...preview, socket: release().socket}, pem)).toThrow(/must be solo/);
  expect(() => signRelease({...preview, bundle: release().bundle}, pem)).toThrow(/must be solo/);
});

test('real S3 HTTP conditional writes advance once, retry a race, and reject an older green build', async () => {
  let held: { body: string; etag: string } | null = null, writes = 0, conflicts = 0;
  const waiting: (() => void)[] = [];
  const server = createServer((request, response) => {
    expect(request.url?.split('?')[0]).toBe('/wildshard-releases/staging.json');
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
  const publish = (build: string): ReturnType<typeof publishChannel> => publishChannel({ client, bucket: 'wildshard-releases', candidate: release(build), privateKey: pem, publicKey, isAncestor,
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
  const releaseBucket = 'wildshard-releases';
  const releaseKey = (key: string): string => `signed:${key}`;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url?.split('?')[0] ?? '');
    const releasePath = `/${releaseBucket}/`;
    const key = path.startsWith(releasePath) ? releaseKey(path.slice(releasePath.length)) : path.replace(/^\/packs\//u, '');
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
  const ready = (row: ReleaseFile): ReturnType<typeof serverPacksReady> => serverPacksReady(client, 'packs', row, { client, bucket: releaseBucket });
  const publish = (build: string, align = false, channel: 'staging' | 'production' = 'staging'): ReturnType<typeof publishChannel> => publishChannel({ client, bucket: releaseBucket, candidate: { ...release(build), channel },
    privateKey: pem, publicKey, isAncestor, align, packsReady: ready });
  const channel = (name = 'staging'): ReleaseFile => readReleaseFile(objects.get(releaseKey(`${name}.json`)) ?? '', publicKey);
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
    expect(objects.has(releaseKey('production.json'))).toBe(false);
    expect((await publish(sha, false, 'production')).status).toBe('published');
    // and a live production file keeps its exact signed bytes while the next tag's packs are incomplete.
    const live = objects.get(releaseKey('production.json'));
    shelve(newest, 7);
    for (const n of [7, 8]) objects.set(part(n).url.slice(1), 'part');
    expect(await publish(newest, false, 'production')).toMatchObject({ status: 'held', release: { engineBuild: sha, serial: 1 }, reason: 'no server part at assets/spawn/server/9999999999999999.pack.br' });
    expect(objects.get(releaseKey('production.json'))).toBe(live);
    objects.set(part(9).url.slice(1), 'part');
    expect((await publish(newest, false, 'production')).status).toBe('published');
    expect(channel('production')).toMatchObject({ engineBuild: newest, serial: 2 });
    await expect(publish(newest, true, 'production')).rejects.toThrow(/Only staging/u);
    expect(writes).toBe(4);
    // Q37: publication copies the API document once, then signs its immutable identity.
    const source = { version: 1, items: [{ id: 'sword', maxTier: 3 }, { id: 'amulet', maxTier: 1 }] };
    objects.set('/api/items.json', JSON.stringify(source));
    const apiRead: typeof fetch = async (_url, init) => fetch(`http://127.0.0.1:${String(address.port)}/api/items.json`, init);
    const items = await copyItemCatalogue(client, releaseBucket, apiRead), body = objects.get(releaseKey(items.path));
    expect(objects.has(items.path)).toBe(false);
    expect(JSON.parse(body ?? '')).toEqual({ version: 1, items: [...source.items].reverse() });
    expect(await copyItemCatalogue(client, releaseBucket, apiRead)).toEqual(items);
    expect(writes, 'the same hash-named object is not overwritten').toBe(5);
    const candidate = { ...release(newest), items };
    expect(await ready(candidate)).toBeNull();
    const signedItems = await publishChannel({ client, bucket: releaseBucket, candidate, privateKey: pem, publicKey, isAncestor,
      packsReady: ready });
    expect(signedItems.status).toBe('published'); expect(channel().items).toEqual(items);
    expect(await readSignedRelease(signedItems.signed, publicKey)).toEqual(signedItems.release);
    objects.delete(releaseKey(items.path));
    expect(await ready(candidate)).toBe(`no item catalogue at ${items.path}`);
    objects.set(releaseKey(items.path), 'corrupt');
    expect(await ready(candidate)).toBe(`item catalogue hash mismatch at ${items.path}`);
    await expect(copyItemCatalogue(client, releaseBucket, apiRead)).rejects.toThrow('Existing item catalogue hash mismatch');
    objects.set('/api/items.json', JSON.stringify({ version: 1, items: [source.items[0], source.items[0]] }));
    await expect(copyItemCatalogue(client, releaseBucket, apiRead)).rejects.toThrow('Duplicate platform item');
    // Abandoning an unmerged staging release must not strand its next prepared release; the packs gate still runs.
    const prepared = createTempRepo();
    try {
      const manifest = (version: string): string => JSON.stringify({ name: 'fixture', version });
      const cut = prepared.commit({ 'package.json': manifest('0.1.29'), 'runtime.ts': 'old' }, 'Main source');
      const abandoned = prepared.commit({ 'package.json': manifest('0.1.30') }, 'chore(release): v0.1.30');
      prepared.git(['update-ref', 'refs/remotes/origin/release/v0.1.30', abandoned]);
      prepared.git(['switch', '--detach', cut]);
      const fixed = prepared.commit({ 'runtime.ts': 'fixed' }, 'Fix entry');
      prepared.git(['update-ref', 'refs/remotes/origin/main', fixed]);
      const next = prepared.commit({ 'package.json': manifest('0.1.31') }, 'chore(release): v0.1.31');
      prepared.git(['update-ref', 'refs/remotes/origin/release/v0.1.31', next]);
      objects.set(releaseKey('staging.json'), signRelease(release(abandoned), pem));
      const rotate = (build: string, nextChannel: 'staging' | 'production' = 'staging'): ReturnType<typeof publishChannel> => publishChannel({
        client, bucket: releaseBucket, candidate: { ...release(build), channel: nextChannel }, privateKey: pem, publicKey, isAncestor, align: nextChannel === 'staging',
        preparedFollows: (a, b) => preparedReleaseFollows(a, b, prepared.dir), packsReady: ready });
      expect(await rotate(next)).toMatchObject({ status: 'held', release: { engineBuild: abandoned, serial: 1 } });
      shelve(next, 1);
      expect(await rotate(next)).toMatchObject({ status: 'published', release: { engineBuild: next, serial: 2 } });
      await expect(rotate(abandoned)).rejects.toThrow(/unrelated history/u);
      objects.set(releaseKey('production.json'), signRelease({ ...release(abandoned), channel: 'production' }, pem));
      await expect(rotate(next, 'production')).rejects.toThrow(/unrelated history/u);
      expect(channel()).toMatchObject({ engineBuild: next, serial: 2 });
      expect(channel('production')).toMatchObject({ engineBuild: abandoned, serial: 1 });
    } finally { prepared.cleanup(); }
  } finally { client.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); }
});

test('GO7: a release of every pin opens every grid cell, under the slug the grid reads', () => {
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string; uploadNumber: number; shardVersion?: string }[] };
  // PV2: a pin that names its shard version carries it into the release (SF24 pins Driftwood's images-only upload with one).
  const head = (slug: string) => { const row = pins.shards.find(shard => shard.slug === slug); return { slug, revision: row?.uploadNumber, ...(row?.shardVersion === undefined ? {} : { shardVersion: row.shardVersion }) }; };
  // J434 retired the Template pin, the one whose folder differed from its slug: every pin serves under its own slug.
  expect(releaseShards(pins, 'driftwood-isle,brasscap-mesa')).toEqual([head('driftwood-isle'), head('brasscap-mesa')]);
  expect(() => releaseShards(pins, 'brasscap-mesa,brasscap-mesa')).toThrow(/unique/u);
  // A release of every pin opens every grid cell, through the server's own WORLD_CELLS=grid reading.
  const served = releaseShards(pins, pins.shards.map(row => row.slug).join(',')).map(row => row.slug);
  const { cells } = new GridAssembly({ developer: false, devserver: false });
  expect(worldCells('grid', served)).toHaveLength(cells.length);
});

test('NB7: a release that names a retired row is refused at publish, before any server reads it', () => {
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string; uploadNumber: number }[] };
  // meta NEVER-BREAK-LIVE I6: E7 still listed the retired `_template` (J434) and the live rooms preload rejected it at
  // restart. The release's own pins are the catalogue the engine serves; a row outside them never reaches a signed file.
  expect(pins.shards.some(row => row.slug === '_template')).toBe(false);
  expect(() => releaseShards(pins, 'driftwood-isle,_template')).toThrow('No pinned uploadNumber for _template');
  expect(() => releaseShards(pins, 'driftwood-isle,cinder-orchard')).toThrow('No pinned uploadNumber for cinder-orchard');
});

test('J234: every run signs with main\'s publisher and builds in the source\'s own tree', () => {
  const workflow = readFileSync('.github/workflows/server-release.yml', 'utf8'), publish = workflow.slice(workflow.indexOf('\n  publish:'));
  const checkouts = [...publish.matchAll(/- uses: actions\/checkout@[^\n]+\n\s+with:\n((?:\s{10}[^\n]+\n)+)/gu)].map(match => match[1] ?? '');
  expect(checkouts[0]).toMatch(/ref: main\n/u);
  expect(checkouts[1]).toMatch(/ref: \$\{\{ needs\.source\.outputs\.sha \}\}\n\s+path: source\n/u);
  for (const step of ['Build deterministic dedicated bundle', 'Upload immutable bundle to its tag release']) expect(publish.slice(publish.indexOf(step)).split('\n')[1]).toBe('        working-directory: source');
  const sign = publish.slice(publish.indexOf('Sign and advance the channel release file'));
  expect(sign).not.toMatch(/working-directory/u);
  expect(sign).toContain('node src/scripts/server-release/publish.mjs');
});

test('meta QA 11-25 rows 127 and 135: only the production-pointers job reads the flip token, from the production environment', () => {
  const workflow = readFileSync('.github/workflows/server-release.yml', 'utf8');
  const start = workflow.indexOf('\n  production-pointers:'), end = workflow.indexOf('\n  devserver-client:');
  expect(start).toBeGreaterThan(workflow.indexOf('\n  publish:'));
  const job = workflow.slice(start, end);
  expect(job).toContain('needs: [source, publish]');
  expect(job).toContain("needs.publish.result == 'success' && needs.source.outputs.channel == 'production'");
  expect(job).toMatch(/\n {4}environment: production\n/u);
  expect(job).toContain('PRODUCTION_FLIP_TOKEN: ${{ secrets.PRODUCTION_FLIP_TOKEN }}');
  expect(job).toContain('run: node src/scripts/server-release/production-pointers.mjs');
  expect(job).not.toMatch(/continue-on-error/u);
  // The API's flip-only token has one reader and the full admin token none (row 135: it left GitHub). A workflow
  // naming either anywhere else leaks a catalogue write on a public repo.
  const readers = (secret: string): { name: string, at: number | undefined }[] => readdirSync('.github/workflows')
    .filter(name => /\.ya?ml$/u.test(name)).flatMap(name => {
      const text = readFileSync(join('.github/workflows', name), 'utf8');
      return [...text.matchAll(new RegExp(`secrets\\.${secret}\\b`, 'gu'))].map(match => ({ name, at: match.index }));
    });
  expect(readers('ADMIN_TOKEN')).toEqual([]);
  const flip = readers('PRODUCTION_FLIP_TOKEN');
  expect(flip).toEqual([{ name: 'server-release.yml', at: workflow.indexOf('secrets.PRODUCTION_FLIP_TOKEN') }]);
  expect(flip[0]?.at).toBeGreaterThan(start);
  expect(flip[0]?.at).toBeLessThan(end);
});

test('FS28: signing and client archives queue independently for the exact release', () => {
  const workflow = readFileSync('.github/workflows/server-release.yml', 'utf8');
  const jobs = workflow.indexOf('\njobs:'), publish = workflow.indexOf('\n  publish:');
  const clients = workflow.indexOf('\n  devserver-client:');
  expect(workflow.slice(0, jobs)).not.toMatch(/^concurrency:/mu);
  expect(workflow.slice(publish, clients)).toContain(
    'group: server-release-sign-${{ needs.source.outputs.channel }}-${{ needs.source.outputs.sha }}',
  );
  expect(workflow.slice(publish, clients)).toContain('cancel-in-progress: false');
  expect(workflow.slice(clients)).toContain('group: server-release-clients-${{ needs.source.outputs.tag }}');
  expect(workflow.slice(clients)).toContain('cancel-in-progress: false');
});

test('production release creation needs only the already-pushed tag and cannot create metadata for a different tag', () => {
  const repo = createTempRepo();
  try {
    const build = repo.commit({ 'entry.txt': 'published source' }, 'Tagged source');
    repo.git(['update-ref', 'refs/remotes/origin/main', build]);
    repo.git(['update-ref', 'refs/remotes/origin/release/v1.2.3', build]);
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
      const result = spawnSync(process.execPath, ['--import', transport, resolve('src/scripts/server-release/github.mjs'), 'asset', tag, build, archive,
        staging ? 'staging' : 'production'], { cwd: repo.dir, encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env['PATH'], GH_TOKEN: 'fixture', FIXTURE_SHA: build, FIXTURE_MODE: mode } });
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

test('release refs admit staged and tagged sources while main, dry runs and unreachable tags cannot ship', () => {
  const repo = createTempRepo();
  try {
    const base = repo.commit({ 'base.txt': 'main source' }, 'Base source');
    const sha = repo.commit({ 'src/scripts/server-release/publish.mjs': '// publisher exists' }, 'Release source');
    repo.git(['tag', 'v1.2.3', sha]);
    const later = repo.commit({ 'later.txt': 'newer release head' }, 'Later release source');
    const eventPath = join(repo.dir, 'event.json'), output = join(repo.dir, 'outputs'), transport = join(repo.dir, 'transport.mjs');
    writeFileSync(transport, `
import assert from 'node:assert/strict';
globalThis.fetch = async (input) => {
  const url = new URL(input);
  assert.equal(url.hostname, 'api.github.com');
  assert.equal(url.searchParams.get('head_sha'), process.env.FIXTURE_SHA);
  assert.equal(url.searchParams.get('event'), 'push');
  return Response.json({ workflow_runs: [{ id: 1, head_sha: process.env.FIXTURE_SHA, head_branch: 'release/v1.2.3', event: 'push', status: 'completed', conclusion: 'success' }] });
};
`);
    const run = (mode: string): { status: number | null; stderr: string; output: string } => {
      repo.git(['update-ref', 'refs/remotes/origin/main', mode === 'merged' ? sha : base]);
      repo.git(['update-ref', '-d', 'refs/remotes/origin/release/v1.2.3']);
      if (!['merged', 'unreachable'].includes(mode)) repo.git(['update-ref', 'refs/remotes/origin/release/v1.2.3', sha]);
      if (mode === 'stale') repo.git(['update-ref', 'refs/remotes/origin/release/v1.2.3', later]);
      const eventName = ['tag', 'merged', 'unreachable'].includes(mode) ? 'push' : mode === 'align' ? 'workflow_dispatch' : 'workflow_run';
      const branch = mode === 'main' ? 'main' : mode === 'dryrun' ? 'release/dryrun-v1.2.3' : 'release/v1.2.3';
      writeFileSync(eventPath, JSON.stringify({ workflow_run: { id: 1, head_sha: sha, head_branch: branch, event: 'push', status: 'completed', conclusion: 'success', head_repository: { full_name: 'project-wildshard/engine' } } }));
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, ['--import', transport, resolve(import.meta.dirname, '../src/scripts/server-release/github.mjs'), 'select'], { cwd: repo.dir, encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env['PATH'], GH_TOKEN: 'fixture', FIXTURE_SHA: sha, GITHUB_REPOSITORY: 'project-wildshard/engine', GITHUB_EVENT_NAME: eventName,
          GITHUB_REF: 'refs/heads/main', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, ALIGN_BUILD: sha } });
      expect(result.error).toBeUndefined();
      return { status: result.status, stderr: result.stderr, output: readFileSync(output, 'utf8') };
    };
    for (const mode of ['staging', 'tag', 'merged', 'align']) {
      const result = run(mode);
      expect(result.status, `${mode}: ${result.stderr}`).toBe(0);
      expect(result.output, mode).toContain('ready=true');
      expect(result.output, mode).toContain(`sha=${sha}`);
    }
    for (const mode of ['main', 'dryrun', 'stale']) {
      const result = run(mode);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('');
    }
    const refused = run('unreachable');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/unreachable/u);
    expect(refused.output).toBe('');
  } finally { repo.cleanup(); }
});

test('an already prepared main release finishes explicit staging alignment and asset publication', () => {
  const repo = createTempRepo();
  try {
    repo.commit({ 'package.json': JSON.stringify({ version: '1.2.2' }), 'src/scripts/server-release/publish.mjs': '// released publisher' }, 'Main source');
    const prepared = repo.commit({ 'package.json': JSON.stringify({ version: '1.2.3' }) }, 'chore(release): v1.2.3');
    const later = repo.commit({ 'later.txt': 'main keeps moving' }, 'Ordinary main source');
    repo.git(['update-ref', 'refs/remotes/origin/main', later]);
    // A newer release branch contains the old prepare; it does not make that
    // old prepare its current head or prevent the in-flight release finishing.
    repo.git(['update-ref', 'refs/remotes/origin/release/v1.2.4', later]);
    const transport = join(repo.dir, 'transport.mjs'), output = join(repo.dir, 'outputs'), event = join(repo.dir, 'event.json');
    writeFileSync(transport, `
import assert from 'node:assert/strict';
const sha = process.env.FIXTURE_SHA;
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.origin === 'https://uploads.github.com') return Response.json({});
  assert.equal(url.origin, 'https://api.github.com');
  if (url.pathname.includes('/actions/')) return Response.json({ workflow_runs: [{ id: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] });
  if (url.pathname.includes('/releases/tags/')) return Response.json({ id: 1, upload_url: 'https://uploads.github.com/releases/1/assets{?name}', assets: [] });
  return Response.json({ object: { type: 'commit', sha } });
};
`);
    const invoke = (sha: string, mode = 'workflow_dispatch'): { status: number | null; stderr: string; output: string } => {
      writeFileSync(output, '');
      writeFileSync(event, JSON.stringify({ workflow_run: { id: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_repository: { full_name: 'project-wildshard/engine' } } }));
      const result = spawnSync(process.execPath, ['--import', transport, resolve('src/scripts/server-release/github.mjs'), 'select'], { cwd: repo.dir, encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env['PATH'], GH_TOKEN: 'fixture', FIXTURE_SHA: sha, GITHUB_REPOSITORY: 'project-wildshard/engine', GITHUB_EVENT_NAME: mode, GITHUB_REF: 'refs/heads/main', ALIGN_BUILD: sha, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } });
      return { status: result.status, stderr: result.stderr, output: readFileSync(output, 'utf8') };
    };
    const admitted = invoke(prepared);
    expect(admitted.status, admitted.stderr).toBe(0);
    expect(admitted.output).toContain('ready=true');
    expect(invoke(prepared, 'workflow_run').output).toBe('');
    const refused = invoke(later);
    expect(refused.status).toBe(1);
    expect(refused.output).toBe('');
    const archive = join(repo.dir, `engine-server-${prepared}.tar.gz`);
    writeFileSync(archive, 'prepared legacy bundle');
    repo.git(['switch', '--detach', prepared]);
    const asset = spawnSync(process.execPath, ['--import', transport, resolve('src/scripts/server-release/github.mjs'), 'asset', `server-staging-${prepared}`, prepared, archive, 'staging'],
      { cwd: repo.dir, encoding: 'utf8', timeout: 5000, env: { PATH: process.env['PATH'], GH_TOKEN: 'fixture', FIXTURE_SHA: prepared } });
    expect(asset.status, asset.stderr).toBe(0);
  } finally { repo.cleanup(); }
});

test('the main publisher admits an unmerged release head and refuses unreachable source bytes', () => {
  const repo = createTempRepo();
  try {
    const main = repo.commit({ 'save-epoch.json': JSON.stringify({ saveEpoch: 1 }), 'test/pins/shardfiles.json': JSON.stringify({ shards: [{ slug: 'driftwood-isle', revision: 1 }] }) }, 'Main publisher source');
    repo.git(['switch', '-c', 'release/v1.2.3']);
    const build = repo.commit({ 'release.txt': 'version and notes' }, 'chore(release): v1.2.3');
    repo.git(['tag', 'v1.2.3', build]);
    repo.git(['update-ref', 'refs/remotes/origin/release/v1.2.3', build]);
    repo.git(['update-ref', 'refs/remotes/origin/main', main]);
    repo.git(['switch', 'main']);
    const archive = join(repo.dir, `engine-server-${build}.tar.gz`);
    writeFileSync(archive, 'exact immutable release bundle');
    const invoke = (channel: string): { status: number | null; stdout: string; stderr: string } => spawnSync(process.execPath, [resolve('src/scripts/server-release/publish.mjs'), '--check', '--channel', channel, '--build', build,
      '--tag', channel === 'staging' ? `server-staging-${build}` : 'v1.2.3', '--bundle', archive, '--out', join(repo.dir, 'release.json')],
    { cwd: repo.dir, encoding: 'utf8', timeout: 5000, env: { PATH: process.env['PATH'], E7_RELEASE_SIGNING_KEY: pem, E7_RELEASE_PUBLIC_KEY: publicKey,
      E7_RELEASE_SOCKET: 'wss://stage.example.test/', E7_SERVER_SHARDS: 'driftwood-isle', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET_PACKS: 'wildshard-packs', R2_PACKS_ACCESS_KEY_ID: 'fixture', R2_PACKS_SECRET_ACCESS_KEY: 'fixture', R2_RELEASES_ACCESS_KEY_ID: 'fixture', R2_RELEASES_SECRET_ACCESS_KEY: 'fixture' } });
    for (const channel of ['staging', 'production']) {
      const admitted = invoke(channel);
      expect(admitted.status, String(admitted.stderr)).toBe(0);
      expect(String(admitted.stdout)).toContain('Server release configuration admitted');
    }
    repo.git(['update-ref', '-d', 'refs/remotes/origin/release/v1.2.3']);
    expect(invoke('staging').status).toBe(1);
    expect(invoke('production').status).toBe(1);
  } finally { repo.cleanup(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- The test owns a small folder store.
import {mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdtempSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The tests stage files in one folder of their own.
import {join, dirname, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the exact bytes in the shardfile, not their names.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the bytes inside real cooked parts with loose files.
import {brotliDecompressSync} from 'node:zlib';
import {afterAll, expect, test, vi} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {migrateShardfile} from '@wildshard/format/migrate';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {folderStore} from '../src/cook/game/packStore';
import {folderTarball} from '../src/cook/game/folderTarball';
import {runCookJob} from '../src/cook/game/cookJob';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {readServerPack} from '../src/shared/game/shardfile/serverPack';
import {publishCooked, readVersionedCook, verifyCookReuse} from '../src/cook/game/publishCooked';
import {sourceOnlyParts} from '../src/cook/game/cookObjectProvenance';
import {objectHeaders, type CookIndex} from '../src/cook/game/cookWorker';
import type {ObjectHeaders} from '../src/cook/game/packStore';
import {checkedCookedMember, cookedIndexKey, cookedObjectKey} from '../src/shared/game/shardfile/cookedPackPaths';
import {releaseCookedPack} from '../src/server/host/dedicated/packReader';
import {readSpawnManifest, type SpawnManifest} from '../src/shared/game/shardfile/spawnManifest';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

const scratch = resolve('tmp/codex-cookkeys');
mkdirSync(scratch, {recursive: true});
const root = mkdtempSync(join(scratch, 'publish-'));
afterAll(() => {rmSync(root, {recursive: true, force: true});});
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const identity = {slug: 'fixture', shardVersion: '0.2.0', cookVersion: '1.0.0', cookHash: 'a'.repeat(64)};
const hash = 'b'.repeat(64), outputDigest = 'c'.repeat(64), mount = 'assets/fixture/image.png', generated = 'assets/spawn/manifest.json';

test('two cook versions keep the same shardfile files once and resolve generated output by version', async () => {
  const store = folderStore(join(root, 'r2')), putImmutable = vi.fn(store.putImmutable);
  const options = {store: {...store, putImmutable}, headers: () => ({type: 'application/octet-stream', cache: 'public'}),
    parallel: async <T,>(rows: readonly T[], run: (row: T) => Promise<void>) => {await Promise.all(rows.map(run));}};
  const make = (path: string, body: string): void => {
    const file = join(root, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body);
  };
  make(mount, 'from the shardfile');
  make(generated, 'from the cook');
  const index = legacyDouble<CookIndex>({slug: identity.slug, hash, check: {...legacyDouble<NonNullable<CookIndex['check']>>({pass: true})}});
  const files = [{path: mount, file: mount, common: true, mount: true}, {path: generated, file: generated}];
  const first = await publishCooked(options, identity, index, outputDigest, root, files);
  const versionTwo = {...identity, cookVersion: '1.1.0', cookHash: '1'.repeat(64)};
  const second = await publishCooked(options, versionTwo, index, outputDigest, root, files);
  const shared = cookedObjectKey(identity, first.objects, mount);
  expect(shared).toBe(`shards/fixture/0.2.0/common/${digest('from the shardfile')}.png`);
  expect(second.mounts?.[`/${mount}`]).toBe(shared);
  expect(await store.list('shards/fixture/0.2.0/common/')).toHaveLength(1);
  expect(cookedObjectKey(versionTwo, second.objects, generated)).toBe(`shards/fixture/0.2.0/cooks/1.1.0/${generated}`);
  expect(second.cookHash).toBe(versionTwo.cookHash);
  expect(await readVersionedCook(store, versionTwo, hash)).toEqual(second);
  expect(await store.has(cookedIndexKey(identity))).toBe(true);
  expect(shared).toBeDefined();
  if (shared === undefined) throw new Error('Missing shared object');
  await expect(async () => {await store.putImmutable(shared, Buffer.from('other bytes'), options.headers());}).rejects.toThrow('Cook object bytes differ');
  expect(readFileSync(join(root, 'r2', shared), 'utf8')).toBe('from the shardfile');
});

test('CK1: headers come from the object key, so content-named copies are immutable', async () => {
  const at = join(root, 'ck1'), store = folderStore(join(at, 'r2')), seen = new Map<string, ObjectHeaders>();
  const asked: string[] = [];
  const options = {store: {...store, putImmutable: async (key: string, body: Uint8Array, headers: ObjectHeaders) => {
    seen.set(key, headers); await store.putImmutable(key, body, headers);
  }}, headers: (key: string) => {asked.push(key); return objectHeaders(key);},
  parallel: async <T,>(rows: readonly T[], run: (row: T) => Promise<void>) => {await Promise.all(rows.map(run));}};
  const jpg = 'assets/fixture/baked/tex/clouds.jpg', part = 'assets/spawn/parts/0123456789abcdef.pack.br';
  for (const [path, body] of [[jpg, 'cloud pixels'], [part, 'part bytes'], [generated, 'from the cook']] as const) {
    const file = join(at, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body);
  }
  const index = legacyDouble<CookIndex>({slug: identity.slug, hash, check: {...legacyDouble<NonNullable<CookIndex['check']>>({pass: true})}});
  const out = await publishCooked(options, identity, index, outputDigest, at, [
    {path: jpg, file: jpg, common: true, mount: true}, {path: part, file: part}, {path: generated, file: generated}]);
  const key = (path: string): string => out.objects[path] ?? '';
  expect(key(jpg)).toBe(`shards/fixture/0.2.0/common/${digest('cloud pixels')}.jpg`);
  expect(asked.sort()).toEqual(Object.values(out.objects).sort());
  expect(seen.get(key(jpg))).toEqual({type: 'image/jpeg', cache: 'public, max-age=31536000, immutable'});
  expect(seen.get(key(part))?.cache).toBe('public, max-age=31536000, immutable');
  expect(seen.get(key(generated))?.cache).toBe('public, max-age=300');
  // An index stays short-lived: the versioned carry may replace one in place when a newer validator judges the same bytes.
  expect(seen.get(cookedIndexKey(identity))?.cache).toBe('public, max-age=300');
  // The page path alone is not content-named: asking by it was the bug (142 live objects at max-age=300, 11-28).
  expect(objectHeaders(jpg).cache).toBe('public, max-age=300');
});

test('the full part digest can be rebuilt only with original members', () => {
  const raw = new Uint8Array(21), first = Buffer.from('first'), second = Buffer.from('other');
  raw.set(first); raw.set(second, 16);
  const url = '/assets/spawn/parts/example.pack.br';
  const part = {url, bytes: raw.length, hash: digest(raw)};
  const make = (tier: 'phone' | 'desktop', body: Uint8Array, offset: number): SpawnManifest =>
    ({version: 1, shard: identity.slug, tier, flow: 'client', totalBytes: body.length,
      files: [{url: `/${tier}.png`, bytes: body.length, hash: digest(body)}], parts: [{...part, members: [[0, offset]]}]});
  const phone = make('phone', first, 0), desktop = make('desktop', second, 16);
  const original = (path: string): Uint8Array => path === '/phone.png' ? first : second;
  expect(sourceOnlyParts([phone, desktop], original)).toEqual([url.slice(1)]);
  expect(sourceOnlyParts([phone], original)).toEqual([]);
  expect(sourceOnlyParts([phone, desktop], path => path === '/phone.png' ? first : undefined)).toEqual([]);
});

test('new hash verifies two independent zones and refuses changed bytes', async () => {
  const samples = [{slug: 'driftwood-isle', outputDigest: 'driftwood bytes'}, {slug: 'brasscap-mesa', outputDigest: 'brasscap bytes'}];
  const cook = vi.fn(async (slug: string) => {await Promise.resolve(); return samples.find(row => row.slug === slug)?.outputDigest ?? '';});
  await verifyCookReuse(samples, cook);
  expect(cook.mock.calls).toEqual([['driftwood-isle'], ['brasscap-mesa']]);
  await expect(verifyCookReuse(samples, slug => Promise.resolve(slug === 'driftwood-isle' ? 'driftwood bytes' : 'changed'))).rejects.toThrow('Cook output changed for brasscap-mesa');
});

test('a room reads the signed cook address and accepts the placement version for an advanced upload', () => {
  const legacy = {shards: [{slug: identity.slug, hash, shardVersion: identity.shardVersion}]};
  expect(releaseCookedPack(legacy, identity.slug)).toBeUndefined();
  const release = {...legacy, cook: {version: identity.cookVersion, hash: identity.cookHash}};
  expect(releaseCookedPack(release, identity.slug)).toEqual({ref: identity, hash});
  expect(releaseCookedPack({...release, shards: [{slug: identity.slug, shardVersion: identity.shardVersion}]}, identity.slug)).toEqual({ref: identity});
  const advanced = {hash: 'e'.repeat(64), shardVersion: '0.3.0-candidate.1'};
  expect(releaseCookedPack(release, identity.slug, advanced)).toEqual({ref: {...identity, shardVersion: advanced.shardVersion}, hash: advanced.hash});
  expect(() => releaseCookedPack(release, identity.slug, {hash: advanced.hash})).toThrow('Signed cook address is incomplete');
});

test('a versioned cook stores no loose bytes that already belong to a client or server part', {timeout: 120_000}, async () => {
  const out = join(root, 'single-copy'), client = join(out, 'client');
  const original = readTar(folderTarball(resolve('test/fixtures/made-up-old')));
  const source = new Map(migrateShardfile(original, {hash: digest}).files);
  const header = source.get('shard.json'), staleReceipt = original.get('validation.json');
  if (header === undefined || staleReceipt === undefined) throw new Error('Test product needs a header and a receipt');
  const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
  const receipt = {...Object(parse(staleReceipt)), sourceHash: parseOutputIndex(parse(header)).build?.sourceHash, indexHash: digest(header)};
  source.set('validation.json', new TextEncoder().encode(JSON.stringify(receipt)));
  const report = await runCookJob(writeTar(source), out, {
    check: (shard, assets, sections) => checkShardfile(shard, assets, {sections}),
    versionedOutput: true, shardVersion: '1.2.3', wireBytes: (_url, bytes) => bytes.length, now: () => 0,
  });
  const packed = new Set<string>(), parts = new Set<string>(), headerHashes: string[] = [];
  const partBody = (url: string): Buffer => {
    const file = join(client, url.slice(1)); parts.add(file);
    return brotliDecompressSync(readFileSync(file));
  };
  for (const row of report.cook.manifests) {
    const manifest = readSpawnManifest(JSON.parse(readFileSync(join(client, row.url.slice(1)), 'utf8')));
    const header = manifest.files.find(file => file.url.startsWith(`/${report.header}?v=`));
    if (header === undefined) throw new Error('Manifest lost its header');
    headerHashes.push(header.hash);
    for (const part of manifest.parts ?? []) {
      const bytes = partBody(part.url);
      for (const [index, offset] of part.members) {
        const file = manifest.files[index];
        if (file === undefined) throw new Error('Missing part member');
        packed.add(digest(bytes.subarray(offset, offset + file.bytes)));
      }
    }
  }
  const server = readServerPack(JSON.parse(readFileSync(join(client, report.cook.server.index.slice(1)), 'utf8')));
  for (const part of [server, ...server.more ?? []]) {
    const bytes = partBody(part.url);
    for (const [, offset, size] of part.files) packed.add(digest(bytes.subarray(offset, offset + size)));
  }
  for (const dirent of readdirSync(client, {recursive: true, withFileTypes: true})) {
    const path = join(dirent.parentPath, dirent.name);
    if (dirent.isFile() && !parts.has(path)) expect(packed.has(digest(readFileSync(path))), path).toBe(false);
  }
  const alias = report.objects?.members?.[report.header];
  expect(alias).toBeDefined();
  if (alias === undefined) throw new Error('The header should use its server part');
  expect(new Set(headerHashes)).toEqual(new Set([alias.hash]));
  expect(report.receipt?.indexHash).toBe(alias.hash);
  expect(report.objects?.common).not.toContain(alias.part);
  expect(JSON.parse(new TextDecoder().decode(await checkedCookedMember(partBody(`/${alias.part}`), alias))))
    .toMatchObject({identity: {slug: report.slug}, cook: {path: 'cook.json'}});
});

// oxlint-disable-next-line import/no-nodejs-modules -- The test owns a small folder store.
import {mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The tests stage files in one folder of their own.
import {join, dirname, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the exact bytes in the shardfile, not their names.
import {createHash} from 'node:crypto';
import {afterAll, expect, test, vi} from 'vitest';
import {folderStore} from '../src/cook/game/packStore';
import {publishCooked, readVersionedCook, verifyCookReuse} from '../src/cook/game/publishCooked';
import {sourceOnlyParts} from '../src/cook/game/cookObjectProvenance';
import type {CookIndex} from '../src/cook/game/cookWorker';
import {cookedIndexKey, cookedObjectKey} from '../src/shared/game/shardfile/cookedPackPaths';
import {releaseCookedPack} from '../src/server/host/dedicated/packReader';
import type {SpawnManifest} from '../src/shared/game/shardfile/spawnManifest';
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

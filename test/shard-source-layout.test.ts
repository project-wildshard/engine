// SHARD-AUTHORING SA42 (engine half): the shard build scripts read a single-shard repo's `src/` as well as `src/shards/<folder>/`,
// the layouts sharddev's SA16 `findShardSource` already tells apart, so `build-shards` can build either.
// oxlint-disable-next-line import/no-nodejs-modules -- Each layout is a fixture repo on disk, as the scripts read one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixtures live in the OS temp folder.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { hasShardSource, manifestFolders, outputManifest, productFolder, shardOutputs, shardSourceDir, singleShardFolder } from '../scripts/shard-outputs.mjs';
import { mapShards } from '../scripts/map-hash.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function repo(name: string, files: Readonly<Record<string, string>>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'sa42-')), name);
  roots.push(root);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
}
const manifest = (slug: string): string => JSON.stringify({ slug, name: slug, look: { tint: 'base' } });
const outputs = JSON.stringify({ outputs: [{ slug: 'cove-night', manifest: { look: { tint: 'night' } } }] });

test('a multi-shard repo reads src/shards/<folder>/, as before', () => {
  const root = repo('shard-pair', { 'src/shards/cove/shard.config.ts': '', 'src/shards/cove/manifest.json': manifest('cove'), 'src/shards/cove/outputs.json': outputs,
    'src/shards/reef/shard.config.ts': '', 'src/shards/reef/manifest.json': manifest('reef') });
  expect(singleShardFolder(root)).toBeNull();
  expect(hasShardSource(root)).toBe(true);
  expect(manifestFolders(root)).toEqual(['cove', 'reef']);
  expect(shardSourceDir(root, 'reef')).toBe(join(root, 'src/shards/reef'));
  expect(mapShards(root)).toEqual([{ slug: 'cove', dir: join(root, 'src/shards/cove') }, { slug: 'reef', dir: join(root, 'src/shards/reef') }]);
  expect(productFolder(root, 'cove-night')).toBe('cove');
});

test('a single-shard repo reads src/ as one folder named by its manifest slug', () => {
  const root = repo('shard-cove', { 'src/shard.config.ts': '', 'src/manifest.json': manifest('cove'), 'src/outputs.json': outputs });
  expect(singleShardFolder(root)).toBe('cove');
  expect(hasShardSource(root)).toBe(true);
  expect(manifestFolders(root)).toEqual(['cove']);
  expect(shardSourceDir(root, 'cove')).toBe(join(root, 'src'));
  expect(mapShards(root)).toEqual([{ slug: 'cove', dir: join(root, 'src') }]);
  const [night] = shardOutputs(root, 'cove') ?? [];
  expect(night?.slug).toBe('cove-night');
  expect(productFolder(root, 'cove-night')).toBe('cove');
  expect(outputManifest(root, 'cove', night?.row ?? { slug: 'x' })).toMatchObject({ slug: 'cove-night', look: { tint: 'night' }, shardfile: '/shardfiles/cove-night/shard.json' });
});

test('a bad single-shard outputs.json names its own path', () => {
  const root = repo('shard-cove', { 'src/shard.config.ts': '', 'src/manifest.json': manifest('cove'), 'src/outputs.json': JSON.stringify({ outputs: [] }) });
  expect(() => shardOutputs(root, 'cove')).toThrow('src/outputs.json: needs a nonempty outputs list');
});

test('a single-shard source with no manifest slug takes the repo folder name; a hand-written one its identity slug', () => {
  expect(singleShardFolder(repo('shard-bare', { 'src/shard.config.ts': '' }))).toBe('shard-bare');
  const handwritten = repo('shard-hand', { 'src/shard.json': JSON.stringify({ identity: { slug: 'hand-made' } }) });
  expect(singleShardFolder(handwritten)).toBe('hand-made');
  expect(mapShards(handwritten), 'no shard.config.ts: no map bake').toEqual([]);
});

test('a tree with no shard source has no folders (P3)', () => {
  const root = repo('engine-like', { 'src/index.ts': '' });
  expect(hasShardSource(root)).toBe(false);
  expect(manifestFolders(root)).toEqual([]);
  expect(mapShards(root)).toEqual([]);
});

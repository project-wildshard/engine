// oxlint-disable-next-line import/no-nodejs-modules -- Read receipt-backed product bytes and exercise asset admission.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the current SDK-built product and its declared file.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the complete GLB without expanding a 10 MB assertion.
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { readBuiltShardfile } from '../scripts/built-folder.mjs';
import { readProgramDiscovery } from '../scripts/program-discovery.mjs';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { emptyShardfile } from '../src/shared/host/author';
import { projectAssets } from '../src/sharddev/project';
import { prepareProjectOutput } from '../src/sharddev/projectOutput';
import { createProjectGeneration } from '../src/sharddev/projectGeneration';
import { prepareOutput } from '../src/shards/far-reach/generators/sourceOutput';
import { SKY_WORLD_TILE_ROWS } from '../src/shards/far-reach/generators/worldTileRows';
import { SKY_NAVIGATION_INPUT, skyNavigationRows } from '../src/shards/far-reach/generators/navigation';

test('the SDK-built product publishes receipt-backed geometry and discovery', () => {
  const root = resolve('.'), folder = readBuiltShardfile(root, 'far-reach');
  const input: unknown = JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8'));
  const index = parseOutputIndex(input);
  const discovery = readProgramDiscovery(root, 'far-reach');
  expect(discovery.navigation).toEqual(skyNavigationRows(readFileSync(resolve('src/shards/far-reach', SKY_NAVIGATION_INPUT))));
  for (const name of ['prepared-models', 'bridge-rest', 'mill-rest', 'fan']) {
    const file = index.files.find(row => row.name === `world/geometry/${name}.glb`);
    if (file === undefined) throw new Error('Missing owned geometry');
    const bytes = readFileSync(resolve(folder, file.path));
    expect(file.path).toBe(`blobs/glb/${file.hash}.glb`);
    expect(hashImmutableBytes(bytes)).toBe(file.hash);
  }
});


test('all original tiles admit from owned output with no project asset files', async () => {
  const scratch = mkdtempSync(resolve('tmp/sky-tile-publication-'));
  try {
    const ctx = createProjectGeneration(resolve('src/shards/far-reach'), 'f'.repeat(64), new Map(), resolve(scratch, 'cache'),
      [{ prefix: '/assets/', directory: resolve('public/assets') }]);
    const owned = await prepareOutput(ctx), prepared = await prepareProjectOutput(resolve('src/shards/far-reach'), owned);
    const base = emptyShardfile({ slug: 'tile-publication', name: 'Tiles', author: 'Fixture', revision: 1, seed: 1 });
    const rows = SKY_WORLD_TILE_ROWS, shard = { ...base, files: rows.files, tiles: rows.tiles,
      library: rows.files.map(file => file.hash), budgets: { ...base.budgets, library: {
        compressed: rows.files.reduce((sum, file) => sum + file.compressed, 0),
        resident: rows.files.reduce((sum, file) => sum + file.decoded + file.gpu, 0) } } };
    const empty = mkdtempSync(resolve(scratch, 'project-'));
    const admitted = projectAssets(empty, shard, 'project', prepared.assets);
    expect(readdirSync(empty)).toEqual([]);
    expect([...admitted.keys()]).toEqual(rows.files.map(file => file.hash));
    const folder = readBuiltShardfile(resolve('.'), 'far-reach');
    const input: unknown = JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8'));
    const index = parseOutputIndex(input);
    const lod = (level: number): Set<string> => new Set(rows.tiles.filter(tile => tile.lod === level).flatMap(tile => tile.files));
    const fineFiles = lod(0), coarseFiles = lod(1), fine = rows.files.filter(file => fineFiles.has(file.hash)), coarse = rows.files.filter(file => coarseFiles.has(file.hash));
    expect(fine.length).toBeGreaterThan(0);
    expect(coarse.length).toBeGreaterThan(0);
    expect([...fineFiles].some(hash => coarseFiles.has(hash))).toBe(false);
    expect(fine.length + coarse.length).toBe(rows.files.length);
    for (const original of [...fine, ...coarse]) {
      const file = index.files.find(row => row.hash === original.hash), bytes = admitted.get(original.hash);
      if (file === undefined || bytes === undefined) throw new Error('Missing admitted original tile');
      expect(file).toMatchObject(original);
      expect(hashImmutableBytes(bytes)).toBe(original.hash);
      expect(Buffer.compare(bytes, readFileSync(resolve(folder, file.path)))).toBe(0);
    }
    const first = rows.files[0];
    if (first === undefined) throw new Error('Missing original tile declaration');
    const missing = new Map(prepared.assets); missing.delete(first.hash);
    expect(() => projectAssets(empty, shard, 'project', missing)).toThrow();
    const short = new Map(prepared.assets); short.set(first.hash, new Uint8Array());
    expect(() => projectAssets(empty, shard, 'project', short)).toThrow('Project asset differs from its declared wire size');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

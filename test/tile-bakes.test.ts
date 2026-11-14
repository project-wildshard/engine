// oxlint-disable-next-line import/no-nodejs-modules -- Isolated product bytes exercise the real build-time guard without a producer or build.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Every test path stays under its owned fixture root.
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { emptyShardfile } from '../src/shared/host/author';
import { writeOutputFolder } from '../src/sharddev/outputFolder';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { checkTileBake, readTileBakeCensus, tileBakeCensus } from '../scripts/tile-bakes.mjs';
import { parseTileBakePolicy, tileBakeApprovalFailures } from '../scripts/tile-bake-policy.mjs';

const owned: string[] = [];
afterEach(() => { for (const folder of owned.splice(0)) rmSync(folder, { recursive: true }); });
function tiles(): Shardfile['tiles'] {
  return ([0, 1] as const).flatMap(lod => Array.from({ length: lod === 0 ? 64 : 16 }, (_, i): Shardfile['tiles'][number] => {
    const count = lod === 0 ? 8 : 4, size = 500 / count, x = i % count, z = Math.floor(i / count);
    return { lod, x, z, files: [], bounds: { min: [-250 + x * size, 0, -250 + z * size], max: [-250 + (x + 1) * size, 0, -250 + (z + 1) * size] },
      geometricError: 0, decoded: 0, gpu: 0, compressed: 0, triangles: 0, draws: 0 };
  }));
}
function fixture(rows = tiles()): { root: string; folder: string } {
  mkdirSync('tmp', { recursive: true });
  const root = resolve(mkdtempSync('tmp/tile-bake-check-')); owned.push(root);
  mkdirSync(resolve(root, 'lint'));
  writeFileSync(resolve(root, 'lint/tile-bake-debt.json'), JSON.stringify({ version: 1, products: {} }));
  const folder = resolve(root, 'out/check'), source = emptyShardfile({ slug: 'check', name: 'Check', author: 'Test', revision: 1, seed: 1 });
  source.tiles = rows;
  writeOutputFolder(source, new Map(), folder);
  return { root, folder };
}
test('a new product requires all 64+16 coordinates and every full 5x5', () => {
  const f = fixture(), census = checkTileBake(f.root, 'check', f.folder);
  expect([census.l0, census.l1, census.windows.length]).toEqual([64, 16, 16]);
  expect(census.windows.every(window => window.tiles === 25)).toBe(true);
  expect(census.debt).toEqual({});
  const absent = fixture(tiles().slice(1));
  expect(() => checkTileBake(absent.root, 'check', absent.folder)).toThrow('missing/0/0/0');
});
test.each([0, 1] as const)('the exact L%s cap is allowed, one extra unit is debt for every metric', lod => {
  const rows = tiles(), tile = rows.find(row => row.lod === lod), cap = lod === 0 ? CONTENT_CAPS.l0 : CONTENT_CAPS.l1;
  if (tile === undefined) throw new Error('Missing fixture tile');
  Object.assign(tile, { decoded: cap.resident, compressed: cap.compressed, triangles: cap.triangles, draws: cap.draws });
  expect(tileBakeCensus(rows, []).debt).toEqual({});
  tile.decoded++; tile.compressed++; tile.triangles++; tile.draws++;
  expect(tileBakeCensus(rows, []).debt).toEqual({ [`tile/${lod}/0/0/resident`]: cap.resident + 1,
    [`tile/${lod}/0/0/compressed`]: cap.compressed + 1, [`tile/${lod}/0/0/triangles`]: cap.triangles + 1, [`tile/${lod}/0/0/draws`]: cap.draws + 1 });
});
test('exact coordinate debt permits its current cost but no new or worsened overrun', () => {
  const rows = tiles(), first = rows[0];
  if (first === undefined) throw new Error('Missing fixture tile');
  first.compressed = CONTENT_CAPS.l0.compressed + 1;
  const f = fixture(rows), path = resolve(f.root, 'lint/tile-bake-debt.json');
  writeFileSync(path, JSON.stringify({ version: 1, products: { check: { 'tile/0/0/0/compressed': first.compressed } } }));
  expect(checkTileBake(f.root, 'check', f.folder).debt).toEqual({ 'tile/0/0/0/compressed': first.compressed });
  first.compressed++;
  const source = emptyShardfile({ slug: 'check', name: 'Check', author: 'Test', revision: 1, seed: 1 }); source.tiles = rows;
  writeOutputFolder(source, new Map(), f.folder);
  expect(() => checkTileBake(f.root, 'check', f.folder)).toThrow('tile/0/0/0/compressed');
  writeFileSync(path, JSON.stringify({ version: 1, products: { other: { 'tile/0/0/0/compressed': first.compressed } } }));
  expect(() => checkTileBake(f.root, 'check', f.folder)).toThrow('tile bake refused');
});
test('5x5 totals include all rows and count shared transitive assets once separately', () => {
  const rows = tiles(), hash = 'a'.repeat(64), dependency = 'b'.repeat(64);
  for (const tile of rows.filter(row => row.lod === 0)) { tile.files = [hash]; tile.compressed = 17; }
  const census = tileBakeCensus(rows, [{ hash, dependencies: [dependency], decoded: 10, gpu: 20, compressed: 7, triangles: 3, draws: 1 },
    { hash: dependency, dependencies: [], decoded: 30, gpu: 40, compressed: 11, triangles: 0, draws: 0 }]);
  expect(census.windows.every(window => window.declared.compressed === 25 * 17 && window.unique.compressed === 18 && window.unique.resident === 100)).toBe(true);
  expect(() => tileBakeCensus(rows, [])).toThrow('Tile file/dependency is absent');
});
test('full 5x5 cap checks include the corner and permit the exact aggregate cap', () => {
  const rows = tiles(), first = rows[0];
  if (first === undefined) throw new Error('Missing fixture tile');
  for (const tile of rows.filter(row => row.lod === 0)) tile.decoded = CONTENT_CAPS.l0.resident;
  expect(tileBakeCensus(rows, []).debt).toEqual({});
  first.decoded++;
  expect(tileBakeCensus(rows, []).debt).toEqual({ 'tile/0/0/0/resident': CONTENT_CAPS.l0.resident + 1,
    'window/2/2/resident': 25 * CONTENT_CAPS.l0.resident + 1 });
});
test('duplicate, out-of-grid and dishonest cell bounds refuse before policy', () => {
  const rows = tiles(), first = rows[0];
  if (first === undefined) throw new Error('Missing fixture tile');
  expect(() => tileBakeCensus([first, first], [])).toThrow('Duplicate or outside tile');
  expect(() => tileBakeCensus([{ ...first, x: 8 }], [])).toThrow('Duplicate or outside tile');
  expect(() => tileBakeCensus([{ ...first, bounds: { ...first.bounds, max: [-188, 0, -187.5] } }], [])).toThrow('bounds differ');
});
test('corrupt section bytes and a mismatched index receipt cannot borrow debt', () => {
  const f = fixture(), path = resolve(f.folder, 'sections/world/tiles.json'), bytes = readFileSync(path);
  writeFileSync(path, `${bytes.toString('utf8')} `);
  expect(() => readTileBakeCensus(f.folder, 'check')).toThrow('section hash/size differs');
  writeFileSync(path, bytes); writeFileSync(resolve(f.folder, 'validation.json'), JSON.stringify({ indexHash: '0'.repeat(64) }));
  expect(() => readTileBakeCensus(f.folder, 'check')).toThrow('index receipt differs');
});
test('policy rows are strict and increases/identity swaps require exact approval trailers', () => {
  const before = { version: 1, products: { check: { 'missing/0/0/0': 1, 'tile/0/1/1/compressed': 400000 } } };
  expect(() => parseTileBakePolicy({ ...before, skip: true })).toThrow();
  expect(() => parseTileBakePolicy({ version: 1, products: { check: { 'missing/0/0/0': 2 } } })).toThrow('one exact coordinate');
  expect(() => parseTileBakePolicy({ version: 1, products: { check: { 'tile/*/compressed': 500000 } } })).toThrow();
  expect(tileBakeApprovalFailures(before, { version: 1, products: {} }, '')).toEqual([]);
  const after = { version: 1, products: { check: { 'missing/0/1/0': 1, 'tile/0/1/1/compressed': 400001 } } };
  expect(tileBakeApprovalFailures(before, after, '')).toHaveLength(2);
  expect(tileBakeApprovalFailures(before, after, 'test: reviewed\n\nRatchet-Approved: wildshard-new wildshard/tile-bake check/missing/0/1/0 +1\nRatchet-Approved: wildshard-new wildshard/tile-bake check/tile/0/1/1/compressed +1')).toEqual([]);
  expect(tileBakeApprovalFailures(undefined, before, '')).toEqual(['Missing ratchet approval: Ratchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1']);
  expect(tileBakeApprovalFailures(undefined, before, 'test: bootstrap\n\nRatchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1')).toEqual([]);
  expect(tileBakeApprovalFailures(before, before, 'test: unused\n\nRatchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1')).toEqual([]);
});

// @vitest-environment node
/// <reference types="node" />
// SB38e (meta STAGING-BUGBASH, WILDSHARD-GAME-8Z): staging's grid placements change after the build (J379 auto-placed
// uploads), so the page's live inputs miss the baked strip book and it certified and built every seam itself, in play, on
// a phone. A seam's shape is a function of its shape key alone, so the page now seeds construction with every baked shape
// its live inputs still name and certifies only the shapes beside a changed cell, building the same strips byte for byte.
import { expect, test } from 'vitest';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { Scope } from '../src/shared/engine/app/scope';
import { generatePlatform, platformShapeKeys, type GeneratedStrip, type PlatformCell, type StripProfile } from '../src/shared/engine/sim/strips';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { platformGeometrySource, readCompiledGridStrips, readGridStripsOrSeeds } from '../src/shared/game/grid/compiledStrips';
import { writeGridStripBlocks } from '../src/cook/game/gridStripPages';
// oxlint-disable-next-line import/no-nodejs-modules -- This artifact fixture owns and removes only its bounded tmp directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's own ignored scratch output.
import { basename, join, resolve } from 'node:path';

const pitch = CONTENT_CAPS.pitch, reach = 1.5 * pitch + 1;
const empty: StripProfile = { roadHeight: 0, heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.25, 0.25, 0.25]) };
/** A varied edge (road level and grey at both ends, so corners agree), different for each seed. */
const hills = (seed: number): StripProfile => ({ roadHeight: 0,
  heights: Array.from({ length: 257 }, (_, i) => i === 0 || i === 256 || Math.abs(-250 + i * 500 / 256) < 12 ? 0 : (i * seed) % 23 - 9),
  colours: Array.from({ length: 257 }, (_, i) => i === 0 || i === 256 ? [0.25, 0.25, 0.25] : [(i % 5) / 5, (i * seed % 7) / 7, 0.5]) });
const cell = (x: number, z: number, edges: Partial<PlatformCell['edges']> = {}): PlatformCell => ({ instance: `cell_${x}_${z}`, cell: [x, z],
  origin: { x: x * pitch, z: z * pitch }, edges: { north: empty, east: empty, south: empty, west: empty, ...edges } });
/** The build's grid: 3 x 3, two cells with real edges. */
const built = (): PlatformCell[] => {
  const cells: PlatformCell[] = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    const seed = x === 0 && z === 0 ? 3 : x === 1 && z === 0 ? 5 : 0;
    cells.push(seed === 0 ? cell(x, z) : cell(x, z, { north: hills(seed), east: hills(seed), south: hills(seed), west: hills(seed) }));
  }
  return cells;
};
/** The live grid after the build: an auto-placed cell east of the grid and one changed edge. */
const live = (): PlatformCell[] => [...built().map(row => row.instance === 'cell_-1_1' ? { ...row, edges: { ...row.edges, east: hills(7) } } : row),
  cell(2, 0, { north: hills(11), east: hills(11), south: hills(11), west: hills(11) })];
const ring = (home: PlatformCell) => (x: number, z: number): boolean => Math.abs(x - home.origin.x) <= reach && Math.abs(z - home.origin.z) <= reach;
const words = (array: Float32Array | Uint32Array): Buffer => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function sameStrips(actual: readonly GeneratedStrip[], expected: readonly GeneratedStrip[]): void {
  expect(actual.map(strip => strip.id)).toEqual(expected.map(strip => strip.id));
  for (const [index, source] of expected.entries()) {
    const copy = actual[index]; if (copy === undefined) throw new Error('Missing strip');
    expect(copy.mesh.origin).toEqual(source.mesh.origin); expect(copy.features).toEqual(source.features); expect(copy.turnIn).toEqual(source.turnIn);
    for (const key of ['positions', 'colours', 'indices'] as const) expect(Buffer.compare(words(copy.mesh[key]), words(source.mesh[key]))).toBe(0);
    expect(copy.duplicates.map(row => ({ instance: row.instance, origin: row.mesh.origin }))).toEqual(source.duplicates.map(row => ({ instance: row.instance, origin: row.mesh.origin })));
  }
}

test('a page whose placements changed after the build certifies only the changed shapes and builds native strips exactly', async () => {
  const cells = built(), strips = generatePlatform(cells, empty), source = await platformGeometrySource(cells, empty);
  // a second build mode (another source) whose blocks hold some keys first: a home may seed from another source's rows
  const other = cells.map(row => row.instance === 'cell_1_1' ? { ...row, edges: { ...row.edges, north: hills(13) } } : row);
  const root = mkdtempSync(resolve('tmp/grid-shape-seeds-')); mkdirSync(join(root, 'out/.app'), { recursive: true });
  try {
    const homes = cells.map(row => ({ instance: row.instance, slug: 'fixture', origin: row.origin }));
    const result = writeGridStripBlocks(root, 'a'.repeat(64), [{ source, pitch, strips, keys: platformShapeKeys(cells, empty), homes },
      { source: await platformGeometrySource(other, empty), pitch, strips: generatePlatform(other, empty), keys: platformShapeKeys(other, empty), homes }], reach, 64 * 1024 * 1024);
    const selector = result.geometry; if (selector === undefined) throw new Error('Missing block selector');
    const files = new Map<string, Uint8Array>(result.files.map(file => [file.url, readFileSync(join(root, 'out/.app/grid-strip-pages', basename(file.url)))]));
    const book = JSON.parse(new TextDecoder().decode(files.get(selector.directory.url))) as { blocks: unknown[]; shapes?: { url: string } };
    if (book.shapes === undefined) throw new Error('The book names no shape index');
    const after = { cells: live(), empty }, home = cells.find(row => row.instance === 'cell_0_0'); if (home === undefined) throw new Error('Missing home');
    const baked = new Set(platformShapeKeys(cells, empty));
    for (const [phase, keep] of [['initial', ring(home)], ['outer', (x: number, z: number) => !ring(home)(x, z)]] as const) {
      const scope = new Scope(`seeds ${phase}`), allocator = new ResidencyAllocator(), urls: string[] = [];
      const read = (url: string): Promise<Response> => {
        urls.push(url); const bytes = files.get(url); if (bytes === undefined) throw new Error(`Unexpected request ${url}`);
        return Promise.resolve(new Response(Uint8Array.from(bytes).buffer));
      };
      // the exact-source contract is unchanged: a changed grid has no compiled road
      expect(await readCompiledGridStrips(selector, after, home.instance, { scope, allocator }, read, () => Promise.resolve(), keep, phase)).toBeNull();
      const seeded = await readGridStripsOrSeeds(selector, after, home.instance, { scope, allocator }, read, () => Promise.resolve(), keep, phase);
      if (seeded === null || !('seeds' in seeded)) throw new Error('Missing seeds');
      expect(urls).toContain(book.shapes.url);
      // seeds are own copies: no charge outlives the read
      expect(allocator.entries()).toEqual([]);
      const plans = new Map<string, readonly number[][]>();
      sameStrips(generatePlatform(after.cells, empty, plans, keep, seeded.seeds), generatePlatform(after.cells, empty, new Map(), keep));
      // only the shapes the build never certified are certified here
      const needed = new Set(platformShapeKeys(after.cells, empty, keep)), changed = [...needed].filter(key => !baked.has(key));
      expect(changed.length).toBeGreaterThan(0); expect(changed.length).toBeLessThan(needed.size);
      expect([...plans.keys()].sort()).toEqual(changed.sort());
      expect([...seeded.seeds.keys()].sort()).toEqual([...needed].filter(key => baked.has(key)).sort());
      scope.dispose(); expect(allocator.entries()).toEqual([]);
    }
    // seeds only save work: a corrupt index keeps native construction (null), with every claim released
    const corrupt = new Map(files), index = Uint8Array.from(files.get(book.shapes.url) ?? []); index[3] = (index[3] ?? 0) ^ 1; corrupt.set(book.shapes.url, index);
    const refusedScope = new Scope('refused'), refusedClaims = new ResidencyAllocator();
    expect(await readGridStripsOrSeeds(selector, after, home.instance, { scope: refusedScope, allocator: refusedClaims }, url => {
      const bytes = corrupt.get(url); if (bytes === undefined) throw new Error(`Unexpected request ${url}`);
      return Promise.resolve(new Response(Uint8Array.from(bytes).buffer));
    }, () => Promise.resolve(), ring(home))).toBeNull();
    expect(refusedClaims.entries()).toEqual([]); refusedScope.dispose();
    // the unchanged grid still reads its compiled road
    const scope = new Scope('exact'), allocator = new ResidencyAllocator();
    const exact = await readGridStripsOrSeeds(selector, { cells, empty }, home.instance, { scope, allocator }, url => {
      const bytes = files.get(url); if (bytes === undefined) throw new Error(`Unexpected request ${url}`);
      return Promise.resolve(new Response(Uint8Array.from(bytes).buffer));
    }, () => Promise.resolve(), ring(home));
    if (exact === null || !('strips' in exact)) throw new Error('Missing compiled road');
    sameStrips(exact.strips, generatePlatform(cells, empty, new Map(), ring(home)));
    scope.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

test('a shape key names one shape: placement never enters it', () => {
  const cells = built(), keys = platformShapeKeys(cells, empty), strips = generatePlatform(cells, empty);
  expect(keys).toHaveLength(strips.length);
  const first = new Map<string, GeneratedStrip>();
  for (const [index, strip] of strips.entries()) {
    const key = keys[index] ?? ''; const seen = first.get(key);
    if (seen === undefined) { first.set(key, strip); continue; }
    for (const field of ['positions', 'colours', 'indices'] as const) expect(Buffer.compare(words(strip.mesh[field]), words(seen.mesh[field]))).toBe(0);
  }
  expect(first.size).toBeLessThan(strips.length);
});

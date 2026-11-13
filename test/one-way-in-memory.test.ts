import { afterEach, expect, test } from 'vitest';
import { enterByShard, oneWayIn, shardCell, worldHosted, type RouteMemory } from '../src/client/game/grid/oneWayIn';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { catalogueDocument } from '../src/shared/game/grid/catalogueDocument';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { bootPageMode } from '../src/client/game/grid/pageEntry';
import { setPageGoto, setPageMode } from '../src/shared/game/grid/pageMode';

// QA-FEEDBACK 2026-11-12 row 36 (Jake on bad LTE, prod v0.1.13: Driftwood sat 34 s on "Read audio 7 / 91"): when the world check
// misses its 3 s, the page keeps the route this device last used, not the one-shard route it never downloaded.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' };
const silent = (): Promise<boolean | null> => new Promise<never>(() => { /* a link that never answers */ });
function memory(start: Record<string, boolean> = {}): RouteMemory & { readonly kept: Record<string, boolean> } {
  const kept = { ...start };
  return { kept, read: release => kept[release] ?? null, write: (release, grid) => { kept[release] = grid; } };
}
afterEach(() => { pageGridIntents().consume(''); setPageMode('shard'); setPageGoto(null); });

test('a stored grid answer and a world check that times out: the page takes the grid route', async () => {
  const kept = memory({ [WORLD.release]: true });
  expect(await worldHosted(WORLD, 10, kept, silent)).toBe(true);
  expect(await enterByShard({ online: true, slug: 'driftwood-isle', kept: false }, WORLD, world => worldHosted(world, 10, kept, silent))).toBe('driftwood-isle');
  expect(bootPageMode('driftwood-isle'), 'the cached grid route, not the one-shard page').toBe('grid');
});

test('a stored one-shard answer and a timed-out check keep the one-shard route', async () => {
  expect(await worldHosted(WORLD, 10, memory({ [WORLD.release]: false }), silent)).toBe(false);
});

test('no stored answer and a timed-out check: the grid, never a one-shard page (J300)', async () => {
  expect(await worldHosted(WORLD, 10, memory(), silent)).toBe(true);
  expect(await worldHosted(WORLD, 10, memory({ 'https://packs.example/releases/prod.json': false }), silent), 'another world\'s answer is not this one\'s').toBe(true);
  expect(await worldHosted(WORLD, 1000, memory(), async () => null), 'a socket that closed with no word').toBe(true);
});

test('GC20: on a world build with no word and no kept answer, every grid shard\'s card enters its cell; the two off-grid shards do not', async () => {
  const assembly = new GridAssembly({ developer: false, devserver: false });
  expect(assembly.cells, 'the 5 × 5 grid').toHaveLength(25);
  for (const cell of assembly.cells) {
    pageGridIntents().consume('');
    const entered = await enterByShard({ online: true, slug: cell.slug, kept: false }, WORLD, world => worldHosted(world, 10, memory(), silent));
    expect(entered, cell.slug).toBe(cell.instance);
    expect(oneWayIn({ online: true, hosted: true, slug: cell.slug, kept: false }, assembly)?.instance, cell.slug).toBe(shardCell(cell.slug, assembly)?.instance);
  }
  const placed = new Set(assembly.cells.map(cell => cell.slug));
  const off = catalogueDocument().placements.map(row => row.slug).filter(slug => !placed.has(slug));
  expect(off).toEqual(['open-plot-thin-ice', 'open-plot-desert-ruin']);
  for (const slug of off) expect(await enterByShard({ online: true, slug, kept: false }, WORLD, world => worldHosted(world, 10, memory(), silent)), slug).toBeNull();
});

test('an answer in time decides and is kept for the next launch; no word keeps nothing', async () => {
  const kept = memory({ [WORLD.release]: false });
  expect(await worldHosted(WORLD, 1000, kept, async () => true)).toBe(true);
  expect(kept.kept[WORLD.release]).toBe(true);
  expect(await worldHosted(WORLD, 1000, kept, async () => false)).toBe(false);
  expect(kept.kept[WORLD.release]).toBe(false);
  expect(await worldHosted(WORLD, 1000, memory({ [WORLD.release]: true }), async () => null), 'a socket that closed with no word falls back to the stored answer').toBe(true);
  expect(await worldHosted(WORLD, 10, kept, silent)).toBe(false);
});

test('a link that always answers late still keeps its answer for the next launch', async () => {
  const kept = memory();
  let answer: (grid: boolean | null) => void = () => undefined;
  const asked: number[] = [];
  const slow = (_world: unknown, waitMs: number): Promise<boolean | null> => { asked.push(waitMs); return new Promise(resolve => { answer = resolve; }); };
  expect(await worldHosted(WORLD, 10, kept, slow), 'this page goes on without it, into the grid (J300)').toBe(true);
  expect(asked[0], 'the read itself outlives the page\'s deadline').toBeGreaterThan(10);
  answer(false); await Promise.resolve(); await Promise.resolve();
  expect(kept.kept[WORLD.release]).toBe(false);
  expect(await worldHosted(WORLD, 10, kept, silent), 'the next launch knows the world is one cell: the one-shard page').toBe(false);
});

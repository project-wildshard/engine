import { afterEach, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The page's own wiring is read where the entry and the first paint apply it.
import { readFileSync } from 'node:fs';
import baked from './pins/catalogue.json' with { type: 'json' };
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { installCatalogue, installedCatalogue, oneCellWorld, type CatalogueDocument } from '../src/shared/game/grid/catalogueSlot';
import { currentPageMode, pageGoto, setPageGoto, setPageMode } from '../src/shared/game/grid/pageMode';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { bootPageMode, enterOneCellWorld, pendingGridEntry } from '../src/client/game/grid/pageEntry';
import { admittedShardInstance, cataloguePlaced } from '../src/shared/game/shardfile/identity';
import { inlineCellDescriptor } from '../src/client/game/shardfile/clientSource';

// CHUNK-PARAM-REMOVAL CP10 (J522): a page whose `ws-catalogue` holds one cell (`wildshard dev`'s and `wildshard prepare`'s page, a
// tool's zone alone) boots that world at its only cell on a bare `/` with no tap: the grid path players take, never the one-shard page.
const SLOT = Symbol.for('game.catalogue');
const oneCell = (slug: string, instance = slug): CatalogueDocument => {
  const cells = [{ instance, slug, cell: [0, 0] }];
  return { ...baked, grid: { ...baked.grid, cells } };
};
afterEach(() => {
  pageGridIntents().consume(''); setPageMode('shard'); setPageGoto(null);
  Reflect.deleteProperty(globalThis, SLOT);
});

test('a one-cell catalogue names its cell; the channel grid, a page with none and a two-cell grid name none', () => {
  expect(oneCellWorld(oneCell('pine-hollow'))).toEqual({ instance: 'pine-hollow', slug: 'pine-hollow', cell: [0, 0] });
  expect(oneCellWorld(baked as CatalogueDocument), 'the pinned channel catalogue is a whole grid').toBeNull();
  expect(oneCellWorld(undefined)).toBeNull();
  const two = { ...baked, grid: { ...baked.grid, cells: [{ instance: 'a', slug: 'a', cell: [0, 0] }, { instance: 'b', slug: 'b', cell: [1, 0] }] } };
  expect(oneCellWorld(two)).toBeNull();
  installCatalogue(oneCell('my-shard'));
  expect(oneCellWorld()?.slug, 'the installed catalogue by default').toBe('my-shard');
});

test('the one cell boots as a grid page with no tap: its intent is this document\'s only, and the world is that cell', () => {
  installCatalogue(oneCell('pine-hollow'));
  const cell = oneCellWorld();
  if (cell === null) throw new Error('no cell');
  enterOneCellWorld(cell.instance, cell.slug);
  expect(pendingGridEntry('pine-hollow')).toBe(true);
  expect(bootPageMode('pine-hollow'), 'a grid page, never the one-shard page').toBe('grid');
  expect(currentPageMode()).toBe('grid');
  expect(pageGoto(), 'no seat to ask for: the world has one cell').toBeNull();
  const world = new GridAssembly({ developer: false, devserver: false }, installedCatalogue()?.grid);
  expect(world.cells.map(row => [row.slug, row.cell]), 'the world is its one cell, at the origin').toEqual([['pine-hollow', [0, 0]]]);
  expect(world.neighbour(world.cell('pine-hollow'), 'north'), 'past it is the grid\'s empty sea, as at the grid\'s outer ring').toBe(world.emptyNeighbour);
  // the intent was the document's alone: nothing was written for another tab or a later page
  expect(pendingGridEntry('pine-hollow')).toBe(false);
});

test('a zone no title row names boots in its own one cell', () => {
  installCatalogue(oneCell('my-shard'));
  enterOneCellWorld('my-shard', 'my-shard');
  expect(bootPageMode('my-shard')).toBe('grid');
});

test('the one cell places an author\'s shard, so its saves and home claim use the cell instance the grid enters', async () => {
  // `wildshard dev` 11-25: an unplaced inline shard admitted its home as `external-<hash>`, then the grid session admitted the
  // cell's instance and the boot stopped on "Page home residency changed identity or cost"
  installCatalogue({ ...oneCell('my-shard'), placements: [] });
  expect(cataloguePlaced('my-shard')).toBe(true);
  await expect(admittedShardInstance('http://127.0.0.1:4000/', 'my-shard', () => Promise.resolve('a'.repeat(64)))).resolves.toBeUndefined();
  await expect(admittedShardInstance('http://127.0.0.1:4000/', 'elsewhere', () => Promise.resolve('a'.repeat(64)))).resolves.toBe(`external-${'a'.repeat(64)}`);
});

test('the inline shard a one-cell grid enters names its descriptor, so the grid admits the cell from the page\'s origin', () => {
  // `wildshard dev` 11-25: without it the cell stayed "not a shardfile shard (it stays a far proxy until M3)" and the boot waited
  installCatalogue({ ...oneCell('my-shard'), placements: [] });
  setPageMode('shard');
  expect(inlineCellDescriptor('my-shard'), 'the one-shard page keeps its inline shard pointerless').toEqual({});
  setPageMode('grid');
  expect(inlineCellDescriptor('my-shard')).toEqual({ shardfile: '/shardfiles/my-shard/shard.json' });
  expect(inlineCellDescriptor('elsewhere'), 'only the one cell\'s own shard').toEqual({});
  installCatalogue(baked);
  expect(inlineCellDescriptor('pine-hollow'), 'the channel grid is not a one-cell world').toEqual({});
});

test('the entry and the first paint read the one-cell world, and no address names its zone', () => {
  const entry = readFileSync('src/client/app/entry.ts', 'utf8');
  expect(entry, 'an inline author shard (`wildshard dev`, `wildshard prepare`) runs in its one cell too (CP25)')
    .toContain('inlineCell = requested === null && slugged === null && !exploreChannel() ? oneCellWorld(catalogue) : null;');
  expect(entry).toContain('if (inlineCell !== null) enterOneCellWorld(inlineCell.instance, inlineCell.slug);');
  expect(entry, 'a one-cell world reads its own zone\'s set, never its neighbours\' files').toContain("flow = inlineCell === null && (pageGridRecovery() !== null || pendingGridEntry(slug)) ? 'grid' : 'client'");
  const page = readFileSync('index.html', 'utf8');
  expect(page, 'the first paint shows the zone\'s loading card, never the title').toContain("document.documentElement.classList.remove('title-first', 'boot-menu');");
  expect(page).toContain("const loadShard = homeParams.get('chunk') || oneCellZone || 'driftwood-isle';");
  expect(page).toContain("!homeParams.has('chunk') && Array.isArray(cells) && cells.length === 1");
  const worker = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  expect(worker, 'CP25: a one-cell page never leaves for a one-shard page because its world hosts one cell').toContain('reshard !== undefined && oneCellWorld() === null &&');
  const cost = readFileSync('src/client/game/shardfile/folderCost.ts', 'utf8');
  expect(cost, 'CP25: only a page that owns its candidate (dev, prepare) prices an unverdicted product').toContain("const OWNS_CANDIDATE=(typeof __DEVSERVER__==='boolean'&&__DEVSERVER__)||(typeof __PREPARATION_ONLY__==='boolean'&&__PREPARATION_ONLY__);");
});

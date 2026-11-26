import { afterEach, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The page's own wiring is read where the entry and the first paint apply it.
import { readFileSync } from 'node:fs';
import baked from './pins/catalogue.json' with { type: 'json' };
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { installCatalogue, installedCatalogue, oneCellWorld, type CatalogueDocument } from '../src/shared/game/grid/catalogueSlot';
import { currentPageMode, pageGoto, setPageGoto, setPageMode } from '../src/shared/game/grid/pageMode';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { bootPageMode, enterOneCellWorld, pendingGridEntry } from '../src/client/game/grid/pageEntry';

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

test('the entry and the first paint read the one-cell world, and no address names its zone', () => {
  const entry = readFileSync('src/client/app/entry.ts', 'utf8');
  expect(entry, 'a page with its own inline shard (`wildshard dev`, `wildshard prepare`) keeps its own boot: the grid admits no uncooked candidate (CP25)')
    .toContain("inlineCell = requested === null && slugged === null && !exploreChannel() && document.getElementById('ws-shardfile') === null\n    ? oneCellWorld(catalogue) : null;");
  expect(entry).toContain('if (inlineCell !== null) enterOneCellWorld(inlineCell.instance, inlineCell.slug);');
  expect(entry, 'a one-cell world reads its own zone\'s set, never its neighbours\' files').toContain("flow = inlineCell === null && (pageGridRecovery() !== null || pendingGridEntry(slug)) ? 'grid' : 'client'");
  const page = readFileSync('index.html', 'utf8');
  expect(page, 'the first paint shows the zone\'s loading card, never the title').toContain("document.documentElement.classList.remove('title-first', 'boot-menu');");
  expect(page).toContain("const loadShard = homeParams.get('chunk') || oneCellZone || 'driftwood-isle';");
  expect(page).toContain("!homeParams.has('chunk') && !document.getElementById('ws-shardfile') && Array.isArray(cells) && cells.length === 1");
});

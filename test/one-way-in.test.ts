import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The worker client's wiring is read where the page applies it.
import { readFileSync } from 'node:fs';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { catalogueDocument } from '../src/shared/game/grid/catalogueDocument';
import { currentPageMode, pageGoto, setPageGoto, setPageMode } from '../src/shared/game/grid/pageMode';
import { enterByShard, oneWayIn, shardCell } from '../src/client/game/grid/oneWayIn';
import { pageGridIntents } from '../src/client/game/grid/intent';
import { bootPageMode } from '../src/client/game/grid/pageEntry';
import { gridEntryShown } from '../src/client/game/grid/menu';
import { gotoSocket } from '../src/client/host/online/shell';
import { gotoCell } from '../src/server/host/dedicated/world';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GO7 (meta MMO-PLAN MP1G, DG4; ZS4's goto, ZS5's retirement): one way in. On a build whose world hosts the grid, Shard select → a grid
// shard enters the grid at that shard's cell; a solo build, and a shard the grid doesn't place, still open the shard alone.
const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'ab' };
const assembly = new GridAssembly({ developer: false, devserver: false });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => {
  for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined;
  pageGridIntents().consume(''); setPageMode('shard'); setPageGoto(null);
});

test('an online build whose world hosts the grid: Shard select → Driftwood boots a grid page in Driftwood\'s cell, never a shard page', async () => {
  const hosted = vi.fn(async () => true);
  expect(await enterByShard({ online: true, slug: 'driftwood-isle', kept: false }, WORLD, hosted)).toBe('driftwood-isle');
  expect(hosted).toHaveBeenCalledWith(WORLD);
  expect(bootPageMode('driftwood-isle'), 'the same page boots as a grid page').toBe('grid');
  expect([currentPageMode(), pageGoto()], 'and asks the world to seat it in Driftwood\'s cell').toEqual(['grid', 'driftwood-isle']);
  expect(shardCell('driftwood-isle', assembly)?.cell, 'the grid\'s home cell').toEqual([0, 0]);
  // A plot and a cell whose instance isn't its shard's slug go to their own cells too.
  expect(oneWayIn({ online: true, hosted: true, slug: 'nalati-grasslands', kept: false }, assembly)?.instance).toBe('nalati-grasslands');
  expect(oneWayIn({ online: true, hosted: true, slug: '_template', kept: false }, assembly)?.instance).toBe('template-2');
  expect(oneWayIn({ online: true, hosted: true, slug: 'open-plot-sky-race', kept: false }, assembly)?.instance).toBe('open-plot-2-0');
});

test('a solo build still opens the shard alone, and never asks a world', async () => {
  const hosted = vi.fn(async () => true);
  expect(await enterByShard({ online: false, slug: 'driftwood-isle', kept: false }, undefined, hosted)).toBeNull();
  expect(hosted).not.toHaveBeenCalled();
  expect(bootPageMode('driftwood-isle')).toBe('shard');
  expect(pageGoto()).toBeNull();
});

test('a world that hosts only its home cell (production until WORLD_CELLS=grid) keeps today\'s one-shard page', async () => {
  expect(await enterByShard({ online: true, slug: 'driftwood-isle', kept: false }, WORLD, async () => false)).toBeNull();
  expect(bootPageMode('driftwood-isle')).toBe('shard');
});

test('EXPLORE WORLD, a page already entering the grid, and shards the grid doesn\'t place stay as they are', async () => {
  const hosted = vi.fn(async () => true);
  expect(await enterByShard({ online: true, slug: 'driftwood-isle', kept: true }, WORLD, hosted)).toBeNull();
  const placed = new Set(assembly.cells.map(cell => cell.slug));
  const off = catalogueDocument().placements.map(row => row.slug).filter(slug => !placed.has(slug));
  expect(off, 'the shards Shard select still opens alone').toEqual(['blender-template', 'pastel-plain', 'ink-cel-valley']);
  for (const slug of off) expect(await enterByShard({ online: true, slug, kept: false }, WORLD, hosted), slug).toBeNull();
  expect(hosted, 'a shard that cannot turn never waits on the world').not.toHaveBeenCalled();
});

test('Infinite Wildshard shows without Developer once the world hosts the grid (DG4)', () => {
  const player = { developer: false, devserver: false };
  expect([gridEntryShown(player, false), gridEntryShown(player, false, true), gridEntryShown({ ...player, developer: true }, false)]).toEqual([false, true, true]);
});

test('the dial names the goto cell; the door reads only a well-formed one', () => {
  expect(gotoSocket('wss://play.example/', undefined)).toBe('wss://play.example/');
  expect(gotoSocket('wss://play.example/', 'driftwood-isle')).toBe('wss://play.example/?chunk=driftwood-isle');
  expect([gotoCell('/'), gotoCell('/?chunk=driftwood-isle'), gotoCell('/?chunk=template-2&x=1'), gotoCell('/?chunk=../etc'), gotoCell(undefined)])
    .toEqual([null, 'driftwood-isle', 'template-2', null, null]);
  const source = readFileSync('src/client/game/shardfile/clientWorker.ts', 'utf8');
  expect(source, 'a grid page asks for its booted cell only when Shard select sent it there').toMatch(/pageGoto\(\) === booted \? \{ goto: true \}/u);
});

test('the door seats a goto in the cell it names, over the player\'s last place; a cell it doesn\'t open falls back to that place', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:goer', name: 'G', shard: '_template', cell: 'template-2', build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: ['driftwood-isle', 'template-2'], saves, workers: 1 });
  const goer = bot(`${bench.url}?chunk=driftwood-isle`, 'bench', 'device:goer');
  expect(await goer.arrived()).toBe(true);
  expect(JSON.parse(goer.resume ?? '{}'), 'Shard select → Driftwood: seated in Driftwood').toMatchObject({ shard: 'driftwood-isle', cell: 'driftwood-isle' });
  goer.transport.control('ready', new Uint8Array([1]).buffer);
  await vi.waitFor(() => { expect(bench?.room('driftwood-isle')?.holds('device:goer')).toBe(false); });
  const back = bot(`${bench.url}?chunk=nalati-grasslands`, 'bench', 'device:goer');
  expect(await back.arrived()).toBe(true);
  expect(JSON.parse(back.resume ?? '{}'), 'a cell this world does not open: the last place').toMatchObject({ cell: 'driftwood-isle' });
  expect(bench.crashes).toEqual([]);
});

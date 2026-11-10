// oxlint-disable-next-line import/no-nodejs-modules -- The page build's pinned catalogue.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { cellFrame, cellName, cellShard, worldCells } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GO3 (MMO-ZONE-SELECT, MP1.4): the server's cells are the grid's, named by instance. A cell whose instance isn't its shard's slug
// (`template-2` runs `_template`, the one such cell Ring 1 installs) is the case a one-shard world never had.
const HOME = 'driftwood-isle', PLOT = 'template-2', PLOT_SHARD = '_template';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('a name means a grid instance, and each cell runs its shard', () => {
  expect([cellName(PLOT), cellName(PLOT_SHARD), cellName(HOME), cellName('_template'), cellName('not-on-the-grid')]).toEqual([PLOT, PLOT, HOME, 'template-2', 'not-on-the-grid']);
  expect([cellShard(PLOT), cellShard(HOME), cellShard('template-2'), cellShard('not-on-the-grid')]).toEqual([PLOT_SHARD, HOME, '_template', 'not-on-the-grid']);
});

test('the catalogue a page build installs places the grid as the server\'s baked one does, so frame numbers agree', () => {
  const baked = new GridAssembly({ developer: false, devserver: false }).cells.map(cell => [cell.instance, cell.slug]);
  const pinned = new GridAssembly({ developer: false, devserver: false }, (JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { grid: unknown }).grid).cells.map(cell => [cell.instance, cell.slug]);
  expect(pinned).toEqual(baked);
});

test('a cell\'s frames carry the number a grid page gives that cell', () => {
  const { cells } = new GridAssembly({ developer: false, devserver: false });
  expect(cells).toHaveLength(25);
  for (const [index, cell] of cells.entries()) expect(cellFrame(cell.instance), cell.instance).toBe(index + 1);
  expect(cellFrame(HOME), 'not 1, which a grid page reads as Pine Hollow').not.toBe(1);
  expect(cellFrame('not-on-the-grid'), 'a cell the grid does not place keeps the old one-shard frame').toBe(1);
});

test('`grid` opens every grid cell the release names, home first; a list keeps its order; a bad list is refused before any worker', () => {
  const released = ['nalati-grasslands', PLOT_SHARD, HOME, 'not-on-the-grid'];
  expect(worldCells('grid', released), 'catalogue order after home').toEqual([HOME, PLOT, 'nalati-grasslands']);
  expect(worldCells(` ${PLOT_SHARD},${HOME}`, released)).toEqual([PLOT, HOME]);
  expect(worldCells(HOME, released), 'the setting every VPS has today').toEqual([HOME]);
  expect(() => worldCells('pine-hollow', released)).toThrow(/release has no pine-hollow/u);
  expect(() => worldCells(`${PLOT},${PLOT_SHARD}`, released)).toThrow(/twice/u);
  expect(() => worldCells('grid', ['not-on-the-grid'])).toThrow(/opens no cell/u);
});

test('a cell named by instance: /health lists it and its worker, its frames carry its grid number, and a bot rejoins where it left', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: 'device:walker', name: 'W', shard: PLOT_SHARD, cell: PLOT, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [HOME, PLOT], saves, workers: 2 });
  expect(bench.world.health()).toMatchObject({ cells: 2, workers: 2, table: { [HOME]: 0, [PLOT]: 1 } });
  const walker = bot(bench.url, 'bench', 'device:walker');
  walker.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  expect(await walker.arrived()).toBe(true);
  expect(JSON.parse(walker.resume ?? '{}')).toMatchObject({ shard: PLOT_SHARD, cell: PLOT });
  expect(walker.client.latest?.cell).toBe(cellFrame(PLOT));
  const room = bench.room(PLOT), spawn = room?.spawn;
  await new Promise(resolve => { setTimeout(resolve, 1000); });
  walker.stop();
  await new Promise(resolve => { setTimeout(resolve, 200); });
  const body = room?.bodyOf('device:walker'), left = body === undefined ? null : { x: body.position.x, z: body.position.z };
  expect(left).not.toBeNull();
  expect(Math.hypot((left?.x ?? 0) - (spawn?.x ?? 0), (left?.z ?? 0) - (spawn?.z ?? 0)), 'it walked away from the spawn').toBeGreaterThan(1);
  walker.transport.control('ready', new Uint8Array([1]).buffer);
  await vi.waitFor(() => { expect(room?.holds('device:walker')).toBe(false); });
  expect(await saves.where('device:walker')).toBe(PLOT);
  const back = bot(bench.url, 'bench', 'device:walker');
  expect(await back.arrived()).toBe(true);
  const resume = JSON.parse(back.resume ?? '{}') as { shard: string; cell: string; at: { x: number; z: number } };
  expect(resume).toMatchObject({ shard: PLOT_SHARD, cell: PLOT });
  expect(Math.hypot(resume.at.x - (left?.x ?? 0), resume.at.z - (left?.z ?? 0)), 'where it left, not the spawn').toBeLessThan(0.5);
  expect(back.client.latest?.cell).toBe(cellFrame(PLOT));
  await vi.waitFor(() => { expect(room?.holds('device:walker')).toBe(true); });
  const restored = room?.bodyOf('device:walker');
  expect(Math.hypot((restored?.position.x ?? 0) - (left?.x ?? 0), (restored?.position.z ?? 0) - (left?.z ?? 0)), 'the server put its body back there too').toBeLessThan(0.5);
  const fresh = bot(bench.url, 'bench', 'device:new');
  expect(await fresh.arrived()).toBe(true);
  expect(JSON.parse(fresh.resume ?? '{}'), 'a player with no save lands in the first cell').toMatchObject({ shard: HOME, cell: HOME });
  expect(fresh.client.latest?.cell).toBe(cellFrame(HOME));
  expect(bench.crashes).toEqual([]);
});

// oxlint-disable-next-line import/no-nodejs-modules -- A placement is signed by a real key.
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { cellFrame, cellName, cellShard, forgetPlacedCells, placeCell, placedCells, type PlacedCell } from '../src/server/host/dedicated/gridCells';
import { PlacementWatch, readPlacementFile } from '../src/server/host/dedicated/placementFile';
import type { PlacementFile } from '../src/shared/game/grid/placementRows';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// SA33 (meta SHARD-AUTHORING, J314): a cell the API places for a new slug opens on a running server with no engine release. The API signs a
// placement file with its own key; the server places the cell (any empty spot of the 7 × 7), boots it on a worker of its own, and no other
// worker hears a word, so players in other cells stay connected. Thin Ice is off the J305 grid and has a built product, so it stands in for
// a new slug here; (0, 3) is the spiral's first ring-3 spot (SA30).
const keys = generateKeyPairSync('ed25519'), KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const signed = (body: string, key = keys.privateKey): string => JSON.stringify({ body, signature: sign(null, Buffer.from(body), key).toString('hex') });
const PLACED: PlacedCell = { instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3] };
const file = (serial: number, cells: readonly PlacedCell[] = [PLACED]): PlacementFile => ({ kind: 'placement', channel: 'staging', serial, cells });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; forgetPlacedCells(); });

test('a placement file signed by the placement key reads back; the release key, an edit or another channel word is refused', () => {
  const text = signed(JSON.stringify(file(3)));
  expect(readPlacementFile(text, KEY)).toEqual(file(3));
  expect(() => readPlacementFile(text.replace(String.raw`"serial\":3`, String.raw`"serial\":9`), KEY)).toThrow(/bad signature/u);
  expect(() => readPlacementFile(signed(JSON.stringify(file(3)), generateKeyPairSync('ed25519').privateKey), KEY), 'another key, such as the release key').toThrow(/bad signature/u);
  expect(() => readPlacementFile(signed(JSON.stringify({ ...file(3), channel: 'preview' })), KEY), 'preview has no MMO').toThrow();
  expect(() => readPlacementFile(signed(JSON.stringify(file(3, [{ ...PLACED, instance: 'Not An Id' }]))), KEY)).toThrow();
  expect(() => readPlacementFile(signed(JSON.stringify({ ...file(3), kind: 'release' })), KEY), 'a body of another kind').toThrow();
});

test('a placed cell takes an empty spot of the 7 × 7 and the next frame number; a slug keeps one cell and a spot holds one', () => {
  expect(placeCell(PLACED)).toBe(true);
  expect([cellName(PLACED.slug), cellShard(PLACED.instance), cellFrame(PLACED.instance)], 'after J305\'s 25').toEqual([PLACED.instance, PLACED.slug, 26]);
  expect(placeCell(PLACED), 'the same placement again changes nothing').toBe(false);
  expect(placedCells()).toEqual([PLACED]);
  expect(() => placeCell({ ...PLACED, cell: [1, 3] }), 'a cell for life').toThrow(/already placed/u);
  expect(() => placeCell({ instance: 'sa33-other', slug: 'sa33-other', cell: [0, 3] }), 'one cell a spot').toThrow(/0,3 is open-plot-thin-ice's/u);
  expect(() => placeCell({ instance: 'sa33-other', slug: 'sa33-other', cell: [1, 1] }), 'a J305 spot').toThrow(/1,1 is template-2's/u);
  expect(() => placeCell({ instance: 'sa33-twin', slug: 'driftwood-isle', cell: [1, 3] }), 'a grid shard never moves').toThrow(/already has a cell/u);
  expect(() => placeCell({ instance: 'sa33-far', slug: 'sa33-far', cell: [4, 0] }), 'radius 4 is off the grid').toThrow(/off the grid/u);
  expect(() => placeCell({ instance: '_template', slug: 'sa33-steal', cell: [2, 3] }), 'an instance named for a grid shard would take its players').toThrow(/placed shard's name/u);
  expect(() => placeCell({ instance: 'sa33-steal', slug: 'template-2', cell: [2, 3] }), 'a slug named for a grid instance').toThrow(/already has a cell/u);
  expect(placeCell({ instance: 'sa33-next', slug: 'sa33-next', cell: [1, 3] })).toBe(true);
  expect(cellFrame('sa33-next')).toBe(27);
  expect(cellFrame('driftwood-isle'), 'the catalogue\'s frames do not move').toBe(cellFrame(cellName('driftwood-isle')));
});

test('a watch opens only cells it has not opened, asks again for one that did not open, and never believes an older serial', async () => {
  let next: PlacementFile | Error = file(1, []), answer: 'all' | 'none' = 'all';
  const asked: string[][] = [], failures: string[] = [];
  const watch = new PlacementWatch({ channel: 'staging', everyMs: 3_600_000, failed: error => { failures.push(String(error)); },
    read: () => next instanceof Error ? Promise.reject(next) : Promise.resolve(next),
    open: cells => { asked.push(cells.map(cell => cell.instance)); return Promise.resolve(answer === 'all' ? cells.map(cell => cell.instance) : []); } });
  await watch.look();
  expect([asked, watch.serial]).toEqual([[], 1]);
  answer = 'none'; next = file(2);
  await watch.look(); await watch.look();
  expect(asked, 'a cell whose pack is not ready is asked for again').toEqual([[PLACED.instance], [PLACED.instance]]);
  answer = 'all';
  await watch.look(); await watch.look();
  expect(asked, 'once open, never again').toHaveLength(3);
  next = file(3, [PLACED, { instance: 'sa33-next', slug: 'sa33-next', cell: [1, 3] }]);
  await watch.look();
  expect(asked.at(-1)).toEqual(['sa33-next']);
  next = file(2); await watch.look();
  next = { ...file(4), channel: 'production' }; await watch.look();
  next = new Error('R2 is away'); await watch.look();
  expect(failures).toEqual([expect.stringMatching(/older than 3/u), expect.stringMatching(/production placement file on a staging server/u), expect.stringMatching(/R2 is away/u)]);
  expect(watch.serial).toBe(3);
  watch.dispose();
});

test('a placed cell opens on a running world: /health lists it, a player can be seated there, and the player already in another cell stays', { timeout: 120_000 }, async () => {
  const home = cellName('open-plot-night-market');
  bench = await roomBench({ cells: [home], workers: 1, saves: memoryPlayerSaves() });
  const stayer = bot(bench.url, 'bench', 'device:stayer');
  stayer.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
  expect(await stayer.arrived()).toBe(true);
  expect(bench.world.health()).toMatchObject({ cells: 1, workers: 1, players: 1, table: { [home]: 0 } });
  const before = stayer.client.latest?.tick ?? 0;

  expect(placeCell(PLACED)).toBe(true);
  const [opened, twice] = await Promise.all([bench.world.openCells([PLACED.instance, home]), bench.world.openCells([PLACED.instance])]);
  expect([opened, twice], 'two opens at once boot one worker').toEqual([[PLACED.instance], []]);
  expect(bench.world.health(), 'the new cell on a worker of its own').toMatchObject({ cells: 2, workers: 2, players: 1, table: { [home]: 0, [PLACED.instance]: 1 } });
  expect(await bench.world.openCells([PLACED.instance]), 'opened once').toEqual([]);

  const comer = bot(`${bench.url}?chunk=${PLACED.instance}`, 'bench', 'device:comer');
  expect(await comer.arrived()).toBe(true);
  expect(JSON.parse(comer.resume ?? '{}')).toMatchObject({ shard: PLACED.slug, cell: PLACED.instance });
  expect(comer.client.latest?.cell, 'its frames carry the placed frame').toBe(cellFrame(PLACED.instance));
  await vi.waitFor(() => { expect(stayer.client.latest?.tick ?? 0).toBeGreaterThan(before + 30); }, { timeout: 10_000 });
  expect(stayer.closed, 'still connected').toBeNull();
  expect(bench.world.health()).toMatchObject({ players: 2, awake: 2 });
  expect([bench.restarts, bench.crashes]).toEqual([0, []]);
});

test('a placed cell whose worker fails to boot opens nothing and ends nobody', { timeout: 60_000 }, async () => {
  const home = cellName('open-plot-night-market');
  bench = await roomBench({ cells: [home], workers: 1, saves: memoryPlayerSaves() });
  expect(placeCell({ instance: 'sa33-no-pack', slug: 'sa33-no-pack', cell: [1, 3] })).toBe(true);
  await expect(bench.world.openCells(['sa33-no-pack'])).rejects.toThrow();
  expect(bench.world.health()).toMatchObject({ cells: 1, workers: 1, table: { [home]: 0 } });
  expect(bench.crashes).toEqual([]);
});

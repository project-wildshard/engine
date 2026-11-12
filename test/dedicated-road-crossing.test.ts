import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { floorBelow } from '../src/shared/engine/physics/query';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { cellFrame, roadName } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC15 (the GC15a list's items 1 to 3): with `WORLD_CROSSING=worker` a worker hosts the road between its cells, its cells
// open onto it instead of standing in lone walls, and a seat whose feet leave a cell crosses by itself: Driftwood, the road (frame 0),
// then Far Reach, on one socket, the seat held throughout. Staging's 2-worker table: Nalati is alone on worker 0, so worker 1's road
// is named for Driftwood and walls Nalati off. Off (the default), a cell stays lone and feet past its edge move nothing.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', EAST = 'nalati-grasslands', CELLS = [HOME, SOUTH, EAST], ROAD = roadName(HOME);
/** Staging's pitch: Far Reach's origin is this far south of Driftwood's. */
const PITCH = 562.5;
const forward = (): ReturnType<RoomBot['thumb']> => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (...args: ConstructorParameters<typeof RoomBot>): RoomBot => { const made = new RoomBot(...args); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

test('feet past Driftwood\'s edge cross onto the road, and feet inside Far Reach cross into it: one socket, frame 0 between', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  bench = await roomBench({ cells: CELLS, saves, workers: 2, crossing: true });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), south = bench.room(SOUTH), road = bench.road(ROAD);
  if (home === undefined || south === undefined || road === undefined) throw new Error('Both cells and the road boot on one worker');
  expect(bench.road(roadName(EAST)), 'Nalati\'s worker hosts a road of its own').toBeDefined();
  const travels: NetTravel[] = [];
  a.client.onTravel(event => { travels.push(event); });
  // Off Driftwood's south edge: the trigger asks, the door orders the cross, and the road takes the seat.
  const body = home.bodyOf('device:a');
  if (body === undefined) throw new Error('A stands in Driftwood');
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(0); }, { timeout: 10_000 });
  expect(home.holds('device:a'), 'Driftwood let the seat go').toBe(false);
  expect(road.holds('device:a'), 'the road holds it').toBe(true);
  const onRoad = road.bodyOf('device:a');
  expect(onRoad?.position.z ?? 0, 'it stands where it left, in the world\'s frame').toBeLessThan(-CHUNK_HALF);
  expect(a.closed, 'the socket never closed').toBeNull();
  // The road keeps no progress, so the place row still says Driftwood.
  await vi.waitFor(async () => { expect(await saves.where('device:a')).toBe(HOME); });
  // Its input drives the road's body.
  const from = { ...onRoad?.position ?? { x: 0, y: 0, z: 0 } };
  a.thumb = forward;
  await vi.waitFor(() => { const now = road.bodyOf('device:a')?.position; expect(Math.hypot((now?.x ?? from.x) - from.x, (now?.z ?? from.z) - from.z)).toBeGreaterThan(1); }, { timeout: 10_000 });
  a.thumb = (): ReturnType<RoomBot['thumb']> => ({ ...forward(), steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 } });
  // Into Far Reach, 10 m past its north edge: the road hands the seat in, standing in Far Reach's own frame.
  // Far Reach is sky islands: the first ground in from its north edge. From 3 m under it, as a road lower than a cell's edge bank
  // would arrive, the body must stand on the top, not fall out of the world and respawn.
  // A world that never stepped has no scene queries yet: B stands in Far Reach, so it has.
  saves.write({ player: 'device:b', name: 'B', shard: SOUTH, cell: SOUTH, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  const b = bot(bench.url, 'bench', 'device:b', 'B');
  expect(await b.arrived()).toBe(true);
  await vi.waitFor(() => { expect(south.holds('device:b')).toBe(true); });
  const spot = Array.from({ length: 24 }, (_, row) => CHUNK_HALF - 10 - row * 10).flatMap(z => [0, 40, -40, 80, -80].map(x => ({ x, z, ground: floorBelow(south.host.physics, x, z, 400, 800) }))).find(row => row.ground !== undefined);
  if (spot?.ground === undefined) throw new Error('Far Reach has ground near its north edge');
  const { ground } = spot;
  onRoad?.resetPose({ x: spot.x, y: ground - 3, z: -PITCH + spot.z }, 0);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(SOUTH)); }, { timeout: 10_000 });
  expect(road.holds('device:a')).toBe(false);
  expect(south.holds('device:a')).toBe(true);
  expect(Math.abs((south.bodyOf('device:a')?.position.z ?? 0) - spot.z), 'local to Far Reach').toBeLessThan(3);
  await new Promise(resolve => { setTimeout(resolve, 500); });
  expect(Math.abs((south.bodyOf('device:a')?.position.z ?? 0) - spot.z), 'it stands there, not respawned after a fall').toBeLessThan(3);
  expect(south.bodyOf('device:a')?.position.y ?? -Infinity).toBeGreaterThan(ground - 1);
  expect(a.closed).toBeNull();
  expect(travels.map(({ from: left, to }) => [left, to])).toEqual([[cellFrame(HOME), 0], [0, cellFrame(SOUTH)]]);
  expect(bench.lines.filter(line => line['at'] === 'cell.crossed').map(line => [line['from'], line['to'], line['moved']])).toEqual([[HOME, ROAD, true], [ROAD, SOUTH, true]]);
  await vi.waitFor(async () => { expect(await saves.where('device:a')).toBe(SOUTH); });
  expect(bench.world.health()).toMatchObject({ players: 2 });
  expect(bench.crashes).toEqual([]);
});

test('a seat held on the road comes back to the road when its player dials again', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(ROAD), body = home?.bodyOf('device:a');
  if (road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(0); }, { timeout: 10_000 });
  a.drop();
  await vi.waitFor(() => { expect(road.holding).toBe(1); }, { timeout: 5000 });
  const again = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await again.arrived()).toBe(true);
  expect(again.client.latest?.cell).toBe(0);
  expect(road.holding).toBe(0);
  expect(bench.crashes).toEqual([]);
});

test('without WORLD_CROSSING a cell stays lone: feet past its edge cross nowhere', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2 });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (home === undefined || body === undefined) throw new Error('Driftwood boots');
  expect(bench.road(ROAD)).toBeUndefined();
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await new Promise(resolve => { setTimeout(resolve, 500); });
  expect(home.holds('device:a')).toBe(true);
  expect(a.client.latest?.cell).toBe(cellFrame(HOME));
  expect(bench.lines.some(line => line['at'] === 'cell.crossed')).toBe(false);
});

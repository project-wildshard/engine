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
/** Wait for a room to step `ticks` more times: a slow runner waits longer, never checks sooner. */
const ticks = async (room: { readonly host: { readonly state: { readonly tick: number } } }, count: number): Promise<void> => {
  const from = room.host.state.tick;
  await vi.waitFor(() => { expect(room.host.state.tick).toBeGreaterThanOrEqual(from + count); }, { timeout: 30_000 });
};
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
  // Its input drives the road's body: along the road (yaw a quarter turn), never on into Far Reach, which a slow run would reach.
  const from = { ...onRoad?.position ?? { x: 0, y: 0, z: 0 } };
  a.thumb = (): ReturnType<RoomBot['thumb']> => ({ ...forward(), yaw: Math.PI / 2 });
  await vi.waitFor(() => { const now = road.bodyOf('device:a')?.position; expect(Math.hypot((now?.x ?? from.x) - from.x, (now?.z ?? from.z) - from.z)).toBeGreaterThan(1); }, { timeout: 10_000 });
  a.thumb = (): ReturnType<RoomBot['thumb']> => ({ ...forward(), steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 } });
  expect(road.holds('device:a'), 'still on the road').toBe(true);
  // Into Far Reach beside B, from 2 m above where B stands (Far Reach is sky islands: its bottom plane lies under its fall floor). The
  // road hands the seat in, standing in Far Reach's own frame.
  saves.write({ player: 'device:b', name: 'B', shard: SOUTH, cell: SOUTH, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  const b = bot(bench.url, 'bench', 'device:b', 'B');
  expect(await b.arrived()).toBe(true);
  await vi.waitFor(() => { expect(south.bodyOf('device:b')?.fall.grounded).toBe(true); }, { timeout: 10_000 });
  const stands = south.bodyOf('device:b')?.position;
  if (stands === undefined) throw new Error('B stands in Far Reach');
  const spot = { x: stands.x + 4, z: stands.z };
  onRoad?.resetPose({ x: spot.x, y: stands.y + 2, z: -PITCH + spot.z }, 0);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(SOUTH)); }, { timeout: 10_000 });
  expect(road.holds('device:a')).toBe(false);
  expect(south.holds('device:a')).toBe(true);
  expect(Math.abs((south.bodyOf('device:a')?.position.z ?? 0) - spot.z), 'local to Far Reach').toBeLessThan(3);
  await ticks(south, 60);
  expect(Math.abs((south.bodyOf('device:a')?.position.z ?? 0) - spot.z), 'it stands there, not respawned after a fall').toBeLessThan(3);
  expect(a.closed).toBeNull();
  expect(travels.map(({ from: left, to }) => [left, to])).toEqual([[cellFrame(HOME), 0], [0, cellFrame(SOUTH)]]);
  expect(bench.lines.filter(line => line['at'] === 'cell.crossed').map(line => [line['from'], line['to'], line['moved']])).toEqual([[HOME, ROAD, true], [ROAD, SOUTH, true]]);
  await vi.waitFor(async () => { expect(await saves.where('device:a')).toBe(SOUTH); });
  expect(bench.world.health()).toMatchObject({ players: 2 });
  expect(bench.crashes).toEqual([]);
});

test('a body coming off the road below a cell\'s ground stands on it, not inside it (a bank above the road)', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), road = bench.road(ROAD), body = home?.bodyOf('device:a');
  if (home === undefined || road === undefined || body === undefined) throw new Error('Driftwood and its road boot');
  const spawn = home.spawn, ground = floorBelow(home.host.physics, spawn.x + 4, spawn.z, spawn.y + 20, 60);
  if (ground === undefined) throw new Error('Driftwood has ground beside its spawn');
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(0); }, { timeout: 10_000 });
  // Driftwood's origin is the world's: its frame and the road's agree.
  road.bodyOf('device:a')?.resetPose({ x: spawn.x + 4, y: ground - 3, z: spawn.z }, 0);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(HOME)); }, { timeout: 10_000 });
  await ticks(home, 60);
  const stood = home.bodyOf('device:a')?.position;
  expect(Math.hypot((stood?.x ?? Infinity) - (spawn.x + 4), (stood?.z ?? Infinity) - spawn.z), 'where it crossed, not respawned').toBeLessThan(3);
  expect(stood?.y ?? -Infinity).toBeGreaterThan(ground - 1);
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

test('with WORLD_CROSSING=off a cell stays lone: feet past its edge cross nowhere', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2 });
  const a = bot(bench.url, 'bench', 'device:a', 'A');
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (home === undefined || body === undefined) throw new Error('Driftwood boots');
  expect(bench.road(ROAD)).toBeUndefined();
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await ticks(home, 60);
  expect(home.holds('device:a')).toBe(true);
  expect(a.client.latest?.cell).toBe(cellFrame(HOME));
  expect(bench.lines.some(line => line['at'] === 'cell.crossed')).toBe(false);
});

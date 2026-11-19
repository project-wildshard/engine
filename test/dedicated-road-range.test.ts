import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { placeOf } from '../src/client/engine/net/otherPlayers';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { roadName } from '../src/server/host/dedicated/gridCells';
import type { RoadRoom } from '../src/server/host/dedicated/roadRoom';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP1.5b: the road's frame is the world's, about ±1,390 m across the grid, and a player's `x`/`z` are cell metres that clamp
// at ±260 m. Wire 1.2's `roadX`/`roadZ` carry a road body's place to others: two bots on Driftwood's road 1 km apart each read the
// other within 0.1 m, and the page's other-player body (`placeOf`) stands there, where `x`/`z` alone would pin it at the clamp.
const HOME = 'driftwood-isle', CELLS = [HOME, 'sunscar-dunes', 'far-reach', 'nalati-grasslands'];
/** The middle of the road between Driftwood and Sunscar on staging's pitch (562.5 m), and two places on it 1 km apart. */
const GAP = -(562.5 / 2), NORTH = 500, SOUTH = -500;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const out = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 });
const still = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });

/** Walk `bot`'s body out of Driftwood's west entryway by input until the road holds it. */
async function ontoRoad(device: string, bot: RoomBot, road: RoadRoom): Promise<void> {
  bench?.room(HOME)?.bodyOf(device)?.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  bot.thumb = out;
  await vi.waitFor(() => { expect(road.holds(device), `${device} onto the road`).toBe(true); }, { timeout: 20_000, interval: 100 });
  bot.thumb = still;
}

/** What `reader` reads of `device`'s body in its newest frame: the row's road place, its clamped `x`/`z`, and where a page stands it. */
function readOf(reader: RoomBot, road: RoadRoom, device: string): { roadX: number; roadZ: number; x: number; z: number; place: { x: number; z: number } } | null {
  const frame = reader.client.latest, id = road.bodyId(device), handle = id === undefined ? undefined : reader.client.handle(id);
  if (frame === null || handle === undefined || reader.client.entities.get(handle)?.cls !== PLAYER_CLASS) return null;
  const fields = reader.client.fields(frame, handle), row = frame.rows.get(handle);
  if (fields === null || row === undefined) return null;
  const values = PLAYER_CLASS.row.map((column, index) => { const value = column.value(row[index] ?? 0); return typeof value === 'number' ? value : Number(value); });
  return { roadX: Number(fields['roadX']), roadZ: Number(fields['roadZ']), x: Number(fields['x']), z: Number(fields['z']), place: placeOf(values) };
}

test('two bots on Driftwood\'s road 1 km apart each read the other within 0.1 m', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'), b = new RoomBot(bench.url, 'bench', 'device:b', 'B'); bots.push(a, b);
  expect(await a.arrived()).toBe(true);
  expect(await b.arrived()).toBe(true);
  const road = bench.road(roadName(HOME));
  if (road === undefined) throw new Error('Driftwood\'s road boots with it');
  await ontoRoad('device:a', a, road);
  await ontoRoad('device:b', b, road);
  const bodyA = road.bodyOf('device:a'), bodyB = road.bodyOf('device:b');
  if (bodyA === undefined || bodyB === undefined) throw new Error('Both bodies stand on the road');
  bodyA.resetPose({ x: GAP, y: bodyA.position.y + 0.5, z: NORTH }, 0);
  bodyB.resetPose({ x: GAP, y: bodyB.position.y + 0.5, z: SOUTH }, 0);
  expect(Math.hypot(bodyA.position.x - bodyB.position.x, bodyA.position.z - bodyB.position.z)).toBeCloseTo(1000, 0);
  for (const [reader, device, body] of [[a, 'device:b', bodyB], [b, 'device:a', bodyA]] as const) {
    await vi.waitFor(() => {
      const read = readOf(reader, road, device);
      expect(read, `${device}'s row reaches the other bot`).not.toBeNull();
      if (read === null) return;
      expect(Math.abs(read.roadX - body.position.x), `${device} roadX`).toBeLessThan(0.1);
      expect(Math.abs(read.roadZ - body.position.z), `${device} roadZ`).toBeLessThan(0.1);
      // the cell metres alone pin it at the clamp, 240 m short; the page stands it at its road place
      expect(Math.abs(read.z), 'z clamps at 260 m').toBeLessThanOrEqual(260);
      expect(Math.abs(read.place.x - body.position.x) + Math.abs(read.place.z - body.position.z), `${device} where a page stands it`).toBeLessThan(0.2);
    }, { timeout: 5_000, interval: 50 });
  }
});

test('a cell row carries no road place, and an older room\'s rows read none', () => {
  const row = new Float64Array(PLAYER_CLASS.row.length), at = (name: string): number => PLAYER_CLASS.row.findIndex(column => column.name === name);
  row[at('x')] = 12; row[at('z')] = -40;
  expect(placeOf(row), 'zero in a cell').toEqual({ x: 12, z: -40 });
  for (const name of ['roadX', 'roadZ']) {
    const index = at(name), road = PLAYER_CLASS.row[index];
    if (road === undefined) throw new Error(`Missing ${name}`);
    row[index] = Number(road.value(Math.round(2048 / road.step)));
  }
  expect(placeOf(row), 'the decoded zero of a cell row').toEqual({ x: 12, z: -40 });
  row[at('roadX')] = -2048; row[at('roadZ')] = -2048;
  expect(placeOf(row), 'the node floor from a room older than wire 1.2').toEqual({ x: 12, z: -40 });
  row[at('roadX')] = -281.25; row[at('roadZ')] = 500;
  expect(placeOf(row), 'a road place').toEqual({ x: -281.25, z: 500 });
});

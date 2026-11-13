import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF, CONTENT_CAPS } from '../src/shared/engine/core/config';
import type { SimHost } from '../src/server/engine/sim';
import { PLATFORM_COLLIDER_OWNER } from '../src/shared/engine/physics/stripColliders';
import { tagOf } from '../src/shared/engine/physics/surface';
import { cellFrame, forgetPlacedCells, placeCell, roadName, type PlacedCell } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// SA34a (meta SHARD-AUTHORING, after SA33 and SA34): a cell placed on a running world with roads (`WORLD_CROSSING=worker`) is laid out on
// every worker's road. Staging's 2-worker table: Nalati alone on worker 0, Driftwood on worker 1. Thin Ice is placed at (0, 3), the
// spiral's first ring-3 spot (SA30): it opens on Driftwood's worker (the nearest open cell's), whose road hands a seat into it, and
// Nalati's road walls it as it walls every cell it can't hand a seat to. On both roads its square has no void floor and the grown grid's
// strips run round it.
const HOME = 'driftwood-isle', EAST = 'nalati-grasslands', HOME_ROAD = roadName(HOME), EAST_ROAD = roadName(EAST);
const PLACED: PlacedCell = { instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3] };
const P = CONTENT_CAPS.pitch, NORTH = PLACED.cell[1] * P;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; forgetPlacedCells(); });

/** An empty road takes no ticks: a step brings its scene queries up to date, as the SA34 floor test does. */
const look = (road: SimHost): SimHost => { road.physics.step(); return road; };
/** The height a ray straight down from 50 m meets, or null. */
const down = (road: SimHost, x: number, z: number): number | null => {
  const { R, world } = look(road).physics, hit = world.castRay(new R.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 60, true);
  return hit === null ? null : 50 - hit.timeOfImpact;
};
/** Whether a ray straight down meets road (a platform strip or its copy) first. */
const road = (host: SimHost, x: number, z: number): boolean => {
  const { R, world } = look(host).physics, hit = world.castRay(new R.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 60, true);
  return hit !== null && tagOf(hit.collider)?.owner === PLATFORM_COLLIDER_OWNER;
};
/** How far north a ray 1 m over the outer road, beside the placed cell's south edge, runs before it meets something. */
const north = (road: SimHost): number | null => {
  const { R, world } = look(road).physics, from = NORTH - CHUNK_HALF - 10, hit = world.castRay(new R.Ray({ x: 0, y: 1, z: from }, { x: 0, y: 0, z: 1 }), 30, true);
  return hit === null ? null : hit.timeOfImpact;
};

test('a placed cell is laid out on every road: no void floor on its square, strips round it, walled where it is not hosted, and a walk in from the road', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: [HOME, EAST], saves: memoryPlayerSaves(), workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), mine = bench.road(HOME_ROAD), other = bench.road(EAST_ROAD);
  if (home === undefined || mine === undefined || other === undefined) throw new Error('Both workers boot a road');
  expect(bench.world.health()).toMatchObject({ table: { [EAST]: 0, [HOME]: 1 } });
  // Before: (0, 3) is the void's floor on both roads, and nothing stands at its edge.
  for (const road of [mine, other]) { expect(down(road.host, 0, NORTH)).toBeCloseTo(0, 2); expect(north(road.host)).toBeNull(); }

  expect(placeCell(PLACED)).toBe(true);
  expect(await bench.world.openCells([PLACED.instance])).toEqual([PLACED.instance]);
  expect(bench.world.health(), 'on Driftwood\'s worker, the open cell nearest (0, 3)').toMatchObject({ cells: 3, workers: 2, table: { [EAST]: 0, [HOME]: 1, [PLACED.instance]: 1 } });
  const placed = bench.room(PLACED.instance);
  if (placed === undefined) throw new Error('Thin Ice opens');
  // Nalati's worker hears it too, on its own time.
  await vi.waitFor(() => { expect(north(other.host)).not.toBeNull(); }, { timeout: 30_000 });
  for (const road of [mine, other]) {
    expect(down(road.host, 0, NORTH), 'no void floor over its square').toBeNull();
    expect(down(road.host, 0, NORTH + P / 2), 'the strip north of it').toBeCloseTo(0, 1);
    expect(down(road.host, P / 2, NORTH), 'the strip east of it').toBeCloseTo(0, 1);
    expect(down(road.host, P, NORTH), 'its empty neighbour is still floor').toBeCloseTo(0, 2);
  }
  expect(north(other.host), 'Nalati\'s road walls it, 2 m out from its edge').toBeCloseTo(10 - 2 - 0.5, 1);
  // Its own world has the road past each edge: the pack's outer strip south of it (its copy) and a new strip north.
  for (const z of [-(CHUNK_HALF + 3), CHUNK_HALF + 3]) expect(road(placed.host, 0, z), `the road at z ${String(z)} in its frame`).toBe(true);
  expect(north(mine.host), 'Driftwood\'s road hands a seat in: no wall').toBeNull();

  // Off Driftwood's north edge onto its road, then set down on the outer road just south of Thin Ice and walk north by input.
  const body = home.bodyOf('device:a');
  if (body === undefined) throw new Error('A stands in Driftwood');
  body.resetPose({ x: 0, y: body.position.y, z: CHUNK_HALF + 3 }, body.yaw);
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(0); }, { timeout: 10_000 });
  const onRoad = mine.bodyOf('device:a');
  if (onRoad === undefined) throw new Error('A stands on the road');
  onRoad.resetPose({ x: 0, y: 0.5, z: NORTH - CHUNK_HALF - 6 }, Math.PI);
  a.thumb = (): ReturnType<RoomBot['thumb']> => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI, pitch: 0, buttons: 0 });
  await vi.waitFor(() => { expect(a.client.latest?.cell).toBe(cellFrame(PLACED.instance)); }, { timeout: 20_000 });
  expect(mine.holds('device:a'), 'the road let the seat go').toBe(false);
  expect(placed.holds('device:a'), 'Thin Ice holds it').toBe(true);
  expect(a.closed, 'the socket never closed').toBeNull();
  expect(bench.lines.filter(line => line['at'] === 'cell.crossed').map(line => [line['from'], line['to'], line['moved']])).toEqual([[HOME, HOME_ROAD, true], [HOME_ROAD, PLACED.instance, true]]);
  expect([bench.restarts, bench.crashes]).toEqual([0, []]);
});

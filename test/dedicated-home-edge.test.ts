// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { placeOf } from '../src/client/engine/net/otherPlayers';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { NetClass } from '../src/shared/engine/net/schema';
import { createSimHost } from '../src/server/engine/sim';
import { ROAD } from '../src/server/host/standalone/roadWorld';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { EDGE_PREFIX, EDGE_REACH, EdgeList, EdgeRows, edgeDistance } from '../src/server/host/dedicated/edgeRows';
import type { RoadRoom } from '../src/server/host/dedicated/roadRoom';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP5.2a (Q36 under zone entry, J352/J353): a page holds its home and the road, and every other cell stands behind a wall, so
// the one border a player sees across is the home edge. Its two sides are two rooms on one worker (the cell and the worker's road), and
// before this each hid the other: a friend 5 m inside the edge vanished as you stepped onto the road. Now each room shows the other's
// bodies within 60 m of the edge, read-only, ten times a second.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

/** What a row of `view` says, through the player class's own samplers, and where a page stands it. */
function rowOf(view: unknown): { x: number; z: number; place: { x: number; z: number } } {
  const cls = PLAYER_CLASS as NetClass<unknown>, out = new Float64Array(cls.row.length), refs = (): number => 0;
  cls.row.forEach((column, index) => { out[index] = column.sample(view, refs); });
  const values = cls.row.map((column, index) => { const value = column.value(out[index] ?? 0); return typeof value === 'number' ? value : Number(value); });
  return { x: Number(values[cls.row.findIndex(column => column.name === 'x')]), z: Number(values[cls.row.findIndex(column => column.name === 'z')]), place: placeOf(values) };
}
/** Every row `list` shows, by id. */
function shownBy(list: EdgeList): Map<string, unknown> { const rows = new Map<string, unknown>(); list.visit({ entity: (id, _cls, view) => { rows.set(id, view); } }); return rows; }

test('a cell\'s edge, either side: negative inside, positive out on the road, the corner by its diagonal', () => {
  const origin = { x: -562.5, z: 0 };
  expect(edgeDistance(origin, { x: origin.x + CHUNK_HALF - 5, z: 10 })).toBeCloseTo(-5, 9);
  expect(edgeDistance(origin, { x: origin.x + CHUNK_HALF + 20, z: 10 })).toBeCloseTo(20, 9);
  expect(edgeDistance(origin, { x: origin.x + CHUNK_HALF + 3, z: CHUNK_HALF + 4 })).toBeCloseTo(5, 9);
  expect(edgeDistance(origin, origin)).toBeCloseTo(-CHUNK_HALF, 9);
});

test('off Driftwood\'s origin (Sunscar, 562.5 m west): each side reads the other at its true place in its own frame, within 60 m only', () => {
  const road = createSimHost(ROAD, { rapier }), cell = createSimHost(ROAD, { rapier });
  try {
    const origin = { x: -562.5, z: 0 }, slug = 'sunscar-dunes';
    // inside Sunscar 5 m short of its east edge (its own frame), and out on the road 20 m past it (the world's)
    const inside = cell.addPlayer('seat:in', { x: CHUNK_HALF - 5, y: 1, z: 40 }, 0), deep = cell.addPlayer('seat:deep', { x: CHUNK_HALF - EDGE_REACH - 20, y: 1, z: 0 }, 0);
    const out = road.addPlayer('seat:out', { x: origin.x + CHUNK_HALF + 20, y: 1, z: -30 }, 0), far = road.addPlayer('seat:far', { x: origin.x + CHUNK_HALF + EDGE_REACH + 20, y: 1, z: 0 }, 0);
    out.roadPlace = true; far.roadPlace = true;
    const rows = new EdgeRows(), origins = new Map([[slug, origin]]), roadList = new EdgeList(), cellList = new EdgeList();
    const homes = new Map<string, string | null>([['seat:out', slug], ['seat:far', 'driftwood-isle']]);
    rows.refresh({ host: road, list: roadList, taken: 2, homes: () => homes }, [{ slug, host: cell, list: cellList, taken: 2 }], origins);
    const onRoad = shownBy(roadList), inCell = shownBy(cellList);
    expect([...onRoad.keys()], 'the road shows Sunscar\'s body near its edge, not the deep one').toEqual([`${EDGE_PREFIX}${slug}:seat:in`]);
    expect([...inCell.keys()], 'Sunscar shows the road body within 60 m, not the far one').toEqual([`${EDGE_PREFIX}road:seat:out`]);
    const seenOnRoad = rowOf(onRoad.get(`${EDGE_PREFIX}${slug}:seat:in`)), seenInCell = rowOf(inCell.get(`${EDGE_PREFIX}road:seat:out`));
    expect(Math.abs(seenOnRoad.place.x - (origin.x + inside.position.x)) + Math.abs(seenOnRoad.place.z - inside.position.z), 'on the road, in the world\'s frame').toBeLessThan(0.1);
    expect(Math.abs(seenInCell.place.x - (out.position.x - origin.x)) + Math.abs(seenInCell.place.z - out.position.z), 'in Sunscar, in its frame').toBeLessThan(0.1);
    expect(Math.abs(seenInCell.x), 'x alone clamps at 260 m; the road place carries the rest').toBeLessThanOrEqual(260);
    // the road seat whose home is Sunscar sees Sunscar's row; one whose home is another cell sees a wall there, so not the row
    expect(rows.hides('seat:out', `${EDGE_PREFIX}${slug}:seat:in`)).toBe(false);
    expect(rows.hides('seat:far', `${EDGE_PREFIX}${slug}:seat:in`)).toBe(true);
    expect(rows.hides('seat:far', 'seat:out'), 'a road body\'s own row is never hidden').toBe(false);
    // read live between refreshes: a step along the edge shows at once
    inside.position.z += 3;
    expect(rowOf(onRoad.get(`${EDGE_PREFIX}${slug}:seat:in`)).place.z).toBeCloseTo(inside.position.z, 1);
    // a body that left its host shows no more, before the next refresh; an empty cell is shown nothing and shows nothing
    cell.removePlayer('seat:in');
    expect(shownBy(roadList).size).toBe(0);
    rows.refresh({ host: road, list: roadList, taken: 2, homes: () => homes }, [{ slug, host: cell, list: cellList, taken: 0 }], origins);
    expect(cellList.size).toBe(0);
    expect(deep.position.x).toBeLessThan(CHUNK_HALF - EDGE_REACH);
  } finally { road.dispose(); cell.dispose(); }
});

const HOME = 'driftwood-isle', CELLS = [HOME, 'sunscar-dunes', 'far-reach', 'nalati-grasslands'];
/** The middle of the road between Driftwood and Sunscar on staging's pitch (562.5 m): 31 m out from Driftwood's west edge. */
const GAP = -(562.5 / 2);
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const out = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: 0 });
const still = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });

/** Where `reader`'s newest frame stands the row `id`, or null when it has none. */
function placeIn(reader: RoomBot, id: string): { x: number; z: number } | null {
  const frame = reader.client.latest, handle = reader.client.handle(id), row = handle === undefined ? undefined : frame?.rows.get(handle);
  if (frame === null || handle === undefined || row === undefined || reader.client.entities.get(handle)?.cls !== PLAYER_CLASS) return null;
  return placeOf(PLAYER_CLASS.row.map((column, index) => { const value = column.value(row[index] ?? 0); return typeof value === 'number' ? value : Number(value); }));
}

test('across Driftwood\'s west edge: the bot inside and the bot on the road each read the other within 0.1 m; neither can hit the other', { timeout: 120_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'), b = new RoomBot(bench.url, 'bench', 'device:b', 'B'); bots.push(a, b);
  expect(await a.arrived()).toBe(true);
  expect(await b.arrived()).toBe(true);
  const home = bench.room(HOME), road: RoadRoom | undefined = bench.road(roadName(HOME));
  if (home === undefined || road === undefined) throw new Error('Driftwood and its road boot');
  // B walks off Driftwood's west entryway by input onto the road, then stands mid-road 31 m out; A stands 5 m inside the edge
  home.bodyOf('device:b')?.resetPose({ x: -(CHUNK_HALF - 10), y: 1, z: 0 }, Math.PI / 2);
  b.thumb = out;
  await vi.waitFor(() => { expect(road.holds('device:b'), 'B onto the road').toBe(true); }, { timeout: 20_000, interval: 100 });
  b.thumb = still;
  const onRoad = road.bodyOf('device:b'), inside = home.bodyOf('device:a');
  if (onRoad === undefined || inside === undefined) throw new Error('Both bodies stand');
  onRoad.resetPose({ x: GAP, y: onRoad.position.y + 0.5, z: 40 }, 0);
  inside.resetPose({ x: -(CHUNK_HALF - 5), y: inside.position.y + 0.5, z: 40 }, 0);
  const aRow = `${EDGE_PREFIX}${HOME}:${inside.id}`, bRow = `${EDGE_PREFIX}road:${onRoad.id}`;
  await vi.waitFor(() => {
    const seenByB = placeIn(b, aRow), seenByA = placeIn(a, bRow);
    expect(seenByB, 'B on the road reads A inside').not.toBeNull();
    expect(seenByA, 'A inside reads B on the road').not.toBeNull();
    // Driftwood's frame is the world's (its origin is 0, 0), so both read world metres here; the shift itself is the test above's
    expect(Math.abs((seenByB?.x ?? Infinity) - inside.position.x) + Math.abs((seenByB?.z ?? Infinity) - inside.position.z), 'A where B stands it').toBeLessThan(0.1);
    expect(Math.abs((seenByA?.x ?? Infinity) - onRoad.position.x) + Math.abs((seenByA?.z ?? Infinity) - onRoad.position.z), 'B where A stands it').toBeLessThan(0.1);
  }, { timeout: 5_000, interval: 50 });
  // Read-only: neither room holds a body for the other's row, and a blow either way is refused (MP5.1c)
  expect(home.host.players.get(bRow)).toBeUndefined();
  expect(road.host.players.get(aRow)).toBeUndefined();
  const blow = (host: typeof home.host, source: typeof inside, target: typeof onRoad) => host.combat.hit({ source: source.health, target: target.health,
    sourceTags: ['dmg.melee', 'cover.checked'], amount: 1, point: new Vector3(), dir: new Vector3(), throughWalls: true });
  expect(blow(home.host, inside, onRoad), 'A hits B from inside').toBeNull();
  expect(blow(road.host, onRoad, inside), 'B hits A from the road').toBeNull();
  // A walks 80 m in: past 60 m, B reads it no more
  inside.resetPose({ x: -(CHUNK_HALF - 80), y: inside.position.y + 0.5, z: 40 }, 0);
  await vi.waitFor(() => { expect(placeIn(b, aRow), 'A 80 m in is not shown on the road').toBeNull(); }, { timeout: 5_000, interval: 50 });
});

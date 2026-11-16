// The grid's road as a world of its own: the solo grid server's highway (`gridServer.ts`), and since GC15 a dedicated worker's road room
// (`dedicated/roadRoom.ts`). Its frame is the world's; the ground lies far below the road's strips, which C2's grid pack carries.
import type { Collider } from '@dimforge/rapier3d-simd';
import { withOwner } from '@wildshard/engine/app/ownership';
import { CHUNK_HALF, CONTENT_CAPS } from '@wildshard/engine/core/config';
import { groups } from '@wildshard/engine/physics/groups';
import { PLATFORM_COLLIDER_OWNER, stripCollider } from '@wildshard/engine/physics/stripColliders';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimHost, type SimLevel } from '@wildshard/engine/sim';
import { SIM_API_VERSION } from '@wildshard/engine/sim/apiVersion';
import type { GridCell } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { HOST_PROBE } from '@wildshard/engine/game/plugin/simulation';
import { installVoidFloor, voidFloorBoxes } from '@wildshard/engine/game/grid/voidFloor';
import { FALL_FLOOR } from './fallFloor';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';
import { walledCells, zoneWallEdges } from '@wildshard/engine/game/grid/zoneWalls';

/** Ground under the whole grid, far below the road's strips, and a player's pace on them. */
const ROAD_HALF_SIZE = 2000, ROAD_SPEED = 8;
/** A cell wall's thickness and half its height. */
const WALL = 0.5, WALL_HEIGHT = 30;
/** How far out from a cell's edge its wall stands. */
const WALL_OFF = 2;
export const ROAD: SimLevel = { version: SIM_API_VERSION, id: 'grid-road', seed: 1, ground: { size: ROAD_HALF_SIZE * 2, height: FALL_FLOOR }, player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: ROAD_SPEED }, entities: [], quests: [], weapon: HOST_PROBE };

/** Each road world's cell walls, by the cell they stand round, so GC15 (3) can open one a walker can now cross into. */
const walls = new WeakMap<SimHost, Map<string, Collider[]>>();
/**
 * A wall around every cell in the road's own world, as the page's readiness walls are while a cell loads. A player stops just short of
 * a cell until its world is ready and the crossing takes them in, 6 m out at most; the road never runs on under a cell's own
 * hills, where a late hand-off would set them down inside one. A cell's terrain can end in a bank above road level at its very edge,
 * and a capsule set down touching that bank stays stuck in it, so the wall stands clear of it.
 */
export function addCellWalls(road: SimHost, cells: readonly (Pick<GridCell, 'origin'> & { readonly instance?: string })[]): void {
  const { R, world } = road.physics, reach = CHUNK_HALF + WALL_OFF + WALL / 2, long = reach + WALL / 2;
  const kept = walls.get(road) ?? new Map<string, Collider[]>();
  walls.set(road, kept);
  withOwner(road.scope, () => {
    for (const { origin, instance } of cells) for (const [x, z, hx, hz] of [[reach, 0, WALL / 2, long], [-reach, 0, WALL / 2, long], [0, reach, long, WALL / 2], [0, -reach, long, WALL / 2]] as const) {
      const collider = world.createCollider(R.ColliderDesc.cuboid(hx, WALL_HEIGHT, hz).setTranslation(origin.x + x, WALL_HEIGHT, origin.z + z).setCollisionGroups(groups('WORLD')));
      if (instance !== undefined) kept.set(instance, [...kept.get(instance) ?? [], collider]);
    }
  });
}
/**
 * ZONE-ENTRY ZE11 (J352): the in-page server's road walls every cell but the session's home on the page's own lines (`zoneWallEdges`:
 * the edge line, open only at each entryway's buffer, the gate 10 m in) and floors each buffer with its entry socket, so the feet
 * reach a gate on the server's road as they do on the page, and no further. The home has only its 2 m hold. A restored road first loses the
 * walls an older build saved (`dropCellWalls`); its platform-tagged pieces are renewed with its void floor (`renewVoidFloor`).
 */
export function addZoneWalls(road: SimHost, cells: readonly GridCell[], home: string): void {
  const walled = walledCells({ cells }, { instance: home });
  withOwner(road.scope, () => {
    installEntrySockets(road.physics, road.scope, walled.map(cell => cell.origin));
    new ReadinessWalls(road.physics, walled.flatMap(cell => zoneWallEdges(cell, { origin: { x: 0, z: 0 } })), road.scope);
  });
  // the home keeps the 2 m hold (`addCellWalls`): its crossing, 6 m out, takes a walker past it; but this server keeps one world, so
  // after a reload on the road a walker who reaches the home before it loads stops there, never walking on under its hills
  addCellWalls(road, cells.filter(cell => cell.instance === home));
}
/** ZE6: each dedicated road's zone walls, by the cell they stand round, so a seat's motor can pass its own home's. */
const zoneWalls = new WeakMap<SimHost, Map<string, readonly number[]>>();
/**
 * ZONE-ENTRY ZE6 (J352): a dedicated worker's road walls every cell on the page's own lines (`zoneWallEdges`: the edge line, open
 * only at each entryway's buffer, the gate 10 m in) and floors each buffer with its entry socket. One road world holds every seat
 * on the worker and seats have different homes, so no cell is left open in the world: each seat's motor passes its own home's
 * walls (`openHomeFor`), and meets every other cell's at its edge and its gate, as the page does.
 */
export function addSeatZoneWalls(road: SimHost, cells: readonly GridCell[]): void {
  if (cells.length === 0) return;
  const kept = zoneWalls.get(road) ?? new Map<string, readonly number[]>();
  zoneWalls.set(road, kept);
  withOwner(road.scope, () => {
    installEntrySockets(road.physics, road.scope, cells.map(cell => cell.origin));
    const zone = new ReadinessWalls(road.physics, cells.flatMap(cell => zoneWallEdges(cell, { origin: { x: 0, z: 0 } })), road.scope);
    for (const cell of cells) kept.set(cell.instance, zone.handles(cell.instance));
  });
}
/** ZE6: `motor` (a seat's on this road) passes the walls round `home`, its own cell, and no other. False when `home` has none here. */
export function openHomeFor(road: SimHost, motor: { readonly phased: Set<number> }, home: string): boolean {
  const handles = zoneWalls.get(road)?.get(home);
  if (handles === undefined) return false;
  for (const handle of handles) motor.phased.add(handle);
  return true;
}
/** ZE11: take out the 2 m plain walls (`addCellWalls`) a road saved by an older build holds: the only cuboids of that size. */
export function dropCellWalls(road: SimHost): number {
  const { world } = road.physics, found: Collider[] = [];
  world.forEachCollider(collider => {
    if (tagOf(collider) !== undefined) return;
    const half = collider.halfExtents?.();
    if (half !== undefined && half !== null && Math.abs(half.y - WALL_HEIGHT) < 1e-3 && Math.abs(Math.min(half.x, half.z) - WALL / 2) < 1e-3) found.push(collider);
  });
  for (const collider of found) world.removeCollider(collider, false);
  return found.length;
}
/** GC15 (3): take down the walls round these cells (on another worker, their entryways standing): the road crosses into them now. */
export function openCellWalls(road: SimHost, instances: readonly string[]): void {
  const kept = walls.get(road);
  if (kept === undefined) return;
  for (const instance of instances) { for (const collider of kept.get(instance) ?? []) if (collider.isValid()) road.physics.world.removeCollider(collider, false); kept.delete(instance); }
}
/** Each road world's void floor colliders, so a placement can lift them (SA34a). */
const floors = new WeakMap<SimHost, readonly Collider[]>();
/** SA34: the 7 × 7's void, walkable: a road-level floor over every empty cell and out to the rail, and the rim on the rail. */
export function addVoidFloor(road: SimHost, cells: readonly Pick<GridCell, 'cell'>[], rim = true): void {
  withOwner(road.scope, () => { floors.set(road, installVoidFloor(road.physics, cells, CONTENT_CAPS.pitch, rim)); });
}
/**
 * SA34a: a running road is told of cells placed after it opened (SA33). The void floor is laid again for the grown grid, so none lies over a
 * new cell's square; the new strips go in; and a new cell this worker can't hand a seat to gets the walls every other worker's cell has.
 * The rim stays: it stands on the 7 × 7's rail whatever is placed.
 */
export function placeOnRoad(road: SimHost, cells: readonly Pick<GridCell, 'cell'>[], strips: readonly GridCollisionStrip[], walled: readonly GridCell[]): void {
  const { world } = road.physics;
  for (const collider of floors.get(road) ?? []) world.removeCollider(collider, false);
  addVoidFloor(road, cells, false);
  buildStrips(road, strips.map(strip => strip.mesh));
  addSeatZoneWalls(road, walled);
}
/**
 * SA34: a restored road's save holds the void floor and rim the saving build made (strips are held as data and out of every save,
 * `gridServer.ts` `capture`, so each platform collider in it is the void's). Take them out and install this build's, so a restore
 * never stacks a second floor and a save from the one-slab floor gets the tiles. Feet the slab had sunk below road level over the
 * void stand back on it at `skin`.
 */
export function renewVoidFloor(road: SimHost, cells: readonly Pick<GridCell, 'cell'>[], feet: { x: number; y: number; z: number }, skin: number): boolean {
  const { world } = road.physics, saved: Parameters<typeof world.removeCollider>[0][] = [];
  world.forEachCollider(collider => { if (tagOf(collider)?.owner === PLATFORM_COLLIDER_OWNER) saved.push(collider); });
  for (const collider of saved) world.removeCollider(collider, false);
  addVoidFloor(road, cells);
  const overVoid = voidFloorBoxes(cells, CONTENT_CAPS.pitch).some(box => Math.abs(feet.x - box.x) <= box.hx && Math.abs(feet.z - box.z) <= box.hz);
  if (!overVoid || feet.y >= skin || feet.y < -1) return false;
  feet.y = skin; return true;
}
/** C6: a room's world builds every strip at once, since no one list can follow every player. */
export function buildStrips(host: SimHost, meshes: readonly GridCollisionStrip['mesh'][]): void {
  withOwner(host.scope, () => { for (const mesh of meshes) stripCollider(host.physics, mesh); });
}
/** The road admits no ordinary damage, including scripted environmental hits.
 * Terminal out-of-world falls retain CombatPipeline.fall's recovery path. */
export function installRoadCombat(road: SimHost): void {
  road.events.answer('damage.admit', () => null, road.scope);
}
/**
 * GC15: a dedicated worker's road, with nobody on it yet: every strip built, the void's floor round `placed` (SA34), and since ZE6 the
 * zone walls round every cell in `walled` (all of them: each seat passes only its own home's, `openHomeFor`). Its lead seat is the
 * room's to park.
 */
export function openRoad(rapier: Rapier, walled: readonly GridCell[], strips: readonly GridCollisionStrip[], placed: readonly Pick<GridCell, 'cell'>[]): SimHost {
  const road = createSimHost(ROAD, { rapier });
  installRoadCombat(road);
  addSeatZoneWalls(road, walled);
  addVoidFloor(road, placed);
  buildStrips(road, strips.map(strip => strip.mesh));
  return road;
}

// The grid's road as a world of its own: the solo grid server's highway (`gridServer.ts`), and since GC15 a dedicated worker's road room
// (`dedicated/roadRoom.ts`). Its frame is the world's; the ground lies far below the road's strips, which C2's grid pack carries.
import { withOwner } from '@wildshard/engine/app/ownership';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { groups } from '@wildshard/engine/physics/groups';
import { stripCollider } from '@wildshard/engine/physics/stripColliders';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimHost, type SimLevel } from '@wildshard/engine/sim';
import { SIM_API_VERSION } from '@wildshard/engine/sim/apiVersion';
import type { GridCell } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { HOST_PROBE } from '@wildshard/engine/game/plugin/simulation';
import { FALL_FLOOR } from './cellWorld';

/** Ground under the whole grid, far below the road's strips, and a player's pace on them. */
const ROAD_HALF_SIZE = 2000, ROAD_SPEED = 8;
/** A cell wall's thickness and half its height. */
const WALL = 0.5, WALL_HEIGHT = 30;
/** How far out from a cell's edge its wall stands. */
const WALL_OFF = 2;
export const ROAD: SimLevel = { version: SIM_API_VERSION, id: 'grid-road', seed: 1, ground: { size: ROAD_HALF_SIZE * 2, height: FALL_FLOOR }, player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: ROAD_SPEED }, entities: [], quests: [], weapon: HOST_PROBE };

/**
 * A wall around every cell in the road's own world, as the page's readiness walls are while a cell loads. A player stops just short of
 * a cell until its world is ready and the crossing takes them in, 6 m out at most; the road never runs on under a cell's own
 * hills, where a late hand-off would set them down inside one. A cell's terrain can end in a bank above road level at its very edge,
 * and a capsule set down touching that bank stays stuck in it, so the wall stands clear of it.
 */
export function addCellWalls(road: SimHost, cells: readonly Pick<GridCell, 'origin'>[]): void {
  const { R, world } = road.physics, reach = CHUNK_HALF + WALL_OFF + WALL / 2, long = reach + WALL / 2;
  withOwner(road.scope, () => {
    for (const { origin } of cells) for (const [x, z, hx, hz] of [[reach, 0, WALL / 2, long], [-reach, 0, WALL / 2, long], [0, reach, long, WALL / 2], [0, -reach, long, WALL / 2]] as const)
      world.createCollider(R.ColliderDesc.cuboid(hx, WALL_HEIGHT, hz).setTranslation(origin.x + x, WALL_HEIGHT, origin.z + z).setCollisionGroups(groups('WORLD')));
  });
}
/** C6: a room's world builds every strip at once, since no one list can follow every player. */
export function buildStrips(host: SimHost, meshes: readonly GridCollisionStrip['mesh'][]): void {
  withOwner(host.scope, () => { for (const mesh of meshes) stripCollider(host.physics, mesh); });
}
/**
 * GC15: a dedicated worker's road, with nobody on it yet: every strip built, and walls only round `walled`, the cells it can't hand a
 * seat to (those on another worker: GC7's one line). Its lead seat is the room's to park.
 */
export function openRoad(rapier: Rapier, walled: readonly Pick<GridCell, 'origin'>[], strips: readonly GridCollisionStrip[]): SimHost {
  const road = createSimHost(ROAD, { rapier });
  addCellWalls(road, walled);
  buildStrips(road, strips.map(strip => strip.mesh));
  return road;
}

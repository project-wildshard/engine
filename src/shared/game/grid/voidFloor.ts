/**
 * SA34 (meta SHARD-AUTHORING-PLAN, J314, grill Q9): the 7 × 7's empty cells are a walkable void floor, never a wall. The
 * grid lays out all 49 cells (`DRAWN_GRID_RADIUS` 3): the roads run round the placed cells' rectangle as before (the
 * generator's strips, `strips.ts`), and every other spot inside the 7 × 7's rail is the void's flat floor at road level
 * (y 0, the height an empty neighbour's strip edge ends at, `assembly.ts` `emptyNeighbour`). The rail, the void's closed
 * rim, stands on the 7 × 7's outer road shoulder whatever is placed, so a walk from ring 2 into an empty ring-3 cell stays
 * on the floor and comes back. Each road world (the page's highway, the in-page server's road, a dedicated worker's road room)
 * installs the same slabs and rim with `installVoidFloor`; the look draws the floor from the same layout (`voidLook.ts`).
 */
import type { Physics } from '@wildshard/engine/physics/Physics';
import { groups } from '@wildshard/engine/physics/groups';
import { PLATFORM_COLLIDER_OWNER } from '@wildshard/engine/physics/stripColliders';
import { tagCollider } from '@wildshard/engine/physics/surface';
import { emptyCellSquares, GAP_HALF, gridRail, type CellSquare } from './roadLayout';

/** A floor slab's footprint in grid metres: its centre and half sizes. Its top is at road level, y 0. */
export type VoidBox = CellSquare;
/** How far the floor runs on past the rail, so a capsule pressed to the rim still stands on it. */
export const VOID_FLOOR_PAST_RAIL = 20;
/** How far the rim reaches below road level (m). */
export const VOID_FLOOR_DEPTH = 1;
/**
 * The floor's largest square (m). One road-level slab as long as the band (2875 m × 560 m) is a cuboid Rapier can't stand a capsule on:
 * its contact error grows with the shape's size, so a player walked a metre onto it, sank 0.17 m into its top and stuck there (on the
 * in-page server's road and so on the page, which takes the server's state back). The floor is a flat trimesh of squares this size
 * instead, as the strips are, each collider in its own box's frame.
 */
export const VOID_FLOOR_TILE = 125;

/** The placed cells' rectangle, in cells (the strips' extent: `strips.ts` builds a gap round every side of it). */
function placedRange(cells: readonly { readonly cell: readonly [number, number] }[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = cells.map((c) => c.cell[0]), zs = cells.map((c) => c.cell[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * Where the void's floor lies: an empty cell inside the placed rectangle (its 500 m square; the strips round it end at road
 * level on its side), and the band between the strips' outer edge and just past the rail. Never under a strip or a cell.
 */
export function voidFloorBoxes(cells: readonly { readonly cell: readonly [number, number] }[], pitch: number): readonly VoidBox[] {
  if (cells.length === 0) return [];
  const range = placedRange(cells), rail = gridRail(pitch), boxes: VoidBox[] = [...emptyCellSquares(cells, pitch)];
  // the strips' outer edge, and the floor's: past the rail on every side
  const x0 = range.minX * pitch - pitch / 2 - GAP_HALF, x1 = range.maxX * pitch + pitch / 2 + GAP_HALF;
  const z0 = range.minZ * pitch - pitch / 2 - GAP_HALF, z1 = range.maxZ * pitch + pitch / 2 + GAP_HALF;
  const X0 = rail.minX - VOID_FLOOR_PAST_RAIL, X1 = rail.maxX + VOID_FLOOR_PAST_RAIL, Z0 = rail.minZ - VOID_FLOOR_PAST_RAIL, Z1 = rail.maxZ + VOID_FLOOR_PAST_RAIL;
  const band = (a: number, b: number, c: number, d: number): void => { if (b - a > 0.01 && d - c > 0.01) boxes.push({ x: (a + b) / 2, z: (c + d) / 2, hx: (b - a) / 2, hz: (d - c) / 2 }); };
  band(X0, x0, Z0, Z1); band(x1, X1, Z0, Z1); // west and east, full depth
  band(x0, x1, Z0, z0); band(x0, x1, z1, Z1); // south and north, between them
  return boxes;
}

/** A floor box as a flat, upward-facing trimesh at road level (y 0) in the box's own frame: squares of at most `VOID_FLOOR_TILE`. */
export function voidFloorMesh(box: VoidBox): { readonly positions: Float32Array; readonly indices: Uint32Array } {
  const nx = Math.max(1, Math.ceil((2 * box.hx) / VOID_FLOOR_TILE)), nz = Math.max(1, Math.ceil((2 * box.hz) / VOID_FLOOR_TILE));
  const positions = new Float32Array((nx + 1) * (nz + 1) * 3), indices = new Uint32Array(nx * nz * 6);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const at = (i * (nz + 1) + j) * 3;
    positions[at] = -box.hx + (2 * box.hx * i) / nx; positions[at + 2] = -box.hz + (2 * box.hz * j) / nz;
  }
  let k = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = i * (nz + 1) + j, b = a + nz + 1; // a: (i, j), b: (i + 1, j); +1 steps j
    indices.set([a, a + 1, b, b, a + 1, b + 1], k); k += 6; // wound to face up (+y)
  }
  return { positions, indices };
}

/** The rim: four walls on the rail's lines, as `ReadinessEdge`s are built (never opened: the void has no sim to wait for). */
export function rimWalls(pitch: number): readonly { readonly x: number; readonly z: number; readonly axis: 'x' | 'z'; readonly halfLength: number }[] {
  const { minX, maxX, minZ, maxZ } = gridRail(pitch), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2;
  return [{ x: minX, z: cz, axis: 'x', halfLength: hz }, { x: maxX, z: cz, axis: 'x', halfLength: hz }, { x: cx, z: minZ, axis: 'z', halfLength: hx }, { x: cx, z: maxZ, axis: 'z', halfLength: hx }];
}

/** The rim's half height and half thickness (m): a wall nobody climbs or boosts over. */
const RIM_HALF_HEIGHT = 30, RIM_HALF_THICK = 0.25;

/**
 * Install the void's floor slabs and, with `rim`, its rim in a road world in the grid's frame (the page's highway keeps its
 * rim as readiness walls instead). The caller's owner holds the colliders. Tagged as platform ground, so regional hashes
 * leave them out.
 */
export function installVoidFloor(physics: Pick<Physics, 'R' | 'world'>, cells: readonly { readonly cell: readonly [number, number] }[], pitch: number, rim = true): number {
  const { R, world } = physics;
  let made = 0;
  for (const box of voidFloorBoxes(cells, pitch)) {
    const { positions, indices } = voidFloorMesh(box);
    const collider = world.createCollider(R.ColliderDesc.trimesh(positions, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES).setTranslation(box.x, 0, box.z).setCollisionGroups(groups('WORLD')));
    tagCollider(collider, 'stone', PLATFORM_COLLIDER_OWNER); made++;
  }
  if (rim) for (const wall of rimWalls(pitch)) {
    const acrossX = wall.axis === 'x';
    const collider = world.createCollider(R.ColliderDesc.cuboid(acrossX ? RIM_HALF_THICK : wall.halfLength, RIM_HALF_HEIGHT, acrossX ? wall.halfLength : RIM_HALF_THICK)
      .setTranslation(wall.x, RIM_HALF_HEIGHT - VOID_FLOOR_DEPTH, wall.z).setCollisionGroups(groups('WORLD')));
    tagCollider(collider, 'edge', PLATFORM_COLLIDER_OWNER); made++;
  }
  return made;
}

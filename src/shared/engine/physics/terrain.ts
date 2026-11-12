/**
 * The shard's ground as Rapier colliders (PHYSICS.md P1): the terrain heightfield and the four chunk-edge walls.
 *
 * The heightfield is sampled from `heightAt` at the terrain mesh's own vertices (Terrain.ts builds a
 * `PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, RES - 1, RES - 1)` the same way), so its triangles are the triangles the player
 * sees. Rapier's heightfield: rows run along z and columns along x, the matrix is column-major, it spans
 * [-scale/2, scale/2] around its collider, and each cell is split along the (x0, z1)–(x1, z0) diagonal — the same
 * diagonal three's PlaneGeometry uses once it's rotated flat (test/physics-terrain.test.ts holds both to ≤ 2 cm).
 */
import type { Collider } from '@dimforge/rapier3d-simd';
import { CHUNK_HALF, CHUNK_SIZE, TERRAIN_RES } from '../core/config';
import { heightAt } from '../world/Heightfield';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, tagOf } from './surface';

/** The mesh's vertex heights, row-major (index iz × res + ix), x and z from −size/2 to +size/2. */
export function terrainGrid(res: number = TERRAIN_RES, size: number = CHUNK_SIZE): Float32Array {
  const out = new Float32Array(res * res);
  const d = size / (res - 1), half = size / 2;
  for (let iz = 0; iz < res; iz++) for (let ix = 0; ix < res; ix++) out[iz * res + ix] = heightAt(ix * d - half, iz * d - half);
  return out;
}

/** The row-major grid in Rapier's column-major (row = z, column = x) layout. */
export function toColumnMajor(grid: Float32Array, res: number): Float32Array {
  const out = new Float32Array(res * res);
  for (let iz = 0; iz < res; iz++) for (let ix = 0; ix < res; ix++) out[ix * res + iz] = grid[iz * res + ix] ?? 0;
  return out;
}

/** Inner faces of the edge walls sit here; with the player's 0.4 m capsule the centre stops 1.2 m inside the chunk. */
export const EDGE_WALL_INSET = 0.8;

interface Ground { collider: Collider; grid: Float32Array; res: number; size: number; declared?: true }
const grounds = new WeakMap<Physics, Ground>();

function buildGround(physics: Physics, grid: Float32Array, res: number, size: number): Collider {
  const { R, world } = physics;
  const desc = R.ColliderDesc.heightfield(res - 1, res - 1, toColumnMajor(grid, res), { x: size, y: 1, z: size })
    .setCollisionGroups(groups('WORLD')).setFriction(0.9);
  const ground = world.createCollider(desc);
  tagCollider(ground, 'ground');
  return ground;
}

export function addTerrain(physics: Physics, grid: Float32Array = terrainGrid(), res: number = TERRAIN_RES, size: number = CHUNK_SIZE): Collider {
  const collider = buildGround(physics, grid, res, size);
  grounds.set(physics, { collider, grid, res, size });
  return collider;
}

/** A terrain collider lattice centred on the chunk: row-major heights (index iz × res + ix), x and z from −size/2 to +size/2. */
export interface TerrainLattice { readonly grid: Float32Array; readonly res: number; readonly size: number }

/**
 * The level's terrain collider. A level that declares its collider lattice (a declared page: the shard's baked collider, the
 * ground the server walks) gets that lattice, sample for sample, and keeps it: a page sampled at its own TERRAIN_RES² lattice
 * stands centimetres off the server's on a dune, and every acked step corrects (NET-LAG NL10, Signal Dunes' 257² collider).
 * Any other level samples TERRAIN_RES² from the bound heightfield, as before.
 */
export function addLevelTerrain(physics: Physics, lattice?: TerrainLattice): Collider {
  if (lattice === undefined) return addTerrain(physics);
  // a copy: the level spec's lattice is shared by every entry of this level
  const collider = addTerrain(physics, Float32Array.from(lattice.grid), lattice.res, lattice.size), g = grounds.get(physics);
  if (g !== undefined) g.declared = true;
  return collider;
}

/**
 * Resample the terrain collider from the live heightfield (the same lattice it was built on): a level look's painter that
 * bound its own ground after the collider was added (`Terrain.groundBound`, a grid region builds its collider first) moves
 * the collision onto that ground. Returns false when this world has no terrain collider, or when its collider is a declared
 * lattice (`addLevelTerrain`): that one is the server's ground and stays it. Cuts made before are not replayed.
 */
export function resampleTerrain(physics: Physics): boolean {
  const g = grounds.get(physics);
  if (!g || g.declared === true) return false;
  const grid = terrainGrid(g.res, g.size);
  physics.world.removeCollider(g.collider, false);
  g.collider = buildGround(physics, grid, g.res, g.size); g.grid = grid;
  return true;
}

/** Take the sampled collider out of this world: something else is its ground now. Returns false when it had none. */
export function retireTerrain(physics: Physics): boolean {
  const g = grounds.get(physics);
  if (!g) return false;
  physics.world.removeCollider(g.collider, false);
  grounds.delete(physics);
  return true;
}

/** A rectangle (centre, half-extents, turned by `yaw` about +Y) where the physics ground must sit at or below `below`. */
interface TerrainCut { x: number; z: number; hw: number; hd: number; yaw: number; below: number }

/**
 * Push the physics heightfield down inside `cuts` (PHYSICS P4): where the drawn terrain pokes up through a walk-in
 * space (the sea cave's floor), the collision ground must not — the space's own colliders are the floor there. Grid
 * vertices inside a cut (grown by one cell, so no triangle still reaches in) are clamped to `below`; the heightfield
 * collider is rebuilt once. The drawn terrain is untouched. A declared lattice (`addLevelTerrain`) is never cut. Returns the vertices changed.
 */
export function cutTerrain(physics: Physics, cuts: readonly TerrainCut[]): number {
  const g = grounds.get(physics);
  // a declared lattice is the server's collider, which the server never cuts: cutting it here would part them again (NL10)
  if (!g || g.declared === true || cuts.length === 0) return 0;
  const { grid, res, size } = g, d = size / (res - 1), half = size / 2;
  let changed = 0;
  for (const c of cuts) {
    const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw), r = Math.hypot(c.hw, c.hd) + d;
    const i0 = Math.max(0, Math.floor((c.x - r + half) / d)), i1 = Math.min(res - 1, Math.ceil((c.x + r + half) / d));
    const k0 = Math.max(0, Math.floor((c.z - r + half) / d)), k1 = Math.min(res - 1, Math.ceil((c.z + r + half) / d));
    for (let iz = k0; iz <= k1; iz++) for (let ix = i0; ix <= i1; ix++) {
      const dx = ix * d - half - c.x, dz = iz * d - half - c.z;
      // into the cut's frame: three's +Y turn by yaw maps local (lx, lz) to (lx cos + lz sin, −lx sin + lz cos)
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) > c.hw + d || Math.abs(lz) > c.hd + d) continue;
      const i = iz * res + ix, h = grid[i] ?? 0;
      if (h > c.below) { grid[i] = c.below; changed++; }
    }
  }
  if (changed > 0) {
    physics.world.removeCollider(g.collider, false);
    g.collider = buildGround(physics, grid, res, size);
  }
  return changed;
}

/** Four walls a little inside the chunk edge — the chunk floats; there is nothing to walk onto. `reuse` (SERVER-PARITY SS10):
 *  a wall the world already holds (a native bake's own copy of these walls) stands as that wall, tagged `edge`, not twice. */
export function addEdgeWalls(physics: Physics, options: { readonly reuse?: boolean } = {}): Collider[] {
  const { R, world } = physics;
  const t = 1, reach = CHUNK_HALF - EDGE_WALL_INSET + t, lo = -60, hi = 400;
  const cy = (lo + hi) / 2, hy = (hi - lo) / 2, span = CHUNK_HALF + 2;
  const walls: [number, number, number, number][] = [[reach, 0, t, span], [-reach, 0, t, span], [0, reach, span, t], [0, -reach, span, t]];
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  const held = (x: number, z: number, hx: number, hz: number): Collider | undefined => {
    let found: Collider | undefined;
    if (options.reuse === true) world.forEachCollider(c => {
      const material = tagOf(c)?.material;
      if (found !== undefined || (material !== undefined && material !== 'edge') || c.isSensor() || !c.isEnabled() || c.collisionGroups() !== groups('WORLD')
        || c.shapeType() !== R.ShapeType.Cuboid || c.parent()?.isDynamic() === true) return;
      const at = c.translation(), h = c.halfExtents(), q = c.rotation();
      if (h !== null && same(at.x, x) && same(at.y, cy) && same(at.z, z) && same(h.x, hx) && same(h.y, hy) && same(h.z, hz) && same(Math.abs(q.w), 1)) found = c;
    });
    return found;
  };
  return walls.map(([x, z, hx, hz]) => {
    const old = held(x, z, hx, hz);
    if (old !== undefined) { if (tagOf(old) === undefined) tagCollider(old, 'edge'); return old; }
    const c = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, cy, z).setCollisionGroups(groups('WORLD')));
    tagCollider(c, 'edge');
    return c;
  });
}

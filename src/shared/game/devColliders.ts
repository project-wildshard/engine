import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { groups } from '@wildshard/engine/physics/groups';
import { swapTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import { terrainTileHeight, type TerrainTileData } from '@wildshard/format/terrainTileBytes';

/**
 * SHARD-SOURCE AP5 (J347): a watched part's solid boxes, as the dev hook's `swapColliders` hands them to a physics world.
 * The page's world (the player's prediction) and the in-page server's world (the worker, over the harness port) both take
 * them through `swapDevBoxes`, so the two sets never differ. DEVSERVER-only on both sides: each caller reaches this module
 * behind the `__DEVSERVER__` define, so a production bundle drops it (engine `scripts/check-devserver.mjs`).
 */
export interface DevBox {
  readonly centre: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  /** world rotation quaternion (x, y, z, w) */
  readonly rotation: readonly [number, number, number, number];
}

/** The harness-port message that carries one part's boxes to the in-page server. */
export interface DevCollidersMessage { readonly wildshardDevColliders: string; readonly boxes: readonly DevBox[] }

const numbers = (value: unknown, length: number, above = -Infinity): boolean => Array.isArray(value) && value.length === length
  && value.every(n => typeof n === 'number' && Number.isFinite(n) && n > above);
const isBox = (value: unknown): value is DevBox => typeof value === 'object' && value !== null && 'centre' in value && numbers(value.centre, 3)
  && 'half' in value && numbers(value.half, 3, 0) && 'rotation' in value && numbers(value.rotation, 4);

export const isDevColliders = (value: unknown): value is DevCollidersMessage => typeof value === 'object' && value !== null
  && 'wildshardDevColliders' in value && typeof value.wildshardDevColliders === 'string' && 'boxes' in value && Array.isArray(value.boxes) && value.boxes.every(isBox);

/**
 * Replace part `name`'s boxes in `physics`: the new set is made under a fresh child of `owner` first, then the old set's
 * scope is disposed (its colliders leave the world with it). An empty set removes the part's boxes.
 */
export function swapDevBoxes(physics: Physics, owner: Scope, held: Map<string, Scope>, name: string, boxes: readonly DevBox[]): void {
  const old = held.get(name);
  if (boxes.length === 0) held.delete(name);
  else {
    const scope = owner.child(`devColliders.${name}`);
    withOwner(scope, () => {
      for (const box of boxes) physics.world.createCollider(physics.R.ColliderDesc.cuboid(...box.half)
        .setTranslation(...box.centre).setRotation({ x: box.rotation[0], y: box.rotation[1], z: box.rotation[2], w: box.rotation[3] })
        .setCollisionGroups(groups('WORLD')));
    });
    held.set(name, scope);
  }
  old?.dispose();
}

/** SHARD-SOURCE AP18: a watched shard's whole ground, heights only (row-major, as the wire carries a terrain tile). */
export type DevGround = Pick<TerrainTileData, 'resolution' | 'x' | 'z' | 'size' | 'heights'>;
/** The harness-port message that carries the new ground to the in-page server. */
export interface DevGroundMessage { readonly wildshardDevGround: DevGround }

export const isDevGround = (value: unknown): value is DevGroundMessage => {
  if (typeof value !== 'object' || value === null || !('wildshardDevGround' in value)) return false;
  const ground = value.wildshardDevGround;
  if (typeof ground !== 'object' || ground === null || !('resolution' in ground) || !('x' in ground) || !('z' in ground) || !('size' in ground) || !('heights' in ground)) return false;
  const { resolution, x, z, size, heights } = ground;
  return typeof resolution === 'number' && Number.isInteger(resolution) && resolution >= 2 && resolution <= 257 && [x, z, size].every(n => typeof n === 'number' && Number.isFinite(n))
    && (size as number) > 0 && heights instanceof Float32Array && heights.length === resolution * resolution && heights.every(Number.isFinite);
};

/**
 * Where feet at (x, y, z) stand once new solids are in: on the ground when they are under it, or on top of a box they are
 * inside. Null when they are in neither (nothing to lift). A box's top is its highest point, a fair floor for a dev swap.
 */
export function liftedFeet(x: number, y: number, z: number, heightAt: ((x: number, z: number) => number) | null, boxes: readonly DevBox[]): number | null {
  let lifted: number | null = null;
  if (heightAt !== null) { const ground = heightAt(x, z); if (y < ground - 0.02) lifted = ground; }
  for (const box of boxes) {
    const [qx, qy, qz, qw] = box.rotation, dx = x - box.centre[0], dy = (lifted ?? y) + 0.05 - box.centre[1], dz = z - box.centre[2];
    // into the box's frame: the conjugate rotation, v + 2w(-q x v) + 2(-q x (-q x v))
    const cx = -qy * dz + qz * dy, cy = -qz * dx + qx * dz, cz = -qx * dy + qy * dx;
    const lx = dx + 2 * (qw * cx + (-qy * cz + qz * cy)), ly = dy + 2 * (qw * cy + (-qz * cx + qx * cz)), lz = dz + 2 * (qw * cz + (-qx * cy + qy * cx));
    if (Math.abs(lx) > box.half[0] || Math.abs(ly) > box.half[1] || Math.abs(lz) > box.half[2]) continue;
    // the box's world y extent: |R row y| . half
    const r1 = 2 * (qx * qy + qw * qz), r2 = 1 - 2 * (qx * qx + qz * qz), r3 = 2 * (qy * qz - qw * qx);
    const top = box.centre[1] + Math.abs(r1) * box.half[0] + Math.abs(r2) * box.half[1] + Math.abs(r3) * box.half[2];
    if (top > (lifted ?? y)) lifted = top;
  }
  return lifted;
}

/** The new ground's height law, as the page's terrain field (`clientGround`) reads a collider: 0 off the lattice. */
export const devGroundHeight = (ground: DevGround): ((x: number, z: number) => number) => (x, z) => x < ground.x || z < ground.z || x > ground.x + ground.size || z > ground.z + ground.size ? 0 : terrainTileHeight(ground, x, z);

/**
 * The in-page server's half of a ground swap: the new heightfield (in `held`'s scope, the last swap's going), the new
 * height query, and every player under it lifted onto it (`place`: the wire counts it and the client snaps).
 */
export function swapDevGround(physics: Physics, owner: Scope, held: { scope: Scope | null }, ground: DevGround, ports: {
  readonly heightQuery: (heightAt: (x: number, z: number) => number) => void;
  readonly players: () => Iterable<readonly [string, { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly yaw: number }]>;
  readonly place: (at: { x: number; y: number; z: number; yaw: number }, player: string) => void;
}): void {
  const old = held.scope, scope = owner.child('devGround');
  swapTerrainCollider(physics, ground, scope);
  held.scope = scope; old?.dispose();
  const heightAt = (x: number, z: number): number => terrainTileHeight(ground, x, z, { boundary: 'clamp' });
  ports.heightQuery(heightAt);
  for (const [id, player] of ports.players()) {
    const y = liftedFeet(player.position.x, player.position.y, player.position.z, heightAt, []);
    if (y !== null) ports.place({ x: player.position.x, y, z: player.position.z, yaw: player.yaw }, id);
  }
}

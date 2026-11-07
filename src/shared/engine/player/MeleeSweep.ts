/**
 * MeleeSweep — the sword's world checks (Sword.ts, C1 / B5), asked of the physics world (src/shared/engine/physics/query.ts,
 * PHYSICS.md P5) and kept free of three.js so they are unit-tested against a small Rapier world
 * (test/melee-sweep.test.ts).
 *
 *   bladeBlocked(physics, eye, point, exclude?) → true when a world surface (a wall, the wreck's hull, a trunk, a rock,
 *     the terrain) lies on the segment eye → hit point short of BLADE_SLACK m before the point: no hits through a wall.
 *     The wreck's hold is real floors and walls now, so fighting inside it needs no exemption.
 *   bladeContact(physics, eye, dir, len, exclude?) → where the blade tip's ray first meets a hard world surface within
 *     `len` m, and the clang it makes (`clangOf`), or null: open air, soft ground (the blade sinks into sand / grass
 *     without a clang), an invisible chunk edge, a body.
 *
 * `physics` null (before boot, a node test that builds none): nothing is ever hit — never blocked, no contact.
 * `exclude`: the swinger's own capsule (Player.motor.collider).
 */
import type { Collider } from '@dimforge/rapier3d-simd';
import type { Physics } from '../physics/Physics';
import { castRay, lineOfSight, type Hit } from '../physics/query';
import type { Material } from '../physics/surface';

interface Vec3 { x: number; y: number; z: number }

/** m before the hit point where a surface no longer blocks (the target's own body, grass under a crab's belly) */
export const BLADE_SLACK = 0.3;

export function bladeBlocked(physics: Physics | null, eye: Vec3, point: Vec3, exclude?: Collider): boolean {
  return physics !== null && !lineOfSight(physics, eye, point, BLADE_SLACK, exclude);
}

/**
 * What the blade makes of a surface: `stone` — a ringing clang and sparks (stone, rock, metal, shell); `wood` — a dull
 * thud and splinters (wood, planks); null — no contact (soft ground, water, flesh, the invisible chunk edge).
 */
export type Clang = 'stone' | 'wood';
const CLANG: Record<Material, Clang | null> = {
  stone: 'stone', rock: 'stone', metal: 'stone', shell: 'stone',
  wood: 'wood', planks: 'wood', felt: 'wood',
  sand: null, wetSand: null, grass: null, water: null, ground: null, edge: null, flesh: null, earth: null,
};
export function clangOf(m: Material): Clang | null { return CLANG[m]; }

export interface BladeContact { hit: Hit; clang: Clang }

export function bladeContact(physics: Physics | null, eye: Vec3, dir: Vec3, len: number, exclude?: Collider): BladeContact | null {
  if (physics === null) return null;
  const hit = castRay(physics, eye, dir, len, undefined, exclude);
  if (hit === null) return null;
  const clang = clangOf(hit.material);
  return clang === null ? null : { hit, clang };
}

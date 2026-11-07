/**
 * The game's physics queries (PHYSICS.md §Architecture): every collision question the game asks goes through here —
 * floors under a point, what a ray / bolt / blade meets, whether one point sees another. Each answer carries what
 * was hit: the point, the surface normal, the distance, its material (bolts stick in wood, glance off stone; impact
 * sounds and dust by material) and its owner (the piece, door or animal behind the collider).
 */
import type { Ball, Collider, Ray } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { GROUP, queryGroups, type GroupName } from './groups';
import { tagOf, type Material } from './surface';

interface Vec3 { x: number; y: number; z: number }

/** First world contact through at most four invisible edge strips. Radius zero casts a segment; positive radius sweeps a ball.
 * Distance stays relative to the original start. The caller supplies the actual physics owner. */
export function worldHit(physics: Physics, a: Vec3, b: Vec3, radius: number): Hit | null {
  let from = a, skip: Hit['collider'] | undefined, travelled = 0;
  for (let pass = 0; pass < 4; pass++) {
    const hit = radius > 0 ? sweepBall(physics, from, b, radius, undefined, skip) : castSegment(physics, from, b, undefined, skip);
    if (hit?.material !== 'edge') { if (hit) hit.distance += travelled; return hit; }
    travelled += hit.distance; from = hit.point; skip = hit.collider;
  }
  return null;
}

export interface Hit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  material: Material;
  owner: unknown;
  collider: Collider;
}

const WORLD: readonly GroupName[] = ['WORLD'];
const rays = new WeakMap<Physics, Ray>();
const rayOf = (physics: Physics): Ray => {
  let ray = rays.get(physics);
  if (!ray) { ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }); rays.set(physics, ray); }
  return ray;
};

/**
 * The top of the first world surface (terrain, deck, floor, rock) straight below (x, fromY, z), within `maxDrop`;
 * undefined when there is none. `exclude`: a collider the ray passes through (the caller's own body).
 */
export function floorBelow(physics: Physics, x: number, z: number, fromY: number, maxDrop: number, exclude?: Collider, only?: (collider: Collider) => boolean): number | undefined {
  const ray = rayOf(physics);
  ray.origin.x = x; ray.origin.y = fromY; ray.origin.z = z;
  ray.dir.x = 0; ray.dir.y = -1; ray.dir.z = 0;
  const hit = physics.castRay(ray, maxDrop, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(WORLD), exclude, undefined, only);
  return hit ? fromY - hit.timeOfImpact : undefined;
}

/**
 * The first thing along the ray from `origin` in direction `dir` (unit length) within `maxDist`, among the kinds in
 * `sees` (default: the world — terrain, structures, props, trunks). Null when nothing is hit.
 */
export function castRay(physics: Physics, origin: Vec3, dir: Vec3, maxDist: number, sees: readonly GroupName[] = WORLD, exclude?: Collider): Hit | null {
  const ray = rayOf(physics);
  ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
  ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
  const hit = physics.castRayAndGetNormal(ray, maxDist, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(sees), exclude);
  if (!hit) return null;
  const t = hit.timeOfImpact, tag = tagOf(hit.collider);
  return {
    point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
    normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    distance: t, material: tag?.material ?? 'wood', owner: tag?.owner ?? null, collider: hit.collider,
  };
}

/** The first world hit on the segment a → b (null: the segment is clear). */
export function castSegment(physics: Physics, a: Vec3, b: Vec3, sees: readonly GroupName[] = WORLD, exclude?: Collider): Hit | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  return castRay(physics, a, { x: dx / len, y: dy / len, z: dz / len }, len, sees, exclude);
}

/** Does `from` see `to`? — no world surface on the segment between them, short of `slack` metres before `to` (the target's own body). */
export function lineOfSight(physics: Physics, from: Vec3, to: Vec3, slack = 0.3, exclude?: Collider): boolean {
  const hit = castSegment(physics, from, to, WORLD, exclude);
  if (!hit) return true;
  return hit.distance >= Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) - slack;
}

const balls = new WeakMap<Physics, Map<number, Ball>>();

/**
 * Sweep a ball of `radius` from `a` to `b` (a bolt's flight over one step, a thrown thing): the first world surface it
 * touches, with the ball's centre at `point` when it does. Null when the sweep is clear.
 */
export function sweepBall(physics: Physics, a: Vec3, b: Vec3, radius: number, sees: readonly GroupName[] = WORLD, exclude?: Collider): Hit | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  let byR = balls.get(physics);
  if (!byR) { byR = new Map(); balls.set(physics, byR); }
  let ball = byR.get(radius);
  if (!ball) { ball = new physics.R.Ball(radius); byR.set(radius, ball); }
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  const hit = physics.world.castShape(a, { x: 0, y: 0, z: 0, w: 1 }, dir, ball, 0, len, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(sees), exclude);
  if (!hit) return null;
  const t = hit.time_of_impact, tag = tagOf(hit.collider);
  return {
    point: { x: a.x + dir.x * t, y: a.y + dir.y * t, z: a.z + dir.z * t },
    normal: { x: hit.normal2.x, y: hit.normal2.y, z: hit.normal2.z },
    distance: t, material: tag?.material ?? 'wood', owner: tag?.owner ?? null, collider: hit.collider,
  };
}

/** Materials a bolt / arrow sticks in; anything else it glances off (stone, rock, metal, shell). */
export function sticksIn(m: Material): boolean {
  return m === 'wood' || m === 'planks' || m === 'flesh' || m === 'grass' || m === 'sand' || m === 'wetSand' || m === 'ground' || m === 'felt' || m === 'earth';
}

/** Load-time upright capsule admission against current collider poses, including a just-restored deck, without stepping the world. */
export function canStandAt(physics: Physics, feet: Vec3, dimensions: { radius: number; height: number; blockedBy?: readonly GroupName[] }, floorOwner: unknown, exclude?: Collider): boolean {
  if (![feet.x, feet.y, feet.z, dimensions.radius, dimensions.height].every(Number.isFinite)
    || dimensions.radius <= 0 || dimensions.height < dimensions.radius * 2) return false;
  const mask = [...new Set(dimensions.blockedBy ?? WORLD)].reduce((bits, group) => bits + GROUP[group], 0) << 16;
  const { R } = physics, shape = new R.Capsule(Math.max(0.01, dimensions.height / 2 - dimensions.radius), dimensions.radius);
  const centre = { x: feet.x, y: feet.y + dimensions.height / 2 + 0.03, z: feet.z }, rotation = { x: 0, y: 0, z: 0, w: 1 };
  const ray = new R.Ray({ x: feet.x, y: feet.y + 0.1, z: feet.z }, { x: 0, y: -1, z: 0 });
  const admitted = { clear: true, floor: false };
  // Direct collider queries use the restored transforms even before Rapier updates its next-step broad phase.
  physics.world.forEachCollider(collider => {
    if (!collider.isEnabled() || collider.isSensor() || collider.handle === exclude?.handle || (collider.collisionGroups() & mask) === 0) return;
    if (collider.intersectsShape(shape, centre, rotation)) admitted.clear = false;
    if (tagOf(collider)?.owner === floorOwner) {
      const hit = collider.castRayAndGetNormal(ray, 0.15, true);
      if (hit !== null && hit.normal.y >= 0.99 && Math.abs(hit.timeOfImpact - 0.1) < 0.01) admitted.floor = true;
    }
  });
  return admitted.clear && admitted.floor;
}


/** Rebind the original parentless baked box without allocating or changing its state.
 * The tolerance and first-match order retain the native continuation's lookup. */
export function staticBoxCollider(physics: Physics, box: { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly yTop: number; readonly yBottom: number }): Collider | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  const found: Collider[] = [], cy = (box.yTop + box.yBottom) / 2, hy = (box.yTop - box.yBottom) / 2;
  physics.world.forEachCollider(collider => {
    const at = collider.translation(), half = collider.halfExtents();
    if (half !== null && collider.parent() === null && near(at.x, box.x) && near(at.y, cy) && near(at.z, box.z)
      && near(half.x, box.hw) && near(half.y, hy) && near(half.z, box.hd)) found.push(collider);
  });
  return found[0] ?? null;
}

/** Admission-only check for an enabled static ground collider. No simulation
 * tick or query-pipeline update is needed for newly admitted native terrain. */
export function hasStaticGround(physics: Physics): boolean {
  let found = false;
  physics.world.forEachCollider(collider => {
    const parent = collider.parent();
    if (collider.isEnabled() && !collider.isSensor() && (parent === null || parent.isFixed())
      && tagOf(collider)?.material === 'ground') found = true;
  });
  return found;
}

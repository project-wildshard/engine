/** Solid practice bodies for player movement, plus separate head/body hit volumes for shots and melee. */
import type { Ray } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { groups, queryGroups } from './groups';
import { tagCollider, tagOf } from './surface';

interface Vec3 { x: number; y: number; z: number }
interface TargetPart { target: object; headshot: boolean }

/** A dummy's colliders, switched as one: on only while its room is open (E300 — they sat live over the shard at Y 900). */
export interface TrainingTargetBodies { setEnabled: (on: boolean) => void }

/** The body and the separate head are static HITBOX colliders; only the shared physics layer imports Rapier. */
export function addTrainingTarget(physics: Physics, target: object, x: number, y: number, z: number): TrainingTargetBodies {
  const { R, world } = physics;
  // A CREATURE-group static body blocks the player's character controller without becoming WORLD geometry
  // (which would make each dummy obscure its own line-of-sight check). The hitboxes remain projectile-query only.
  const solid = world.createCollider(R.ColliderDesc.cuboid(0.38, 0.86, 0.29)
    .setTranslation(x, y + 0.9, z).setCollisionGroups(groups('CREATURE')));
  tagCollider(solid, 'wood', target);
  const colliders = [solid];
  const parts = [
    { x, y: y + 0.83, z, hx: 0.44, hy: 0.58, hz: 0.3, headshot: false },
    { x, y: y + 1.57, z, hx: 0.23, hy: 0.21, hz: 0.22, headshot: true },
  ];
  for (const p of parts) {
    const desc = R.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setCollisionGroups(groups('HITBOX'));
    const collider = world.createCollider(desc);
    const owner: TargetPart = { target, headshot: p.headshot };
    tagCollider(collider, 'wood', owner);
    colliders.push(collider);
  }
  return { setEnabled: (on) => { for (const c of colliders) c.setEnabled(on); } };
}

const rays = new WeakMap<Physics, Ray>();

/** First training dummy struck, using Rapier's real collider query rather than a visual bounding-box approximation. */
export function trainingTargetRaycast(physics: Physics, origin: Vec3, dir: Vec3, maxDist: number): { target: object; point: Vec3; distance: number; headshot: boolean } | null {
  let ray = rays.get(physics);
  if (!ray) { ray = new physics.R.Ray(origin, dir); rays.set(physics, ray); }
  ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
  ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
  const hit = physics.world.castRayAndGetNormal(ray, maxDist, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(['HITBOX'], 'PROJECTILE'));
  if (!hit) return null;
  const owner = tagOf(hit.collider)?.owner;
  if (typeof owner !== 'object' || owner === null || !('target' in owner) || !('headshot' in owner)) return null;
  const part = owner as TargetPart;
  const distance = hit.timeOfImpact;
  return { target: part.target, point: { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance, z: origin.z + dir.z * distance }, distance, headshot: part.headshot };
}

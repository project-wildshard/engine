import type { Vector3 } from 'three';
import type { TargetHit } from '../../../client/engine/combat/types';

/** Authored parts replace the legacy head bonus. A shield consumes no damage roll. */
export function rangedTargetDamage(hit: TargetHit, distance: number): number {
  if (hit.multiplier === 0) return 0;
  if (hit.multiplier === undefined) return hit.animal.damageFor(hit.headshot, distance);
  return hit.animal.damageFor(false, distance) * hit.multiplier;
}
/** Keep the released three-argument call when no part was authored. */
export function applyTargetDamage(hit: TargetHit, damage: number, direction: Vector3): boolean {
  if (hit.multiplier === 0) return false;
  return hit.part === undefined ? hit.animal.applyDamage(damage, hit.point, direction)
    : hit.animal.applyDamage(damage, hit.point, direction, hit.part);
}

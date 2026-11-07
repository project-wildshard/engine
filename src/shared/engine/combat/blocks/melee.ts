import type { AimCommand } from '../../input/commands';
import type { Vector3 } from 'three';
import type { CombatPipeline, DamageDealt, DamageRequest } from '../pipeline';

/** Public contact block: callers choose the move and target; combat owns cover and damage rules. */
export function melee(combat: CombatPipeline): { hit: (req: DamageRequest) => DamageDealt | null; dispose: () => void } {
  return { hit: (req) => combat.hit(req), dispose: () => undefined };
}

/** Aim block shared by custom and family weapons; no camera or scene dependency. */
export function aimRay(command: () => AimCommand): {
  solve: (origin: Vector3, dir: Vector3) => Vector3; dispose: () => void;
} {
  return { solve: (origin, dir) => { const aim = command(); origin.copy(aim.origin); return dir.copy(aim.direction); }, dispose: () => undefined };
}

export function fovForAspect(base: number, aspect: number): number {
  return aspect >= 1 ? base : 360 / Math.PI * Math.atan(Math.tan(base * Math.PI / 360) / Math.sqrt(aspect));
}

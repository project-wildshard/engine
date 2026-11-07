import { Vector3 } from 'three';
import type { Physics } from '../physics/Physics';
import { lineOfSight } from '../physics/query';

export interface ReachActor {
  readonly position: { x: number; y: number; z: number }; readonly scale: number;
  readonly dims: { bodyY: number; bodyRadius: number };
  headWorld: (out: Vector3) => Vector3;
}
const from = new Vector3(), to = new Vector3(), head = new Vector3();
/** Same chest/aim-point/slack query in every level, evaluated at the contact frame. */
export function canReach(actor: ReachActor, target: { x: number; y: number; z: number }, physics: Physics | null): boolean {
  if (physics === null) return true;
  const bodyY = actor.dims.bodyY * actor.scale;
  to.copy(actor.position); to.y += bodyY;
  if (bodyY > 0.9) to.y = (to.y + actor.headWorld(head).y) / 2;
  from.set(target.x, target.y + 1.2, target.z);
  return lineOfSight(physics, from, to, actor.dims.bodyRadius * actor.scale + 0.1);
}

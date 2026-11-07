import type { Vector3 } from 'three';
import type { Events } from '../events/events';
import type { AimTarget } from '../../../client/engine/player/AimTargets';
import type { TargetHit, Targets } from '../../../client/engine/combat/types';

export interface RayTargets { origin: Vector3; dir: Vector3; maxDist: number; hit: TargetHit | null }
declare module '../../../client/engine/events/maps' {
  interface AskMap {
    'combat.targets.ray': [RayTargets, RayTargets];
    'combat.aimTargets': [readonly AimTarget[], readonly AimTarget[]];
  }
}
/** An authored target source may refine the nearer creature hit. Practice uses its own isolated targets. */
export function authoredTargets(events: Events, creatures: Targets, practice: () => Targets | null): Targets {
  return { raycast: (origin, dir, maxDist) => {
    const room = practice();
    if (room !== null) return room.raycast(origin, dir, maxDist);
    return events.ask('combat.targets.ray', { origin, dir, maxDist, hit: creatures.raycast(origin, dir, maxDist) }).hit;
  } };
}

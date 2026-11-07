import type { NetClient } from '@wildshard/engine/net/client';
import { FIXED_STEP } from '@wildshard/engine/core/fixedStep';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';
import type { NeighbourCreature, NeighbourRegion } from './neighbourLife';

/** How long a creature's row has to move for a view to read a walking speed from it, in ticks. */
const SPEED_SPAN = 6;

/** What a view keeps of a creature between frames, to read a speed off its row. */
interface Trail { tick: number; x: number; z: number; speed: number }

/** A cell's creatures off the wire (E6): the rows a page's `NeighbourLife` draws once the flip takes the region's sim away.
 * `renderTick` is `client.present()`'s. A row has no strafe: a view walks it forward. */
export function netNeighbourRegion(client: NetClient, renderTick: () => number): NeighbourRegion {
  const trails = new Map<string, Trail>();
  const read = (id: string): NeighbourCreature | undefined => {
    for (const [handle, info] of client.entities) {
      if (info.id !== id || info.cls.cls !== ANIMAL_CLASS.cls) continue;
      const tick = renderTick(), row = client.interpolator.fields(handle, tick);
      if (row === null) return undefined;
      const { x, y, z, yaw, attackT, alive } = row, scale = info.initial['scale'], state = ANIMAL_STATES.find(entry => entry === row['state']);
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof yaw !== 'number' || state === undefined || typeof scale !== 'number') return undefined;
      const trail = trails.get(id) ?? { tick, x, z, speed: 0 };
      if (tick - trail.tick >= SPEED_SPAN) Object.assign(trail, { speed: Math.hypot(x - trail.x, z - trail.z) / ((tick - trail.tick) * FIXED_STEP), tick, x, z });
      trails.set(id, trail);
      return { position: { x, y, z }, yaw, scale, speed: trail.speed, strafe: 0, alive: alive === true, attackPhase: attackT === 0 ? -1 : Number(attackT), state };
    }
    return undefined;
  };
  return { host: { entities: { get: read } } };
}

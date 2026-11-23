import { Vector3 } from 'three';
import { CREATURE_SIZES, creatureScale } from '@wildshard/format/creatureSizes';
import { creatureSkinBounds } from '@wildshard/format/creatureSkinBounds';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { SimSpawn } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';

/** Raw placement validation runs before this compilation. One final scale goes
 * into the existing actor, save/net metadata, motion capsule and bound skin. */
export function sizeCreatureSpawns(spawns: readonly SimSpawn[], rows: ShardRows, placements: ShardCreatures['spawns']): SimSpawn[] {
  const species = new Map(rows.species.map(row => [row.id, row.body])), sources = new Map(placements.map(row => [row.id, row.species]));
  return spawns.map(spawn => {
    const body = species.get(sources.get(spawn.id) ?? '');
    if (body === undefined) return spawn;
    const scale = creatureScale(body, spawn.scale);
    return scale === spawn.scale ? spawn : { ...spawn, scale };
  });
}

/** The actual admitted mesh and rest hit envelope supplement declared dimensions.
 * A small claimed dimension cannot admit a giant whose real rig exceeds its cap. */
export function checkCreatureHeight(body: CreatureBody, bytes: Uint8Array, actor: AnimalSim, pose: CreatureVolumePose | undefined,
  skinBounds: (bytes: Uint8Array) => { lower: number; upper: number } = creatureSkinBounds): void {
  const cap = CREATURE_SIZES[body.size].maxHeight;
  if (cap === undefined) return;
  const bounds = skinBounds(bytes);
  let lower = bounds.lower * actor.scale, upper = bounds.upper * actor.scale;
  const rear = new Vector3(), front = new Vector3();
  for (const [index, volume] of (pose?.volumes ?? []).entries()) {
    pose?.segment(index, rear, front);
    lower = Math.min(lower, rear.y - actor.position.y - volume.radius, front.y - actor.position.y - volume.radius);
    upper = Math.max(upper, rear.y - actor.position.y + volume.radius, front.y - actor.position.y + volume.radius);
  }
  if (upper - lower > cap + 1e-6) throw new Error(`creature ${actor.entityId}: actual giant height exceeds ${cap} m`);
}

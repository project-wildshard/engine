import type { Vector3 } from 'three';
import type { Actor, CombatPipeline } from '../../../shared/engine/combat/pipeline';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { engineString } from '../../../shared/engine/strings';

interface FallingCreature { position: Vector3; combatActor: () => Actor }
/**
 * A declared world death plane runs on the body clock; the four original worlds declare none. The one law for a creature
 * under `world.killY`: it dies through the combat pipeline's fall (`combat.fall`, the world's `fallCause` or "out of world").
 * AnimalManager calls it after each body update; a renderer-free headless runtime calls the same function on its SimHost
 * bodies (Sky Reach's runtime/flock.ts), so the browser and headless share it.
 */
export function killBelowWorld(animal: FallingCreature, world: LevelSpec['world'], combat: CombatPipeline): boolean {
  if (world === undefined) return false;
  if (!Number.isFinite(world.killY)) throw new Error('World killY must be finite');
  if (animal.position.y >= world.killY) return false;
  return combat.fall(animal.combatActor(), animal.position, world.fallCause ?? { kind: 'out-of-world', label: engineString('s_out_of_world') })?.killed ?? false;
}

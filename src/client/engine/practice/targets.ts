import type { Actor } from '../../../shared/engine/combat/pipeline';
import type { TargetAnimal } from '../combat/types';

/** Practice bodies keep their armour, floats and animation reactions for pipeline hits too. */
export function practiceActor(target: TargetAnimal, id: string): Actor {
  return {
    id, tags: ['actor.practice'], state: [], attributes: { health: 100, maxHealth: 100 },
    get alive() { return target.alive; },
    applyDamage: (req) => {
      const killed = target.applyDamage(req.amount, req.point, req.dir);
      if (req.stagger !== undefined) target.stagger?.(req.dir, req.stagger);
      return killed;
    },
  };
}

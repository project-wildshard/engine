import type { Actor } from '@wildshard/engine/combat/pipeline';
import type { LevelContext } from '@wildshard/engine/level/context';

export const DEATH_ORDER = { spine: 10, ecology: 20, keepsakes: 30, loot: 40 } as const;
export interface CreatureDeathSource { combatActor: () => Actor }

/** Actor ids identify a species, so resolve the exact instance rather than paying the first of its kind. */
export function onCreatureDeath<A extends CreatureDeathSource>(ctx: Pick<LevelContext, 'on'>,
  animals: () => readonly A[], run: (animal: A) => void, order: number): void {
  ctx.on('actor.died', ({ actor }) => {
    const animal = animals().find((body) => body.combatActor() === actor);
    if (animal !== undefined) run(animal);
  }, { order });
}

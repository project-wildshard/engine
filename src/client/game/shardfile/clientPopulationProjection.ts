import type { ShardContext } from '../plugin/context';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { PopulationProjection } from '../population/projection';

/** Client-only composition at the existing animals-built/world-update boundary.
 * Resolves the actual world services; the declaration supplies data only. */
export function installPopulationProjection(ctx: ShardContext, input: unknown): void {
  const shell = ctx.game.runtime, world = shell?.world;
  if (shell === undefined || world === undefined || world === null) throw new Error('Population projection requires its world');
  const previousReady = shell.hooks.animalsBuilt, previousUpdate = shell.hooks.worldUpdate;
  let projection: PopulationProjection | null = null;
  const ready = async (animals: RowBodiesView): Promise<void> => {
    await previousReady?.(animals);
    projection = await new PopulationProjection(animals, world.game.scene, world.sky, ctx.scope, input, world.game.rootScene).build();
    shell.objects['enemies'] = projection;
  };
  const update = (dt: number, time: number): void => { previousUpdate?.(dt, time); projection?.update(dt, time, world.player.position); };
  shell.hooks.animalsBuilt = ready; shell.hooks.worldUpdate = update;
  ctx.scope.onDispose(() => {
    if (shell.hooks.animalsBuilt === ready) {
      if (previousReady === undefined) delete shell.hooks.animalsBuilt; else shell.hooks.animalsBuilt = previousReady;
    }
    if (shell.hooks.worldUpdate === update) {
      if (previousUpdate === undefined) delete shell.hooks.worldUpdate; else shell.hooks.worldUpdate = previousUpdate;
    }
    if (shell.objects['enemies'] === projection) delete shell.objects['enemies'];
  });
}

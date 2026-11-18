// SHARD-SOURCE SS-GP1/SS-GP3: the page's play context for one stay in a grid data cell. A one-shard page installs its quest
// views and declared HUD on its own context; a grid copy has none of its own, so each stay gets the page's context with its
// verbs (systems, HUD, Bag, events) bound to the stay's scope, the way `regionalRuntime.ts` builds an entered runtime's. Its
// system ids carry the cell, so a copy of the home's own product (or a second copy) never clashes with the home's systems.
import type { Scope } from '@wildshard/engine/app/scope';
import { createLevelInstallation } from '@wildshard/engine/level/installation';
import { shardContext, type ShardContext } from '../plugin/context';

/** The page's context, bound to `stay`. */
export function stayContext(page: ShardContext, stay: Scope, instance: string): ShardContext {
  const level = createLevelInstallation(page.app, stay, page.app.levelAdapters, () => page.progress).context;
  const scoped: typeof level = { ...level, get progress() { return level.progress; },
    system: (spec) => { level.system({ ...spec, id: `grid.${instance}.${spec.id}` }); } };
  return shardContext(scoped, page.manifest, page.game, page.product);
}

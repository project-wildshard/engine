import { HEADLESS_CONTEXT_SECTIONS, headlessSections } from '@wildshard/format/headlessSections';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';

/**
 * SHARD-COMPAT HS6: the server reads its plan from `server/plan` only (`serverPlan.ts`), but format's headless list still
 * names only the page's `client/plan`, so a headless worker got no plan and no portal ride, and a portal director refused
 * "requires a native observation owner". The engine forwards `server/plan` beside format's list until format names it.
 */
const SERVER_PLAN = 'server/plan';
/** Format's headless context plus the server's own plan, as the worker and its host read them. */
export function engineHeadlessSections(input?: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const sections = headlessSections(input);
  if (input?.has(SERVER_PLAN) === true) sections.set(SERVER_PLAN, input.get(SERVER_PLAN));
  return sections;
}

/** Forward the complete verified native context, including targets and plan selection (a `ShardFolder`'s reader takes
 *  only its section names, so this lists them here rather than through format's `HeadlessSectionSource`). */
export function folderHeadlessSections(product: ShardFolder): Map<string, unknown> {
  return engineHeadlessSections(new Map([...HEADLESS_CONTEXT_SECTIONS, SERVER_PLAN].filter(name => (product.has as (name: string) => boolean)(name)).map(name => [name, (product.section as (name: string) => unknown)(name)])));
}

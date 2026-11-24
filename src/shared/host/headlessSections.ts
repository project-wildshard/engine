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
  // QA-FEEDBACK-2026-11-23-b row 41: SDK 0.4.29's `wildshard check` narrows its sections by format's list before the engine
  // sees them, so `server/plan` never arrives there (Nine's TS21 check, Ring 3 run 45335242015). The SDK writes
  // `server/plan` as the same bytes as `client/plan` (HS6d), so the page's copy stands in until the format names it.
  const plan = input?.get(SERVER_PLAN) ?? input?.get('client/plan');
  if (plan !== undefined) sections.set(SERVER_PLAN, plan);
  return sections;
}

/** Forward the complete verified native context, including targets and plan selection (a `ShardFolder`'s reader takes
 *  only its section names, so this lists them here rather than through format's `HeadlessSectionSource`). */
export function folderHeadlessSections(product: ShardFolder): Map<string, unknown> {
  return engineHeadlessSections(new Map([...HEADLESS_CONTEXT_SECTIONS, SERVER_PLAN].filter(name => (product.has as (name: string) => boolean)(name)).map(name => [name, (product.section as (name: string) => unknown)(name)])));
}

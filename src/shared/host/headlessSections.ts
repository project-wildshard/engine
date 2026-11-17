import * as sections from '@wildshard/format/headlessSections';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';

/** The headless context sections and how they cross the worker boundary: format's law (SDK-SPLIT SP5c, Q35). */
export const HEADLESS_CONTEXT_SECTIONS: typeof sections.HEADLESS_CONTEXT_SECTIONS = sections.HEADLESS_CONTEXT_SECTIONS;
export const headlessSections: typeof sections.headlessSections = sections.headlessSections;

/** Forward the complete verified native context, including targets and plan selection (a `ShardProduct`'s reader takes
 *  only its section names, so this lists them here rather than through format's `HeadlessSectionSource`). */
export function productHeadlessSections(product: ShardProduct): Map<string, unknown> {
  return headlessSections(new Map(HEADLESS_CONTEXT_SECTIONS.filter(name => product.has(name)).map(name => [name, product.section(name)])));
}

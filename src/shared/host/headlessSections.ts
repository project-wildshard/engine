import * as sections from '@wildshard/format/headlessSections';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';

/** The headless context sections and how they cross the worker boundary: format's law (SDK-SPLIT SP5c, Q35). */
export const HEADLESS_CONTEXT_SECTIONS: typeof sections.HEADLESS_CONTEXT_SECTIONS = sections.HEADLESS_CONTEXT_SECTIONS;
export const headlessSections: typeof sections.headlessSections = sections.headlessSections;

/** Forward the complete verified native context, including targets and plan selection (a `ShardFolder`'s reader takes
 *  only its section names, so this lists them here rather than through format's `HeadlessSectionSource`). */
export function folderHeadlessSections(product: ShardFolder): Map<string, unknown> {
  return headlessSections(new Map(HEADLESS_CONTEXT_SECTIONS.filter(name => product.has(name)).map(name => [name, product.section(name)])));
}

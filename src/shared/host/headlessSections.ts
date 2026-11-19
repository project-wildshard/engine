import { HEADLESS_CONTEXT_SECTIONS, headlessSections } from '@wildshard/format/headlessSections';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';

/** Forward the complete verified native context, including targets and plan selection (a `ShardFolder`'s reader takes
 *  only its section names, so this lists them here rather than through format's `HeadlessSectionSource`). */
export function folderHeadlessSections(product: ShardFolder): Map<string, unknown> {
  return headlessSections(new Map(HEADLESS_CONTEXT_SECTIONS.filter(name => product.has(name)).map(name => [name, product.section(name)])));
}

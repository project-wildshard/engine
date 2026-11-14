import { parsePlatformDataSection } from '@wildshard/format/platformDataSections';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';

/** One defining context catalogue for author-build intake and worker transport. */
export const HEADLESS_CONTEXT_SECTIONS = ['view/modules', 'sim/scripts', 'actors/spawn-scripts', 'actors/return-scripts', 'actors/moves', 'actors/strikes', 'world/targets', 'sim/runtime-plan', 'sim/bodies'] as const;

/** Explicit admitted decision/move context crossing the worker boundary; no ABI is inferred from bytes. */
export function headlessSections(input?: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const sections = new Map<string, unknown>();
  for (const name of HEADLESS_CONTEXT_SECTIONS) {
    if (input?.has(name) === true) sections.set(name, parsePlatformDataSection(name, input.get(name)));
  }
  return sections;
}
/** Forward the complete verified native context, including targets and plan selection. */
export function folderHeadlessSections(product: ShardFolder): Map<string, unknown> {
  return headlessSections(new Map(HEADLESS_CONTEXT_SECTIONS.filter(name => product.has(name)).map(name => [name, product.section(name)])));
}

import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';

/** @deprecated ONE-FORMAT OF10c4: whether a shard's material graphs keep their declared ceilings (a runtime or a declared
 * page; admission gives those to our own products alone). Opened, any shard could compile unbounded GPU graphs; the
 * shard's tier GPU limits (graph nodes, textures, passes) replace it. */
export function dangerousUnbudgetedMaterialGraph(source: Pick<Shardfile, 'runtime'> & Partial<Pick<Shardfile, 'questHost'>>): boolean {
  return source.runtime !== null || hasDeclaredClientPage(source);
}

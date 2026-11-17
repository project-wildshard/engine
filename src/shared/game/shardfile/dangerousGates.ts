import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';

/**
 * ONE-FORMAT OF10b: the four dangerous gates of the ledger (`gates.ts`, docs/GATES.md), each named for its harm. Each is
 * deprecated: its OF10c row replaces it with the budget tier its comment names, then deletes it. A gate site calls one of
 * these; nothing else reads the provenance option for these capabilities.
 */
interface Provenance { readonly firstParty?: boolean }

/** @deprecated ONE-FORMAT OF10c1: a declared `runtime` binds a native engine module with no CPU, memory or bandwidth limit
 * of its own; the shard's tier CPU and memory limits, metered on that module, replace this provenance check. */
export function dangerousUnbudgetedRuntime(reader: Provenance): boolean { return reader.firstParty === true; }

/** @deprecated ONE-FORMAT OF10c2: native page features run page code paths outside the cost admission charged; the
 * shard's tier CPU and memory limits, charged per page feature, replace this provenance check. */
export function dangerousUnbudgetedPageFeatures(reader: Provenance): boolean { return reader.firstParty === true; }

/** @deprecated ONE-FORMAT OF10c3: a runtime that owns the page's world, audio or stages escapes admission; the shard's
 * tier CPU and memory limits, with the owned stages metered as the runtime's, replace this provenance check. */
export function dangerousRuntimeOwnership(reader: Provenance): boolean { return reader.firstParty === true; }

/** @deprecated ONE-FORMAT OF10c4: whether a shard's material graphs keep their declared ceilings (a runtime or a declared
 * page; admission gives those to our own products alone). Opened, any shard could compile unbounded GPU graphs; the
 * shard's tier GPU limits (graph nodes, textures, passes) replace it. */
export function dangerousUnbudgetedMaterialGraph(source: Pick<Shardfile, 'runtime'> & Partial<Pick<Shardfile, 'questHost'>>): boolean {
  return source.runtime !== null || hasDeclaredClientPage(source);
}

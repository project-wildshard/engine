import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';

/**
 * ONE-FORMAT OF10b: the dangerous gates of the ledger (`gates.ts`, docs/GATES.md), each named for its harm. Each is
 * deprecated: its OF10c row replaces it with the budget tier its comment names, then deletes it. A gate site calls one of
 * these; nothing else reads the provenance option for these capabilities.
 */
/** ONE-FORMAT OF10a7: the provenance option survives only as these dangerous gates' input. Nothing else reads it; each
 * OF10c row deletes one reader, and the last deletes this and `dangerousTrust`. */
export interface DangerousProvenance { readonly dangerousGrant?: boolean }
type Provenance = DangerousProvenance;
/** The host's grant of the dangerous capabilities (runtime, page features, ownership) until OF10c budgets them. */
export function dangerousTrust(granted = true): DangerousProvenance { return granted ? { dangerousGrant: true } : {}; }

/** @deprecated ONE-FORMAT OF10c3: a runtime that owns the page's world, audio or stages escapes admission; the shard's
 * tier CPU and memory limits, with the owned stages metered as the runtime's, replace this provenance check. */
export function dangerousRuntimeOwnership(reader: Provenance): boolean { return reader.dangerousGrant === true; }

/** @deprecated ONE-FORMAT OF10c4: whether a shard's material graphs keep their declared ceilings (a runtime or a declared
 * page; admission gives those to our own products alone). Opened, any shard could compile unbounded GPU graphs; the
 * shard's tier GPU limits (graph nodes, textures, passes) replace it. */
export function dangerousUnbudgetedMaterialGraph(source: Pick<Shardfile, 'runtime'> & Partial<Pick<Shardfile, 'questHost'>>): boolean {
  return source.runtime !== null || hasDeclaredClientPage(source);
}

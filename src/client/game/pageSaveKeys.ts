import * as v from 'valibot';
import type { SaveKeyDef, SaveStore } from '@wildshard/engine/saves/store';

/**
 * The keys of a page's old saves that a page may not open. Settings takes a file from before the flip key by key against what its store has
 * defined, and a key it doesn't know is left out of the import. A file holds every shard, so a Driftwood page meets Pine's doors. Every page
 * stubs these, whichever shard it's on, and leaves their shape to whatever reads them: a server, or a page on the shard that does.
 */
const FILE_KEYS: readonly SaveKeyDef<unknown>[] = ['platform.buildings', 'platform.continuation', 'platform.encounters', 'platform.grid-position', 'platform.region', 'platform.runtime-logical', 'platform.runtime-state']
  .map(key => ({ key, scope: 'shard', version: 1, schema: v.unknown(), initial: (): unknown => null, stub: true }));

/** Before a player can reach Settings. */
export function definePageSaveKeys(store: Pick<SaveStore, 'define'>): void { for (const key of FILE_KEYS) store.define(key); }

import type { SaveStore, SaveInstance, InstanceSaveKeyDef, InstanceSaveSlot } from '@wildshard/engine/saves/store';
import { catalogueDocument } from './grid/catalogueDocument';

/** Stable placement identity passed by the session, independent of cell or launch mode. */
export interface LocalSaveInstance { id: string; shard: string }
/** Bind shard-local state, migrating a slug only for its canonical first-party instance. Template copies start independent. */
export function instanceSave<T>(store: SaveStore, definition: InstanceSaveKeyDef<T>, identity: LocalSaveInstance): InstanceSaveSlot<T> {
  return store.instance(definition, instanceSaveIdentity(identity));
}
/** Resolve exactly the same durable namespace and legacy alias for reading, previewing and resetting either entry mode. */
export function instanceSaveIdentity(identity: LocalSaveInstance): SaveInstance {
  const canonical = catalogueDocument().placements.find((placement) => placement.instance === identity.id && placement.slug.replace(/^_/u, '') === identity.shard.replace(/^_/u, ''));
  return { id: identity.id, ...(canonical === undefined ? {} : { legacy: canonical.slug }) };
}

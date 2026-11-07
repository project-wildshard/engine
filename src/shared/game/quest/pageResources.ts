import { isJsonData } from '@wildshard/format/json';
import type { Scope } from '@wildshard/engine/app/scope';
import type { QuestPlaceAnchor } from '@wildshard/engine/world/interact/types';
import type { AmbientGroup } from '../ambient/flock';
/** Existing native page owners are published once under declared identities.
 * Content supplies anchor values and a concrete platform flock, never methods. */
export interface QuestPageWorld {
  readonly pois: Readonly<Record<string, { readonly anchors: Readonly<Record<string, QuestPlaceAnchor>> } | null>>;
  readonly flock: AmbientGroup | null;
}
const worlds = new WeakMap<Scope, Map<string, QuestPageWorld>>();
export function registerQuestPageWorld(scope: Scope, id: string, world: QuestPageWorld): void {
  const book = worlds.get(scope) ?? new Map<string, QuestPageWorld>();
  if (scope.disposed || book.has(id) || !isJsonData(world.pois)) throw new Error('Duplicate or disposed quest page world');
  book.set(id, world); worlds.set(scope, book); scope.onDispose(() => { book.delete(id); });
}
export function questPageWorld(scope: Scope, id: string): QuestPageWorld {
  const world = worlds.get(scope)?.get(id); if (scope.disposed || world === undefined) throw new Error('Missing entered quest world'); return world;
}

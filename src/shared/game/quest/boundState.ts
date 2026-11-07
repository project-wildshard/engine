import { Flags } from '@wildshard/engine/world/interact/flags';
import type { RuntimeFacts } from '../plugin/runtimeRows';
import type { Scope } from '@wildshard/engine/app/scope';
import type { QuestState } from '@wildshard/engine/quest/core';

interface QuestOwners { readonly flags: Map<string, Flags>; readonly facts: Map<string, RuntimeFacts>; readonly states: Map<string, QuestState> }
const owners = new WeakMap<Scope, QuestOwners>();
function entered(scope: Scope): QuestOwners {
  if (scope.disposed) throw new Error('Quest owners require a live entry');
  let book = owners.get(scope);
  if (book === undefined) {
    book = { flags: new Map(), facts: new Map(), states: new Map() }; owners.set(scope, book);
    // Retained retired scopes must not retain their old quest/world/ledger owners.
    scope.onDispose(() => { owners.delete(scope); });
  }
  return book;
}

/** Internal publication by the existing quest binder; never creates state or listeners. */
export function publishBoundQuest(scope: Scope, state: QuestState): void {
  entered(scope).states.set(state.def.id, state);
}

/** Borrow the original entered quest and its flags by id; disposed entries cannot be read. */
export function boundQuestState(scope: Scope, id: string): QuestState {
  const state = owners.get(scope)?.states.get(id);
  if (scope.disposed || state === undefined) throw new Error(`Quest ${id} is not bound in this entry`);
  return state;
}

/** Install the original flag book once in its entered scope, retaining its persisted level key. */
export function installBoundQuestFlags(scope: Scope, id: string, level: string): Flags {
  if (scope.disposed || id.length === 0 || level.length === 0) throw new Error('Quest flags require a live declared owner');
  const book = entered(scope), current = book.states.get(id)?.flags ?? book.flags.get(id);
  if (current !== undefined) {
    if (current.level !== level) throw new Error('Quest flag level differs from its existing owner');
    return current;
  }
  const flags = new Flags(level); book.flags.set(id, flags); return flags;
}
/** Existing achievement installation publishes its exact ledger/refresh service, never a shard hook. */
export function publishQuestFacts(scope: Scope, id: string, service: RuntimeFacts): void {
  entered(scope).facts.set(id, service);
}
/** Internal chapter admission borrows the existing services by id; no new ledger or flag owner is created. */
export function boundQuestServices(scope: Scope, id: string): { flags: Flags; facts: RuntimeFacts } {
  const book = owners.get(scope), flags = book?.flags.get(id), service = book?.facts.get(id);
  if (scope.disposed || flags === undefined || service === undefined) throw new Error(`Quest ${id} is not bound in this entry`);
  return { flags, facts: service };
}
/** Read an entered state without constructing a second quest. */
export function findBoundQuestState(scope: Scope, id: string): QuestState | undefined {
  if (scope.disposed) throw new Error(`Quest ${id} is not bound in this entry`);
  return owners.get(scope)?.states.get(id);
}

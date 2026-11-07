import type { Scope } from '@wildshard/engine/app/scope';
import type { ObservationRef } from '@wildshard/format/sceneRefs';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { QuestChapter } from '../../../client/game/quest/chapter';
import { boundQuestState } from './boundState';
import { questObservation } from './questObservation';
import type { AdventurePersistence } from './persistence';

const persistenceOwners = new WeakMap<Scope, AdventurePersistence>();
/** Saved owners publish directly, so numeric readers never import client persistence code. */
export function publishBoundPersistence(scope: Scope, owner: AdventurePersistence): void {
  if (persistenceOwners.has(scope)) throw new Error('Adventure persistence is already bound');
  persistenceOwners.set(scope, owner); scope.onDispose(() => { persistenceOwners.delete(scope); });
}
/** Borrow the concrete saved owner installed at world admission. */
export function enteredAdventurePersistence(scope: Scope): AdventurePersistence {
  const owner = persistenceOwners.get(scope);
  if (scope.disposed || owner === undefined) throw new Error('Adventure persistence is not entered');
  return owner;
}

const chapters = new WeakMap<Scope, Map<string, QuestChapter>>();
/** Internal chapter publication; the existing presentation owns every resource. */
export function publishBoundChapter(scope: Scope, id: string, chapter: QuestChapter): void {
  let installed = chapters.get(scope);
  if (installed === undefined) {
    installed = new Map<string, QuestChapter>(); chapters.set(scope, installed);
    // O18: a retired scope object can outlive its region (a cached facade or listener still names it); the weak key
    // then kept every visit's chapter, and through it that visit's whole world and script modules (~80 MB a visit)
    scope.onDispose(() => { chapters.delete(scope); });
  }
  installed.set(id, chapter);
}
/** Framework admission refuses duplicate chapter installation. */
export function hasBoundChapter(scope: Scope, id: string): boolean { return chapters.get(scope)?.has(id) === true; }
/** Borrow an installed chapter without constructing state or presentation. */
export function boundChapter(scope: Scope, id: string): QuestChapter {
  const chapter = chapters.get(scope)?.get(id);
  if (scope.disposed || chapter === undefined) throw new Error('Chapter presentation is not installed');
  return chapter;
}

/** Typed saved and quest observations share their actual entered owners (questObservation.ts reads them).
 * Only elite record read failures recover; flag/listener failures are outside
 * that read boundary and always propagate. No reflected author path is read. */
export function readQuestObservation(ctx: Pick<ShardContext, 'scope'>, quest: string, ref: ObservationRef): number {
  return questObservation(ref, { flags: () => boundQuestState(ctx.scope, quest).flags, quest: id => boundQuestState(ctx.scope, id),
    active: () => boundChapter(ctx.scope, quest).line?.active, saved: () => enteredAdventurePersistence(ctx.scope) });
}


/** Publish the existing chapter's sorted flag snapshot for this entered scope.
 * The scoped property restores prior readers; no state or probe registry is made. */
export function publishChapterFlags(ctx: Pick<ShardContext, 'scope' | 'game'>, id: string): void {
  const scope = ctx.scope;
  if (scope.disposed || scope.disposing) throw new Error('Quest flag publication needs its live entry');
  const chapter = boundChapter(scope, id), flags = chapter.quest.flags, runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Quest flag publication needs its entered runtime');
  scope.expose(runtime.hooks, 'adventureFlags', () => {
    if (scope.disposed || scope.disposing) return [];
    if (ctx.game.runtime !== runtime || boundChapter(scope, id) !== chapter || chapter.quest.flags !== flags) throw new Error('Quest flag owner changed');
    return flags.all.slice().sort();
  });
}

import type { QuestDef, QuestMarker, QuestStep } from './core';

/** A quest's transitions, in the order a view is told them: a finish, then the step it moved to. */
export interface QuestViewObserver { step?: (step: QuestStep | null, previous: QuestStep | null) => void; complete?: () => void }
/**
 * What a quest view reads, and all it reads (E6). The page's `QuestState` is this as it stands, fed by the page's sim;
 * `NetQuestView` is the same seat fed by a `NetClient`'s `quest` and `phase` events. A view decides nothing and writes
 * nothing through it, so the flip changes the feed and no view.
 */
export interface QuestView {
  readonly def: QuestDef;
  readonly isStarted: boolean;
  readonly isComplete: boolean;
  readonly current: QuestStep | null;
  objective: () => string;
  chip: () => { label: string; count: string };
  hint: () => string;
  markers: () => QuestMarker[];
  observe: (observer: QuestViewObserver) => () => void;
}
/** The flags that shape this player's own world (J106): a gate another player opened stays shut here. */
export interface QuestGateView { readonly has: (flag: string) => boolean }

/**
 * A quest observation read, renderer- and page-free (CI12: the Nalati chapter tape answers the same flag, quest, step,
 * boss and elite reads the page does): a flag of the observing quest, a quest's state (complete, active on the observing
 * chapter's line, or at a step), or a saved boss / elite record. `readQuestObservation` (chapterBindings.ts) reads through
 * this with the page's bound quests, chapter line and adventure persistence; a native host passes its own.
 *
 *   questObservation(ref, { flags: () => quest.flags, quest: id => states.get(id), active: () => line.active, saved: () => records })
 */
import type { ObservationRef } from '@wildshard/format/sceneRefs';

/** what an observation reads of a quest state (QuestState) */
export interface ObservedQuest { readonly isComplete: boolean; readonly current: { readonly id: string } | null }
/** the saved boss and elite records (AdventurePersistence.bosses / .elites) */
export interface ObservedRecords {
  readonly bosses: { readonly read: () => Readonly<Record<string, { readonly defeated: boolean; readonly rewardTaken: boolean; readonly kills: number }>> };
  readonly elites: { readonly read: () => Readonly<Record<string, { readonly kills: number }>> };
}
/** Each port is called only when the observation needs it, in the page's order; a port that is not bound throws. */
export interface QuestObservationPorts<Q extends ObservedQuest> {
  /** the observing quest's flags */
  readonly flags: () => { readonly has: (flag: string) => boolean };
  /** the quest state named `id` */
  readonly quest: (id: string) => Q;
  /** the quest active on the observing chapter's line, if any */
  readonly active: () => Q | null | undefined;
  /** the entered adventure's saved records */
  readonly saved: () => ObservedRecords;
}

/** The observation `ref` as a number (a flag, quest or boolean field is 0 / 1; elite kills are a count). Only an elite
 *  record read failure answers 0; every other failure propagates. */
export function questObservation<Q extends ObservedQuest>(ref: ObservationRef, ports: QuestObservationPorts<Q>): number {
  if ('flag' in ref) return Number(ports.flags().has(ref.flag));
  if ('quest' in ref) {
    const state = ports.quest(ref.quest);
    if (ref.state === 'complete' && !state.isComplete) return 0;
    if (ref.state === 'active' && ports.active() !== state) return 0;
    return Number(ref.step === undefined ? ref.state === 'active' || state.isComplete : state.current?.id === ref.step);
  }
  if (!('saved' in ref)) throw new Error('Observation requires its admitted scene owner');
  const persistence = ports.saved(), row = ref.saved;
  if (row.record === 'bosses') {
    const saved = persistence.bosses.read()[row.id];
    return saved === undefined ? 0 : Number(saved[row.field]);
  }
  if (row.field !== 'kills') throw new Error('Elite observation requires its kill field');
  let saved: ReturnType<ObservedRecords['elites']['read']>;
  try { saved = persistence.elites.read(); } catch { return 0; }
  return saved[row.id]?.kills ?? 0;
}

import type { CompletionRows } from '@wildshard/format/completion';

/** SHARD-COMPAT CP6 (Q10): the engine's completion card for a shard without `ui/completion`, never a refusal. It opens when
 * the shard's last tracked quest (else its last quest) completes, and shows the play time and the achievements earned. A
 * shard with no quest has nothing to complete and gets no card. */
export interface DefaultCardQuest { readonly id: string; readonly completeFlag: string; readonly track?: boolean | undefined }

export function defaultCompletionRows(slug: string, title: string, quests: readonly DefaultCardQuest[]): CompletionRows | undefined {
  const tracked = quests.filter(quest => quest.track !== false), last = tracked.at(-1) ?? quests.at(-1);
  if (last === undefined) return undefined;
  return {
    doneFlag: last.completeFlag, seenFlag: `engine.completion.${slug}.seen`, trigger: 'quest', system: `engine.completion.${slug}`,
    before: [], after: [], title, card: { kicker: 'Shard complete', flavour: [] }, menuSubtitle: 'Review your run', toastSuffix: ' complete',
    safeRadius: 12, pollSeconds: 0.5, maximumTodo: 6, more: 'more', coveredEvents: [], groups: [],
    stats: [{ label: 'Play time', value: { kind: 'time' } }, { label: 'Achievements', value: { kind: 'achievements' } }],
  };
}

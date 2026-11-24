// SHARD-SOURCE SS-GP1: a shard's declared quests, one install for a one-shard page (`client.ts`) and a grid data cell
// (`grid/dataCellQuests.ts`), so the grid cannot miss them again. Each quest's state follows `flags` (the page's book, which
// follows the server's), and the page presents it: its chip, pins, card and reward.
import type { Events } from '@wildshard/engine/events/events';
import type { Scope } from '@wildshard/engine/app/scope';
import { QuestState } from '@wildshard/engine/quest/core';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { QuestPresentationOptions } from '../plugin/ui';
import { publishDeclaredQuest } from '../../../shared/game/quest/boundState';

/** A quest the page presents: `installQuestPresentation` or its entered form, or a test's. */
export type QuestPresenter = (quest: QuestState, options: QuestPresentationOptions) => void;

/** An untracked quest's chip (`track: false`): blank. */
export const BLANK_CHIP = (): { label: string; count: string } => ({ label: '', count: '' });

/** Whether a source declares any quest. */
export const hasQuests = (source: Pick<Shardfile, 'quests'>): boolean => source.quests.quests.length > 0;

/** What an untracked quest (`track: false`) shows: no chip and no world pins, its markers on the full map only
 *  (MOSSGATE-ZONE MZ16: Mossgate's twelve places are one untracked quest's markers, which would be twelve pins in the view). */
export const UNTRACKED: Pick<QuestPresentationOptions, 'chip' | 'worldPins'> = { chip: BLANK_CHIP, worldPins: false };

/** Build each declared quest's state over `flags` for `scope`'s life and hand it to `present`. Each is published by the shard's
 *  `slug` for its client features (FORMAT-PRUNE FP49: a scene shard's `weather.fields` reads its quest's flags). */
export function installDeclaredQuests(quests: Shardfile['quests'], flags: Flags, events: Events | undefined, scope: Scope, present: QuestPresenter, slug: string): QuestState[] {
  return quests.quests.map((declaration) => {
    const quest = new QuestState(declaration, flags, events, scope);
    publishDeclaredQuest(slug, scope, quest);
    present(quest, declaration.track === false ? UNTRACKED : {});
    return quest;
  });
}

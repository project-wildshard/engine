// SHARD-SOURCE SS-GP1: a data cell's quests inside the grid. A one-shard page builds each declared quest's state and
// presentation (`client.ts`, `installDeclaredQuests`); a grid copy installed its talks (`dataCellTalks.ts`) but no quest, so
// a talk could start a quest the grid never tracked. While the feet stand in the copy each quest follows the cell server's
// flags (a book that follows the wire, dropped with the stay) and rows; its chip shows only while the wire is this cell's.
import type { Scope } from '@wildshard/engine/app/scope';
import type { Events } from '@wildshard/engine/events/events';
import type { QuestState } from '@wildshard/engine/quest/core';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { BLANK_CHIP, installDeclaredQuests, type QuestPresenter } from '../shardfile/declaredQuests';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';
import { enteredLandingPorts, installQuestLandings } from '../quest/questLanding';

/** The events and the presentation the quests use: the page's (`enterDataCellQuests`), or a test's. */
export interface DataCellQuestPorts { readonly events?: Events; readonly present: QuestPresenter }

/** Install a copy's quests for one stay in it. `here` says whether the wire is this cell's. */
export function installCellQuests(source: Pick<Shardfile, 'quests' | 'identity'>, stay: Scope, here: () => boolean, ports: DataCellQuestPorts): QuestState[] {
  const book = wirePage.book(source.identity.slug, stay, here());
  return installDeclaredQuests(source.quests, book, ports.events, stay, (quest, options) => {
    const chip = options.chip ?? (() => wirePage.quest(quest.def).chip());
    ports.present(quest, { ...options, chip: () => (here() ? chip() : BLANK_CHIP()) });
  }, source.identity.slug);
}

/** The page's install: each quest's chip, pins, card and reward on the page's context, bound to the stay. */
export async function enterDataCellQuests(source: Pick<Shardfile, 'quests' | 'identity'>, page: Pick<RegionalRuntimePage, 'context'>, stay: Scope, instance: string,
  here: () => boolean): Promise<void> {
  const ui = await import('../plugin/ui');
  if (stay.disposed || stay.disposing) return;
  const at = stayContext(page.context, stay, instance);
  const states = installCellQuests(source, stay, here, { events: at.app.events, present: (quest, options) => { ui.installQuestPresentation(at, quest, options); } });
  // meta MOSSGATE-ZONE MZ31: the copy's declared steps and payoffs land where they happened, while the wire is this cell's
  const ports = enteredLandingPorts(at, `${source.identity.slug}.${instance}`);
  if (ports !== null) installQuestLandings(states, { ...ports, frame: (run) => { ports.frame((dt) => { if (here()) run(dt); }); } }, stay);
}

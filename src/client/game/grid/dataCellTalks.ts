// TEMPLATE-E2E TC-E8: a data cell's quest-givers (`targets.talks`) inside the grid. A one-shard page installs them in its
// shardfile client (TE-ENG3, `declaredTalks.ts`); a grid copy offered only its `targets.interactions` (`copyPrompts.ts`), so on
// staging Brasscap's sheriff and poster and Mossgate's Lamplighter and hermit showed no prompt and no quest could start. While
// the feet stand in the copy its talks join the copy's prompts, in its frame; E opens the dialogue box on the node the cell's
// server says (an owned line), and an answer goes to that server as a press. The figures are drawn with the cell's tiles
// (`session.ts`, `talkStandIns`), so the installer's own stand-ins go to a root that is never drawn.
import { Group } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { app } from '@wildshard/engine/app/runtime';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { installDeclaredTalks, type TalkBox } from '../shardfile/declaredTalks';
import { wirePage } from '../shardfile/wirePage';

/** What the talks read off the page: where the feet stand, in the cell's frame. */
export interface DataCellTalkPage { readonly world: { readonly player: { readonly position: { readonly x: number; readonly z: number } } } }

/** Whether a copy declares any talk. */
export const hasTalks = (source: Pick<Shardfile, 'targets'>): boolean => (source.targets.talks?.length ?? 0) > 0;

/** The box and the frame clock the talks use: the page's (`enterDataCellTalks`), or a test's. */
export interface DataCellTalkPorts { readonly box: () => TalkBox; readonly system: (spec: SystemSpec) => void }

/** Install a copy's talks for one stay in it: their prompts join `prompts` and leave it with `scope`. `here` says whether the
 *  wire is this cell's, so a line read or an answer sent mid-crossing is never another cell's. */
export function installCellTalks(source: Pick<Shardfile, 'targets' | 'quests'>, prompts: Interactable[], page: DataCellTalkPage, scope: Scope,
  here: () => boolean, ports: DataCellTalkPorts): ReturnType<typeof installDeclaredTalks> {
  return installDeclaredTalks(source, { root: new Group(), scope, interactables: prompts, system: ports.system,
    flags: wirePage.gates, line: (name) => (here() ? wirePage.line(name) : 0), send: (id) => { if (here()) wirePage.send(id); }, box: ports.box,
    player: () => page.world.player.position });
}

/** The page's install: its dialogue box (loaded with the quest presentation) and a frame system named for the cell. */
export async function enterDataCellTalks(source: Pick<Shardfile, 'targets' | 'quests'>, prompts: Interactable[], page: DataCellTalkPage, scope: Scope,
  instance: string, here: () => boolean): Promise<void> {
  const ui = await import('../plugin/ui');
  if (scope.disposed || scope.disposing) return;
  let box: TalkBox | null = null;
  installCellTalks(source, prompts, page, scope, here, {
    box: () => { box ??= ui.talkBox(scope.child('talks')); return box; },
    system: (spec) => { app.addSystem({ ...spec, id: `grid.talks.${instance}` }, scope); } });
}

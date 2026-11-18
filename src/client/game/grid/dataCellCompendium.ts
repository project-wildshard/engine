// SHARD-SOURCE SS-GP4d: a data cell's compendium and journal inside the grid. A one-shard page registers each declared
// compendium row and installs the journal (`client.ts`, `installCompendium`): the N key, the Bag's FINDS tab, the phone's
// Journal pill and the tracker that marks creatures discovered, seen and taken. A grid copy had none, so the Template's grey
// blob page never filled on a grid cell (GRID-CELL-PARITY row 13). While the feet stand in the copy its compendium is
// registered from its own folder and its journal is on the page; the journal's frame system is named for the cell and bound
// to the stay, and the registration, the journal and its ways in all leave with the stay.
import type { Scope } from '@wildshard/engine/app/scope';
import { compendiumSketches } from '@wildshard/format/compendiumSketches';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { declaredFolderCompendium } from '../../../shared/game/shard/declaredRows';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type * as CompendiumPresentation from '../compendium/install';
import type { CompendiumHost } from '../compendium/install';
import type { ShardCompendium } from '../../../shared/game/compendium/types';
import type { ShardContext } from '../plugin/context';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';

/** Whether a copy declares a compendium. */
export const hasCompendium = (source: Pick<Shardfile, 'rows'>): boolean => source.rows.compendiums.length > 0;

/** The journal's page owners: the page's (`enterDataCellCompendium`), or a test's. */
export type DataCellCompendiumPorts = Omit<CompendiumHost, 'context' | 'chunkId' | 'cabins' | 'interactables' | 'wall'>;

/** How a declared row becomes a compendium: the folder's (`declaredFolderCompendium`), or a test's. */
export type CompendiumDefine = (product: ShardFolder, id: string, sketches: ReturnType<typeof compendiumSketches>) => ShardCompendium;

/** Register a copy's compendium on `at` (bound to the stay, reading the copy's folder) and install its journal. */
export async function installCellCompendium(source: Pick<Shardfile, 'rows' | 'identity'>, assets: ReadonlyMap<string, Uint8Array>, at: ShardContext,
  ports: DataCellCompendiumPorts, define: CompendiumDefine = declaredFolderCompendium): Promise<ReturnType<typeof CompendiumPresentation['installCompendium']>> {
  const compendium = await import('../compendium/install');
  if (at.scope.disposed || at.scope.disposing) return null;
  const sketches = compendiumSketches(source.rows, assets);
  for (const row of source.rows.compendiums) at.rows.compendium({ id: row.id, ...define(at.product, row.id, sketches) });
  const installed = compendium.installCompendium({ ...ports, context: at, chunkId: source.identity.slug, cabins: null, interactables: [] });
  if (installed !== null) at.scope.onDispose(() => { installed.journal.scope.dispose(); });
  return installed;
}

/** The page's install: the journal on the page's HUD, menu and creatures; its frame system named for the cell. */
export async function enterDataCellCompendium(source: Pick<Shardfile, 'rows' | 'identity'>, assets: ReadonlyMap<string, Uint8Array>, folder: ShardFolder,
  page: Pick<RegionalRuntimePage, 'context' | 'play' | 'world'>, stay: Scope, instance: string): Promise<void> {
  const { play, world } = page, app = page.context.app;
  await installCellCompendium(source, assets, stayContext(page.context, stay, instance, folder), { camera: world.game.camera, hud: play.hud, menu: play.menu,
    animals: play.animals, weapons: play.weapons, touchUi: play.touchUi, nolock: play.nolock,
    game: { onUpdate: (run, label) => { app.addContentSystem({ id: `grid.${instance}.${label ?? 'compendium'}`, phase: 'update', run }, stay); } } });
}

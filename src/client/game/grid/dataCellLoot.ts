// SHARD-SOURCE SS-GP4e: a data cell's gear loot inside the grid. A one-shard page whose `economy/loot` row carries gear (the
// Template's `purse.coins`) installs its purse, coin burst and the Bag's loot row (`client.ts`, `installLoot`); a grid copy
// had none, so coins the cell server paid on a grid cell never burst, chimed or showed on the HUD (GRID-CELL-PARITY row 12).
// While the feet stand in the copy its purse mirrors the server's coins line, its payouts burst where they fell, and its
// coin chip and Bag row are on the page; all of it leaves with the stay. The loot module stays a split chunk, as on the page.
import type { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { coinsDeclared } from '../../../shared/game/loot/currency';
import type { LootBody, ScopedLoot, ScopedLootHost } from '../loot/runtime';
import type { ShardContext } from '../plugin/context';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';

/** The copy's gear loot row id, or null: only a gear row has a page presentation (`client.ts`). */
export function cellLootRow(source: Pick<Shardfile, 'rows'>): string | null {
  const row = source.rows.loot[0];
  return row !== undefined && 'gear' in row ? row.id : null;
}

/** The page owners the purse and its burst borrow: the page's (`enterDataCellLoot`), or a test's. */
export type DataCellLootPorts = Pick<ScopedLootHost<LootBody>, 'owned' | 'scene' | 'player' | 'camera' | 'animals' | 'menu'>;

/** Install a copy's loot for one stay in it, on `at` (the page's context bound to the stay, reading the copy's folder). */
export async function installCellLoot(source: Pick<Shardfile, 'rows' | 'identity'>, row: string, at: ShardContext, ports: DataCellLootPorts): Promise<ScopedLoot | null> {
  const loot = await import('../loot/runtime');
  if (at.scope.disposed || at.scope.disposing) return null;
  return loot.installLoot({ ...ports, ctx: at, manifest: { slug: source.identity.slug, loot: { coins: coinsDeclared(source.rows.loot) } },
    presentation: loot.enteredLootPresentation(at, row) });
}

/** The page's install: the copy's purse and presentation on the page's play owner, read from the copy's own folder. */
export async function enterDataCellLoot(source: Pick<Shardfile, 'rows' | 'identity'>, row: string, folder: ShardFolder, page: Pick<RegionalRuntimePage, 'context' | 'play' | 'world'>,
  stay: Scope, instance: string): Promise<void> {
  const { play, world } = page;
  await installCellLoot(source, row, stayContext(page.context, stay, instance, folder), { owned: play.owned, scene: world.game.scene,
    player: world.player, camera: world.game.camera, animals: () => play.animals.animals, menu: play.menu });
}

import * as v from 'valibot';
import { CatalogueEconomySchema } from '@wildshard/format/catalogueEconomy';
import { isOwnedId } from '../../../shared/game/loot/Owned';
import { isJsonData } from '@wildshard/format/json';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import { HeldFinishes } from '../loadout/finishes';
import { heldFinishEffect } from '../loadout/effects';
import { STARTER_EFFECTS } from '../../../shared/game/systems/effects/starterEffects';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { declaredFolderCompendium } from '../../../shared/game/shard/declaredRows';

/** Kit-only catalogue registration from admitted ids. Preparation stays with
 * the resident resource owner; this feature registers no frame or save owner. */
export function installClientCatalogue(ctx: ShardContext, row: ClientFeatureRow): void {
  if (ctx.scope.disposed || ctx.scope.disposing || row.kind !== 'content.catalogue') throw new Error('Invalid content catalogue feature');
  if (row.economy !== undefined && !isJsonData(row.economy)) throw new Error('JSON-only catalogue economy');
  const items = new ItemCatalogue(ctx.product.section('combat/items').items);
  const weapons = row.weapons.map(id => items.equipment(id));
  const ammunition = row.ammunition.flatMap(id => [...items.ammunition(id).values()].map(ammo => ammo.row));
  const finishes = row.finishes || row.effects.includes('finishes') ? HeldFinishes.current(ctx.product.slug) : null;
  const journals = row.compendiums.map(id => Object.assign(declaredFolderCompendium(ctx.product, id), { id }));
  const economy = row.economy === undefined ? undefined : v.parse(CatalogueEconomySchema, row.economy);
  if (economy?.goods.some(good => !isOwnedId(good.id) || good.needs !== undefined && !isOwnedId(good.needs)) === true) throw new Error('Unknown catalogue economy ownership');
  const effects = row.effects.flatMap(kind => kind === 'starter' ? STARTER_EFFECTS
    : finishes?.cards.map(({ id }) => heldFinishEffect(id, finishes.get(id).weapon)) ?? []);
  if (row.quests) installQuestCatalogue(ctx);
  for (const journal of journals) ctx.rows.compendium(journal);
  for (const encounter of row.encounters) ctx.rows.encounter(encounter);
  if (weapons.length > 0) ctx.rows.weapon(weapons);
  if (ammunition.length > 0) ctx.rows.ammo(ammunition);
  if (effects.length > 0) ctx.rows.effect(effects);
  if (economy !== undefined) { ctx.rows.effect(economy.effects); ctx.rows.shop(economy.goods); }
  if (row.finishes && finishes !== null) ctx.rows.skin(finishes.list());
}

/** Client-only registration of admitted item and achievement rows in their existing level scope.
 * Simulation counters, ledger rewards and saved inventory retain their original owners. */
export function installQuestCatalogue(ctx: Pick<ShardContext, 'product'> & { readonly rows: Pick<ShardContext['rows'], 'item' | 'feat'> }): void {
  const items = ctx.product.section('combat/items').items.catalogue;
  const feats = ctx.product.section('quests/quests').quests.achievements;
  if (items !== undefined) ctx.rows.item(items);
  if (feats !== undefined) ctx.rows.feat(feats);
}

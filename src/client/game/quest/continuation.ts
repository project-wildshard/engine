/** Client-only entered continuation. Native inventory, flags, geometry and
 * saves keep their original owners; no content factory crosses this host. */
import * as v from 'valibot';
import { QuestContinuationSchema, parseQuestContinuationDocument } from '@wildshard/format/questContinuation';
import { CollectionDisplaysSchema } from '@wildshard/format/collectionDisplay';
import type { ShardContext } from '../plugin/context';
import { requireClientPlaceSetsBound } from '../shardfile/clientPlaceSets';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import { declaredLootEconomy } from '../../../shared/game/shard/declaredRows';
import { defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import { sharedModelContext, type ModelDef } from '@wildshard/engine/models/model';
import { Sword } from '../weapons/Sword';
import { installItemEffects } from '../loadout/effects';
import { installDeclaredCollectionKeepsakes } from '../compendium/keepsakes';
import { enteredLootPresentation, installRuntimeLoot } from '../loot/runtime';
import { installQuestShop } from './trader';

const ended = (ctx: ShardContext): boolean => ctx.scope.disposed || ctx.scope.disposing;

/** Complete an entered quest's data-declared keepsakes, effects and loot after
 * its figures and chapter are ready. Its scope owns all resulting bindings. */
export async function installQuestContinuation(ctx: ShardContext, input: unknown): Promise<void> {
  const row = v.parse(QuestContinuationSchema, input), adventure = entryOwner(ctx.scope, 'quest', row.quest);
  const catalogue = entryOwner(ctx.scope, 'collection', row.collection), shell = ctx.game.runtime, world = shell?.world, play = shell?.play;
  if (world === undefined || world === null || play === undefined || play === null) throw new Error('Quest continuation needs its entered world');
  const swords = play.weapons.list.map(({ id }) => play.weapons.get(id)).filter(weapon => weapon instanceof Sword);
  const economy = declaredLootEconomy(ctx.product.section('economy/loot').rows.loot);
  installItemEffects(ctx);
  const cosmeticRows = await ctx.product.json(row.cosmetics.file);
  if (ended(ctx)) return;
  const cosmetics = defineWorldSceneCatalogue(cosmeticRows), sources = sharedModelContext(world.sky);
  const bind = (model: ModelDef<Record<string, unknown>>): ModelDef<Record<string, unknown>> => ({ ...model,
    build: (_context, params, rng) => model.build({ ...sources, specimenScope: ctx.scope }, params, rng) });
  const collections = v.parse(CollectionDisplaysSchema, ctx.product.section(row.collections));
  await installDeclaredCollectionKeepsakes(ctx, collections.keepsakes, economy,
    new Map([['collection', { adventure, world, play, swords, catalogue,
      models: new Map(Object.entries(row.cosmetics.models).map(([id, key]) => [id, bind(cosmetics.model(key))])) }]]));
  if (ended(ctx)) return;
  const shop = await ctx.product.json(row.loot.shop);
  if (ended(ctx)) return;
  const presentation = enteredLootPresentation(ctx, row.loot.id, row.loot.bag);
  installRuntimeLoot(ctx, { ...presentation, shop: () => installQuestShop(ctx, shop)() }, { minimap: row.loot.minimap, before: row.loot.before });
}

/** Finite entry dispatch. The admitted file owns quest and collection ids; no
 * repeated ids or callables are supplied by the client-plan row. */
export async function installQuestContinuationFile(ctx:ShardContext,file:string):Promise<void> {
  const input=await ctx.product.json(file);
  if(ended(ctx))throw new Error('Quest continuation owner ended during read');
  const row=parseQuestContinuationDocument(input);
  requireClientPlaceSetsBound(ctx);
  await installQuestContinuation(ctx,row);
}

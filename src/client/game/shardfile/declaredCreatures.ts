import type { Group, Material } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { TIER } from '@wildshard/engine/core/tier';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { wirePage } from './wirePage';
import { abilityRows, clientSpeciesLooks, nativeKindOwners, pageSpecies, speciesSwaps, speciesViewKinds, type ClientRigLooks, type ShardViewRecipe } from './clientRecipes';
import { loadClientRigLooks } from './clientRigLooks';
import { clientNativeBook } from './clientNativeBook';
import { loadStaticModels } from './itemModels';
import { attachmentRefs, withAttachments } from './clientAttachments';
import { loadClientSkins, type ClientSkin } from './clientSkins';

/** What a page's declared bodies are drawn with: its materials, skins, rig looks and attachment models. */
export interface DeclaredCreatureModels {
  readonly materials: ReadonlyMap<string, Material>;
  readonly skins: ReadonlyMap<string, ClientSkin>;
  readonly rigLooks: ClientRigLooks;
  readonly attachmentModels: ReadonlyMap<string, Group>;
  readonly recipes: ReadonlyMap<string, ShardViewRecipe>;
}

/** ONE-FORMAT OF19d1/OF19d2: a data page draws its declared bodies from their looks, so the page itself registers its
 *  declared species (FORMAT-PRUNE FP20: no plan feature owns them any more). Standalone that is the data client's kit; on
 *  the grid it is the regional entry's kit (K6, v0.1.56: Sunscar Dunes r5 never did, and stalled at finish). */
export function pageDeclaresOwnSpecies(product: Pick<ShardFolder, 'has' | 'shardfile'>): boolean {
  return hasDeclaredClientPage(product.shardfile) && product.has('client/plan');
}

/** ONE-FORMAT OF23e4: a native runtime page whose species are only its declared rows (Pine r10). Its page registers them
 *  itself (`declarePageCreatures`), standalone (client.ts `declaredNativePage`) and on the grid (regionalRuntime.ts's
 *  entered kit), or a row's kind is unknown (P1 2026-11-22: v0.1.72 baked Driftwood r8's client product beside the box's
 *  r9, and nobody declared the crabs, monkeys, sailors or the Captain: every enemy was invisible). */
export function nativeDeclaresOwnSpecies(product: Pick<ShardFolder, 'shardfile'>): boolean {
  const source = product.shardfile;
  if (source.runtime === null || hasDeclaredClientPage(source)) return false;
  return source.rows.species.length > 0 && source.creatures.spawns.length > 0;
}

/** OF23e4 on the grid: a native page's declared species, and the hull book's kit it keeps (held equipment, socket cards),
 *  as client.ts's `kit` does standalone. */
export async function declareNativePage(ctx: ShardContext, source: Shardfile, models: DeclaredCreatureModels): Promise<void> {
  declarePageCreatures(ctx, source, models);
  const { prepareDeclaredNativeKit } = await import('../models/socketRigCreature');
  await prepareDeclaredNativeKit(ctx);
}

/** Load what `declarePageSpecies` draws with, from the page's own retained files (the data client loads the same in its world). */
export async function loadDeclaredCreatureModels(product: ShardFolder, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>,
  presentation: { readonly materials: ReadonlyMap<string, Material>; readonly compile: (entry: unknown) => Material }, scope: Scope,
  recipes: ReadonlyMap<string, ShardViewRecipe> = new Map()): Promise<DeclaredCreatureModels> {
  const attachmentModels = await loadStaticModels(attachmentRefs(source.rows), assets, scope);
  const skins = await loadClientSkins(source, assets, presentation.compile, scope);
  const rigLooks = await loadClientRigLooks(product, source.rows, scope);
  return { materials: presentation.materials, skins, rigLooks, attachmentModels, recipes };
}

/** The declared species, their looks and swaps, and their models ready for the rows' bodies (the page draws the server's). */
export function declarePageCreatures(ctx: ShardContext, source: Shardfile, models: DeclaredCreatureModels): void {
  const runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Declared creatures require the normal kit stage');
  // TE-ENG7: two declared species on one native kind each register under a page kind of their own; rows find it by species id
  const kinds = speciesViewKinds(source.rows), pageKind = (species: string, kind: string): string => kinds.get(species) ?? kind;
  wirePage.declareSpecies(kinds, ctx.scope);
  wirePage.declareAbilities(abilityRows(source.rows), ctx.scope);
  const pageRows = source.rows.species.map((row) => ({ ...row, harvest: row.harvest ?? [], variants: row.variants.map((variant) => ({ ...variant, scale: [variant.scale[0], variant.scale[1]] as [number, number] })) }));
  // QA 11-23 #4: the bare native kind answers for its first declared species (rows and looks alike)
  const owners = nativeKindOwners(source.rows.species);
  ctx.rows.species(pageSpecies(pageRows, kinds, undefined, owners));
  // CC28c: a body's swap look registers under its own page kind, with a copy of its species row, never its species' kind
  const swaps = speciesSwaps(source.rows), swapped = new Map(swaps.map((swap) => [swap.look, swap]));
  const looks = withAttachments(clientSpeciesLooks(source.rows, models.recipes, models.materials, models.skins, models.rigLooks), source.rows, models.attachmentModels, models.materials, TIER === 'phone');
  ctx.rows.speciesLook(pageSpecies(looks.filter((look) => !swapped.has(look.id)), kinds, undefined, owners));
  for (const swap of swaps) {
    const row = pageRows.find((entry) => entry.id === swap.species), look = looks.find((entry) => entry.id === swap.look);
    if (row === undefined || look === undefined) throw new Error(`Missing swap look ${swap.look}`);
    ctx.rows.species({ ...row, id: `${row.id}~swap`, kind: swap.kind }); ctx.rows.speciesLook({ ...look, kind: swap.kind });
  }
  wirePage.declareSwaps(new Map(swaps.map((swap) => [pageKind(swap.species, source.rows.species.find((row) => row.id === swap.species)?.kind ?? ''), swap])), ctx.scope);
  runtime.hooks.animalsReady = (manager) => {
    for (const spawn of source.creatures.spawns) {
      const species = source.rows.species.find((row) => row.id === spawn.species); if (species === undefined) throw new Error('Missing authored creature species');
      manager.factory.model(pageKind(species.id, species.kind), spawn.variant);
    }
  };
}

/** OF19d2: the page's species are its declared rows, registered in this context's kit for
 *  `population.homes`; the plan's keeper boss, if it keeps one (OF19c0b), gets its fight's name as that feature gave it. */
export function declarePageSpecies(ctx: ShardContext, source: Shardfile, models: () => DeclaredCreatureModels): void {
  clientNativeBook(ctx).species = true;
  if (source.creatures.spawns.length === 0) return;
  declarePageCreatures(ctx, source, models());
  if (ctx.product.has('sim/runtime-plan')) {
    const owner = ctx.product.section('sim/runtime-plan').recipe.population.owner;
    if (owner !== undefined) ctx.rows.encounter({ id: owner.actor, displayName: owner.definition.name });
  }
}

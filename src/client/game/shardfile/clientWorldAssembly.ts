/** Enter the declared book through the existing native construction authorities. */
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { WorldEntry } from './worldEntry';
import type { SceneHandles } from './sceneHandles';
import { publishClientSceneHandles } from './clientSceneHandles';
import type { IslandLibrary } from '../models/islandLibrary';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { buildProgress, type ShardContext } from '../plugin/context';
import { admittedIslandBook, preflightIslandBook } from './islandBook';
import { WorldAssembly } from './worldAssembly';
import { HybridResidentWorld } from './hybrid';
import { boundResidentWorldScope } from './hybridPresentation';
import { runtimeLookMaterials } from './runtimeProduct';
import { lendLooks } from './lentLooks';
import { installWorldScenes } from './worldScenes';
import { bakedTileContents, residentBakedTiles, type BakedTiles } from './bakedTiles';
import { publishEntryOwner, lendEntryOwner, entryOwner, presentEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { timeClientPreparation } from './preparationTiming';
import { cameraCone, followResidentTiles, noteTileBytes, productTileRing, residentTiles } from './tileDriver';
import { StreamingCamera } from './streamingView';
import { farStandIn } from './farStandIn';
import { wholeRefinementCover } from './wholeRefinementCover';

const enteredScopes = new WeakSet<ShardContext['scope']>();
const residents = new WeakMap<IslandLibrary<unknown> | ShardProduct, {
  readonly recipe: string; readonly scenes: unknown; readonly world: HybridResidentWorld<SceneHandles>;
}>();
/** Construction remains on its original bound owner; entered reads borrow only
 * after it completes. Leaving an entry never cancels a still-live resident. */
export async function installClientWorldAssembly(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'world.assembly' }>): Promise<void> {
  if (row.native !== undefined) {
    preflightIslandBook(ctx.product, row);
    const {product, scope} = ctx, runtime = ctx.game.runtime, world = runtime?.world, step = runtime?.step, id = row.native.groups;
    if (runtime === undefined || world === undefined || world === null || step === undefined || step === null) throw new Error('Native assembly requires its counted world');
    const game = world.game, construction = game.levelScope, read = product.json, file = product.file;
    const live = (): void => { if (scope.disposed || scope.disposing || construction.disposed || construction.disposing || ctx.scope !== scope || ctx.product !== product || product.json !== read || product.file !== file || ctx.game.runtime !== runtime || runtime.world !== world || runtime.step !== step || world.game !== game || game.levelScope !== construction) throw new Error('Native assembly owner left or changed'); };
    live(); if (presentEntryOwner(scope, 'world-groups', id) !== null) throw new Error('Native assembly already constructed');
    await step('cabins', () => undefined); live();
    const groups = await step('props', async progress => {
      live(); const draws = await scope.run(() => WorldAssembly.prepareNative(row.rows, ctx)); live();
      const result = await scope.run(() => WorldAssembly.construct(row.rows, {runtime, native: ctx, product, scope, draws, baked: new Map(), progress})); live(); return result;
    });
    live(); publishEntryOwner(scope, 'world-groups', id, groups); return;
  }
  const { product, scope } = ctx, runtime = ctx.game.runtime, resident = boundResidentWorldScope(scope);
  if (runtime?.world === undefined || runtime.world === null) throw new Error('Island assembly needs its native world');
  const world = runtime.world, progress = buildProgress(ctx), source = product.shardfile, sceneRows = product.section('world/scenes'), cube = ctx.cube;
  const read = product.file, json = product.json, piece = row.entered === undefined ? undefined : ctx.piece;
  const { game, registry, sky, physics } = world;
  const live = (): void => {
    if (scope.disposed || scope.disposing || boundResidentWorldScope(scope) !== resident || resident?.disposed === true || resident?.disposing === true
      || piece !== undefined && ctx.piece !== piece || ctx.product !== product || product.shardfile !== source || product.file !== read || product.json !== json || product.section('world/scenes') !== sceneRows || ctx.cube !== cube || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game || world.registry !== registry || world.sky !== sky || world.physics !== physics) throw new Error('Island entry owner left or changed');
  };
  live(); preflightIslandBook(product, row);
  if (row.entered !== undefined && enteredScopes.has(scope)) throw new Error('World assembly pieces already entered');
  const libraryId = row.library;
  const book = libraryId === undefined ? undefined : await scope.run(() => admittedIslandBook(product, libraryId)); live();
  const construction = row.rows.construction;
  if (construction?.looks === undefined) throw new Error('World construction metadata missing');
  const { looks, publish } = construction;
  const build = async (owner: ShardContext['scope'], bound: boolean): Promise<SceneHandles> => {
    const check = (): void => {
      if (owner.disposed || owner.disposing || product.shardfile !== source || product.file !== read || product.json !== json || product.section('world/scenes') !== sceneRows || runtime.world !== world || ctx.game.runtime !== runtime || ctx.product !== product || world.game !== game || world.registry !== registry || world.sky !== sky || world.physics !== physics) throw new Error('Island construction owner left or changed');
    };
    check();
    // Developer pages time each part of the build ('wildshard.prepare:<slug>:assembly:<part>', G626 H3)
    const timed = <T,>(part: string, work: () => Promise<T>): Promise<T> => timeClientPreparation(product.slug, `assembly:${part}`, work);
    const drainGeometry = book?.library.prepareGeometry(game.registrationScope, owner);
    try {
      const materials = await timed('looks', () => runtimeLookMaterials({ scope: owner, game: ctx.game }, product.shardfile, true, bound ? looks.bound : looks.unbound)); check();
      lendLooks(owner, materials);
      const scenes = await timed('scenes', () => installWorldScenes(ctx, sceneRows, owner)); check();
      const baked: ReadonlyMap<string, BakedTiles> = book === undefined ? new Map<string, BakedTiles>() : await timed('baked', () => residentBakedTiles(ctx, owner)); check();
      // T3: the baked sets by tile (their meshes' triangles, their unclaimed colliders on the collider ring)
      for (const set of baked.values()) for (const content of bakedTileContents(set)) scenes.addTiled(content);
      const variant = construction.variant?.[cube === null ? 'standalone' : 'cell'];
      await timed('construct', () => WorldAssembly.construct(row.rows, { runtime, product, scope: owner, scenes, baked, progress,
        ...(book === undefined ? {} : { library: book.library, sites: book.sites }), ...(variant === undefined ? {} : { variant }) })); check();
      if (book !== undefined && publish !== undefined) {
        publishEntryOwner(owner, 'collection', publish.collection, book.library.collections);
        publishEntryOwner(owner, 'fixed-draws', publish.draws, book.library.loaded());
      }
      return scenes;
    } finally { if (drainGeometry !== undefined) await timed('geometry-drain', drainGeometry); }
  };
  let scenes: SceneHandles;
  if (resident === undefined) scenes = await build(scope, false);
  else {
    const key = book?.library ?? product, recipe = JSON.stringify(row);
    let cached = residents.get(key);
    if (cached !== undefined && (cached.recipe !== recipe || cached.scenes !== sceneRows)) throw new Error('World assembly declaration changed');
    if (cached === undefined) { cached = { recipe, scenes: sceneRows, world: new HybridResidentWorld<SceneHandles>() }; residents.set(key, cached); }
    scenes = await cached.world.load(ctx, owner => build(owner, true));
  }
  live(); publishClientSceneHandles(product, resident ?? scope, scenes); WorldAssembly.lend(row.rows, resident ?? scope, scope);
  if (row.entered !== undefined) {
    const entryRows = sceneRows.entry;
    if (entryRows === undefined || piece === undefined) throw new Error('World assembly entered pieces missing');
    const root = entryOwner(scope, 'object', row.entered.root), variant = construction.variant?.[cube === null ? 'standalone' : 'cell'];
    const entry = WorldEntry.admit(entryRows, { root, scope, tier: game.tier, ...(variant === undefined ? {} : { variant }), piece: value => { ctx.piece(value); }, fence: live });
    enteredScopes.add(scope); scope.onDispose(() => { enteredScopes.delete(scope); });
    await timeClientPreparation(product.slug, 'assembly:entered', async () => { for (const block of row.entered?.blocks ?? []) { live(); await entry.run(block); live(); } });
  }
  if (resident !== undefined && publish !== undefined) {
    lendEntryOwner(scope, resident, 'fixed-draws', publish.draws);
    lendEntryOwner(scope, resident, 'collection', publish.collection);
  }
  // tile streaming T4 (pause ▸ Settings ▸ Debug ▸ Tile residency): the tiled world content's spawn and entry tiles (all
  // of them for the whole cell) before controls, once per resident; then each entry's tiles follow the player
  const owner = resident ?? scope;
  // G748 (shipped G761): beyond the render ring a shard that declares it (its drawn world tiled)
  // draws its own near view for its occupied tiles; once per resident (its scene handles survive a re-entry). A grid cell's
  // tile streamer already draws the entered cell's L1 parents (T8), so there a stand-in drew each one twice (G913: 10 draws)
  if (row.farStandIn === true && cube === null && !scenes.tiled().some(content => content.id === 'whole.refinement.coarse' || content.id === `${product.slug}.far-stand-in`)) {
    // Runtime-bound props bypass the data renderer. Prefer their actual T8
    // parents to a second near-view proxy; both use the same fine-ring mask.
    const standIn = source.props?.tiles.some(tile => tile.lod === 1)
      ? wholeRefinementCover(ctx, owner, source.spawn).content : farStandIn(ctx);
    if (standIn !== null) scenes.addTiled(standIn);
  }
  // NT1: the product's own ring (its whole cell where it declares `ring: 'cell'`), as the client plan's driver takes it
  // DL21: the resident tiles (coarse cover and the spawn's tiles before controls) are a named span: on Nine they were the
  // untimed ~1.9 s tail of world assembly, the card on 'Props · world ready' meanwhile
  noteTileBytes(owner, source.tiles);
  await timeClientPreparation(product.slug, 'assembly:resident-tiles', () => residentTiles(owner, scenes.tiled(), source.spawn, source.entryways, productTileRing(source))); live();
  const camera = new StreamingCamera(ctx.root, () => world.game.camera);
  const follow = followResidentTiles(owner, () => world.player.position, () => cameraCone(world.game.camera), () => camera.read());
  if (follow !== null) ctx.system({ id: 'client.world.tiles', phase: 'update', run: () => { follow(); } });
}

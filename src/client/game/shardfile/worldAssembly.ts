import { clientWaterSurfaces } from './clientWaterSurfaces';
import { SceneDressing } from './sceneDressing';
import { bindClientPlaceSets } from './clientPlaceSets';
import { installFixedDrawsStage, installPaintedReseedStage, installPaintedWorldStage } from './paintedWorldStages';
import {ArenaRoomEncounter} from '../boss/arenaRoom';
import {buildArenaRoomEncounter} from '../boss/arenaRoomView';
import type { ShardContext } from '../plugin/context';
import { TIER } from '@wildshard/engine/core/tier';
import { gpuOnlyTrees } from '@wildshard/engine/core/gpuOnly';
import { macrotask, slicer, type StepProgress } from '@wildshard/engine/boot/plan';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import type { IslandLibrary } from '../models/islandLibrary';
import type { defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import type { BakedTiles } from './bakedTiles';
import { Group, Mesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import { worldBuildYield } from './worldBuildYield';
import { CoverCompositionSchema } from '@wildshard/format/streamedCover';
import { createStreamedCover } from '../looks/streamedCover';
import { toonLightingOf } from '../looks/toonLighting';
import { createAmbientFlock } from '../ambient/ambientFlock';
import { BuildingLifeDocumentSchema } from '@wildshard/format/buildings';
import { LivingBuildings } from './livingBuildings';
import { createBuildingCloud } from './buildingCloud';
import { hasLentLook, lentLook, lentToon } from './lentLooks';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { RopeDeckSite } from '../models/ropeDeckSite';
import { RopeChain } from '@wildshard/engine/physics/ropeChain';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Game } from '@wildshard/engine/core/Game';
import { productFixedDraws, type FixedDraws } from '../models/fixedDraws';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { sharedModelContext, type ModelContext } from '@wildshard/engine/models/model';
import type { ModelSite } from '@wildshard/engine/models/place';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { WorldAssemblySchema, type WorldAssemblyStage, type WorldConstructionRows, type WorldAssemblyRows } from '@wildshard/format/worldAssembly';
import { publishEntryOwner, entryOwner, lendEntryOwner, presentEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { WorldEntry, type WorldEntryPorts } from './worldEntry';
import { timeClientPreparation } from './preparationTiming';
import type { SceneHandles } from './sceneHandles';

/** What an assembly builds against: the construction scope its loans belong to, the admitted scene handles, the shard's
 *  site catalogue (for `site` stages), the model context and registry sites register into, and the build's slice. */
export interface WorldAssemblyPorts {
  readonly scope: Scope;
  /** The original construction context, used by ordered weather and encounter stages. */
  readonly weatherContext?: ShardContext;
  readonly scenes?: SceneHandles;
  readonly sites?: { readonly site: (key: string, choice: string, ctx: ModelContext, registry: WorldRegistry | null) => ModelSite };
  readonly context: ModelContext;
  readonly registry: WorldRegistry | null;
  /** Original already-loaded templates; no stage creates a second intake. */
  readonly draws?: FixedDraws;
  /** The original admitted product reader; site life never creates an intake. */
  readonly product?: Pick<ShardProduct, 'file'>;
  /** The original early-read cells, native viewer and Game registration receiver. */
  readonly cover?: { readonly cells: Uint8Array; readonly viewer: () => Vector3; readonly updates: Pick<Game, 'onUpdate'> };
  /** Original simulation and fixed-post registration authority for rope chains. */
  readonly physics?: Physics;
  readonly fixed?: Pick<Game, 'onFixed'>;
  /** what `entry` stages run their rows against (the world root, tier, variant and piece registration) */
  readonly entry?: Omit<WorldEntryPorts, 'scenes' | 'fence'>;
  /** the build's time slice, after each stage (labelled progress) */
  readonly slice: (label: string) => Promise<void>;
}

/** Existing concrete native authorities; construction never creates another
 * library, scene intake, registry, world or retained owner. */
export interface WorldConstructionPorts {
  /** The original native construction context, only for declared borrowed-owner stages. */
  readonly native?: ShardContext;
  readonly draws?: FixedDraws;
  readonly runtime: ShardRuntime;
  readonly product: ShardProduct;
  readonly scope: Scope;
  readonly scenes?: SceneHandles;
  readonly baked: ReadonlyMap<string, BakedTiles>;
  readonly library?: IslandLibrary<unknown>;
  readonly sites?: ReturnType<typeof defineWorldSceneCatalogue>;
  readonly variant?: string;
  readonly progress?: StepProgress;
}

/** A drawn-models stage: every row's draw is found in the loaded fixed draws before anything is allocated, then one material
 *  and a group per row holding a copy of its draw; the copies and the material belong to the construction scope (a failure
 *  part-way disposes what it made), and the models are published together as one loan. No progress step. */
function installDrawnModels(ports: Pick<WorldAssemblyPorts, 'scope' | 'draws' | 'context'>, stage: Extract<WorldAssemblyStage, { kind: 'drawn-models' }>): void {
  const { scope, draws } = ports;
  if (draws === undefined || !draws.ready) throw new Error('World drawn models need loaded fixed draws');
  const handles = stage.models.map(row => [row.id, draws.handle(row.draw)] as const);
  const material = painterlyMaterial(ports.context.sky, { rim: stage.look.painterly.rim }), copies: BufferGeometry[] = [];
  let models: Map<string, Object3D>;
  try {
    models = new Map(handles.map(([id, handle]) => {
      const geometry = handle.copy(), group = new Group(); copies.push(geometry); group.add(new Mesh(geometry, material)); return [id, group] as const;
    }));
    if (scope.disposed || scope.disposing) throw new Error('World assembly owner left');
  } catch (error) { for (const geometry of copies) geometry.dispose(); material.dispose(); throw error; }
  scope.own(material); for (const geometry of copies) scope.own(geometry);
  publishEntryOwner(scope, 'drawn-models', stage.id, models);
}

// Only construct's private parsed object can lend these rows, during the
// synchronous cursor creation below. No caller input, owner or pending build
// enters this table; public admit always parses unproven values.
const constructionStages = new WeakMap<object, readonly WorldAssemblyStage[]>();

/** G571: an admitted world assembly (format/worldAssembly), run stage by stage in its declared order. Client-only. */
export class WorldAssembly {
  /** Resolve the declared native metadata prelude before the caller creates programs or reports progress.
   * Geometry loading and loan publication stay at their declared fixed-draw stage. */
  static async prepareNative(input: unknown, ctx: ShardContext): Promise<FixedDraws> {
    const row = v.parse(WorldAssemblySchema, input).construction?.prelude;
    if (row === undefined) throw new Error('World native prelude needs its declared draws');
    const { scope, product, game } = ctx, runtime = game.runtime, world = runtime?.world;
    if (runtime === undefined || world === undefined || world === null) throw new Error('World native prelude needs its original world');
    const owner = world.game.levelScope, nativeGame = world.game, read = product.json;
    const live = (): void => {
      if (scope.disposed || scope.disposing || owner.disposed || owner.disposing || ctx.scope !== scope || ctx.product !== product
        || ctx.game !== game || game.runtime !== runtime || runtime.world !== world || world.game !== nativeGame
        || nativeGame.levelScope !== owner || product.json !== read) throw new Error('World native prelude owner left or changed');
    };
    live();
    const draws = await productFixedDraws(product, row.draws);
    live();
    return draws;
  }

  /** One walk of the declared stages, retaining native checkpoint and progress
   * boundaries. A stage-only row has no progress, prelude or release actions.
   * The caller keeps its original resident cache and lending. */
  static async construct(input: unknown, ports: WorldConstructionPorts): Promise<Record<string, Object3D>> {
    const parsed = v.parse(WorldAssemblySchema, input), rows = parsed.construction, stages = admittedRows(parsed);
    const native = ports.native;
    if (stages.some(stage => ['water-surface','dressing-piece','dressing-anchor','dressing','arena-room','painted-reseed','painted-world'].includes(stage.kind)) && native === undefined) throw new Error('World construction needs its original native context');
    const { runtime, scope, product, library, scenes, baked } = ports, world = runtime.world;
    if (native !== undefined && (native.scope !== scope || native.product !== product || native.game.runtime !== runtime)) throw new Error('World construction native owners changed');
    if (world === null) throw new Error('World construction needs its native world');
    const { game, sky, player, registry, physics } = world, scene = game.scene, viewer = runtime.viewer, read = product.file, json = product.json, originalDraws = ports.draws;
    const nativeGame = native?.game, nativeOwner = native === undefined ? undefined : game.levelScope;
    const borrowedDressing = native !== undefined && stages.some(stage => stage.kind === 'dressing-piece' || stage.kind === 'dressing-anchor' || stage.kind === 'dressing') ? SceneDressing.current(native) : undefined;
    const waters = native !== undefined && stages.some(stage => stage.kind === 'water-surface') ? clientWaterSurfaces(native) : undefined;
    const borrowed = stages.flatMap(stage => {
      if (stage.kind === 'water-surface') { const surface = waters?.get(stage.surface); if (surface === undefined) throw new Error('Missing declared water surface'); return [surface.group]; }
      if (stage.kind === 'dressing-piece') { const piece = borrowedDressing?.pieces.get(stage.part); if (piece === undefined) throw new Error('Missing declared dressing piece'); return [piece.object]; }
      return [];
    });
    let publication: { readonly id: string; readonly root: Object3D } | undefined;
    const live = (): void => {
      if (native !== undefined && (ports.native !== native || native.scope !== scope || native.product !== product || native.game.runtime !== runtime)) throw new Error('World construction native owners changed');
      if (ports.runtime !== runtime || ports.scope !== scope || ports.product !== product || scope.disposed || scope.disposing || nativeOwner !== undefined && (nativeOwner.disposed || nativeOwner.disposing || game.levelScope !== nativeOwner || native?.game !== nativeGame) || runtime.world !== world || world.player !== player || world.game !== game || world.registry !== registry
        || world.sky !== sky || world.physics !== physics || game.scene !== scene || runtime.viewer !== viewer
        || product.file !== read || product.json !== json || ports.draws !== originalDraws || library !== undefined && library.product !== product) throw new Error('World construction owner left or changed');
      if (native !== undefined && (borrowedDressing !== undefined && SceneDressing.current(native) !== borrowedDressing || waters !== undefined && clientWaterSurfaces(native) !== waters)) throw new Error('World construction borrowed owners changed');
      let borrowedAt = 0, borrowedChanged = false;
      // Keep every ordered owner lookup, without allocating a flattened stage
      // array at each construction checkpoint (usually most stages borrow none).
      for (const stage of stages) {
        if (stage.kind === 'water-surface') {
          borrowedChanged = (waters?.get(stage.surface)?.group !== borrowed[borrowedAt++]) || borrowedChanged;
        } else if (stage.kind === 'dressing-piece') {
          borrowedChanged = (borrowedDressing?.pieces.get(stage.part)?.object !== borrowed[borrowedAt++]) || borrowedChanged;
        }
      }
      if (borrowedChanged) throw new Error('World construction borrowed objects changed');
      if (publication !== undefined && entryOwner(scope, 'object', publication.id) !== publication.root) throw new Error('World construction root changed');
    };
    live();
    const create = (root: Object3D, slice: WorldAssemblyPorts['slice'], draws: FixedDraws | undefined, cells?: Uint8Array): WorldAssembly => {
      constructionStages.set(parsed, stages);
      try { return WorldAssembly.admit(parsed, {
        scope, ...(scenes === undefined ? {} : { scenes }), ...(native === undefined ? {} : { weatherContext: native }), ...(ports.sites === undefined ? {} : { sites: ports.sites }),
        context: sharedModelContext(sky, game), registry, slice, product, ...(draws === undefined ? {} : { draws }), physics, fixed: game,
        ...(cells === undefined ? {} : { cover: { cells, viewer, updates: game } }),
        entry: { root, scope, tier: game.tier, physics, ...(ports.variant === undefined ? {} : { variant: ports.variant }), piece: piece => { registry.add(piece); } },
      }); } finally { constructionStages.delete(parsed); }
    };
    if (rows === undefined) {
      const assembly = create(scene, () => Promise.resolve(), originalDraws ?? library?.loaded());
      for (const stage of stages) { live(); await assembly.next(stage.id); live(); }
      return {};
    }
    if (rows.prelude !== undefined) {
      if (native === undefined || originalDraws === undefined) throw new Error('World construction needs its native prelude draws');
      const prepared = await WorldAssembly.prepareNative(parsed, native); live();
      if (prepared !== originalDraws) throw new Error('World construction replaced its native prelude draws');
    }
    const explicit = rows.progress.kind === 'checkpoints';
    if (stages.some(stage => ['water-surface','dressing-piece','dressing-anchor','dressing','fixed-draws','painted-reseed'].includes(stage.kind)) && !explicit) throw new Error('World borrowed stages need explicit checkpoints');
    if (stages.some(stage => stage.kind === 'fixed-draws') && ports.draws === undefined) throw new Error('World construction needs its original fixed draws');
    if (!explicit && rows.progress.start === undefined) throw new Error('World automatic progress needs its start label');
    const names = rows.groups ?? [], objectIds = new Set(stages.filter(stage => loanKinds(stage).includes('object')).map(stage => stage.kind === 'streamed-cover' ? stage.object : stage.id));
    if (rows.root !== undefined) objectIds.add(rows.root.id);
    if (new Set(names.map(row => row.name)).size !== names.length || names.some(row => !objectIds.has(row.object))) throw new Error('World groups need distinct names and declared object loans');
    const variants = rows.variant;
    if (variants !== undefined && ports.variant !== variants.standalone && ports.variant !== variants.cell) throw new Error('World construction needs its selected variant');
    if ((rows.gpu?.roots ?? []).some(ref => ref.when !== undefined && (variants === undefined || ref.when.variant !== variants.standalone && ref.when.variant !== variants.cell))) throw new Error('World GPU root names an undeclared variant');
    if (library === undefined && stages.some(stage => stage.kind === 'rope-deck' || stage.kind === 'ambient-flock' || stage.kind === 'streamed-cover' || stage.kind === 'site' && stage.life !== undefined)) throw new Error('World construction needs its fixed-draw library');
    if (rows.cells === undefined && stages.some(stage => stage.kind === 'streamed-cover')) throw new Error('World construction needs its cover cells');
    const checkpoints = new Map<string, WorldConstructionRows['checkpoints'][number]>();
    const floors = new Set<string>();
    for (const stage of stages) {
      const before = rows.checkpoints.filter(check => check.stage === stage.id && check.at === 'before');
      for (const check of before) for (const action of check.actions) if (action.kind === 'entry-floor' && !floors.has(action.floor)) throw new Error('World checkpoint floor is not constructed yet');
      if (loanKinds(stage).includes('floor')) floors.add(stage.id);
      const after = rows.checkpoints.filter(check => check.stage === stage.id && check.at === 'after');
      for (const check of after) for (const action of check.actions) if (action.kind === 'entry-floor' && !floors.has(action.floor)) throw new Error('World checkpoint floor is not constructed yet');
    }
    for (const check of rows.checkpoints) {
      const key = `${check.at}:${check.stage}`;
      if (!stages.some(stage => stage.id === check.stage) || checkpoints.has(key)) throw new Error('Unknown or repeated world checkpoint');
      checkpoints.set(key, check);
    }
    let last = 0;
    for (const stage of stages) for (const at of ['before', 'after'] as const) for (const action of checkpoints.get(`${at}:${stage.id}`)?.actions ?? []) {
      if (action.kind === 'build-yield' && !explicit) throw new Error('World build yield needs checkpoint progress');
      if (action.kind === 'progress') {
        if (explicit && (action.done === undefined || action.done < last || action.done > rows.progress.total) || !explicit && action.done !== undefined) throw new Error('Invalid world progress checkpoint');
        if (action.done !== undefined) last = action.done;
      }
    }
    const root = rows.root === undefined ? scene : new Group();
    if (rows.root !== undefined) { root.name = rows.root.name; scope.onDispose(() => { root.removeFromParent(); }); }
    let cells: Uint8Array | undefined;
    if (library !== undefined || rows.cells !== undefined) {
      [, cells] = await timeClientPreparation('world', 'assembly:library', () => Promise.all([library?.load(undefined, game.registrationScope, scope), rows.cells === undefined ? undefined : product.file(rows.cells[TIER])]));
      live();
    }
    const draws = ports.draws ?? library?.loaded(), slice = slicer(rows.progress.budgetMs, ports.progress), total = rows.progress.total;
    let completed = 0;
    const complete = async (label: string): Promise<void> => { await slice(++completed, total, label); };
    const assembly = create(root, explicit ? () => Promise.resolve() : complete, draws, cells);
    if (rows.root !== undefined) { publishEntryOwner(scope, 'object', rows.root.id, root); publication = { id: rows.root.id, root }; }
    const checkpoint = async (stage: string, at: 'before' | 'after'): Promise<void> => {
      const check = checkpoints.get(`${at}:${stage}`);
      if (check === undefined) return;
      for (const action of check.actions) {
        live();
        if (action.kind === 'entry-floor') {
          const y = entryOwner(scope, 'floor', action.floor)(player.position.x, player.position.z);
          if (y !== undefined) player.position.y = y;
        } else if (action.kind === 'slice') await slice();
        else if (action.kind === 'progress') { if (explicit) ports.progress?.set(action.done ?? 0, total, action.label); else await complete(action.label); }
        else if (action.kind === 'build-yield') await worldBuildYield({ scope });
        else if (action.kind === 'macrotask') await macrotask();
        else if (action.kind === 'seed') { if (rows.seed !== product.shardfile.identity.seed) throw new Error('Foliage placements require their authored seed'); }
        else if (!baked.has(action.id)) throw new Error(`Missing baked world ${action.id}`);
        live();
      }
    };
    if (rows.progress.start !== undefined) ports.progress?.set(0, total, rows.progress.start);
    for (const stage of stages) {
      live(); await checkpoint(stage.id, 'before'); live();
      await assembly.next(stage.id); live();
      await checkpoint(stage.id, 'after'); live();
    }
    if (!explicit) await slice(total, total, rows.progress.finish); live();
    // Resolve the WHOLE ordered root list before releasing even one CPU copy.
    const roots = (rows.gpu?.roots ?? []).filter(ref => ref.when === undefined || ref.when.variant === ports.variant).map(ref => {
      if (ref.kind === 'object') return ref.id === rows.root?.id ? root : entryOwner(scope, 'object', ref.id);
      if (ref.kind === 'placed') {
        const [placed] = entryOwner(scope, 'placed', ref.id);
        // T3: a stage placed by tile has only its stable root now (the tiles it attaches later keep their CPU copies)
        return placed === undefined ? entryOwner(scope, 'object', ref.id) : placed.object;
      }
      if (ref.kind === 'baked') { const value = baked.get(ref.id); if (value === undefined) throw new Error(`Missing baked world ${ref.id}`); return value.group; }
      if (scenes === undefined) throw new Error('World GPU scene root needs its scene handles');
      return ref.as === 'mesh' ? scenes.mesh(ref.id) : ref.as === 'group' ? scenes.group(ref.id) : scenes.object(ref.id);
    });
    live(); if (rows.gpu !== undefined) gpuOnlyTrees(roots, rows.gpu.label, ['position']);
    return Object.fromEntries(names.map(row => [row.name, entryOwner(scope, 'object', row.object)]));
  }

  private at = 0;
  private constructor(private readonly stages: readonly WorldAssemblyStage[], private readonly ports: WorldAssemblyPorts) {}
  static admit(input: unknown, ports: WorldAssemblyPorts): WorldAssembly {
    const prepared = typeof input === 'object' && input !== null ? constructionStages.get(input) : undefined;
    return new WorldAssembly(prepared ?? admitted(input), ports);
  }

  /** Borrow the completed stages into an entered child, preserving every
   * construction owner. Stage kinds determine the finite loan kinds; no
   * callback, property path or second builder crosses this boundary. */
  static lend(input: unknown, construction: Scope, entered: Scope): void {
    const parsed = v.parse(WorldAssemblySchema, input), stages = admittedRows(parsed);
    if (entered !== construction && !entered.belongsTo(construction)) throw new Error('World assembly needs its construction ancestor');
    const root = parsed.construction?.root;
    const loans = stages.flatMap(stage => loanKinds(stage).map(kind => ({ kind, id: stage.kind === 'streamed-cover' && kind === 'object' ? stage.object : stage.id })));
    if (root !== undefined) loans.unshift({ kind: 'object', id: root.id });
    // Refuse an incomplete build before publishing even its first entered loan.
    for (const { kind, id } of loans) entryOwner(construction, kind, id);
    if (entered !== construction) for (const { kind, id } of loans) lendEntryOwner(entered, construction, kind, id);
  }

  /** Run the next declared stage, which must be `id` (the build keeps the declared order), and publish its loans. Developer
   *  pages time each stage (`wildshard.prepare:world:assembly.<id>`, G626: which stages a tile-ordered home could defer). */
  next(id: string): Promise<void> { return timeClientPreparation('world', `assembly.${id}`, () => this.runStage(id)); }
  private async runStage(id: string): Promise<void> {
    const stage = this.stages[this.at];
    if (stage?.id !== id) throw new Error(`World assembly expected ${stage?.id ?? 'no stage'}, not ${id}`);
    const { scope, scenes } = this.ports;
    // a retired or retiring construction (a sliced ancestor retirement) allocates and publishes nothing more
    const live = (): void => { if (scope.disposed || scope.disposing) throw new Error('World assembly owner left'); };
    live();
    if (stage.kind === 'water-surface' || stage.kind === 'dressing-piece' || stage.kind === 'dressing-anchor' || stage.kind === 'dressing') {
      const ctx = this.ports.weatherContext, runtime = ctx?.game.runtime, world = runtime?.world;
      if (ctx === undefined || runtime === undefined || world === undefined || world === null || ctx.scope !== scope) throw new Error('World borrowing needs its original native context');
      const product = ctx.product, game = world.game;
      const unchanged = (): void => { live(); if (this.ports.weatherContext !== ctx || ctx.scope !== scope || ctx.product !== product || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game) throw new Error('World borrowed owner changed'); };
      unchanged(); this.at++;
      if (stage.kind === 'water-surface') {
        const surface = clientWaterSurfaces(ctx).get(stage.surface);
        if (surface === undefined) throw new Error('Missing declared water surface');
        publishEntryOwner(scope, 'object', stage.id, surface.group);
      } else {
        const dressing = SceneDressing.current(ctx);
        if (stage.kind === 'dressing-piece') {
          const piece = dressing.pieces.get(stage.part);
          if (piece === undefined) throw new Error('Missing declared dressing piece');
          publishEntryOwner(scope, 'object', stage.id, piece.object);
        } else if (stage.kind === 'dressing-anchor') {
          const point = dressing.pieces.get(stage.part)?.anchors[stage.anchor]?.[0];
          publishEntryOwner(scope, 'world-point', stage.id, point === undefined ? null : new Vector3(point.x, point.y, point.z));
        } else {
          if (stage.bindSets) await bindClientPlaceSets(ctx, dressing.placedGroups(), dressing.placed);
          unchanged(); if (SceneDressing.current(ctx) !== dressing) throw new Error('World dressing owner changed');
          publishEntryOwner(scope, 'object', stage.id, dressing.group);
        }
      }
      unchanged(); return;
    }
    if (stage.kind === 'fixed-draws') { this.at++; await installFixedDrawsStage(this.ports, stage); return; }
    if (stage.kind === 'drawn-models') { this.at++; installDrawnModels(this.ports, stage); return; }
    if (stage.kind === 'painted-reseed') { this.at++; installPaintedReseedStage(scope, stage); return; }
    if (stage.kind === 'painted-world') {
      const ctx = this.ports.weatherContext, world = ctx?.game.runtime?.world;
      if (ctx === undefined || world === undefined || world === null || ctx.scope !== scope) throw new Error('Painted construction needs its original native world');
      const game = world.game, runtime = ctx.game.runtime, product = ctx.product, ports = this.ports; this.at++;
      await installPaintedWorldStage({ scope, get nativeScope() {
        if (ports.weatherContext !== ctx || ctx.scope !== scope || ctx.product !== product || ctx.game.runtime !== runtime || runtime?.world !== world || world.game !== game) throw new Error('Painted construction owners changed');
        return game.levelScope; }, get renderer() { return game.renderer; },
        get scene() { return game.scene; }, get sky() { return world.sky; }, get forest() { return world.forest.group; },
        get daySaturation() { return game.level.grade.saturation; } }, stage); return;
    }
    if (stage.kind === 'arena-room') {
      this.at++;
      if ('mode' in stage) {
        const ctx = this.ports.weatherContext, draws = this.ports.draws;
        if (ctx === undefined || draws === undefined || !draws.ready) throw new Error('Room construction needs its original context and draws');
        const runtime = ctx.game.runtime, world = runtime?.world, product = ctx.product, read = product.json, dressing = SceneDressing.current(ctx);
        if (world === undefined || world === null) throw new Error('Room construction needs its original world');
        const game = world.game, scene = game.scene, owner = game.levelScope;
        const unchanged = (): void => { live(); if (owner.disposed || owner.disposing || this.ports.weatherContext !== ctx || this.ports.draws !== draws
          || ctx.scope !== scope || ctx.product !== product || product.json !== read || ctx.game.runtime !== runtime || runtime?.world !== world
          || world.game !== game || game.scene !== scene || game.levelScope !== owner || SceneDressing.current(ctx) !== dressing) throw new Error('Room construction owner changed'); };
        unchanged();
        const vacant = (): void => { if (presentEntryOwner(scope, 'arena-room', stage.id) !== null || presentEntryOwner(scope, 'object', stage.id) !== null) throw new Error('Room construction loan is already published'); };
        vacant();
        const data = v.parse(v.strictObject({room:v.unknown(),encounter:v.unknown()}), await product.json<unknown>(stage.file)); unchanged();
        const entrance = dressing.pieces.get(stage.entrance.part)?.anchors[stage.entrance.anchor]?.[0] ?? null;
        const encounter = await buildArenaRoomEncounter(ArenaRoomEncounter, ctx, data.room, data.encounter, draws, entrance); unchanged(); vacant();
        publishEntryOwner(scope, 'arena-room', stage.id, encounter); publishEntryOwner(scope, 'object', stage.id, encounter.dungeon.group);
      } else {
        const encounter = await buildArenaRoomEncounter(ArenaRoomEncounter,{kind:'open',ports:this.ports,rows:stage}); live(); publishEntryOwner(scope,'arena-room',stage.id,encounter);
      }
      return;
    }
    if (scenes === undefined) throw new Error('World scene stage needs its original scene handles');
    const lifeRow = stage.kind === 'site' ? stage.life : undefined;
    const lifePorts = lifeRow === undefined ? undefined : (() => {
      const draws = this.ports.draws, product = this.ports.product;
      if (draws === undefined || !draws.ready || product === undefined) throw new Error('World site life needs loaded draws and its product');
      const draw = draws.handle(lifeRow.cloud.draw), material = hasLentLook(lifeRow.cloud.look) ? lentLook(lifeRow.cloud.look) : null;
      if (scenes.has(lifeRow.root)) throw new Error('World site life root is already published');
      return { draws, draw, product, read: product.file, material };
    })();
    this.at++;
    if (stage.kind === 'streamed-cover') {
      const cover = this.ports.cover, draws = this.ports.draws, product = this.ports.product, root = this.ports.entry?.root;
      if (cover === undefined || draws === undefined || !draws.ready || product === undefined || root === undefined) throw new Error('World cover needs its cells, draws, product and native authority');
      if (typeof cover.viewer !== 'function' || typeof cover.updates.onUpdate !== 'function' || typeof product.file !== 'function') throw new Error('World cover needs its native reader, update and viewer');
      const read = product.file, viewer = cover.viewer, updates = cover.updates, onUpdate = updates.onUpdate, cells = cover.cells;
      const needed = new Set(stage.rows.kinds.flatMap(kind => [kind.geometry, ...kind.far === undefined ? [] : [kind.far.geometry]]));
      if (needed.size !== Object.keys(stage.draws).length || [...needed].some(key => !Object.hasOwn(stage.draws, key))) throw new Error('World cover needs its exact geometry bindings');
      const handles = Object.entries(stage.draws).map(([name, slot]) => {
        if (scenes.has(name)) throw new Error('World cover geometry is already published');
        return { name, slot, handle: draws.handle(slot) };
      });
      const looks = stage.rows.kinds.flatMap(kind => [ ...kind.far === undefined ? [] : [`${stage.rows.look}-${kind.name}-far`], `${stage.rows.look}-${kind.name}` ]).map(lookId => ({ id: lookId, material: lentLook(lookId), toon: lentToon(lookId) }));
      const lighting = toonLightingOf(stage.rows.lighting);
      const unchanged = (): void => {
        live();
        if (this.ports.scenes !== scenes || this.ports.cover !== cover || cover.viewer !== viewer || cover.updates !== updates || updates.onUpdate !== onUpdate || cover.cells !== cells
          || this.ports.draws !== draws || !draws.ready || this.ports.product !== product || product.file !== read || this.ports.entry?.root !== root
          || toonLightingOf(stage.rows.lighting) !== lighting || handles.some(row => draws.handle(row.slot) !== row.handle)
          || looks.some(row => lentLook(row.id) !== row.material || lentToon(row.id) !== row.toon)) throw new Error('World cover owners changed');
      };
      const bytes = await product.file(stage.file); unchanged();
      const composition = v.parse(CoverCompositionSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (composition.placement !== stage.placement) throw new Error('World cover placement differs from its binding');
      const placed = await scenes.place(stage.placement); unchanged();
      if (!scenes.has(composition.mesh)) throw new Error('World cover companion is missing');
      for (const { name, handle } of handles) scenes.publish(name, handle.copy());
      const field = createStreamedCover(scenes, stage.rows, cells); field.group.name = composition.name;
      const logs = scenes.mesh(composition.mesh); Object.assign(logs.userData, composition.userData); field.group.add(logs);
      unchanged(); root.add(field.group); updates.onUpdate(dt => { field.update(dt, viewer()); }, stage.system);
      unchanged(); publishEntryOwner(scope, 'object', stage.object, field.group); publishEntryOwner(scope, 'placed', stage.id, [placed]);
    } else if (stage.kind === 'ambient-flock') {
      const draws = this.ports.draws, root = this.ports.entry?.root;
      if (draws === undefined || !draws.ready || root === undefined) throw new Error('World ambient flock needs loaded draws and its root');
      const draw = draws.handle(stage.draw.slot), material = lentLook(stage.draw.look);
      const flock = createAmbientFlock(stage.rows, { name: stage.draw.look, geometry: draw.copy(), material: material.clone(), castShadow: stage.draw.castShadow }, stage.perches);
      root.add(flock.group);
      publishEntryOwner(scope, 'object', stage.id, flock.group); publishEntryOwner(scope, 'ambient-draw', stage.id, flock); publishEntryOwner(scope, 'ambient', stage.id, flock.flock);
    } else if (stage.kind === 'rope-deck') {
      const draws = this.ports.draws, registry = this.ports.registry;
      if (draws === undefined || !draws.ready) throw new Error('World rope deck needs loaded fixed draws');
      if (registry === null) throw new Error('World rope deck needs its registry');
      draws.handle(stage.site.draws.specimen); draws.handle(stage.site.draws.world);
      const site = new RopeDeckSite(stage.site, { get ready() { return draws.ready; }, draw: slot => draws.handle(slot), load: () => draws.load() });
      const deck = site.place(this.ports.context.sky, stage.span, registry);
      publishEntryOwner(scope, 'object', stage.id, deck.placed.object); publishEntryOwner(scope, 'placed', stage.id, [deck.placed]);
      publishEntryOwner(scope, 'floor', stage.id, deck.floorHeightAt); publishEntryOwner(scope, 'rope-deck', stage.id, deck);
    } else if (stage.kind === 'rope-chain') {
      const physics = this.ports.physics, fixed = this.ports.fixed;
      if (physics === undefined || fixed === undefined) throw new Error('World rope chain needs its physics and fixed-post authority');
      const deck = entryOwner(scope, 'rope-deck', stage.deck), chain = new RopeChain(physics, deck.chainSpec());
      fixed.onFixed('post', () => { chain.capture(); }, stage.capture);
      publishEntryOwner(scope, 'chain', stage.id, chain);
    } else if (stage.kind === 'place') {
      // tile streaming T3: by tile, its stable root now and its copies as the tile driver attaches them (T4); it places
      // a frozen graph's complete-placement dependency keeps its existing whole owner instead
      const whole = scenes.requiresWhole(stage.id) ? await scenes.place(stage.id) : null;
      if (whole === null) scenes.tile(stage.id);
      publishEntryOwner(scope, 'object', stage.id, scenes.object(`${stage.id}.root`)); publishEntryOwner(scope, 'placed', stage.id, whole === null ? [] : [whole]);
      publishEntryOwner(scope, 'floor', stage.id, (x, z) => scenes.floorAt(stage.id, x, z));
    } else if (stage.kind === 'site') {
      const sites = this.ports.sites; if (sites === undefined) throw new Error('World assembly site needs its catalogue');
      const site = scope.run(() => sites.site(stage.model, stage.choice, this.ports.context, this.ports.registry));
      publishEntryOwner(scope, 'object', stage.id, site.group); publishEntryOwner(scope, 'placed', stage.id, [site.placed]);
      publishEntryOwner(scope, 'site', stage.id, site.anchors); publishEntryOwner(scope, 'floor', stage.id, site.floorHeightAt);
    } else if (stage.kind === 'entry') {
      const ports = this.ports.entry; if (ports === undefined) throw new Error('World assembly entry needs its entry ports');
      if (ports.piece === undefined && stage.rows.some(row => row.kind === 'piece')) throw new Error(`World assembly entry ${stage.id} needs its piece registration`);
      if (ports.physics === undefined && stage.rows.some(row => row.kind === 'cut')) throw new Error(`World assembly entry ${stage.id} needs its physics`);
      const entry = WorldEntry.admit({ blocks: { [stage.id]: stage.rows } }, { ...ports, scenes, fence: live });
      await entry.run(stage.id);
      live();
      publishEntryOwner(scope, 'placed', stage.id, []);   // its places go by tile (the tile driver attaches them)
      const object = stage.object, floor = stage.floor;
      if (object !== undefined) publishEntryOwner(scope, 'object', stage.id, object.as === 'group' ? scenes.group(object.part) : object.as === 'mesh' ? scenes.mesh(object.part) : scenes.object(object.part));
      if (floor !== undefined) publishEntryOwner(scope, 'floor', stage.id, (x, z) => scenes.floorAt(floor, x, z));
    } else publishEntryOwner(scope, 'object', stage.id, stage.kind === 'mesh' ? scenes.mesh(stage.part) : scenes.group(stage.part));
    await this.ports.slice(stage.label);
    live();
    if (lifeRow !== undefined && lifePorts !== undefined) {
      const group = entryOwner(scope, 'object', stage.id);
      const unchanged = (): void => {
        live();
        const material = hasLentLook(lifeRow.cloud.look) ? lentLook(lifeRow.cloud.look) : null;
        if (this.ports.product !== lifePorts.product || lifePorts.product.file !== lifePorts.read || this.ports.draws !== lifePorts.draws || !lifePorts.draws.ready
          || lifePorts.draws.handle(lifeRow.cloud.draw) !== lifePorts.draw || material !== lifePorts.material
          || entryOwner(scope, 'object', stage.id) !== group) throw new Error('World site life owners changed');
      };
      unchanged();
      scenes.publish(lifeRow.root, group);
      group.add(createBuildingCloud(scenes, { ...lifeRow.cloud.pose, geometry: scenes.lend(lifePorts.draw.copy()),
        material: lifePorts.material === null ? null : scenes.lend(lifePorts.material), visible: lifePorts.material !== null }));
      const bytes = await lifePorts.product.file(lifeRow.file);
      unchanged();
      if (scenes.object(lifeRow.root) !== group) throw new Error('World site life root changed');
      const data = v.parse(BuildingLifeDocumentSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      const life = new LivingBuildings(scenes, data.look); life.add(data.life); life.setDusk(data.initialDusk); life.update(0);
      unchanged(); publishEntryOwner(scope, 'buildings', stage.id, life);
    }
  }

  /** Every declared stage ran. */
  get done(): boolean { return this.at === this.stages.length; }
}

/** Admit an assembly: unique stage ids, every placement placed once across it (place stages and entry place rows), and
 *  an entry's floor one of its own unconditional place rows. */
function admitted(input: unknown): readonly WorldAssemblyStage[] {
  return admittedRows(v.parse(WorldAssemblySchema, input));
}

/** Validate one invocation's private parsed snapshot; never memoize mutable caller input. */
function admittedRows({ stages, construction }: WorldAssemblyRows): readonly WorldAssemblyStage[] {
  const owners = stages.flatMap(stage => loanKinds(stage).length === 0 ? [] : [stage.kind === 'streamed-cover' ? stage.object : stage.id]);
  if (construction?.root !== undefined) owners.push(construction.root.id);
  if (owners.some(id => !/^[A-Za-z][A-Za-z0-9_.:-]{0,255}$/u.test(id))) throw new Error('Invalid world assembly owner id');
  if (new Set(stages.map(stage => stage.id)).size !== stages.length) throw new Error('Repeated world assembly owner');
  const placements = stages.flatMap(stage => stage.kind === 'streamed-cover' ? [stage.placement] : stage.kind === 'place' || stage.kind === 'rope-deck' ? [stage.id] : stage.kind === 'entry' ? stage.rows.flatMap(row => row.kind === 'place' ? [row.id] : []) : []);
  if (new Set(placements).size !== placements.length) throw new Error('Repeated world assembly placement');
  for (const stage of stages) if (stage.kind === 'entry' && stage.floor !== undefined && !stage.rows.some(row => row.kind === 'place' && row.id === stage.floor && row.when === undefined)) {
    throw new Error(`World assembly entry ${stage.id} floor needs its unconditional place row`);
  }
  const objectIds = stages.flatMap(stage => loanKinds(stage).includes('object') ? [stage.kind === 'streamed-cover' ? stage.object : stage.id] : []);
  if (construction?.root !== undefined) objectIds.push(construction.root.id);
  if (new Set(objectIds).size !== objectIds.length) throw new Error('Repeated world assembly object');
  const decks = new Set<string>(), chained = new Set<string>(), captures = new Set<string>();
  for (const stage of stages) {
    if (stage.kind === 'rope-deck') decks.add(stage.id);
    if (stage.kind === 'rope-chain') {
      if (!decks.has(stage.deck)) throw new Error('World rope chain needs an earlier rope-deck stage');
      if (chained.has(stage.deck) || captures.has(stage.capture)) throw new Error('Repeated world rope chain or capture');
      chained.add(stage.deck); captures.add(stage.capture);
    }
  }
  return stages;
}

/** The loan kinds a stage publishes, from its declaration alone. */
function loanKinds(stage: WorldAssemblyStage): readonly ('object' | 'placed' | 'site' | 'floor' | 'rope-deck' | 'chain' | 'buildings' | 'ambient-draw' | 'ambient' | 'world-weather' | 'arena-room' | 'fixed-draws' | 'drawn-models' | 'world-point' | 'painted-world')[] {
  if (stage.kind === 'dressing-anchor') return ['world-point'];
  if (stage.kind === 'arena-room') return 'mode' in stage ? ['arena-room', 'object'] : ['arena-room'];
  if (stage.kind === 'painted-world') return ['painted-world', 'object'];
  if (stage.kind === 'fixed-draws') return ['fixed-draws'];
  if (stage.kind === 'drawn-models') return ['drawn-models'];
  if (stage.kind === 'painted-reseed') return [];
  if (stage.kind === 'streamed-cover') return ['object', 'placed'];
  if (stage.kind === 'ambient-flock') return ['object', 'ambient-draw', 'ambient'];
  if (stage.kind === 'rope-deck') return ['object', 'placed', 'floor', 'rope-deck'];
  if (stage.kind === 'rope-chain') return ['chain'];
  if (stage.kind === 'site') return ['object', 'placed', 'site', 'floor', ...stage.life === undefined ? [] : ['buildings'] as const];
  if (stage.kind === 'place') return ['object', 'placed', 'floor'];
  if (stage.kind === 'entry') return ['placed', ...stage.object === undefined ? [] : ['object'] as const, ...stage.floor === undefined ? [] : ['floor'] as const];
  return ['object'];
}

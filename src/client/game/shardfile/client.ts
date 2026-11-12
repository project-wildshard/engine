import {readModuleGroups} from '@wildshard/engine/boot/download';
import { whenControl } from '@wildshard/engine/boot/prefetch';
import type * as ScriptPresentation from '../plugin/ui';
import type { Scope } from '@wildshard/engine/app/scope';
import type * as LootPresentation from '../loot/runtime';
import type * as CompendiumPresentation from '../compendium/install';

import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import { addBakedTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import { retireTerrain } from '@wildshard/engine/physics/terrain';
import { timeClientPreparation } from './preparationTiming';
import { wirePage } from './wirePage';
import { admitClientPlan, installClientPhase, type AdmittedClientPlan, type ClientPhase } from './clientPlan';
import { materialTextureRefs } from '@wildshard/format/materials';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { bindSceneSourceLooks } from './sceneSources';
import { bindPaintedMaterialMaps } from '../looks/paintedLook';
import { installCompletion } from '../complete/declared';
import { retainsRuntimeServices } from '../shard/retainedHooks';
import { installPageItemContexts } from './pageItems';
import { ktx2TranscodeSupport } from '@wildshard/engine/core/ktx2';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import { renderCount } from '@wildshard/engine/render/frameCounter';
import { playerModes } from '@wildshard/engine/player/modes';
import { enteredOwner, withOwner } from '@wildshard/engine/app/ownership';
import { macrotask } from '@wildshard/engine/boot/plan';
import { loadingUnits } from '@wildshard/engine/boot/waits';
import { Mesh, Object3D, Vector3 } from 'three';
import { QuestState } from '@wildshard/engine/quest/core';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { Actor, CombatTarget } from '@wildshard/engine/combat/pipeline';
import { fovForAspect } from '@wildshard/engine/combat/blocks/melee';
import type { ItemTarget } from '@wildshard/engine/combat/items';
import type { ItemFamily } from '@wildshard/engine/combat/itemFamilies';
import type { EquipmentIcon } from '@wildshard/engine/combat/Equipment';
import { installDeclaredAudio, type DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import { TIER } from '@wildshard/engine/core/tier';
import type { ShardContext } from "../plugin/context";
import type { ShardPlayHost } from '../../../shared/game/shard/runtime';
import { installDeclaredPlumbing } from '../shard/declaredPlumbing';
import { declaredProductCompendium, declaredDay, declaredWeather } from '../../../shared/game/shard/declaredRows';
import { installDeclaredTargets } from '../shard/declaredTargets';
import { installDeclaredTalks } from './declaredTalks';
import { mountDeclaredUi } from '../shard/declaredUi';
import type { ClientScriptViewTarget } from "../plugin/ui";
import type { ClientScriptTarget } from '@wildshard/format/clientScripts';
import { Ledger, type LedgerCatalogueItem } from '../../../shared/game/ledger';
import { EmptyEquipment } from './emptyEquipment';
import { BossRowBar } from '../boss/barFeed';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { PageResidency, HomeResidencyClaim } from '../grid/pageResidency';
import { leaseClientLibrary } from './clientLibrary';
import { compendiumSketches } from '@wildshard/format/compendiumSketches';
import { clientMaterials } from './clientMaterials';
import { splatGroundDrawn, splatGroundFiles, withSplatGround } from './clientSplatTerrain';
import { lendLooks, lendSceneMaterials } from './lentLooks';
import type { GraphSources } from './clientGraphs';
import { clientPostStack, type ClientPost } from './clientPost';
import { loadScenePostGraphCompiler } from '@wildshard/engine/render/graphBackend';
import { frameLookOf } from '../grid/frameLook';
import { clientSpeciesLooks, type ShardViewRecipe } from './clientRecipes';
import { loadItemModels } from './itemModels';
import { loadClientSkins, type ClientSkin } from './clientSkins';
import { clientViews } from './clientViews';
import { createShardfileClientScripts, captureClientScriptPosition } from './clientScripts';

import { installClientWater, undrawnWater } from './clientWater';
import { standaloneClientTiles } from './tileContent';
import { tileRing } from './tileDriver';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { clientScene, handledItemInputs, itemScene } from './clientItems';
import { installShardfileColliders } from '../../../shared/game/shardfile/collisionBindings';
import type { ClientAssets } from './clientAssets';
import { installDeclaredItems, leverLines, type DeclaredItems } from '../../../shared/game/shardfile/items';
import { declaredLever } from '../plugin/weaponFamily';
import { runtimeBoundWorldFiles, withoutRuntimeRows } from "../../../shared/game/plugin/runtimeRows";
import type { Shardfile } from '@wildshard/format/shardSchema';
import { nearPlaceholderRoots } from '@wildshard/format/nearPlaceholder';

function isProofMesh(value: Object3D): value is Mesh { return value instanceof Mesh; }

function isItemModel(value: unknown): value is Object3D { return value instanceof Object3D; }

/** Trusted catalogue dependencies are injected by the normal composition root, never imported upward by the loader. */
export interface ShardfileClientBindings {
  recipes: ReadonlyMap<string, ShardViewRecipe>; items: ReadonlyMap<string, ItemFamily>; icon: (name: string) => EquipmentIcon;
  voices: (audio: ShardPlayHost['audio']) => DeclaredAudioPorts['voices']; catalogue: readonly LedgerCatalogueItem[];
  instance: string;
  allocator?: ResidencyAllocator;
  /** Own admitted card/map URLs through hydration, replacement and final retirement. */
  imageOwner?: Scope;
  /** Optional grid-page owner, created before hydration. Runtime homes reuse its reviewed early claim. */
  residency?: PageResidency;
  /** Explicit first-party transition policy: a completely empty data declaration adds no gameplay services. */
  trustedRuntime?: boolean;
  /** Transitional entry owns its stages, while client/plan still installs platform features. */
  runtimeStagesOnly?: boolean;
  /** Hybrid runtimes install entered features on their actual entered context. */
  planLifetime?: 'resident';
  /** Declared audio is the default. A trusted first-party transition may let its runtime consume the same audio declaration exactly once. */
  audioOwner?: 'declared' | 'runtime';
  /** Declared water rows and collider-only props are installed by the data client by default. A trusted first-party transition may
   *  let its runtime consume them exactly once (G164: Driftwood's sea row with its dry sockets and its socket landings). */
  worldOwner?: 'declared' | 'runtime';
  /** Platform installers receive the emitted audio declaration and its admitted recording reader.
   * An absent reader preserves existing trusted catalogue resolution; a declared reader refuses unknown paths. */
  audioProfiles?: (play: ShardPlayHost, product: { source: Shardfile['audio']; read: ((path: string) => Promise<ArrayBuffer>) | undefined }) => DeclaredAudioPorts['profiles'];
  /** Announced during construction only when this data client will create a simulation; empty trusted transitions never announce a handoff. */
  onSimulationExpected?: () => void;
  /** Production handoff to a grid home; the server keeps its saves, so `checkpoint` says only that this page still stands. */
  onSimulation?: (binding: { scope: ShardContext['scope']; checkpoint: () => boolean; setActive: (active: boolean) => void; residency?: HomeResidencyClaim }) => void;
}

/** G348: the far proxy's and near placeholder's files (and what they depend on): the grid's presentation of the shard,
 *  which `wildshard build` bakes into any terrain shardfile and the data client never installs. */
function placeholderFiles(source: Shardfile): ReadonlySet<string> {
  const files = new Map(source.files.map(file => [file.hash, file])), out = new Set<string>(), pending = [...(source.far?.files ?? []), ...nearPlaceholderRoots(source.near)];
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) if (!out.has(ref)) { out.add(ref); pending.push(...(files.get(ref)?.dependencies ?? [])); }
  return out;
}

function emptyHybridData(source: Shardfile, audioOwner: ShardfileClientBindings['audioOwner'], worldOwner: ShardfileClientBindings['worldOwner']): boolean {
  // a runtime-owned world declaration: water rows and props that only declare colliders (no tiles, panels, models, far or textures)
  const runtimeWorld = worldOwner === 'runtime', props = source.props;
  // G348: placeholders (a far proxy, a near row and their files) are grid presentation, never data this client installs, so a
  // trusted transition that ships them stays empty (Signal's play stage, 54603cb17); an authored props far still counts
  const placeholders = placeholderFiles(source), shown = (ref: string): boolean => ref !== source.map?.image && ref !== source.navigation?.file && !placeholders.has(ref);
  const propsEmpty = props === null || (runtimeWorld && props.tiles.length + props.panels.length + props.models.length + props.textures.length === 0 && props.far === null);
  const audioEmpty = audioOwner === 'runtime' || (source.audio.cues.length + source.audio.routing.length === 0 && source.audio.ambience === null && source.audio.score === 'silent' && source.audio.music === undefined && source.audio.samples === undefined && source.audio.zones === undefined);
  // Named blobs are an admitted inventory, not a request to install a second
  // simulation. A trusted runtime-owned world reads those bytes itself; actual
  // behavior and presentation declarations below still select their data host.
  const inventory = runtimeWorld ? 0 : source.files.filter(file => shown(file.hash)).length + source.requires.commons.length
    + source.library.filter(shown).length + source.critical.filter(ref => ref !== source.navigation?.file).length;
  return (source.modes?.traverse.length ?? 0) + source.movers.length + source.crowds.length + source.clientScripts.bindings.length + inventory + source.requires.capabilities.length + source.tiles.length + source.ui.length + source.sim.scripts.length + source.sim.bindings.length + source.state.shared.length + source.state.player.length + Object.values(source.rows).reduce((sum, rows) => sum + rows.length, 0) + (runtimeWorld ? 0 : source.water.length) + source.creatures.brains.length + source.creatures.groups.length + source.creatures.spawns.length + source.encounters.length + Object.values(source.quests).reduce((sum, rows) => sum + rows.length, 0) + source.ledger.length + source.hooks.conditions.length + source.hooks.scenes.length + source.items.rows.length + source.items.contexts.length + source.targets.panels.length + source.targets.interactions.length + (source.targets.talks?.length ?? 0) + source.look.families.length + source.look.keys.length + Object.keys(source.look.materials).length + Object.keys(source.look.familyLooks).length === 0
    && source.terrain === null && propsEmpty && (source.plumbing === null || source.plumbing.input.length + source.plumbing.debug.length === 0)
    && audioEmpty && source.look.grade.lut === null
    && source.look.day === undefined && source.look.dayOverride === null;
}

/**
 * G345: a trusted hybrid's data without its presentation sections: the terrain (its collider and tiles) and the look's
 * family materials (their entries, family looks and curves, and the textures only they name). When this is empty the data
 * is presentation-only: its runtime keeps the simulation and the data client only draws.
 */
/** D74: the catalogue's graph files and the textures their rows name (presentation, as an inline graph's were) */
function graphFileRefs(source: Shardfile): string[] {
  const rows = new Map(source.files.map((file) => [file.hash, file]));
  const refs: string[] = [];
  for (const entry of Object.values(source.look.materials)) if (entry.family === 'graph' && 'file' in entry) refs.push(entry.file, ...rows.get(entry.file)?.dependencies ?? []);
  return refs;
}
function withoutPresentation(source: Shardfile): Shardfile {
  // a splat ground's tiles and layers are presentation too (P1: the ground a trusted runtime's data client draws)
  const files = new Set([...(source.terrain === null ? [] : [source.terrain.collider,
    ...(source.terrain.sampling === undefined ? [] : [source.terrain.sampling.file]), ...source.terrain.tiles.map((tile) => tile.file)]), ...materialTextureRefs(source.look.materials), ...graphFileRefs(source), ...splatGroundFiles(source)]);
  const keep = (ref: string): boolean => !files.has(ref);
  return { ...source, terrain: null, props: source.props === null ? null : { ...source.props, tiles: source.props.tiles.filter(tile => keep(tile.file)) }, files: source.files.filter((file) => keep(file.hash)), critical: source.critical.filter(keep), library: source.library.filter(keep),
    tiles: source.tiles.flatMap((tile) => { const kept = tile.files.filter(keep); return kept.length === 0 ? [] : [kept.length === tile.files.length ? tile : { ...tile, files: kept }]; }),
    look: { ...source.look, families: [], materials: {}, familyLooks: {} } };
}

/** Look-only trusted data draws with its native world and never creates another gameplay owner. */
type DataMode = 'full' | 'empty' | 'presentation';
/** How far (m) the viewer moves before the tile residency re-centres, when the terrain declares no `follow`. */
const FOLLOW = 5;

/** The existing Game's world/kit/play stages install one authored level, one borrowed simulation and the normal equipment/HUD. */
/** SR11 (C9): on the wire an item request is the scene the server takes it by. False: no wire or no scene, so it queues on this page. */
function relayItem(source: Shardfile, item: string, action: number): boolean {
  const scene = itemScene(source, item, action);
  if (scene === undefined || wirePage.client === null) return false;
  wirePage.send(scene); return true;
}
/** the declared days shardfile runtimes own (G580 T1: never borrowed by another runtime) */
const runtimeDays = new WeakSet();

/** LS8 (J204): the world hook's atomic sub-steps, counted on its loading step (Driftwood's props step ran 2.7-3.6 s at 4x CPU
 *  with no count). WORLD_STEPS is their number on a full standalone world; a shorter mode ends its step early. */
const WORLD_STEPS = 10;
const worldStepsDone = new WeakMap<object, number>();
export function worldStep(ctx: Pick<ShardContext, 'progress'>, label: string): void {
  const done = (worldStepsDone.get(ctx) ?? 0) + 1;
  worldStepsDone.set(ctx, done);
  ctx.progress.set(Math.min(done, WORLD_STEPS), WORLD_STEPS, label);
  // DL21: a staged world's `progress` is no step of its own (the no-op of session.ts), so under the 'world data' span
  // the card held 'Region world · world data' for 1.0 s on a warm Pine while the library, materials, looks, item
  // models and skins finished one by one. Each part now moves the card's current step.
  loadingUnits('World data', WORLD_STEPS)(Math.min(done, WORLD_STEPS), label);
}

export class ShardfileClient {
  private plan: AdmittedClientPlan | undefined;
  private readonly source: Shardfile;
  private readonly validatedSource: Shardfile;
  private readonly assets: ClientAssets;
  private readonly bindings: ShardfileClientBindings;
  private presentation: Awaited<ReturnType<typeof clientMaterials>> | undefined;
  private post: ClientPost | null = null;
  private skins: ReadonlyMap<string, ClientSkin> = new Map();
  private worldTiles: Awaited<ReturnType<typeof standaloneClientTiles>> | undefined;
  private items: DeclaredItems | undefined;
  private itemModels: Awaited<ReturnType<typeof loadItemModels>> = new Map();
  private readonly mode: DataMode;
  private readonly nativeFeatures: boolean;
  /** The declared state as authored: a runtime-bound host field keeps its default for the look's curves. */
  private readonly curveState: Shardfile['state'];
  constructor(source: Shardfile, assets: ClientAssets, bindings: ShardfileClientBindings) {
    this.validatedSource = source;
    if (bindings.residency !== undefined) {
      const home = bindings.residency.home();
      if (home.instance !== bindings.instance || home.allocator !== bindings.allocator) throw new Error('Shardfile client requires its early page home residency');
    }
    // M3: a trusted runtime's bound sections (runtime.binds) are its own to install (hybridRows.ts); the data client never installs them
    // P1: a runtime-bound splat ground the Debug row draws streams through this client (its primary files keep their transport)
    const data = bindings.trustedRuntime === true ? withSplatGround(withoutRuntimeRows(source), source) : source;
    if (bindings.trustedRuntime === true) { const ground = splatGroundFiles(data); assets.releaseTransport(new Set([...runtimeBoundWorldFiles(source)].filter(ref => !ground.has(ref)))); }
    this.source = data; this.assets = assets; this.bindings = bindings; this.curveState = source.state;
    // a runtime that owns the client stages draws nothing of this data, but a splat ground the Debug row draws (P1)
    this.mode = bindings.runtimeStagesOnly === true ? splatGroundFiles(data).size > 0 ? 'presentation' : 'empty' : bindings.trustedRuntime !== true ? 'full'
      : emptyHybridData(data, bindings.audioOwner, bindings.worldOwner) ? 'empty'
      : emptyHybridData(withoutPresentation(data), bindings.audioOwner, bindings.worldOwner) ? 'presentation' : 'full';

    if (this.mode === 'full' && !hasDeclaredClientPage(source)) readModuleGroups([
      ...(data.clientScripts.bindings.length > 0 || data.quests.quests.length > 0 || (data.targets.talks?.length ?? 0) > 0 ? ['presentation'] : []),
      ...(data.rows.loot.some(row => 'gear' in row) ? ['loot'] : []),
      ...(data.rows.compendiums.length > 0 ? ['compendium'] : []),
    ]);
    this.nativeFeatures = hasDeclaredClientPage(source);
    if (this.mode === 'full' && !this.nativeFeatures) bindings.onSimulationExpected?.();
  }

  private async phase(ctx: ShardContext, phase: ClientPhase): Promise<void> {
    this.plan ??= admitClientPlan(ctx.product.has('client/plan') ? ctx.product.section('client/plan') : { version: 1, features: [] }, ctx.product);
    await installClientPhase(ctx, this.plan, phase, ctx.scope, this.bindings.planLifetime);
  }

  async world(ctx: ShardContext): Promise<void> {
    // Admission is complete before either the base client or a feature allocates resources.
    this.plan = admitClientPlan(ctx.product.has('client/plan') ? ctx.product.section('client/plan') : { version: 1, features: [] }, ctx.product);
    await timeClientPreparation(ctx.product.slug, 'world.data', () => this.worldData(ctx));
    await this.phase(ctx, 'world');
    worldStep(ctx, 'world features');
    await this.phase(ctx, 'world-bindings');
    worldStep(ctx, 'world bindings');
  }

  private async worldData(ctx: ShardContext): Promise<void> {
    // Quality rows register with the existing tier owner without requesting another simulation.
    const quality = this.source.plumbing;
    if (quality !== null && quality.input.length + quality.debug.length === 0) ctx.tiers.knobs({
      id: `${this.source.identity.slug}.${quality.namespace}`, defaults: Object.fromEntries(quality.knobs.map(row => [row.id, row[TIER]])),
    });
    if (this.mode === 'empty') return;
    const runtime = ctx.game.runtime, world = runtime?.world;
    if (runtime === undefined || world === null || world === undefined) throw new Error('Shardfile requires the normal world stage');
    ctx.scope.onDispose(this.assets.pin());
    // D227 (G872, wildshard-new): once play starts the session's admitted file bytes go, as H6 does for the grid's runtime
    // product (finish.ts): a Pine page still held 33.2 MB here at 30 s of play. The cache pins above stay; a later read
    // verifies from the content cache or the network (ClientAssets.readReleased).
    whenControl(world.game.levelScope, ctx.scope, () => { this.assets.releaseAll(); });
    const allocator = this.bindings.allocator; if (allocator === undefined) throw new Error('Shardfile requires its session residency allocator');
    // The reviewed opaque-runtime claim includes its whole home. Cache leases remain pinned above;
    // ordinary data homes account library/commons and tile parts independently in the same allocator.
    if (this.bindings.residency === undefined || this.source.runtime === null) await leaseClientLibrary(this.source, this.assets.retained, { validatedSource: this.validatedSource, scope: ctx.scope, allocator, owner: this.bindings.instance, textures: ktx2TranscodeSupport(world.game.renderer), read: ref => this.assets.read(ref) });
    worldStep(ctx, 'library');
    const presentation = await clientMaterials({ ...this.source, state: this.curveState }, this.assets.retained, world.game.renderer, ctx.scope, { trustedGraphs: this.nativeFeatures || this.bindings.trustedRuntime === true });
    worldStep(ctx, 'materials');
    this.presentation = presentation;
    if (this.nativeFeatures) presentation.graphs.bind({ hour: () => world.game.sky.dayNight?.hour ?? null });
    const family = this.source.terrain?.family, material = family === undefined ? undefined : presentation.materials.get(family);
    // Scene look slots borrow the exact terrain instance, including its curves
    // and cascade binding, rather than compiling a second family material.
    if (family !== undefined && material !== undefined) {
      if (this.nativeFeatures) world.sky.setupMaterial(material);
      lendSceneMaterials(ctx.scope, this.source.identity.slug, new Map([[family, material]]));
    }
    if (ctx.product.has('world/scenes')) {
      lendLooks(ctx.scope, presentation);
      if (ctx.product.has('look/painted')) bindPaintedMaterialMaps(ctx.product, ctx.scope, presentation);
      await bindSceneSourceLooks(ctx.product, ctx.scope, presentation);
    }
    worldStep(ctx, 'looks');
    this.itemModels = await loadItemModels(this.source.items, this.assets.retained, ctx.scope);
    worldStep(ctx, 'item models');
    this.skins = await loadClientSkins(this.source, this.assets.retained, presentation.compile, ctx.scope);
    worldStep(ctx, 'skins');
    installClientWater(undrawnWater(this.source.water, this.plan?.features ?? []), { root: ctx.root, scope: ctx.scope, materials: presentation.materials, outline: presentation.outline });
    const nativeWorld = this.nativeFeatures || this.mode === 'presentation';
    const start = nativeWorld ? ctx.manifest.spawn : this.source.spawn;
    const collider = nativeWorld && this.source.terrain !== null ? await this.assets.read(this.source.terrain.collider) : undefined;
    // On the wire this page predicts on the ground the server walks: the shard's collider, sample for sample. A page sampled at its own
    // lattice stands centimetres off it on a dune, and every step corrects.
    if (this.source.terrain !== null && (retireTerrain(world.physics) || this.mode === 'full')) addBakedTerrainCollider(world.physics, collider ?? await this.assets.read(this.source.terrain.collider), ctx.scope);
    worldStep(ctx, 'ground collider');
    const views = clientViews({ root: ctx.root, terrain: this.source.terrain?.family ?? null, terrainShadow: this.source.terrain?.shadow, terrainOrder: this.source.terrain?.order, ...presentation, ...(collider === undefined ? {} : { lattice: decodeTerrainTile(collider) }) });
    this.worldTiles = await standaloneClientTiles({ source: this.source, assets: this.assets, root: ctx.root, views: views.tiles }, ctx.scope, {
        instance: this.bindings.instance, budget: allocator, radius: tileRing, start,
        library: owner => this.source.props === null ? Promise.resolve(null) : views.library(this.source.props, this.assets.retained, owner),
        viewer: () => runtime.viewer(), pause: () => buildYield(ctx.scope),
        frame: run => { ctx.system({ id: 'game.shardfile.tiles', phase: 'late', run }); },
      });
    const tiles = this.worldTiles;
    worldStep(ctx, 'world tiles');
    // Debug ▸ Ground tiles (P1/P2): a splat ground draws from its props tiles; the world's whole native ground mesh retires
    if (splatGroundDrawn(this.source.props)) world.terrain.retireMesh();
    this.followViewer(ctx, runtime, tiles, presentation, start);
    if (this.mode === 'presentation') { ctx.debug.expose('shardfileResidency', { tiles, allocator, mode: 'presentation', workers: false }); return; }
    // SF59 step 4: the shard's own post stack (Debug ▸ Look ▸ "Graph materials", default off); in the grid it fades with its
    // cell's owner weight, standalone it stays whole
    const post = await clientPostStack(this.source, this.assets.retained, { compiler: () => loadScenePostGraphCompiler(world.game.renderer), composer: () => world.game.composer, scene: world.game.rootScene, camera: world.game.camera }, ctx.scope, { enabled: true });
    this.post = post; ctx.scope.onDispose(() => { if (this.post === post) this.post = null; });
    worldStep(ctx, 'post stack');
    if (post !== null) {
      const owned = frameLookOf(world.game.rootScene)?.owned;
      if (owned !== undefined) ctx.scope.onDispose(owned(this.bindings.instance, post.weight));
      ctx.debug.expose('shardfilePost', { state: post.state });
      let placed = false;
      ctx.system({ id: 'game.shardfile.post', phase: 'update', run: (dt) => { if (!placed) placed = post.install(); post.tick(dt); } });
    }
    ctx.debug.expose('shardfileResidency', { tiles, allocator, mode: 'standalone', workers: false });
  }

  /**
   * The tiles' residency follows the viewer past the terrain's follow distance (`terrain.follow`, `FOLLOW` by default) from
   * where it started (`from`, the shardfile's spawn by default); the materials' looks, graphs and curves tick each frame.
   */
  private followViewer(ctx: ShardContext, runtime: NonNullable<ShardContext['game']['runtime']>, tiles: { refresh: (x: number, z: number) => Promise<void> }, presentation: Awaited<ReturnType<typeof clientMaterials>>, from: { readonly x: number; readonly z: number } = this.source.spawn): void {
    let priorX = from.x, priorZ = from.z;
    const follow = this.source.terrain?.follow ?? FOLLOW;
    ctx.system({ id: 'game.shardfile.residency', phase: 'fixed.post', after: ['player.step'], run: () => {
      const position = runtime.viewer();
      if (Math.hypot(position.x - priorX, position.z - priorZ) < follow) return;
      void tiles.refresh(position.x, position.z);
      priorX = position.x; priorZ = position.z;
    } });
    ctx.system({ id: 'game.shardfile.presentation', phase: 'update', run: (dt) => { presentation.tick(dt); } });
  }

  async kit(ctx: ShardContext): Promise<void> {
    this.kitData(ctx);
    await this.phase(ctx, 'kit');
  }

  private kitData(ctx: ShardContext): void {
    if (this.mode !== 'full' || this.nativeFeatures) return;
    const runtime = ctx.game.runtime, world = runtime?.world, presentation = this.presentation;
    if (runtime === undefined || world === null || world === undefined || presentation === undefined) throw new Error('Shardfile requires the normal kit stage');
    const source = this.source;
    ctx.rows.species(source.rows.species.map((row) => ({ ...row, variants: row.variants.map((variant) => ({ ...variant, scale: [...variant.scale] })) })));
    ctx.rows.speciesLook(clientSpeciesLooks(source.rows, this.bindings.recipes, presentation.materials, this.skins));
    const sketches = compendiumSketches(source.rows, this.assets.retained);
    for (const row of source.rows.compendiums) ctx.rows.compendium({ id: row.id, ...declaredProductCompendium(ctx.product, row.id, sketches) });
    ctx.rows.lootTable(source.rows.loot);
    runtime.hooks.animalsReady = (manager) => {
      for (const spawn of source.creatures.spawns) {
        const species = source.rows.species.find((row) => row.id === spawn.species); if (species === undefined) throw new Error('Missing authored creature species');
        manager.factory.model(species.kind, spawn.variant); continue;
      }
    };
    const player = (): NonNullable<ShardContext['app']['player']> => { const actor = ctx.app.player; if (actor === null) throw new Error('Player health has not entered play'); return actor; };
    const actor: Actor = { id: 'actor.player', get tags() { return player().tags; }, get state() { return player().state; }, get attributes() { return player().attributes; }, get alive() { return player().alive; }, applyDamage: (request) => player().applyDamage(request) };
    const aimTarget = (target: CombatTarget): ItemTarget => {
      const { dims, scale = 1 } = target.target; // a row's body knows its own measures
      return { ...target, aimPoint: target.position.clone().add(new Vector3(0, dims === undefined ? 0.9 : dims.bodyY * scale, 0)) };
    };
    runtime.buildEquipment = () => {
      // a retained (grid) runtime's item input contexts are entered-only (installPageItemContexts), so copies never collide
      const retained = retainsRuntimeServices(ctx); if (retained) installPageItemContexts(ctx, source);
      const items = installDeclaredItems(source.items, { scope: ctx.scope, actorId: actor.id, input: ctx.app.input, bindings: ctx.app.input.bindings, ...(retained ? { contexts: 'runtime' as const } : {}), observation: { get mode() { const actorPlayer = ctx.game.runtime?.world?.player; return actorPlayer === undefined ? 'foot' : playerModes(actorPlayer).current(); }, get item() { return ctx.app.equipment?.current.row.id ?? null; }, get flags() { return runtime.hooks.questFlags?.() ?? []; } }, families: this.bindings.items, models: this.itemModels, icon: this.bindings.icon,
        aim: () => ({ origin: world.game.camera.getWorldPosition(new Vector3()), direction: world.game.camera.getWorldDirection(new Vector3()) }),
        relay: (item, action) => relayItem(source, item, action),
        runtime: (row) => ({ actor, combat: ctx.app.combat, active: () => ctx.app.state === 'play' && !world.freeCamera,
          targets: () => ctx.app.combat.targets().map(aimTarget),
          effect: (target, effect, from) => { const service = ctx.app.effects; if (service === null) throw new Error('Missing normal effect host'); service.apply(target, effect, from); },
          hook: row.hook === null ? null : (command) => command.action, // what an item's script says is the server's: this runtime never steps
        }),
      });
      this.items = items;
      return Promise.resolve({ primary: items.primary ?? new EmptyEquipment(), secondary: items.secondary, rifle: null, extras: items.extras, order: items.order, install: items.install });
    };
  }

  /** SF67: the installation a part a task (the page's play stage, the views, the sim and the restore were one 170-270 ms
   *  task at 4x CPU). Each part runs under the owner the call began with, and the sim does not step until the last part. */
  async play(ctx: ShardContext): Promise<void> {
    const own = enteredOwner(), scope = ctx.scope, product = ctx.product;
    const presentation = this.mode === 'full' && !this.nativeFeatures && (this.source.clientScripts.bindings.length > 0 || this.source.quests.quests.length > 0 || (this.source.targets.talks?.length ?? 0) > 0) ? await import('../plugin/ui') : null;
    const lootPresentation = this.mode === 'full' && !this.nativeFeatures && this.source.rows.loot.some(row => 'gear' in row) ? await import('../loot/runtime') : null;
    const compendium = this.mode === 'full' && !this.nativeFeatures && this.source.rows.compendiums.length > 0 ? await import('../compendium/install') : null;
    if (ctx.scope !== scope || ctx.product !== product || scope.disposed || scope.disposing) throw new Error('Shardfile left during presentation import');
    const steps = this.playSteps(ctx, presentation, lootPresentation, compendium);
    for (;;) {
      if ((own === null ? steps.next() : withOwner(own, () => steps.next())).done === true) break;
      await macrotask();
      if (ctx.scope.disposed) throw new Error('Shardfile left during play installation');
    }
    await this.phase(ctx, 'prepare-play');
    await this.phase(ctx, 'play');
  }

  private *playSteps(ctx: ShardContext, presentation: typeof ScriptPresentation | null, lootPresentation: typeof LootPresentation | null, compendium: typeof CompendiumPresentation | null): Generator<void, void> {
    if (this.mode !== 'full' || this.nativeFeatures) return;
    const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play, items = this.items, tiles = this.worldTiles;
    const health = ctx.app.player;
    if (runtime === undefined || world === null || world === undefined || play === null || play === undefined || items === undefined || tiles === undefined || health === null) throw new Error('Shardfile requires the normal play stage');
    const source = this.source, identity = { instance: this.bindings.instance, shard: source.identity.slug, revision: source.identity.revision };
    yield;
    const equipmentHost = ctx.app.equipmentHost;
    if (equipmentHost === null) throw new Error('Declared items require the normal equipment view host');
    for (const item of [items.primary, items.secondary, ...items.extras, ...items.tools]) {
      if (item === null) continue;
      const model: unknown = Reflect.get(item, 'model');
      if (isItemModel(model)) {
        equipmentHost.viewmodel.add(model);
        ctx.scope.onDispose(() => { model.removeFromParent(); });
      }
    }
    let baseFov = 0;
    ctx.system({ id: 'shardfile.item-fov', phase: 'update', run: () => {
      const current = play.weapons.current;
      if (!source.items.rows.some((row) => row.kind === 'weapon' && row.family === 'kit.melee' && row.id === current.row.id)) return;
      const camera = world.game.camera;
      const base = fovForAspect(camera.aspect < 1 ? world.game.level.camera?.portraitFov ?? 72 : 72, camera.aspect);
      const target = base + (current.model.visible ? world.player.fovKick : 0);
      if (Math.abs(target - camera.fov) > 0.01) {
        camera.fov = target; camera.updateProjectionMatrix();
        if (Math.abs(base - baseFov) > 0.01) world.sky.csm.updateFrustums();
      }
      baseFov = base;
    } });
    const lootRow = source.rows.loot[0];
    if (lootRow !== undefined && 'gear' in lootRow && lootPresentation === null) throw new Error('Missing loot presentation module');
    if (lootRow !== undefined && 'gear' in lootRow && lootPresentation !== null) lootPresentation.installLoot({ ctx, manifest: ctx.manifest, owned: play.owned, scene: world.game.scene,
      player: world.player, camera: world.game.camera, animals: () => play.animals.animals, menu: play.menu, presentation: lootPresentation.enteredLootPresentation(ctx,lootRow.id),
    });
    if (source.rows.compendiums.length > 0) {
      if (compendium === null) throw new Error('Missing compendium presentation module');
      const journal = compendium.installCompendium({ context: ctx, chunkId: ctx.manifest.slug, game: world.game, camera: world.game.camera, hud: play.hud, menu: play.menu,
        animals: play.animals, cabins: null, interactables: runtime.interactables, weapons: play.weapons, touchUi: play.touchUi, nolock: play.nolock });
      // a retained (grid) context's journal lives in its entered scope (installRetainedCompendium)
      if (journal !== null && !retainsRuntimeServices(ctx)) ctx.scope.onDispose(() => { journal.journal.scope.dispose(); });
    }
    const ledger = new Ledger(ctx.app.saves, [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], this.bindings.catalogue);
    // The server's ledger decides, and a page keeps its word where Progress reads: a feat counts and tells once, off its receipt.
    wirePage.facts(ctx.scope, (name, id) => {
      const rule = source.ledger.find(row => row.fact === name);
      if (rule === undefined) return;
      ledger.record({ ...identity, origin: rule.origin, tick: 0, ordinal: 0, name, entity: id });
      play.progress.refreshLedger();
    });
    // A field a player may see, on this page: the server's row where it sends one. Only public shared fields have rows, so a player's own stands
    // at its authored default: no such row, and none invented here (RETIRE-FEED A6).
    // SR11 (C9): an item's field is an owned line once a wire is up; a line at zero is dropped from `owned`, so absent is zero.
    const itemLines = new Set((source.targets.itemFields ?? []).flatMap(row => source.state.player.filter(field => field.id === row.fieldId).map(field => field.name)));
    const itemLine = (name: string): number | undefined => wirePage.client === null || !itemLines.has(name) ? undefined : wirePage.line(name);
    const fieldValue = (scope: 'shared' | 'player', name: string): number | undefined => {
      const field = source.state[scope].find((row) => row.name === name);
      if (field === undefined || (scope === 'shared' ? field.privacy !== 'public' : field.privacy === 'host')) return undefined;
      const value = scope === 'player' ? itemLine(name) : wirePage.row(name);
      if (value !== undefined || typeof field.default === 'string') return value;
      return typeof field.default === 'boolean' ? Number(field.default) : field.default;
    };
    const read = (scope: 'shared' | 'player', id: number): number => {
      const field = source.state[scope].find((row) => row.id === id); if (field === undefined) throw new Error('Missing declared state field');
      const value = fieldValue(scope, field.name);
      if (value !== undefined) return value;
      if (typeof field.default === 'string') throw new Error('UI requires numeric state'); return typeof field.default === 'boolean' ? Number(field.default) : field.default;
    };
    const declaredHud = mountDeclaredUi(source.ui, { hud: ctx.hud, system: ctx.system, scope: ctx.scope, bag: ctx.bag,
      read: (name) => { const scope = source.state.shared.some((row) => row.name === name) ? 'shared' : 'player', field = source.state[scope].find((row) => row.name === name); if (field === undefined) throw new Error('Missing declared counter field'); return read(scope, field.id); },
    });
    // C10: a declared boss panel has one driver, its encounter's row (J130), as every native bar does: its bar, name card and retry.
    const panels = [...declaredHud.bosses].map(([id, panel]) => {
      const encounter = source.encounters.find(row => row.id === id);
      if (encounter === undefined) throw new Error(`Boss panel requires its declared encounter: ${id}`);
      const bar = new BossRowBar(panel.presentation, { id, ...panel.definition, phases: encounter.phases.map(phase => ({ at: phase.at, caption: phase.caption, name: phase.name })) }, null, {
        lock: on => { play.weapons.setEnabled(!on); },
        attempt: outcome => { ctx.app.events.emit('boss.attempt', { boss: id, outcome: outcome === 'died' ? 'lost' : outcome }); } });
      ctx.on('player.died', ({ actor }) => { if (actor === ctx.app.player) bar.playerDied(); });
      return bar;
    });
    if (panels.length > 0) ctx.system({ id: 'shardfile.boss-panels', phase: 'update', run: dt => { const rows = wirePage.encounters(); for (const bar of panels) bar.draw(rows, dt); } });
    yield;
    let simulationActive = true;
    // This page's flags are the server's, followed by `wirePage`: nothing here saves them.
    const flags = new Flags(source.identity.slug, false);
    // A prop's colliders are world data: the page predicts against them, and the server holds its own.
    const colliders = installShardfileColliders(source, this.assets.retained, () => world.physics, ctx.scope);
    yield;
    // SF59: graph params read the frame owner's clock (the level backdrop's, G158) and the live public state
    // a field the sim does not hold (a runtime-bound host field) reads the runtime's port (G345)
    const graphSources: GraphSources = { hour: () => world.game.sky.dayNight?.hour ?? null, state: fieldValue };
    this.presentation?.graphs.bind(graphSources);
    this.post?.bind(graphSources); // the post stack's bound params read the same clock and state
    // G580 T1: a runtime borrows the level's clock (the page's sky) but never another runtime's own declared day: a warm
    // neighbour built while the home is entered keeps its own day instead of the home's through app.levelScope
    const level = ctx.app.dayCycle, borrowed = level !== null && !runtimeDays.has(level) ? level : null;
    const authoredDay = source.rows.days[0], day = borrowed ?? (authoredDay === undefined ? null : declaredDay(authoredDay));
    const ownsDay = borrowed === null && day !== null;
    if (ownsDay) { ctx.app.registerDayCycle(day, ctx.scope); runtimeDays.add(day); }
    const weather = new Map(source.rows.weather.map((row) => [row.id, declaredWeather(row, ctx.app.rng.stream('cosmetic').fork(row.id))]));
    // SF25 / G66: presentation-only client scripts; live creatures keep their sim pose and clips, a frozen home (the
    // traveller in another frame) breathes and grazes on top of it. The lane sees copies; its sim is never stepped here.
    if (source.clientScripts.bindings.length > 0) {
      if (presentation === null) throw new Error('Missing client script presentation module');
      const { ClientScriptViews, driveClientScriptViews } = presentation;
      // A declared creature is the server's row now: its body is the one the wire named after the spawn, and it may arrive late or
      // come back as another body, so each read looks it up again. Before it arrives a script sees the origin and poses nothing.
      const body = (target: ClientScriptTarget): ReturnType<typeof wirePage.namedBody> => target.kind === 'creature' ? wirePage.namedBody(target.id) : null;
      const scripts = createShardfileClientScripts(source, this.assets.retained, { actorId: health.id, state: { viewField: (_actor, scope, name) => fieldValue(scope, name) },
        observe: (target) => {
          if (target.kind === 'particles') return { position: target.at, frozen: !simulationActive };
          return captureClientScriptPosition(body(target)?.mesh.position, !simulationActive);
        },
        observeInto: (target, capture) => {
          // Particle rows retain their authored iterable alias until the bridge
          // copies it. A creature's former fresh tuple is a numeric snapshot.
          if (target.kind === 'particles') return { position: target.at, frozen: !simulationActive };
          captureClientScriptPosition(body(target)?.mesh.position, !simulationActive, capture);
          return undefined;
        } });
      ctx.scope.onDispose(() => { scripts.dispose(); });
      const targets = scripts.targets.map(({ entity, target }): ClientScriptViewTarget => {
        const looks = source.clientScripts.bindings.find((b) => b.entity === entity)?.emitters.map((e) => ({ id: e.id, live: e.live, colour: e.colour, size: e.size, velocity: e.velocity, gravity: e.gravity })) ?? [];
        return { entity, get object() { return body(target)?.mesh ?? null; }, emitters: looks,
          anchor: (out) => {
            if (target.kind === 'particles') return out.fromArray(target.at);
            const view = body(target);
            return view === null ? out.set(0, 0, 0) : out.copy(view.mesh.position).setY(view.mesh.position.y + view.dims.bodyY * (view.mesh.scale.y || 1) * 1.6);
          } };
      });
      const views = new ClientScriptViews(scripts.lane, targets, { root: ctx.root, scope: ctx.scope });
      let presentationTick = 0, stopped = false;
      // a refused observation (a creature past the lane's ±250 m frame) stills the presentation, never the game
      ctx.system({ id: 'game.shardfile.client-scripts', phase: 'fixed.post', run: () => {
        if (stopped) return;
        try { scripts.step(presentationTick++); } catch (error) { stopped = true; views.restore(); console.warn('[shardfile] client scripts stopped:', error); }
      } });
      driveClientScriptViews(views, { system: ctx.system, id: 'game.shardfile.client-script-views' });
      ctx.debug.expose('shardfileClientScripts', { views: () => views.state(), frames: () => scripts.lane.frames(),
        // where each binding's particles start and whether a body is bound to pose: what a proof reads of a row's body
        anchors: () => targets.map(target => ({ entity: target.entity, bound: target.object !== null, at: target.anchor(new Vector3()).toArray() })) });
    }
    yield;
    // The server keeps this world's saves and reads a page's old ones, and it runs its scenes: a press goes by the prompt's `wireId`.
    // TE-ENG2: a declared lever starts on its rack. On the wire the server takes it and says so in an owned line; with no wire the
    // rack's scene takes it here. Taken, it unlocks and comes to hand.
    const levers = [items.primary, items.secondary, ...items.extras].flatMap(weapon => { const lever = declaredLever(weapon); return lever === null ? [] : [lever]; });
    const takeHere = (item: string, action: number): boolean => {
      const lever = levers.find(entry => entry.row.id === item); if (lever === undefined) return false;
      if (action === 3) lever.take(); else lever.reload();
      return true;
    };
    const scene = clientScene(source, items.runtimes, () => undefined, (item, action) => relayItem(source, item, action) || takeHere(item, action));
    if (levers.length > 0) ctx.system({ id: 'shardfile.lever-lines', phase: 'update', run: () => {
      for (const lever of levers) {
        if (wirePage.client !== null) {
          const lines = leverLines(lever.row.id);
          lever.mirror(wirePage.line(lines.rounds), wirePage.line(lines.reserve), wirePage.line(lines.reloading) > 0, wirePage.line(lines.taken) > 0);
        }
        if (lever.taken && !play.weapons.has(lever.id)) { play.weapons.unlock(lever.id); play.weapons.select(lever.id); }
      }
    } });
    // SR11 (C9): the server burns the lantern; its owned lines are what this page's runtime shows, since it never steps.
    const mirrored = (source.targets.itemFields ?? []).flatMap(row => {
      const field = source.state.player.find(entry => entry.id === row.fieldId), item = items.runtimes.get(row.item);
      return field === undefined || item === undefined || field.privacy === 'host' ? [] : [{ item, name: field.name, property: row.property }];
    });
    if (mirrored.length > 0) ctx.system({ id: 'shardfile.item-lines', phase: 'update', run: () => {
      if (wirePage.client === null) return;
      for (const { item, name, property } of mirrored) {
        const line = wirePage.line(name); // a line at zero is dropped from `owned`: its absence is the server's zero
        const now = item.snapshot(), fuel = property === 'fuel' ? Math.min(1, Math.max(0, line)) : now.fuel, lit = property === 'lit' ? line > 0 : now.lit;
        if (fuel !== now.fuel || lit !== now.lit) item.restore({ ...now, fuel, lit: lit && fuel > 0 });
      }
    } });

    if (source.plumbing !== null && source.plumbing.input.length + source.plumbing.debug.length > 0) {
      const plumbing = installDeclaredPlumbing(source.plumbing, { handledInput: handledItemInputs(source), instance: source.identity.slug, tier: TIER, scope: ctx.scope, input: ctx.app.input,
        active: () => ctx.app.state === 'play' && !world.freeCamera, scene, knobs: ctx.tiers.knobs, debugRow: ctx.debugRow,
        observation: { get mode() { return playerModes(world.player).current(); }, get item() { return ctx.app.equipment?.current.row.id ?? null; }, get flags() { return runtime.hooks.questFlags?.() ?? flags.all; } },
      });
      if (source.plumbing.input.some(row => row.when !== undefined)) ctx.system({ id: 'declared.input.conditions', phase: 'input', before: ['engine.input.contexts'], run: plumbing.update });
    }
    installDeclaredTargets(source.targets, { panels: tiles.props?.panels ?? new Map(), colliders, read, scene, interactables: runtime.interactables, scope: ctx.scope, system: ctx.system });
    // TE-ENG3: a quest-giver from rows. The server keeps each player's node and says it as an owned line; answers go by name.
    if ((source.targets.talks?.length ?? 0) > 0) {
      if (presentation === null) throw new Error('Missing talk presentation module');
      let box: ReturnType<typeof presentation.talkBox> | null = null;
      const talkBox = (): ReturnType<typeof presentation.talkBox> => { box ??= presentation.talkBox(ctx.scope.child('talks')); return box; };
      const talks = installDeclaredTalks(source, { root: ctx.root, scope: ctx.scope, interactables: runtime.interactables, system: ctx.system, flags,
        line: name => wirePage.line(name), send: id => { wirePage.send(id); }, box: talkBox,
        player: () => world.player.position });
      ctx.debug.expose('shardfileTalks', { talks: () => talks.map(talk => ({ id: talk.id, node: talk.node() ?? null, open: box?.isOpen ?? false })) });
    }
    for (const declaration of source.quests.quests) {
      const quest = new QuestState(declaration, flags, ctx.app.events, ctx.scope);
      const options = declaration.track === false ? { chip: () => ({ label: '', count: '' }) } : {};
      // a retained (grid) runtime's chip, pins and card are its entered cell's only
      if (presentation === null) throw new Error('Missing quest presentation module');
      if (retainsRuntimeServices(ctx)) presentation.installEnteredQuestPresentation(ctx, quest, options); else presentation.installQuestPresentation(ctx, quest, options);
    }
    if (ctx.product.has('ui/completion') && ctx.product.section('ui/completion').trigger === 'quest') installCompletion(ctx, flags, play.progress);
    runtime.hooks.questFlags = () => flags.all; runtime.hooks.adventureFlags = () => flags.all;
    // An admitted scene installs its own declared profiles once in the play phase.
    if (this.bindings.audioOwner !== 'runtime' && !this.plan?.features.some(row => row.kind === 'audio.scene')) installDeclaredAudio(source.audio, { audio: play.audio, cues: play.cues, voices: this.bindings.voices(play.audio), music: play.music, scope: ctx.scope, profiles: this.bindings.audioProfiles?.(play, { source: source.audio, read: this.assets.audioRead() }) });
    ctx.debug.expose('shardfile', { source, items: items.runtimes, colliders, fine: tiles.fine, weather,
      // What a panel's field has drawn here: its look, and whether it stands in this page's world.
      targets: () => source.targets.panels.map(row => ({ panel: row.panel, visible: tiles.props?.panels.get(row.panel)?.visible ?? false, solid: row.colliders.every(id => colliders.get(id)?.active() ?? false) })),
      // Read actual live views; an authored spawn or a detached model alone cannot satisfy the author view proof.
      equipmentEvidence: () => {
        const equipment = ctx.app.equipment;
        if (equipment === null) throw new Error('Missing actual equipment owner');
        const current = equipment.current, declaration = source.items.rows.find(row => row.id === current.row.id);
        const asset = declaration?.view.asset ?? null, loaded = asset === null ? undefined : this.itemModels.get(asset), model = current.model;
        let meshes = 0, sameAsset = loaded !== undefined, visible = model.visible;
        const geometries = new Set<Mesh['geometry']>();
        loaded?.traverse(node => { if (isProofMesh(node)) geometries.add(node.geometry); });
        if (model instanceof Object3D) {
          for (let parent: Object3D | null = model; parent !== null; parent = parent.parent) visible &&= parent.visible;
          model.traverse(node => {
            if (!(isProofMesh(node))) return;
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            let draws = true;
            for (let parent: Object3D | null = node; parent !== null; parent = parent.parent) draws &&= parent.visible;
            if (draws && node.geometry.getAttribute('position').count >= 3 && materials.some(material => material.visible && material.opacity > 0)) meshes++;
            sameAsset &&= geometries.has(node.geometry);
          });
        }
        return { tick: wirePage.client?.latest?.tick ?? 0, frames: renderCount(world.game.renderer), id: current.row.id, asset,
          mounted: model.parent === equipmentHost.viewmodel, visible, meshes, sameAsset };
      },
      sceneEvidence: () => {
        const selected = pickPrompt(runtime.interactables, world.game.camera.position, world.physics);
        const interaction = selected === undefined ? undefined : source.targets.interactions.find(row => row.label === selected.label && row.at.every((coordinate, axis) => coordinate === selected.position.getComponent(axis)));
        const creatures = source.creatures.spawns.map(spawn => {
          const view = wirePage.namedBody(spawn.id);
          if (view === null) throw new Error('Declared creature lacks its row body');
          view.mesh.updateMatrixWorld(true); view.mesh.skeleton.update();
          let visible = true;
          for (let parent: Object3D | null = view.mesh; parent !== null; parent = parent.parent) visible &&= parent.visible;
          const materials = Array.isArray(view.mesh.material) ? view.mesh.material : [view.mesh.material];
          const vertices = view.mesh.geometry.getAttribute('position').count;
          return { id: spawn.id, bound: view.simulationBound, attached: world.game.scene.getObjectById(view.mesh.id) === view.mesh,
            visible: visible && materials.some(material => material.visible && material.opacity > 0), vertices,
            bones: view.mesh.skeleton.bones.length, finitePose: view.mesh.skeleton.boneMatrices !== null && [...view.mesh.skeleton.boneMatrices].every(Number.isFinite),
            matchesNative: view.rowDriven && [view.mesh.position.x, view.mesh.position.y, view.mesh.position.z].every(Number.isFinite) && Math.abs(view.mesh.scale.y - view.scale) < 0.001 };
        });
        return { tick: wirePage.client?.latest?.tick ?? 0, frames: renderCount(world.game.renderer), creatures, selectedInteraction: interaction?.id ?? null };
      },
    });
    this.bindings.onSimulation?.({ scope: ctx.scope,
      ...(this.bindings.residency === undefined ? {} : { residency: this.bindings.residency.home() }),
      checkpoint: () => !ctx.scope.disposed, setActive: (active) => { simulationActive = active && !ctx.scope.disposed; },
    });
  }
}

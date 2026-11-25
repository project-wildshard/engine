import { setLampPanels } from '@wildshard/engine/render/lookLight';
import {readModuleGroups} from '@wildshard/engine/boot/download';
import { whenControl } from '@wildshard/engine/boot/prefetch';
import { forgetFinishedShaders } from '@wildshard/engine/render/shaderPatches';
import type * as ScriptPresentation from '../plugin/ui';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type * as LootPresentation from '../loot/runtime';
import type * as CompendiumPresentation from '../compendium/install';

import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import { addBakedTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import { retireTerrain } from '@wildshard/engine/physics/terrain';
import { timeClientPreparation } from './preparationTiming';
import { wirePage } from './wirePage';
import { RaceClockChip, SteerChip } from '@wildshard/engine/quest/view/ui';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import type { FollowedMovers } from '../plugin/followedMovers';
import { installDataPageMovers } from './dataPageMovers';
import { vehicleSoundPort } from '../plugin/vehicleSounds';
import { installDataPageBodies } from './touchViews';
import { admitClientPlan, installClientPhase, type AdmittedClientPlan, type ClientPhase } from './clientPlan';
import { materialTextureRefs } from '@wildshard/format/materials';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { bindSceneSourceLooks } from './sceneSources';
import { bindPaintedMaterialMaps } from '../looks/paintedLook';
import { installCompletion } from '../complete/declared';
import { defaultCompletionRows } from '../../../shared/game/quest/defaultCard';
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
import { installDeclaredQuests } from './declaredQuests';
import { enteredLandingPorts, installQuestLandings } from '../quest/questLanding';
import { placementLedger, recordWireFacts } from './wireFacts';
import { declaredFields, hasDeclaredHud, installDeclaredHud, type BossPanelPorts } from './declaredHud';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { Actor, CombatTarget } from '@wildshard/engine/combat/pipeline';
import { fovForAspect } from '@wildshard/engine/combat/blocks/melee';
import type { ItemTarget } from '@wildshard/engine/combat/items';
import type { ItemFamily } from '@wildshard/engine/combat/itemFamilies';
import type { EquipmentIcon } from '@wildshard/engine/combat/Equipment';
import { installDeclaredAudio, type DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import { pageScoreProfiles } from './declaredScore';
import { TIER } from '@wildshard/engine/core/tier';
import { pageGridInstance, type ShardContext } from "../plugin/context";
import type { ShardPlayHost } from '../../../shared/game/shard/runtime';
import { installDeclaredPlumbing } from '../shard/declaredPlumbing';
import { declaredFolderCompendium, declaredDay, declaredWeather } from '../../../shared/game/shard/declaredRows';
import { installItemCatalogue } from './itemCatalogue';
import { installDeclaredTargets, spentUses } from '../shard/declaredTargets';
import { ownedLineFields } from './ownedLines';
import { hasTalks, heldMove, installPlay, playWire } from './playInstalls';
import type { ClientScriptViewTarget } from "../plugin/ui";
import type { ClientScriptTarget } from '@wildshard/format/clientScripts';
import type { LedgerCatalogueItem } from '../../../shared/game/ledger';
import { EmptyEquipment } from './emptyEquipment';
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
import type { ClientRigLooks, ShardViewRecipe } from './clientRecipes';
import { loadClientRigLooks } from './clientRigLooks';
import { declarePageCreatures, declarePageSpecies, type DeclaredCreatureModels } from './declaredCreatures';
import { loadItemModels, loadStaticModels } from './itemModels';
import { attachmentRefs } from './clientAttachments';
import { loadClientSkins, type ClientSkin } from './clientSkins';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import { clientViews } from './clientViews';
import { createShardfileClientScripts, captureClientScriptPosition } from './clientScripts';

import { installClientWater, undrawnWater } from './clientWater';
import { detailLayerFiles, installClientDetails } from './clientDetails';
import { windClockFallback } from '@wildshard/engine/world/wind';
import { SwingField, setLampSwings } from '@wildshard/engine/world/swings';
import { trample, TRAMPLE_GLSL } from '../systems/looks/trample';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { installClientSplash } from './clientSplash';
import { standaloneClientTiles } from './tileContent';
import { tileRing } from './tileDriver';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { clientScene, handledItemInputs, itemScene } from './clientItems';
import { installShardfileColliders } from '../../../shared/game/shardfile/collisionBindings';
import type { ClientAssets } from './clientAssets';
import { installDeclaredItems, leverLines, rackMeleeRows, rackToolRows, standScenes, takenLine, type DeclaredItems } from '../../../shared/game/shardfile/items';
import { declaredLever } from '../plugin/weaponFamily';
import { runtimeBinds, runtimeBoundWorldFiles, withoutRuntimeRows } from "../../../shared/game/plugin/runtimeRows";
import type { Shardfile } from '@wildshard/format/shardSchema';
import { nearPlaceholderRoots } from '@wildshard/format/nearPlaceholder';
import { saveRevision } from '@wildshard/engine/game/shardfile/saveRevision';

function isProofMesh(value: Object3D): value is Mesh { return value instanceof Mesh; }

function isItemModel(value: unknown): value is Object3D { return value instanceof Object3D; }

/** Native catalogue dependencies are injected by the normal composition root, never imported upward by the loader. */
export interface ShardfileClientBindings {
  recipes: ReadonlyMap<string, ShardViewRecipe>; items: ReadonlyMap<string, ItemFamily>; icon: (name: string) => EquipmentIcon;
  voices: (audio: ShardPlayHost['audio']) => DeclaredAudioPorts['voices']; catalogue: readonly LedgerCatalogueItem[];
  instance: string;
  allocator?: ResidencyAllocator;
  /** Own admitted card/map URLs through hydration, replacement and final retirement. */
  imageOwner?: Scope;
  /** Optional grid-page owner, created before hydration. Runtime homes reuse its reviewed early claim. */
  residency?: PageResidency;
  /** Explicit built-in transition policy: a completely empty data declaration adds no gameplay services. */
  nativeRuntime?: boolean;
  /** Transitional entry owns its stages, while client/plan still installs platform features. */
  runtimeStagesOnly?: boolean;
  /** Runtimes install entered features on their actual entered context. */
  planLifetime?: 'resident';
  /** Declared audio is the default. A native transition may let its runtime consume the same audio declaration exactly once. */
  audioOwner?: 'declared' | 'runtime';
  /** Declared water rows and collider-only props are installed by the data client by default. A native transition may
   *  let its runtime consume them exactly once (G164: Driftwood's sea row with its dry sockets and its socket landings). */
  worldOwner?: 'declared' | 'runtime';
  /** Platform installers receive the emitted audio declaration and its admitted recording reader.
   * An absent reader preserves existing native catalogue resolution; a declared reader refuses unknown paths. */
  audioProfiles?: (play: ShardPlayHost, product: { source: Shardfile['audio']; read: ((path: string) => Promise<ArrayBuffer>) | undefined }) => DeclaredAudioPorts['profiles'];
  /** Announced during construction only when this data client will create a simulation; empty native transitions never announce a handoff. */
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

function emptyRuntimePageData(source: Shardfile, audioOwner: ShardfileClientBindings['audioOwner'], worldOwner: ShardfileClientBindings['worldOwner']): boolean {
  // a runtime-owned world declaration: water rows and props that only declare colliders (no tiles, panels, models, far or textures)
  const runtimeWorld = worldOwner === 'runtime', props = source.props;
  // G348: placeholders (a far proxy, a near row and their files) are grid presentation, never data this client installs, so a
  // native transition that ships them stays empty (Signal's play stage, 54603cb17); an authored props far still counts
  const placeholders = placeholderFiles(source), shown = (ref: string): boolean => ref !== source.map?.image && ref !== source.navigation?.file && !placeholders.has(ref);
  const propsEmpty = props === null || (runtimeWorld && props.tiles.length + props.panels.length + props.models.length + props.textures.length === 0 && props.far === null);
  const audioEmpty = audioOwner === 'runtime' || (source.audio.cues.length + source.audio.routing.length === 0 && source.audio.ambience === null && source.audio.score === 'silent' && source.audio.music === undefined && source.audio.samples === undefined && source.audio.zones === undefined);
  // Named blobs are an admitted inventory, not a request to install a second
  // simulation. A native runtime-owned world reads those bytes itself; actual
  // behavior and presentation declarations below still select their data host.
  const inventory = runtimeWorld ? 0 : source.files.filter(file => shown(file.hash)).length + source.requires.commons.length
    + source.library.filter(shown).length + source.critical.filter(ref => ref !== source.navigation?.file).length;
  return (source.modes?.traverse.length ?? 0) + source.movers.length + source.crowds.length + source.clientScripts.bindings.length + inventory + (source.requires.capabilities?.length ?? 0) + source.tiles.length + source.ui.length + source.sim.scripts.length + source.sim.bindings.length + source.state.shared.length + source.state.player.length + Object.values(source.rows).reduce((sum, rows) => sum + rows.length, 0) + (runtimeWorld ? 0 : source.water.length) + source.creatures.brains.length + source.creatures.groups.length + source.creatures.spawns.length + source.encounters.length + Object.values(source.quests).reduce((sum, rows) => sum + rows.length, 0) + source.ledger.length + source.hooks.conditions.length + source.hooks.scenes.length + source.items.rows.length + source.items.contexts.length + source.targets.panels.length + source.targets.interactions.length + (source.targets.talks?.length ?? 0) + source.look.families.length + source.look.keys.length + Object.keys(source.look.materials).length + Object.keys(source.look.familyLooks).length === 0
    && source.terrain === null && propsEmpty && (source.plumbing === null || source.plumbing.input.length + source.plumbing.debug.length === 0)
    && audioEmpty && source.look.grade.lut === null
    && source.look.day === undefined && source.look.dayOverride === null;
}

/**
 * G345: a native runtime shard's data without its presentation sections: the terrain (its collider and tiles) and the look's
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
  // a splat ground's tiles and layers are presentation too (P1: the ground a native runtime's data client draws)
  const files = new Set([...(source.terrain === null ? [] : [source.terrain.collider,
    ...(source.terrain.sampling === undefined ? [] : [source.terrain.sampling.file]), ...source.terrain.tiles.map((tile) => tile.file)]), ...materialTextureRefs(source.look.materials), ...graphFileRefs(source), ...splatGroundFiles(source)]);
  const keep = (ref: string): boolean => !files.has(ref);
  // A native world's catalogue can take a cooked skin without transferring
  // its roster, equipment or play stage to the parallel data client.
  const skins = new Set(source.rows.looks.filter(look => look.recipe === SKIN_LOOK_RECIPE).map(look => look.species));
  const rows = { ...source.rows, species: source.rows.species.filter(species => !skins.has(species.id)),
    looks: source.rows.looks.filter(look => look.recipe !== SKIN_LOOK_RECIPE) };
  return { ...source, terrain: null, props: source.props === null ? null : { ...source.props, tiles: source.props.tiles.filter(tile => keep(tile.file)) }, files: source.files.filter((file) => keep(file.hash)), critical: source.critical.filter(keep), library: source.library.filter(keep),
    tiles: source.tiles.flatMap((tile) => { const kept = tile.files.filter(keep); return kept.length === 0 ? [] : [kept.length === tile.files.length ? tile : { ...tile, files: kept }]; }),
    rows, look: { ...source.look, families: [], materials: {}, familyLooks: {} } };
}

/** Look-only native data draws with its native world and never creates another gameplay owner. */
type DataMode = 'full' | 'empty' | 'presentation';
/** How far (m) the viewer moves before the tile residency re-centres, when the terrain declares no `follow`. */
const FOLLOW = 5;
/** K6b: a native runtime that binds `items` builds its own equipment (Driftwood's held claims): its data page holds no item. */
const RUNTIME_OWNED_ITEMS: DeclaredItems = { primary: null, secondary: null, extras: [], tools: [], order: [], runtimes: new Map(), install: () => undefined, step: () => undefined };

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
  private rigLooks: ClientRigLooks = new Map();
  /** OF23e4: the kit registered this native page's declared species (`declaredNativePage`). */
  private declaredNative = false;
  private worldTiles: Awaited<ReturnType<typeof standaloneClientTiles>> | undefined;
  private items: DeclaredItems | undefined;
  private itemModels: Awaited<ReturnType<typeof loadItemModels>> = new Map();
  /** CC30c: the GLBs creature attachments draw, by hash */
  private attachmentModels: Awaited<ReturnType<typeof loadStaticModels>> = new Map();
  private readonly mode: DataMode;
  /** K6b: the native runtime binds `items` (its own held equipment), so this page installs none. */
  private readonly runtimeItems: boolean;
  private readonly nativeFeatures: boolean;
  /** The declared state as authored: a runtime-bound host field keeps its default for the look's curves. */
  private readonly curveState: Shardfile['state'];
  constructor(source: Shardfile, assets: ClientAssets, bindings: ShardfileClientBindings) {
    this.validatedSource = source;
    if (bindings.residency !== undefined) {
      const home = bindings.residency.home();
      if (home.instance !== bindings.instance || home.allocator !== bindings.allocator) throw new Error('Shardfile client requires its early page home residency');
    }
    // M3: a native runtime's bound sections (runtime.binds) are its own to install (runtimePageRows.ts); the data client never installs them
    // P1: a runtime-bound splat ground the Debug row draws streams through this client (its primary files keep their transport)
    const data = bindings.nativeRuntime === true ? withSplatGround(withoutRuntimeRows(source), source) : source;
    if (bindings.nativeRuntime === true) { const ground = splatGroundFiles(data); assets.releaseTransport(new Set([...runtimeBoundWorldFiles(source)].filter(ref => !ground.has(ref)))); }
    this.source = data; this.assets = assets; this.bindings = bindings; this.curveState = source.state;
    this.runtimeItems = bindings.nativeRuntime === true && runtimeBinds(source).has('items');
    // a runtime that owns the client stages draws nothing of this data, but a splat ground the Debug row draws (P1)
    this.mode = bindings.runtimeStagesOnly === true ? splatGroundFiles(data).size > 0 ? 'presentation' : 'empty' : bindings.nativeRuntime !== true ? 'full'
      : emptyRuntimePageData(data, bindings.audioOwner, bindings.worldOwner) ? 'empty'
      : emptyRuntimePageData(withoutPresentation(data), bindings.audioOwner, bindings.worldOwner) ? 'presentation' : 'full';

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
    // MG9: the boot's finished shader texts go too (no program is built after control on any zone, mini-shadermem)
    whenControl(world.game.levelScope, ctx.scope, () => { this.assets.releaseAll(); forgetFinishedShaders(); });
    const allocator = this.bindings.allocator; if (allocator === undefined) throw new Error('Shardfile requires its session residency allocator');
    // The reviewed opaque-runtime claim includes its whole home. Cache leases remain pinned above;
    // ordinary data homes account library/commons and tile parts independently in the same allocator.
    if (this.bindings.residency === undefined || this.source.runtime === null) await leaseClientLibrary(this.source, this.assets.retained, { validatedSource: this.validatedSource, scope: ctx.scope, allocator, owner: this.bindings.instance, textures: ktx2TranscodeSupport(world.game.renderer), read: ref => this.assets.read(ref) });
    worldStep(ctx, 'library');
    const presentation = await clientMaterials({ ...this.source, state: this.curveState }, this.assets.retained, world.game.renderer, ctx.scope);
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
    this.attachmentModels = await loadStaticModels(attachmentRefs(this.source.rows), this.assets.retained, ctx.scope);
    worldStep(ctx, 'item models');
    this.skins = await loadClientSkins(this.source, this.assets.retained, presentation.compile, ctx.scope);
    worldStep(ctx, 'skins');
    // M4.6: a planar pool's ripples run on the game clock
    const waterClocks: ((dt: number) => void)[] = [];
    installClientWater(undrawnWater(this.source.water, this.plan?.features ?? []), { root: ctx.root, scope: ctx.scope, materials: presentation.materials, outline: presentation.outline, frame: (run) => { waterClocks.push(run); } });
    if (waterClocks.length > 0) ctx.system({ id: 'game.shardfile.water', phase: 'update', run: (dt) => { for (const run of waterClocks) run(dt); } });
    // SHARD-SOURCE AP32d1: the look's detail layers (grass, ferns), each a camera ring of seeded clumps from its library files
    const details = this.source.look.details;
    // SHARD-SOURCE SS7: they part round the player and every creature body on the page's trample field, and spring back; the
    // page drives the field unless another system already owns it (a native forest's grass pushes and advances it). The
    // owner is settled on the first frame, after every plan phase (the forest page's included) has had its turn to register.
    let ownTrample: boolean | null = null;
    const owns = (): boolean => {
      if (ownTrample === null) { ownTrample = ctx.app.world.trample === null; if (ownTrample) ctx.app.registerTrample(trample, ctx.scope); }
      return ownTrample;
    };
    installClientDetails(details, await detailLayerFiles(details, this.assets.retained, (hash) => this.assets.read(hash)), { root: ctx.root, scope: ctx.scope, materials: presentation.materials, phone: TIER === 'phone',
      viewer: () => runtime.viewer(), frame: (run) => { ctx.system({ id: 'game.shardfile.details', phase: 'late', run }); },
      trample: { field: trample, uniforms: trample.uniforms, glsl: TRAMPLE_GLSL, movers: (() => {
        const player = { id: 'player', x: 0, z: 0, radius: 0.55 }, live: (typeof player)[] = [];
        const rows = this.source.creatures.spawns.map((spawn) => ({ spawn: spawn.id, row: { id: `creature:${spawn.id}`, x: 0, z: 0, radius: 0.7 } }));
        return () => {
          // E321: nothing stamps the shard's grass from a practice room
          if (!owns() || practiceRoom.open) return null;
          live.length = 0;
          player.x = world.player.position.x; player.z = world.player.position.z; live.push(player);
          for (const { spawn, row } of rows) {
            const body = wirePage.namedBody(spawn);
            if (body === null || body.mesh.parent === null) continue;
            row.x = body.mesh.position.x; row.z = body.mesh.position.z; live.push(row);
          }
          return live;
        };
      })() } });
    // SHARD-SOURCE SS8a: the layers sway on the wind clock; a page with no `wind` row, forest or painterly grass to drive
    // it would leave it at 0 and the meadow frozen, so the page drives it whenever nothing else did since its last frame
    if ((details?.length ?? 0) > 0) ctx.system({ id: 'game.shardfile.wind', phase: 'update', run: windClockFallback() });
    // SHARD-SOURCE SS8c: the look's hanging lanterns and signs lean in the wind and swing when a body brushes them; their
    // surfaces, glow cards and lamps turn round the same pivots
    const swingRows = this.source.look.light?.swings ?? [];
    if (swingRows.length > 0) {
      const swings = new SwingField(swingRows, presentation.swings, ctx.root);
      ctx.scope.onDispose(setLampSwings(swings)); ctx.scope.onDispose(() => { swings.dispose(); });
      const clock = windClockFallback(), player = { id: 'player', x: 0, y: 0, z: 0, radius: 0.45 }, live: (typeof player)[] = [];
      const rows = this.source.creatures.spawns.map((spawn) => ({ spawn: spawn.id, row: { id: `creature:${spawn.id}`, x: 0, y: 0, z: 0, radius: 0.6 } }));
      ctx.system({ id: 'game.shardfile.swings', phase: 'update', run: (dt) => {
        clock(dt);
        live.length = 0;
        if (!practiceRoom.open) {
          const at = world.player.position;
          player.x = at.x; player.y = at.y; player.z = at.z; live.push(player);
          for (const { spawn, row } of rows) {
            const body = wirePage.namedBody(spawn);
            if (body === null || body.mesh.parent === null) continue;
            row.x = body.mesh.position.x; row.y = body.mesh.position.y; row.z = body.mesh.position.z; live.push(row);
          }
        }
        swings.update(dt, live);
      } });
    }
    // SHARD-SOURCE SS6: a scene pool splashes and rings when the player walks in, wades or walks out
    installClientSplash(this.source.water, { root: ctx.root, scope: ctx.scope, phone: TIER === 'phone',
      // the player and every declared creature with a body (SS6c): a creature wading the pond splashes as the player does
      // one array and one row a mover, rewritten in place each frame; a creature's id is prefixed so a spawn named 'player' is its own
      movers: (() => {
        const player = { id: 'player', x: 0, y: 0, z: 0 }, live: (typeof player)[] = [];
        const rows = this.source.creatures.spawns.map((spawn) => ({ spawn: spawn.id, row: { id: `creature:${spawn.id}`, x: 0, y: 0, z: 0 } }));
        return () => {
          live.length = 0;
          const at = world.player.position;
          player.x = at.x; player.y = at.y; player.z = at.z; live.push(player);
          rows.forEach(({ spawn, row }) => {
            const body = wirePage.namedBody(spawn);
            if (body === null || body.mesh.parent === null) return;
            row.x = body.mesh.position.x; row.y = body.mesh.position.y; row.z = body.mesh.position.z; live.push(row);
          });
          return live;
        };
      })(),
      frame: (run) => { ctx.system({ id: 'game.shardfile.splash', phase: 'update', run }); } });
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
    const declaredNative = this.declaredNativePage();
    // OF19d2: a declared look drawn from a scene library's rig waits on that library's rigs
    if (this.mode === 'full' || declaredNative) this.rigLooks = await loadClientRigLooks(ctx.product, this.source.rows, ctx.scope);
    // ONE-FORMAT OF23e4: a native page with no species programme or hull book (Pine r10) draws its runtime's bodies from its
    // declared species and their looks, and keeps the hull book kit's held equipment and socket cards
    if (declaredNative) {
      this.declaredNative = true;
      declarePageCreatures(ctx, this.source, this.creatureModels());
      const { prepareDeclaredNativeKit } = await import('../models/socketRigCreature');
      await prepareDeclaredNativeKit(ctx);
    }
    this.kitData(ctx);
    await this.phase(ctx, 'kit');
  }

  /** OF23e4: a native runtime page whose species are only its declared rows (FORMAT-PRUNE FP20: no plan feature registers
   *  species any more; an unread programme section does not count, P1 2026-11-22, `nativeDeclaresOwnSpecies`). */
  private declaredNativePage(): boolean {
    if (this.bindings.nativeRuntime !== true || this.mode === 'empty' || this.nativeFeatures) return false;
    return this.source.rows.species.length > 0 && this.source.creatures.spawns.length > 0;
  }

  /** What this page draws its declared bodies with (declaredCreatures.ts), loaded in its world stage. */
  private creatureModels(): DeclaredCreatureModels {
    const presentation = this.presentation;
    if (presentation === undefined) throw new Error('Declared creatures require the normal kit stage');
    return { materials: presentation.materials, skins: this.skins, rigLooks: this.rigLooks, attachmentModels: this.attachmentModels, recipes: this.bindings.recipes };
  }

  private kitData(ctx: ShardContext): void {
    if (this.mode !== 'full') return;
    // ONE-FORMAT OF19b0: a client-page shard whose creatures are declared spawns (its runtime plan keeps the quest page and
    // held melee) draws them as an ordinary upload's page does
    if (this.nativeFeatures) {
      // OF19d2: the page's species are its declared rows, registered here for the page population
      declarePageSpecies(ctx, this.source, () => this.creatureModels());
      return;
    }
    const runtime = ctx.game.runtime, world = runtime?.world;
    if (runtime === undefined || world === null || world === undefined) throw new Error('Shardfile requires the normal kit stage');
    const source = this.source;
    if (!this.declaredNative) declarePageCreatures(ctx, this.source, this.creatureModels());
    const sketches = compendiumSketches(source.rows, this.assets.retained);
    for (const row of source.rows.compendiums) ctx.rows.compendium({ id: row.id, ...declaredFolderCompendium(ctx.product, row.id, sketches) });
    ctx.rows.lootTable(source.rows.loot);
    // meta QA 11-24 row 45: a page with no client plan (no `content.catalogue`) still knows its own items: a species' harvest
    // drops are items, and proof-stranger's wolf hide was unknown to the page, so a felled wolf offered no harvest
    if (ctx.product.has('combat/items')) installItemCatalogue(ctx);
    const player = (): NonNullable<ShardContext['app']['player']> => { const actor = ctx.app.player; if (actor === null) throw new Error('Player health has not entered play'); return actor; };
    const actor: Actor = { id: 'actor.player', get tags() { return player().tags; }, get state() { return player().state; }, get attributes() { return player().attributes; }, get alive() { return player().alive; }, applyDamage: (request) => player().applyDamage(request) };
    const aimTarget = (target: CombatTarget): ItemTarget => {
      const { dims, scale = 1 } = target.target; // a row's body knows its own measures
      return { ...target, aimPoint: target.position.clone().add(new Vector3(0, dims === undefined ? 0.9 : dims.bodyY * scale, 0)), reach: (dims?.bodyRadius ?? 0) * scale };
    };
    // K6b: a full runtime page (Driftwood's declared roster, OF27d) whose runtime binds `items` leaves the equipment to it
    if (this.runtimeItems) return;
    runtime.buildEquipment = () => {
      // a retained (grid) runtime's item input contexts are entered-only (installPageItemContexts), so copies never collide
      const retained = retainsRuntimeServices(ctx); if (retained) installPageItemContexts(ctx, source);
      const items = installDeclaredItems(source.items, { scope: ctx.scope, actorId: actor.id, input: ctx.app.input, bindings: ctx.app.input.bindings, ...(retained ? { contexts: 'runtime' as const } : {}), observation: { get mode() { const actorPlayer = ctx.game.runtime?.world?.player; return actorPlayer === undefined ? 'foot' : playerModes(actorPlayer).current(); }, get item() { return ctx.app.equipment?.current.row.id ?? null; }, get flags() { return runtime.hooks.questFlags?.() ?? []; } }, families: this.bindings.items, models: this.itemModels, icon: this.bindings.icon, racked: new Set([...rackMeleeRows(source), ...rackToolRows(source)]),
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
    // ONE-FORMAT OF41c: a plain upload's grapple mode draws its claw, rope, hook marks and lock as the native host's does;
    // a client-plan page draws it too unless its held play entry builds the claw (P1 OF21: Nine r6 lost it on v0.1.57)
    if (this.mode === 'full' && this.source.modes?.grapple?.some(row => row.profile !== undefined) === true) {
      const { declaredGrapplePageOwns, installDeclaredGrapplePage } = await import('../grapple/declaredGrapple');
      if (ctx.scope !== scope || ctx.product !== product || scope.disposed || scope.disposing) throw new Error('Shardfile left during grapple import');
      if (declaredGrapplePageOwns(this.source, this.plan?.features ?? [])) await installDeclaredGrapplePage(ctx, this.source);
    }
    // ONE-FORMAT OF20c / OF19c1: a runtime-plan page's declared boss (its owner row on a declared spawn) has no page feature:
    // the page draws its declared `ui` rows, boss panels among them, off the wire as an ordinary page does
    if (this.mode === 'full' && this.nativeFeatures && hasDeclaredHud(this.source)) this.nativeHud(ctx);
    await this.phase(ctx, 'prepare-play');
    await this.phase(ctx, 'play');
  }

  /** A runtime-plan page's declared HUD: its fields are the wire's (a public row, an owned line), its boss panels the wire's encounter rows. */
  private nativeHud(ctx: ShardContext): void {
    const play = ctx.game.runtime?.play, source = this.source, lines = ownedLineFields(source);
    if (play === null || play === undefined) throw new Error('Declared HUD requires the normal play stage');
    const { named } = declaredFields(source, { row: name => wirePage.row(name), line: name => (lines.has(name) && wirePage.client !== null ? wirePage.line(name) : undefined) });
    installDeclaredHud(source, { hud: ctx.hud, system: ctx.system, scope: ctx.scope, bag: ctx.bag, read: named, encounters: () => wirePage.encounters(), boss: bossPanelPorts(ctx, play) });
  }

  private *playSteps(ctx: ShardContext, presentation: typeof ScriptPresentation | null, lootPresentation: typeof LootPresentation | null, compendium: typeof CompendiumPresentation | null): Generator<void, void> {
    if (this.mode !== 'full' || this.nativeFeatures) return;
    const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play, items = this.items ?? (this.runtimeItems ? RUNTIME_OWNED_ITEMS : undefined), tiles = this.worldTiles;
    const health = ctx.app.player;
    if (runtime === undefined || world === null || world === undefined || play === null || play === undefined || items === undefined || tiles === undefined || health === null) throw new Error('Shardfile requires the normal play stage');
    const source = this.source, identity = { instance: this.bindings.instance, shard: source.identity.slug, revision: saveRevision(source.identity) };
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
    const ledger = placementLedger(ctx.app.saves, source, identity, this.bindings.catalogue);
    // SS-GP2: one function with a grid data cell's (`grid/dataCellFacts.ts`). On a grid page a fact filed while the feet stand
    // in another cell is that cell's (its copy records it), never this placement's.
    recordWireFacts(source, identity, ledger, ctx.scope, { here: () => { const entered = pageGridInstance(); return entered === null || entered === identity.instance; },
      refresh: () => { play.progress.refreshLedger(); } });
    // A field a player may see, on this page: the server's row where it sends one. Only public shared fields have rows, so a player's own stands
    // at its authored default: no such row, and none invented here (RETIRE-FEED A6).
    // SR11 (C9): an item's field is an owned line once a wire is up; a line at zero is dropped from `owned`, so absent is zero.
    // SHARD-SOURCE SS-GF1a2: so is a script's own player field (a socket this player lit): the server's `script.player-fields`
    const itemLines = ownedLineFields(source);
    // TE-ENG6: off the wire a lever's take is this page's own, so its projected field reads the page's lever (bound once the levers are).
    const takenFields = new Map((source.targets.itemFields ?? []).flatMap(row => row.property !== 'taken' ? [] : source.state.player.filter(field => field.id === row.fieldId).map(field => [field.name, row.item] as const)));
    let takenHere = (_item: string): boolean => false;
    const itemLine = (name: string): number | undefined => {
      if (!itemLines.has(name)) return undefined;
      if (wirePage.client !== null) return wirePage.line(name);
      const item = takenFields.get(name); return item === undefined ? undefined : Number(takenHere(item));
    };
    // SS-GP3: one field reader and one HUD install with a grid data cell's (`grid/dataCellHud.ts`)
    const { value: fieldValue, read, named } = declaredFields(source, { row: name => wirePage.row(name), line: itemLine });
    installDeclaredHud(source, { hud: ctx.hud, system: ctx.system, scope: ctx.scope, bag: ctx.bag, read: named, encounters: () => wirePage.encounters(), boss: bossPanelPorts(ctx, play) });
    yield;
    let simulationActive = true;
    // This page's flags are the server's, followed by `wirePage`: nothing here saves them.
    const flags = new Flags(source.identity.slug, false);
    // A prop's colliders are world data: the page predicts against them, and the server holds its own.
    const colliders = installShardfileColliders(source, this.assets.retained, () => world.physics, ctx.scope);
    // SHARD-SOURCE SS9c: a touchable crate stands where the server's body is, its panel drawn there (the server installs
    // the bodies whatever the plan's movers, so the page does too)
    installDataPageBodies(source, { physics: world.physics, scope: ctx.scope, panels: tiles.props?.panels ?? new Map() });
    // TEMPLATE-E2E TC-E5c: a plain shard's lift and doors stand on its page; a client plan's movers install their own
    let pageMovers: FollowedMovers | null = null;
    if (this.bindings.nativeRuntime !== true && !(this.plan?.features ?? []).some(row => row.kind === 'world.movers' || row.kind === 'motion.channels')) {
      const movers = installDataPageMovers(source, { physics: world.physics, scope: ctx.scope, panels: tiles.props?.panels ?? new Map(), prompts: runtime.interactables, sounds: vehicleSoundPort(source.audio, this.assets.audioRead()) });
      if (movers !== null) {
        ctx.scope.onDispose(() => { if (movers.riding()) world.player.carried = false; });
        pageMovers = movers; // a steer vehicle's rider is the play list's `rides` entry
        // side parity (SS1) reads the page's colliders beside a room's at tick 0: every mover's collider at its declared rest
        ctx.debug.expose('shardfileMovers', { rest: () => { for (const row of movers.data) { const at = { position: { ...row.at }, euler: { ...row.euler }, enabled: row.enabled }; movers.replayPose(row.id, at, at); } } });
      }
    }
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
    // OF23e3: a row that names its program runs on the server; the page draws it through its own weather feature
    const weather = new Map(source.rows.weather.flatMap((row) => 'program' in row ? [] : [[row.id, declaredWeather(row, ctx.app.rng.stream('cosmetic').fork(row.id))] as const]));
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
    for (const lever of levers) lever.bindAimView(world.game.camera, world.player, () => { world.sky.csm.updateFrustums(); });
    const takeHere = (item: string, action: number): boolean => {
      const lever = levers.find(entry => entry.row.id === item); if (lever === undefined) return false;
      if (action === 3) lever.take(); else lever.reload();
      return true;
    };
    // TEMPLATE-E2E TC-E4b: a melee weapon on a rack starts locked; its owned taken line (or, off the wire, its rack's scene) unlocks it
    const onRacks = rackMeleeRows(source), racked = new Set([items.primary, items.secondary, ...items.extras].filter((weapon): weapon is NonNullable<typeof weapon> => weapon !== null && onRacks.has(weapon.row.id)));
    // SHARD-SOURCE SS-GF1a1a: a tool on a stand is in the kit locked; its taken line (or, off the wire, its stand's scene) unlocks
    // it, and off the wire the scene lights it full here as the server's take does
    const onStands = rackToolRows(source), stands = new Set(items.tools.filter(tool => onStands.has(tool.row.id)));
    const takeRacked = (item: string, here = false): boolean => {
      const tool = [...stands].find(entry => entry.row.id === item);
      if (tool !== undefined) {
        stands.delete(tool); play.weapons.unlock(tool.id);
        const held = items.runtimes.get(item);
        if (here && held !== undefined) { held.queue(4); if (!held.lightOn) held.queue(3); }
        return true;
      }
      if (onStands.has(item)) { const held = items.runtimes.get(item); if (here && held !== undefined) held.queue(4); return true; }
      const weapon = [...racked].find(entry => entry.row.id === item); if (weapon === undefined) return false;
      racked.delete(weapon); play.weapons.unlock(weapon.id); play.weapons.select(weapon.id);
      return true;
    };
    // off the wire: a stand's own scene takes its tool; the tool's other action-3 scene (its toggle) does nothing while it hangs there
    const standIds = standScenes(source);
    const standHere = (item: string, at: string): boolean => {
      if (!onStands.has(item)) return takeRacked(item, true);
      if (standIds.has(at)) return takeRacked(item, true);
      return [...stands].some(tool => tool.row.id === item);
    };
    takenHere = item => levers.some(lever => lever.row.id === item && lever.taken) || onRacks.has(item) && ![...racked].some(weapon => weapon.row.id === item)
      || onStands.has(item) && ![...stands].some(tool => tool.row.id === item);
    const scene = clientScene(source, items.runtimes, () => undefined, (item, action, at) => relayItem(source, item, action) || takeHere(item, action) || action === 3 && standHere(item, at));
    if (levers.length > 0 || racked.size > 0 || stands.size > 0) ctx.system({ id: 'shardfile.lever-lines', phase: 'update', run: () => {
      if (wirePage.client !== null) for (const weapon of racked) if (wirePage.line(takenLine(weapon.row.id)) > 0) takeRacked(weapon.row.id);
      if (wirePage.client !== null) for (const tool of stands) if (wirePage.line(takenLine(tool.row.id)) > 0) takeRacked(tool.row.id);
      for (const lever of levers) {
        if (wirePage.client !== null) {
          const lines = leverLines(lever.row.id);
          lever.mirror(wirePage.line(lines.rounds), wirePage.line(lines.reserve), wirePage.line(lines.reloading) > 0, wirePage.line(lines.taken) > 0);
        }
        if (lever.taken && !play.weapons.has(lever.id)) { play.weapons.unlock(lever.id); play.weapons.select(lever.id); }
      }
    } });

    if (source.plumbing !== null && source.plumbing.input.length + source.plumbing.debug.length > 0) {
      const plumbing = installDeclaredPlumbing(source.plumbing, { handledInput: handledItemInputs(source), instance: source.identity.slug, tier: TIER, scope: ctx.scope, input: ctx.app.input,
        active: () => ctx.app.state === 'play' && !world.freeCamera, scene, knobs: ctx.tiers.knobs, debugRow: ctx.debugRow,
        observation: { get mode() { return playerModes(world.player).current(); }, get item() { return ctx.app.equipment?.current.row.id ?? null; }, get flags() { return runtime.hooks.questFlags?.() ?? flags.all; } },
      });
      if (source.plumbing.input.some(row => row.when !== undefined)) ctx.system({ id: 'declared.input.conditions', phase: 'input', before: ['engine.input.contexts'], run: plumbing.update });
    }
    installDeclaredTargets(source.targets, { panels: tiles.props?.panels ?? new Map(), colliders, read, scene, interactables: runtime.interactables, scope: ctx.scope, system: ctx.system,
      // TE-ENG6: a use that can no longer run drops its prompt: its `unless` condition holds, or its rack's lever is in hand.
      spent: spentUses(source, { read, taken: item => takenHere(item) }) });
    // meta MOSSGATE-ZONE MZ34: a look lamp naming a panel lights while that panel shows (a brazier's fire with its flames)
    const shownPanels: ReadonlyMap<string, { readonly visible: boolean }> = tiles.props?.panels ?? new Map();
    ctx.scope.onDispose(setLampPanels(world.game.rootScene, panel => shownPanels.get(panel)?.visible ?? false));
    // SS-GP7: the one install list (races, talks, rides, a held tool's lines), on this page's wire; a grid stay walks the same list
    if (hasTalks(source) && presentation === null) throw new Error('Missing talk presentation module');
    installPlay(source, { ...playWire(), scope: ctx.scope, system: ctx.system, flags, prompts: runtime.interactables, root: ctx.root,
      feet: () => world.player.position, rider: world.player, boost: () => (world.player.sampleHeldCommand().buttons & NET_BUTTONS.sprint) !== 0, move: heldMove(world.player),
      movers: pageMovers, items: () => items.runtimes, expose: (name, value) => { ctx.debug.expose(name, value); },
      views: { raceClock: () => new RaceClockChip(ctx.scope), steer: () => new SteerChip(ctx.scope),
        talkBox: () => { if (presentation === null) throw new Error('Missing talk presentation module'); return presentation.talkBox(ctx.scope.child('talks')); } } });
    // SS-GP1: one install with a grid data cell's (`grid/dataCellQuests.ts`)
    const installQuests = (quests: Shardfile['quests'], at: ShardContext, ui: typeof presentation): void => {
      const states = installDeclaredQuests(quests, flags, ctx.app.events, at.scope, (quest, options) => {
        // a retained (grid) runtime's chip, pins and card are its entered cell's only
        if (ui === null) throw new Error('Missing quest presentation module');
        if (retainsRuntimeServices(ctx)) ui.installEnteredQuestPresentation(at, quest, options); else ui.installQuestPresentation(at, quest, options);
      }, ctx.product.slug);
      // meta MOSSGATE-ZONE MZ31: each declared step and payoff lands where it happened
      const ports = enteredLandingPorts(at, ctx.manifest.slug);
      if (ports !== null) installQuestLandings(states, ports, at.scope);
    };
    // SHARD-SOURCE AP19 (DEVSERVER): `wildshard watch`'s soft restart rebuilds the quest views from a new quest section, so on a
    // watched (one-shard) page they live in one child scope it replaces; elsewhere they are the context's, as they always were.
    if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && !retainsRuntimeServices(ctx) && typeof window !== 'undefined') {
      const views = (scope: Scope): ShardContext => Object.create(ctx, { scope: { value: scope }, system: { value: (spec: SystemSpec) => { ctx.app.addSystem(spec, scope); } } }) as ShardContext;
      let held = ctx.scope.child('shardfile.quests');
      installQuests(source.quests, views(held), presentation);
      ctx.scope.expose(window, '__shardfileDevQuests', async (quests: Shardfile['quests']): Promise<boolean> => {
        const ui = presentation ?? await import('../plugin/ui');
        if (ctx.scope.disposed) return false;
        // the old views go first: a quest's system keeps its id across the swap
        held.dispose(); held = ctx.scope.child('shardfile.quests');
        try { installQuests(quests, views(held), ui); return true; } catch (cause) { console.error('[devScene] quest views', cause); return false; }
      });
    } else installQuests(source.quests, ctx, presentation);
    if (ctx.product.has('ui/completion')) { if (ctx.product.section('ui/completion').trigger === 'quest') installCompletion(ctx, flags, play.progress); }
    else { const rows = defaultCompletionRows(source.identity.slug, source.identity.name, source.quests.quests); if (rows !== undefined) installCompletion(ctx, flags, play.progress, undefined, undefined, rows); }
    runtime.hooks.questFlags = () => flags.all; runtime.hooks.adventureFlags = () => flags.all;
    // An admitted scene installs its own declared profiles once in the play phase.
    if (this.bindings.audioOwner !== 'runtime' && !this.plan?.features.some(row => row.kind === 'audio.scene')) installDeclaredAudio(source.audio, { audio: play.audio, cues: play.cues, voices: this.bindings.voices(play.audio), music: play.music, scope: ctx.scope, profiles: this.bindings.audioProfiles?.(play, { source: source.audio, read: this.assets.audioRead() }) ?? pageScoreProfiles(source.audio, play, source.quests.races) });
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

/** What a page's declared boss panel does: hold its weapons through the intro, count an attempt, hear its player die. */
function bossPanelPorts(ctx: ShardContext, play: { readonly weapons: { setEnabled: (on: boolean) => void } }): BossPanelPorts {
  return { lock: on => { play.weapons.setEnabled(!on); },
    attempt: (boss, outcome) => { ctx.app.events.emit('boss.attempt', { boss, outcome }); },
    died: then => { ctx.on('player.died', ({ actor }) => { if (actor === ctx.app.player) then(); }); } };
}

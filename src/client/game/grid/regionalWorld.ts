import { LightPool } from '@wildshard/engine/fx/LightPool';
import { clientPageGround } from '../../../shared/game/shardfile/clientGround';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { bindSceneSourceLooks } from '../shardfile/sceneSources';
import { bindPaintedMaterialMaps } from '../looks/paintedLook';
import { leaseClientLibrary } from '../shardfile/clientLibrary';
import { ktx2TranscodeSupport } from '@wildshard/engine/core/ktx2';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
/**
 * The concrete regional world of a trusted hybrid cell (SHARD-PLATFORM SF47 / M3, E452): the foundation that
 * `createRegionalRuntimeFactory` composes, so an admitted first-party runtime can run as a neighbour cell instead of the
 * page's home.
 *
 * The page keeps its one renderer, camera, sky, player, input and combat. The region owns, under its resident scope,
 *
 * - a bodyless destination `RegionShell` (its own Physics, no second traveller capsule) with the real terrain collider of the
 *   region's level, plus whatever cell installs the live session adds (borders, entry sockets, transfer walls);
 * - a `LevelFrameBinding` (level, heightfield, chunk constants, water, navmesh) that is entered with the runtime scope;
 * - a scene subtree: a `Scene` parented under the regional view's root (already at the cell's render offset), which
 *   `Game.bindScene` makes `game.scene` while the runtime is entered, so content the runtime adds to `game.scene` draws
 *   in place; the root scene, its one sky dome and its one sun keep rendering (SF19a's one grid frame);
 * - terrain built with `Terrain.build(..., frame.terrain)` and the region level's own look painter (whatever its `look`
 *   declares as `terrainPainter`; absent, the engine ground from the level's own assets: its splat, layers, boreal set), a forest built inside `frame.run`, and the regional
 *   AnimalManager built with `buildAsync(pause, frame)`, all children of that subtree;
 * - its part in the one grid frame (`frameLook.ts`): its scene's own fog object (which its runtime's weather writes) and
 *   its level's grade, contributed to the page's frame while resident, so its air and grade own the frame inside its cell
 *   and blend across the edge band; it builds no sky dome or sun of its own.
 * - its light on the page's one sky (`regionLight.ts`, G223): whatever its runtime lights (the key light, fill, sun disc,
 *   shadow maps, painterly / fog uniforms, volumetric light, engine grade) is held on each entry and put back on leave.
 * - its own sky (`regionSky.ts`, G223 / G232): its level's sky backdrop laid
 *   over the page's one sky by its owner weight, charged under its own `sim-sky:` claim beside the runtime's. A level with
 *   no backdrop and a painted sky (G321 part 5) lays its standalone sky
 *   environment there instead (`SkyRig.layeredEnvironment`: swapped in at half weight, under the same claim).
 * - its own look parts (SF63): its level's grass driver (`LookStrategy.grass`) is bound with its level frame, so its
 *   runtime grows its own grass, never the page look's or the engine carpet reading its splat wrongly; and (G232)
 *   its level's light model and fog (`LookStrategy.lighting` / `fog`) scoped to its own
 *   materials as region-keyed program variants (`render/regionLook.ts`), freed with the resident scope.
 * - declared page materials and terrain, compiled once under the resident and lent directly to scene/model sources;
 *   the entered frame ticks their existing curves and follows the viewer through ordinary tile residency.
 * - its own post composite (SF63 / G158, op-frame21): where its look declares one (`ExtendLook.cell`; Jake G322: always),
 *   it is built once its world exists and run by the frame owner while it carries the
 *   frame (`FrameLookPort.composite`); a composite that is its whole chain carries a neutral engine chain beside it.
 *
 * Leave: the frame, scene binding and forest LOD system end with the entered scope, and the view hides its root. Dispose
 * (the resident scope): the host's Physics frees every body and collider, the subtree leaves the page scene and frees the
 * GPU resources the asset cache does not share. Memory: everything here is inside the whole-runtime claim the caller
 * reserved (`regionalRuntimeAccountedBytes`); this module reserves nothing beside it but the optional region sky's claim
 * (`regionSky.ts`). Generic game code (E405).
 */
import { Fog, Group, Material, Mesh, Scene, Vector3, type Object3D, type Texture } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { TexturePolicyBinding, registerGpuFiles, texMode } from '@wildshard/engine/boot/gpuFiles';
import { ownSceneResource, ownSceneTree } from '@wildshard/engine/app/sceneOwnership';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import { AnimalHerdView } from '@wildshard/engine/entities/AnimalHerdView';
import { LevelFrameBinding, type LevelFrameOptions } from '@wildshard/engine/level/frame';
import type { LevelSpec } from '@wildshard/engine/level/spec';
import { prepareWorldLook, type LookStrategy } from '@wildshard/engine/render/look';
import { compileOffscreenPass } from '@wildshard/engine/render/precompile';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { addLevelTerrain, addTerrain, resampleTerrain } from '@wildshard/engine/physics/terrain';
import { applySkin, type SkinDef } from '@wildshard/engine/player/Skins';
import { SkyRig } from '@wildshard/engine/world/skyRig';
import { loadCarriedLUT, loadLUT } from '@wildshard/engine/boot/bakedApi';
import { Terrain } from '@wildshard/engine/world/Terrain';
import { TreeFactory } from '@wildshard/engine/world/TreeFactory';
import { Forest } from '@wildshard/engine/world/forest/Forest';
import { WaterBodies } from '@wildshard/engine/world/water/body';
import { CHUNK_SIZE, TERRAIN_RES } from '@wildshard/engine/core/config';
import { RegionShell, type RegionLevel } from './regionShell';
import { RowBodies } from '@wildshard/engine/entities/RowBodies';
import { buildYield, workSlice } from '@wildshard/engine/core/workSlice';
import { heightAt } from '@wildshard/engine/world/Heightfield';
import { loadBakedTerrain } from '@wildshard/engine/world/BakedTerrain';
import { bakedTerrainSource } from '@wildshard/engine/world/bakedTerrainField';
import { TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { prepareManifestScalarBlocks,type ShardManifest } from '../shard/manifest';
import { prepareShardAssets } from '../shard/load';
import { toLevelSpec } from '../shard/spec';
import { prepareRegionalInputs } from './regionalInputs';
import { regionalBuildCheckpoint } from './regionalBuildCheckpoint';
import { clientPreparationBatch, timeClientPreparation } from '../shardfile/preparationTiming';
import type { ShardWorld } from '../../../server/game/shard/world';
import type { RegionalRuntimeFoundation, RegionalRuntimePage, RegionalRuntimeRequest, RegionalRuntimeTextures } from './regionalRuntime';
import { frameLookOf, lookChainKind, regionChain, regionGrade, replacedKnobs, wholeChainKnobs, type FrameLookPort } from './frameLook';
import { applyLevelLight, holdPageLight, regionLightSwap } from './regionLight';
import { buildRegionSky, type RegionBackdrop, type RegionSkyOutcome } from './regionSky';
import { publishSkyClock } from '../session/clockSettings';
import { imagesFirstPlayingBytes } from './runtimeCost';
import { provideRuntimeProduct, runtimeProduct, shardProductFromAdmission } from '../shardfile/runtimeProduct';
import type { AdmittedProduct } from '../shardfile/product';
import { clientMaterials } from '../shardfile/clientMaterials';
import { splatGroundDrawn } from '../shardfile/clientSplatTerrain';
import { lendLooks, lendSceneMaterials } from '../shardfile/lentLooks';
import { standaloneClientTiles, type ClientTileRegistration } from '../shardfile/tileContent';
import { clientViews } from '../shardfile/clientViews';
import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import { shardfileLook } from '../shardfile/look';
import { findShard } from '../shard/registry';
import { tileRing } from '../shardfile/tileDriver';

/** Page-root ports; every default is the standalone behaviour, the live session supplies the cell's own installs. */
export interface RegionalWorldPorts {
  /** The page's existing scheduler owns render tiles; regions borrow scoped instance registration. */
  readonly tiles?: ClientTileRegistration;
  readonly rapier: Rapier;
  /** The trusted level of the admitted manifest (default: the manifest's ordinary `toLevelSpec`). */
  readonly level?: (manifest: ShardManifest) => LevelSpec;
  /** The level's baked navmesh (the browser passes `loadNavmesh`); absent: none. */
  readonly navmesh?: (level: LevelSpec) => Promise<LevelFrameOptions['navmesh']>;
  /** The level's water bodies; absent: the level's own `ground.water` (as `LevelLoader` registers them at level.data), which
   *  the runtime's own registrations join while entered. */
  readonly water?: (level: LevelSpec) => WaterBodies;
  /** Cell installs on the owned destination (grid borders, entry sockets, transfer walls), before any gameplay. */
  readonly install?: (host: RegionShell, request: RegionalRuntimeRequest) => void;
  /** The region's native continuation; false keeps the traveller in the source frame. */
  readonly checkpoint: (host: RegionShell, request: RegionalRuntimeRequest) => boolean;
  /** Yield between herd slices and heavy builds (a macrotask in the browser). */
  readonly pause: () => Promise<void>;
  /** The drawn ground (default: `regionalTerrain`, the level's own painter on the frame's captured heightfield and assets). */
  readonly terrain?: (level: LevelSpec, scope: Scope, binding: LevelFrameBinding['terrain']) => Promise<Terrain>;
  /** The one grid frame's live-region port (default: the frame bound to the page's root scene; null: none). */
  readonly look?: FrameLookPort | null;
  /**
   * The region's light swap on the page's one sky (`regionLight.ts`, G223), installed on each entry: default, the page's
   * whole shared light held on entry and put back on leave when the page sky is a real rig; null: none.
   */
  readonly light?: ((entry: Scope) => void) | null;
}
/**
 * A region's drawn ground as its own level paints it standalone: the painter its look declares (`LookStrategy.terrainPainter`),
 * owned by the region's scope, on the frame's captured heightfield; without one, the engine ground from the level's own
 * assets (splat, layers, boreal set). Only the painter is taken from the look: its sky, fog and chain stay the frame's.
 * Pass the resident's resolved look to share its lifetime; otherwise this function resolves and owns one strategy.
 */
export async function regionalTerrain(level: LevelSpec, scope: Scope, binding: LevelFrameBinding['terrain'], look?: LookStrategy | null): Promise<Terrain> {
  const resolved = look === undefined ? await level.look?.() : look;
  if (look === undefined) scope.onDispose(() => { resolved?.dispose?.(); });
  if (scope.disposed) throw new Error('Regional terrain left while loading its look');
  return new Terrain().build(level.ground, resolved?.terrainPainter, scope, binding);
}

type RegionalPresentationInputs = {
  readonly collider: Uint8Array | undefined;
  readonly presentation: Awaited<ReturnType<typeof clientMaterials>>;
} | null;

/** Verified input and private scope-owned materials need no native frame or
 * heightfield. Their bindings still publish at the original cursor below. */
async function prepareRegionalPresentation(admitted: AdmittedProduct, renderer: Parameters<typeof clientMaterials>[2], scope: Scope): Promise<RegionalPresentationInputs> {
  const full = admitted.source;
  if (!hasDeclaredClientPage(full)) return null;
  const assets = runtimeProduct(full).assets, terrain = full.terrain;
  const collider = terrain === null ? undefined : await assets.read(terrain.collider);
  if (scope.disposed || scope.disposing) throw new Error('Regional world left while reading its presentation collider');
  const presentation = await clientMaterials({ ...full, state: full.state }, assets.retained, renderer, scope, { trustedGraphs: true });
  if (scope.disposed || scope.disposing) throw new Error('Regional world left while preparing its presentation materials');
  return { collider, presentation };
}

/** Bind prepared data at its original ordered cursor. Curves and tiles advance
 * only while entered; the material reader never publishes a regional frame. */
async function regionalPresentation(admitted: AdmittedProduct, start: { readonly x: number; readonly z: number }, root: Object3D, renderer: Parameters<typeof clientMaterials>[2], scope: Scope, hour: () => number | null, allocator: ResidencyAllocator, instance: string, sky: ShardWorld['sky'], input: RegionalPresentationInputs, registration?: ClientTileRegistration): Promise<{ ready: Promise<void>; tick: (dt: number) => void; follow: (x: number, z: number) => void } | null> {
  if (input === null) return null;
  const full = admitted.source, data = full, terrain = data.terrain, assets = runtimeProduct(full).assets;
  const { collider, presentation } = input, slug = full.identity.slug;
  if (terrain !== null) {
    const material = presentation.materials.get(terrain.family);
    if (material === undefined) throw new Error('Regional terrain requires its admitted family material');
    sky.setupMaterial(material);
    lendSceneMaterials(scope, full.identity.slug, new Map([[terrain.family, material]]));
  }
  {
    const product = shardProductFromAdmission(admitted, scope);
    await timeClientPreparation(slug, 'native.presentation.lease', () => leaseClientLibrary(full, assets.retained, { validatedSource: admitted.source, scope, allocator, owner: instance, textures: ktx2TranscodeSupport(renderer), read: ref => assets.read(ref) }));
    lendLooks(scope, presentation);
    bindPaintedMaterialMaps(product, scope, presentation);
    await timeClientPreparation(slug, 'native.presentation.scene-looks', () => bindSceneSourceLooks(product, scope, presentation));
    presentation.graphs.bind({ hour });
  }
  const views = clientViews({ root, terrain: terrain?.family ?? null, terrainShadow: terrain?.shadow, terrainOrder: terrain?.order, ...presentation,
    ...(collider === undefined ? {} : { lattice: decodeTerrainTile(collider) }) });
  let frame: (() => void) | undefined, position = start;
  if (registration !== undefined && data.props !== null) { const props = data.props; await timeClientPreparation(slug, 'native.presentation.props-library', () => views.library(props, assets.retained, scope)); }
  const entry = { source: data, assets, root, views: views.tiles };
  let tiles: Awaited<ReturnType<typeof standaloneClientTiles>> | Awaited<ReturnType<ClientTileRegistration['enter']>> | undefined;
  const ready = timeClientPreparation(slug, 'native.presentation.tiles', (): Promise<NonNullable<typeof tiles>> => registration === undefined ? standaloneClientTiles(entry, scope, {
    instance, budget: allocator, radius: tileRing, start, viewer: () => position,
    library: owner => data.props === null ? Promise.resolve(null) : views.library(data.props, assets.retained, owner),
    pause: () => buildYield(scope), frame: run => { frame = run; },
  }) : registration.enter(instance, entry, scope, start)).then(value => {
    if (scope.disposed || scope.disposing) throw new Error('Regional world left while preparing its tiles');
    tiles = value;
    return undefined;
  });
  // Capture early tile refusal while the private world builds; the runtime
  // gates afterWorld/kit on this original promise and drains before teardown.
  void ready.catch(() => undefined);
  const distance = terrain?.follow ?? 5;
  let priorX = start.x, priorZ = start.z;
  return { ready, tick: dt => { presentation.tick(dt); frame?.(); }, follow: (x, z) => {
    position = { x, z };
    if (Math.hypot(x - priorX, z - priorZ) < distance) return;
    priorX = x; priorZ = z; void tiles?.refresh(x, z);
  } };
}

/** What a leak check reads from a prepared region, beside the view's own census. */
export interface RegionalWorldCensus { readonly bodies: number; readonly colliders: number; readonly sceneBound: boolean; readonly parented: boolean; readonly disposed: boolean }
const census = new WeakMap<RegionalRuntimeFoundation, () => RegionalWorldCensus>();

const isMaterial = (value: unknown): value is Material => value instanceof Material;
/** a level's sky backdrop as the page's sky layers it (G223) */
type LayeredBackdrop = NonNullable<Awaited<ReturnType<SkyRig['layeredBackdrop']>>>['backdrop'];
/** what a page sky's layer attaches: a level's backdrop, or (G321 part 5) its default sky's environment alone */
type LayerAttachable = Parameters<NonNullable<ReturnType<SkyRig['layerBackdrop']>>['attach']>[0] & RegionBackdrop;
/** a layered sky's volumetric light: the page's chain never has one to hand (G232 hands a region's clock the page's saturation, SF63 its god rays) */
const NO_VOL: Parameters<LayeredBackdrop['attachPost']>[0]['vol'] = { setSun: () => undefined, setFogColor: () => undefined, setStrength: () => undefined };

/**
 * The terrain collider's lattice (`terrainGrid` in @wildshard/engine/physics/terrain: TERRAIN_RES² heights over the chunk), sampled
 * under the cell's bound frame a band of rows per work slice (op-hitch26, E435 frame floor): sampling a shard's terrain function
 * at every vertex in one go was a 0.13 s task on Nalati's road entry. Same lattice, same order, same heights.
 */
async function slicedTerrainGrid(run: (rows: () => number) => number, left: () => boolean): Promise<Float32Array> {
  const res = TERRAIN_RES, d = CHUNK_SIZE / (res - 1), half = CHUNK_SIZE / 2, out = new Float32Array(res * res), slice = workSlice();
  for (let next = 0; ;) {
    const from = next;
    next = run(() => {
      let iz = from;
      do { for (let ix = 0; ix < res; ix++) out[iz * res + ix] = heightAt(ix * d - half, iz * d - half); iz++; } while (iz < res && !slice.due());
      return iz;
    });
    if (next >= res) return out;
    await slice.yield();
    if (left()) throw new Error('Regional world left while sampling its ground');
  }
}

const regionLevel = ({ id, spawn }: LevelSpec): RegionLevel => ({ id, player: { at: { x: spawn.x, y: spawn.y ?? 0, z: spawn.z }, yaw: spawn.yaw } });

/** PZ22: install the shard's KTX2 table (once per manifest) before its texture policy resolves: Auto reads KTX2 from
 *  the registered table (gpuFiles.ts, DL17), so a choice made first stays on images for the resident's whole life. */
export function registerRegionalTextureTable(manifest: ShardManifest): Promise<void> {
  return prepareShardAssets(manifest, registerGpuFiles);
}

/** Resolve the existing texture policy once before memory admission. The resident enters this SAME policy for
 * asynchronous construction and each frame, so a capability-probe image fallback cannot retain a compressed claim. */
export function resolveRegionalRuntimeTextures(manifest: Pick<ShardManifest, 'slug' | 'tiers' | 'runtimeCost'>, residents?: Parameters<typeof imagesFirstPlayingBytes>[1]): RegionalRuntimeTextures {
  const { slug: identity } = manifest;
  const policy = new TexturePolicyBinding(manifest.tiers?.[TIER]?.textures, identity, imagesFirstPlayingBytes(manifest.runtimeCost, residents));
  const leave = policy.enter();
  try { return Object.freeze({ mode: texMode(), enter: () => policy.enter() }); }
  finally { leave(); }
}

/** The `prepareFoundation` port of `createRegionalRuntimeFactory` for any trusted hybrid manifest. */
export function createRegionalWorldFoundation(ports: RegionalWorldPorts): (request: RegionalRuntimeRequest) => Promise<RegionalRuntimeFoundation> {
  return async request => {
    if (request.scope.disposed) throw new Error('Regional world requires a live runtime scope');
    const { cell, page } = request, app = page.context.app, home = page.world, game = home.game, sky = home.sky;
    // the look and roster loaders read the cell's admitted product (the one its ShardContext gets), never shard.config
    const product=ports.level===undefined||request.manifest.scalarBlocks!==undefined
      ?shardProductFromAdmission(request.admitted,request.scope):undefined;
    // G782: Developer pages time each native foundation wait (`wildshard.prepare:<slug>:native.<step>`) beside its whole span
    if(product!==undefined)await timeClientPreparation(request.manifest.slug,'native.scalar-blocks',()=>prepareManifestScalarBlocks(request.manifest,product,request.scope));
    const level = ports.level === undefined ? toLevelSpec(hasDeclaredClientPage(request.admitted.source) ? { ...request.manifest, ground: clientPageGround(request.admitted.source, request.admitted.assets) } : request.manifest, product) : ports.level(request.manifest);
    const { slug: identity } = request.manifest;
    if (level.id !== identity) throw new Error('Regional level identity differs from its trusted manifest');
    // PZ22: the table goes in before Auto resolves, and before the resident's scope exists to leak on a refusal
    if (request.textures === undefined) await registerRegionalTextureTable(request.manifest);
    const resident = request.scope.child(`grid.world:${cell.instance}`), left = (): boolean => resident.disposed;
    const pausePoint = regionalBuildCheckpoint(resident, ports.pause);
    let pauses = clientPreparationBatch(identity, 'native.checkpoints', ['pause']);
    const checkpoint = (): Promise<void> => (pauses === undefined ? pausePoint() : pauses.run('pause', pausePoint));
    const textures = request.textures ?? resolveRegionalRuntimeTextures(request.manifest);
    // Exclusive runtime construction has retired the source. Keep the destination's policy through asynchronous
    // setup, then restore the page on the road. Entered frame scopes reinstall this same resolved policy for hooks.
    const leaveTextures = textures.enter(); resident.onDispose(leaveTextures);
    const scene = new Scene(); scene.name = `region-scene:${cell.instance}`;
    // the region's own lights (its content asks this scene's pool) show through the page's reserved lights: the page's
    // light count stays put as the region shows and hides (LightPool, GRID_REGION_POINT_LIGHTS)
    LightPool.for(scene).mirrorInto(LightPool.for(game.rootScene), resident);
    let bound = 0;
    let presentationReady: Promise<[PromiseSettledResult<RegionalPresentationInputs>]> | undefined;
    let rendering: Promise<[PromiseSettledResult<void>]> | undefined;
    ownSceneTree(scene, resident, app.assets);
    try {
      await timeClientPreparation(identity, 'native.shard-assets', () => registerRegionalTextureTable(request.manifest));
      if (left()) throw new Error('Regional world left while registering its texture stand-ins');
      // M3 tiles-swap: the admitted product's reader for the resident runtime (a painter that binds its compiled tiles reads
      // it), handed over first: the level's declared navigation and a required manifest ground are that product's own files
      // (the session's readers read them), never downloaded again
      provideRuntimeProduct(request.admitted, resident);
      // Start independent data/material inputs beside nav/look/native setup.
      // Capture rejection now, consume at its former cursor, and drain before
      // teardown on every earlier refusal without changing failure precedence.
      presentationReady = Promise.allSettled([timeClientPreparation(identity, 'native.presentation-inputs',
        () => prepareRegionalPresentation(request.admitted, game.renderer, resident))] as const);
      const navigation = ports.navmesh;
      const terrainBinding: { current?: LevelFrameBinding['terrain'] } = {};
      const field = (): LevelFrameBinding['terrain']['field'] => {
        if (terrainBinding.current === undefined) throw new Error('Regional ground is not bound');
        return terrainBinding.current.field;
      };
      // This bodyless shell has no ground, entities or player motor yet. Its
      // native initialization can overlap product-backed navigation/look reads;
      // no height query or collider is published until the frame binds below.
      const [inputs, simulation] = await timeClientPreparation(identity, 'native.inputs', () => Promise.allSettled([
        prepareRegionalInputs(level, resident, navigation === undefined ? undefined : () => navigation(level),
          look => prepareWorldLook(look, { renderer: game.renderer, sky, scope: resident })),
        Promise.resolve().then(() => {
          if (left() || resident.disposing) throw new Error('Regional world left before its physics shell');
          return withOwner(resident, () => new RegionShell(regionLevel(level), ports.rapier, resident));
        }),
      ]));
      // Drain both before teardown. Navigation/look keeps its original failure
      // precedence; every successful shell is already owned by resident.
      if (inputs.status === 'rejected') throw inputs.reason;
      if (simulation.status === 'rejected') throw simulation.reason;
      const { navmesh, look: levelLook } = inputs.value, host = simulation.value;
      await checkpoint();
      if (left()) throw new Error('Regional world left while loading its navmesh');
      const water = ports.water?.(level) ?? new WaterBodies();
      // the level's own water bodies (its sea, a river, a pond), registered as a standalone boot registers them at level.data:
      // swimming, wading, the board's ride height, creatures and the edge readers ask them while its frame is bound (without
      // them a cell's sea answered null and the board rode the seabed under it, G254)
      if (ports.water === undefined) for (const body of level.ground.water ?? []) water.add(body, resident);
      // the level's own look parts its content builds from while its frame is bound (SF63: its grass driver)
      if (left()) throw new Error('Regional world left while loading its look');
      const frame = new LevelFrameBinding({ level, scope: resident, levelScope: request.scope, navmesh, water, textures, look: levelLook });
      terrainBinding.current = frame.terrain;
      // Required manifest ground must enter before collision sampling or native home construction.
      if (bakedTerrainSource(frame.terrain.base) !== null) {
        await timeClientPreparation(identity, 'native.baked-ground', () => loadBakedTerrain(frame.terrain));
        if (left()) throw new Error('Regional world left while loading its required ground');
      }
      // The real ground of the region's level, sampled from its own bound heightfield (never the home's).
      // A declared page collides on its server's own collider lattice (NET-LAG NL10); any other level samples its bound heightfield.
      const declared = level.ground.collider;
      if (declared !== undefined) frame.run(app, () => { addLevelTerrain(host.physics, declared); });
      else {
        const groundGrid = await timeClientPreparation(identity, 'native.ground-grid', () => slicedTerrainGrid((rows) => frame.run(app, rows), left));
        frame.run(app, () => { addTerrain(host.physics, groundGrid); });
      }
      ports.install?.(host, request);
      await checkpoint();
      if (left()) throw new Error('Regional world left while building its collision');
      const terrain = await timeClientPreparation(identity, 'native.terrain', () => (ports.terrain === undefined ? regionalTerrain(level, resident, frame.terrain, levelLook) : ports.terrain(level, resident, frame.terrain)));
      await checkpoint();
      if (left()) throw new Error('Regional world left while building its terrain');
      const pendingPresentation = presentationReady;
      const [presentationInput] = await timeClientPreparation(identity, 'native.presentation-wait', () => pendingPresentation);
      if (presentationInput.status === 'rejected') throw presentationInput.reason;
      if (left() || resident.disposing) throw new Error('Regional world left before binding its presentation');
      const presented = await timeClientPreparation(identity, 'native.presentation', () => regionalPresentation(request.admitted, request.entryPoint ?? request.manifest.spawn, scene, game.renderer, resident, () => game.sky.dayNight?.hour ?? null, request.allocator, cell.instance, sky, presentationInput.value, ports.tiles));
      if (presented !== null) rendering = Promise.allSettled([presented.ready]);
      if (left()) throw new Error('Regional world left while drawing its presentation ground');
      // a painter that bound its own ground (its compiled collider) moves the collision built above onto it
      if (terrain.groundBound) frame.run(app, () => { resampleTerrain(host.physics); });
      terrain.group.traverse((node: Object3D) => { const material: unknown = node instanceof Mesh ? node.material : null; if (isMaterial(material)) sky.setupMaterial(material); });
      scene.add(terrain.group);
      // Debug ▸ Ground tiles (P1/P2): a splat ground draws from its props tiles; the region's whole native ground mesh retires
      if (splatGroundDrawn(request.admitted.source.props)) terrain.retireMesh();
      const trees = level.trees?.factory;
      const factory = typeof trees === 'function' ? await timeClientPreparation(identity, 'native.tree-factory', async () => (await trees())(game.renderer, sky)) : new TreeFactory(game.renderer).buildEmpty();
      await checkpoint();
      if (left()) throw new Error('Regional world left while building its trees');
      const forest = frame.run(app, () => new Forest(factory, sky).build({ drawnBy: level.trees?.drawnBy ?? 'self' }));
      if (forest.trees.length === 0) forest.group.visible = false; else scene.add(forest.group);
      terrain.applyCanopy(forest.canopyMap);
      await checkpoint();
      if (left()) throw new Error('Regional world left while building its forest');
      // its look's sky dressing reads the cloud field at composition: the common bake arrives first, never a marched fbm
      if (levelLook?.sky?.build !== undefined && sky instanceof SkyRig) {
        await timeClientPreparation(identity, 'native.cloud-field', () => sky.loadCloudField());
        if (left()) throw new Error('Regional world left while loading its cloud field');
      }
      const ground = { heightAt: (x: number, z: number): number => field().heightAt(x, z), waterSurfaceAt: (x: number, z: number): number | null => water.restAt(x, z) };
      let world: ShardWorld | null = null;
      // SF63 part 2: the region's scoped look, whose per-frame parts run only while its cell is entered
      let regionLook: ReturnType<SkyRig['scopeLevelLook']> = null;
      let skyReady = Promise.resolve();
      // op-frame21 / Jake G322: its look's own post composite, always carried in its cell (a 'replace' look's too, G600)
      const cellComposite = levelLook?.cell ?? null;
      let framePort: FrameLookPort | null = null, viewRoot: Object3D | null = null, composited = false;
      // its light on the page's one sky: held on each entry, put back on leave (G223); its first entry starts from its own level's light
      const light = ports.light !== undefined ? ports.light : sky instanceof SkyRig ? regionLightSwap(() => holdPageLight({ sky, game }), () => { applyLevelLight({ sky, scene }, level); }) : null;
      const foundation: RegionalRuntimeFoundation = {
        // O20: its world retires as steps inside its runtime's sliced retirement (a crossing's), never as one cleanup
        region: { host, dispose: () => { resident.dispose(); }, retire: () => resident.disposeSteps(), ghostRoots: [resident] },
        ground,
        ...(presented === null ? {} : { renderReady: presented.ready }),
        world: view => {
          if (world !== null) throw new Error('Regional world is already composed');
          if (resident.disposed) throw new Error('Regional world left before composition');
          // The region's own fog object: its runtime's weather writes it (it is never drawn itself) ...
          scene.fog = game.rootScene.fog?.clone() ?? null;
          // ... which is the owner's air in the one frame, with its level's grade, while the region is resident
          const look = ports.look === undefined ? frameLookOf(game.rootScene) : ports.look;
          framePort = look; viewRoot = view.root;
          const regionOrigin = new Vector3();
          // G232: on a neutral page shell its whole grade chain (grade, look layer, learned LUT) is carried exactly
          let lut: Texture | null = null;
          const ao = level.tiers?.[TIER]?.ao ?? TIER_CONFIG.ao;
          // a composite that is its whole colour chain: the carried engine chain is neutral beside it (no engine grade, LUT,
          // bloom, vignette, rays or shafts), as standalone, where its compose's chain holds no engine effect
          const chain = cellComposite?.replaces === 'chain' ? regionChain(level, () => null, undefined, { ao }, wholeChainKnobs(ao))
            : regionChain(level, () => lut, lookChainKind(levelLook), { ao, godRays: level.tiers?.[TIER]?.godRays }, replacedKnobs(levelLook, TIER));
          if (look !== null) resident.onDispose(look.contribute(cell.instance, { fog: scene.fog, grade: regionGrade(level), chain }));
          // G223 / G232: its level's own sky backdrop laid over the one sky by its owner weight
          if (look !== null && sky instanceof SkyRig) skyReady = (async () => {
            try {
              // G321: a level whose world draws its own whole sky (`SkyDressing.ownSky`: a painted dome in its scene, no
              // backdrop) owns the horizon in its cell as a backdrop does; its sky fades with its world, so the layer only
              // tells the frame its weight (the road's void floor stands down by it)
              // (hung below unless its environment layer, G321 part 5, hangs the same weight with its environment)
              const hang = look.sky;
              let hungOwn = false;
              const hangOwnSky = (): void => {
                if (hungOwn || levelLook?.backdrop !== undefined || levelLook?.sky?.ownSky !== true || hang === undefined || left()) return;
                hungOwn = true;
                let drawn = 0;
                resident.onDispose(hang(cell.instance, { weight: (w) => { drawn = w; }, state: () => ({ weight: drawn, drawn: drawn > 0, bytes: 0, reserved: 0 }) }));
              };
              const made: { backdrop: LayeredBackdrop | null; environment: (() => Texture | null) | null } = { backdrop: null, environment: null };
              const measured = request.admitted.source.runtime === null ? undefined : textures.mode === 'img' ? request.manifest.runtimeCost?.imagesFirst ?? request.manifest.runtimeCost : request.manifest.runtimeCost;
              const outcome = await buildRegionSky<LayerAttachable>({ instance: cell.instance, look, allocator: request.allocator, scope: resident,
                ...(measured?.residentBaseMB === undefined ? {} : { coveredBy: request.claim.id }), layered: async () => {
                const make = levelLook?.backdrop;
                // G321 part 5: a level with no backdrop lights with its painted sky's environment on
                // its own page; its cell lays that environment alone, its intensity what its clock writes on its own scene
                // (seeded with its declared one), so its world is lit as standalone. Everything else stays its world's own.
                if (make === undefined) {
                  if (level.sky.painted === undefined) return null;
                  scene.environmentIntensity = level.sky.envIntensity;
                  const env = await sky.layeredEnvironment({ level, scope: resident, intensity: () => scene.environmentIntensity });
                  if (env === null) return null;
                  made.environment = () => env.layer.holder.environment;
                  return { ...env, prepare: () => game.warmSkyLayer(env.layer) };
                }
                const layered = await sky.layeredBackdrop(make, { level, scope: resident, air: () => (scene.fog instanceof Fog ? scene.fog : null), planet: levelLook?.sky?.planet !== false, clouds: levelLook?.sky?.clouds !== false, sun: levelLook?.sky?.sun,
                  // G321: its world-anchored sky pieces stand at the region's root, where its level's frame is drawn
                  origin: () => regionOrigin.setFromMatrixPosition(view.root.matrixWorld) });
                if (layered === null) return null;
                // op-hitch47: attaching binds its clock, which draws its environment pass at once: link that pass first
                const pass = layered.backdrop.environmentPass;
                if (pass !== undefined) await compileOffscreenPass(game.renderer, pass, () => !left());
                made.backdrop = layered.backdrop;
                // R12: its clock is the day cycle while its runtime is entered (session/clockSettings.ts)
                publishSkyClock(resident, layered.backdrop.clock);
                // Attachment binds the clock and creates its PMREM. Read that environment after attach, not before.
                made.environment = () => layered.layer.holder.environment;
                // its clock turns the page's saturation with its hour as standalone, where the page carries its chain
                // and its shafts where the page carries a cinematic chain's (SF63 follow-up)
                const post = look.post?.(cell.instance) ?? null;
                if (post !== null) layered.backdrop.attachPost({ vol: post.vol ?? NO_VOL, rays: post.rays, hueSat: post.hueSat });
                return { ...layered, prepare: () => game.warmSkyLayer(layered.layer) };
              } });
              // an environment-only sky draws no backdrop: its own sky stands as without one
              if (outcome !== 'drawn') hangOwnSky();
              // its LUT: the drawn backdrop's (it loaded the level's), else the level's own file when it has no backdrop
              if (outcome === 'drawn') {
                // The subtree is not a render target. Warm-up borrows the same sky environment the page will draw
                // on entry, after the real sky build and its unchanged residency admission have finished.
                scene.environment = made.environment?.() ?? null;
                resident.onDispose(() => { scene.environment = null; }); // borrowed: the sky layer owns its disposal
              }
              if (outcome === 'drawn' && made.backdrop !== null) lut = made.backdrop.lut;
              else if ((outcome === 'off' || levelLook?.backdrop === undefined) && !left() && (look.post?.() ?? null) !== null) {
                const own = await loadLUT(level.id);
                if (own !== null && left()) own.dispose();
                else if (own !== null) { lut = own; ownSceneResource(own, resident); resident.onDispose(() => { lut = null; }); }
              }
              // op-lut20: a look that applies its learned LUT inside its own compose declares it (`ExtendLook.lut`): the
              // cell carries it where nothing else gave one, behind its default-off Debug row (a look change on the grid)
              if (lut === null && levelLook !== null && levelLook.mode !== 'replace' && !left() && (look.post?.() ?? null) !== null) {
                const own = await loadCarriedLUT(levelLook.lut, `${level.id}-declared-lut`);
                if (own !== null && left()) own.dispose();
                else if (own !== null) { lut = own; ownSceneResource(own, resident); resident.onDispose(() => { lut = null; }); }
              }
            } catch (error) { console.warn(`[region sky] ${cell.instance}`, error); }
          })();
          view.root.add(scene); scene.updateMatrixWorld(true);
          // SF63 / G232: its level's light model and fog on its own materials only
          const scoped = levelLook !== null && sky instanceof SkyRig ? sky.scopeLevelLook(view.root, level, levelLook, resident, { isShared: (material) => app.assets.isAcquired(material) }) : null;
          if (scoped !== null) {
            const lookCensus = (): void => { if (scoped.sweep() > 0) console.info(`[region look] ${cell.instance}: ${scoped.patched()} materials on ${level.id}'s light and fog`); };
            lookCensus();
            app.addSystem({ id: `grid.look.${cell.instance}`, phase: 'late', run: lookCensus }, resident);
            regionLook = scoped;
          }
          if (forest.trees.length > 0 && forest.drawer === 'self') withOwner(view.scope, () => view.registry.add({ id: `forest:${cell.instance}`, name: 'Forest', category: 'nature',
            file: 'src/client/engine/world/forest/Forest.ts', surface: 'wood', colliders: forest.colliderDescs() }));
          // Native hosts still read game.level for their saved placement. The
          // page keeps its home Game; this resident borrows its own level.
          const regionalGame = new Proxy(home.game, { get(target, key, receiver) {
            if (key === 'level') return level;
            const value: unknown = Reflect.get(target, key, receiver); return value;
          } });
          world = { ...home, game: regionalGame, terrain, forest, physics: host.physics, registry: view.registry, chunk: request.manifest };
          return world;
        },
        prepare: entry => {
          if (resident.disposed || entry.disposed) throw new Error('Regional construction requires a live resident and owner');
          frame.enter(app, entry);
          const leaveScene = game.bindScene(scene, entry);
          entry.onDispose(leaveScene);
        },
        enter: entry => {
          if (resident.disposed || entry.disposed) throw new Error('Regional world requires a live resident and entry');
          light?.(entry); // first, so the page's light goes back last, after everything the entry installed has left
          frame.enter(app, entry);
          const leaveScene = game.bindScene(scene, entry); bound++;
          entry.onDispose(() => { leaveScene(); bound--; });
          app.addSystem({ id: `grid.runtime.${cell.instance}.forest`, phase: 'update', run: (dt) => { forest.update(dt, home.player.position); } }, entry);
          if (presented !== null) app.addSystem({ id: `grid.runtime.${cell.instance}.presentation`, phase: 'update', run: (dt) => { presented.tick(dt); presented.follow(home.player.position.x, home.player.position.z); } }, entry);
          // its look's per-frame parts (its sky dressing's update, its frame hook) while entered: they write its own uniforms only
          const scopedLook = regionLook;
          if (scopedLook !== null) app.addSystem({ id: `grid.look.${cell.instance}.frame`, phase: 'update', run: (dt, t) => { scopedLook.frame(dt, t); } }, entry);
          // a look whose light and fog change nothing on this page has no scoped look, yet its frame hook (its cullers,
          // its per-frame uniforms) is its own: it runs while entered, after the late hooks, as Game runs it before the draw
          // (look25, SF63 / G158: with its own composite, behind the same default-off Debug row)
          else if (levelLook?.frame !== undefined && cellComposite !== null) {
            const own = levelLook;
            app.addSystem({ id: `grid.look.${cell.instance}.frame`, phase: 'late', run: (dt, t) => { own.frame?.(dt, t); } }, entry);
          }
        },
        afterKit: async () => {
          if (resident.disposed) throw new Error('Regional world left before its creatures');
          const animals = frame.run(app, () => new RowBodies(new AnimalHerdView(scene, sky, { physics: host.physics }), app, host.physics));
          await animals.build(ports.pause, frame);
          if (left()) throw new Error('Regional world left while building creatures');
          return { animals, wearSkin: (equipment: EquipmentService, skin: SkinDef): void => {
            const model = equipment.get(skin.weapon).model;
            if (model instanceof Group) applySkin(model, skin, sky);
          } };
        },
        checkpoint: () => !resident.disposed && ports.checkpoint(host, request),
        // The world-only inventory can link while kit/play continue, with the exact destination sky and look.
        prepareWorldMaterials: async () => {
          await skyReady;
          if (!resident.disposed) regionLook?.sweep();
        },
        precompileEnvironment: () => scene.environment,
        // rt3-crossing2: the look's per-frame sweep never ran on what the entered hooks added (no frame draws while they
        // install), so the warm-up compiled the page-look programs and the first frame after it the region-look ones
        beforeWarm: async () => {
          await skyReady;
          if (resident.disposed) return;
          regionLook?.sweep();
          // op-frame21: its own composite, once its world hook has run and before the warm-up compiles the page's passes
          const place = framePort?.composite;
          if (cellComposite !== null && place !== undefined && viewRoot !== null && !composited) {
            composited = true;
            try { resident.onDispose(place(cell.instance, cellComposite.build({ root: viewRoot, camera: game.camera, renderer: game.renderer, tier: TIER, scope: resident }), cellComposite.replaces)); }
            catch (error) { console.warn(`[region composite] ${cell.instance}`, error); }
          }
        },
      };
      pauses?.finish(); pauses = undefined; // the foundation's own checkpoints; its hooks' later ones are not timed
      census.set(foundation, () => {
        const native = resident.disposed ? { bodies: 0, colliders: 0 } : { bodies: host.physics.world.bodies.len(), colliders: host.physics.world.colliders.len() };
        return { ...native, sceneBound: bound > 0, parented: scene.parent !== null, disposed: resident.disposed };
      });
      return foundation;
    } catch (error) {
      // No async material allocation may arrive after the owner's teardown.
      // Earlier ground/native failures keep their original precedence.
      await presentationReady;
      if (rendering !== undefined) await rendering;
      resident.dispose();
      throw error;
    } finally { leaveTextures(); }
  };
}

/** What a shardfile cell's own sky is built from (`hangCellDataSky`). */
export interface CellDataSkyRequest {
  readonly instance: string;
  readonly slug: string;
  /** the admitted source's look section and its assets (its LUT, when it declares one) */
  readonly look: Parameters<typeof shardfileLook>[0];
  readonly assets: ReadonlyMap<string, Uint8Array>;
  /** the page's staged services (its sky rig, its game); null before they exist: no sky */
  readonly page: RegionalRuntimePage | null;
  readonly allocator: Pick<RegionalRuntimeRequest['allocator'], 'reserve' | 'entries'>;
  /** the region's resident scope: the sky leaves with it */
  readonly scope: Scope;
}

/**
 * The own sky of a grid cell whose shard is a shardfile with no runtime (SHARD-PLATFORM G321, Jake 2026-10-10: *"when you
 * enter a shard, you enter it with its sky"*): its look is data (`dataLook`: a gradient dome, the key light, the ambient and
 * the fog turned by its day keys on its own clock), so its cell lays that backdrop on the page's one sky as a layer, as a
 * runtime cell above lays its level's backdrop: weighted by the cell's owner weight (1 inside, blended across the 16 m edge
 * band, 0 on the road, where nothing of it runs or draws), charged on its `sim-sky:` claim (the data dome holds no texture)
 * and freed with the region's resident scope. Its air and grade stay what its far proxy declared to the frame: the layer's
 * clock writes its fog into a private fog object. 'off' when it has none (an empty look, no page sky yet).
 */
export function hangCellDataSky(request: CellDataSkyRequest): Promise<RegionSkyOutcome> {
  const { page, scope } = request, manifest = findShard(request.slug);
  if (page === null || manifest === undefined || request.look.keys.length === 0) return Promise.resolve('off');
  const sky = page.world.sky, game = page.world.game;
  if (!(sky instanceof SkyRig)) return Promise.resolve('off');
  const level = toLevelSpec(manifest), look = shardfileLook(request.look, request.assets), make = look.backdrop;
  if (make === undefined) return Promise.resolve('off');
  scope.onDispose(() => { look.dispose?.(); });
  const air = new Fog(0xffffff, 1, 2);
  return buildRegionSky<LayerAttachable>({ instance: request.instance, look: frameLookOf(game.rootScene), allocator: request.allocator, scope, layered: async () => {
    const layered = await sky.layeredBackdrop(make, { level, scope, air: () => air, planet: look.sky?.planet !== false, clouds: look.sky?.clouds !== false, sun: look.sky?.sun });
    if (layered === null) return null;
    return { ...layered, prepare: () => game.warmSkyLayer(layered.layer) };
  } });
}

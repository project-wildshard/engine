import { prelinkGridViews } from './prelinkViews';
import { cellPresence } from './cellPresence';
import type { RoadTileBacking } from './roadTileBacking';
import { roadTileWriter } from './roadTileWriter';
import { bootWaits, waitFor, type BootWait } from '@wildshard/engine/boot/waits';
/**
 * The grid session (SHARD-PLATFORM SF17b / SF18a / SF18b / SF21a, the grid client): what turns EXPERIMENTAL Wildshard's
 * home-cell boot into a 5 × 5 grid inside the one page. The home cell boots through the normal shard flow (its own
 * player, camera, HUD and the page's one fixed step); this session adds, around it, in the home cell's frame:
 *
 * - **the highway deck and strips**: `generatePlatform` (the pure SF17b generator) over the assembly, drawn as one mesh
 *   and installed as platform-owned trimesh colliders in the home world (the same vertices; `installStripCollider`).
 *   Every cell's edge rows come from its shard's own data (`edgeSources.ts` through `loadGridEdgeProfiles`, loaded once in
 *   `create`); the seams wear their materials by feature range (`seamLook.ts`).
 * - **render origin per cell** (C39): the home cell is the render origin; every other cell's root sits at its origin
 *   minus the home origin, and the rings get world positions (local + home origin).
 * - **neighbours as their declared fallback** (§3.3): no neighbour is a resident shardfile sim in the page yet, so each
 *   shows its baked far proxy (SF23) through the render rings (SF18b) and one residency allocator; its edge holds as a
 *   soft wall at the 6 m re-frame line (SF18d `ReadinessWalls`, closed while its sim is not ready). Step 2
 *   (`attach`, `liveSession.ts`) admits shardfile neighbours (the template copies) into regional hosts, opens their walls
 *   when ready and crosses the one page traveller at the fixed boundary; the rest stay closed until M3.
 *   The grid's outer rim is the outer road's shoulder: a glowing rail and closed walls, the VR void past it (G77 / G89).
 * - **cell events**: `gridCells.enter` while the player's feet are in the home cell's interior, `leave` on the deck
 *   (SF46's hybrid runtime runs only inside its cell).
 * - **legacy bounds yield** (SF17a): the session asks the level to leave out its chunk-edge walls and hide the edge
 *   veil (`gridLevel`), the bounds' horizontal check reads `grid`; fall recovery stays.
 */
import { LightPool } from '@wildshard/engine/fx/LightPool';
import { platformInputs } from '../../../shared/game/grid/platformInputs';
import { gridLevel as levelForGrid } from '../../../shared/game/grid/pageMode';
import { cellClip } from './cellClip';
import { BufferGeometry, Group, Mesh, Scene, Vector3, type Material, type Object3D } from 'three';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import * as v from 'valibot';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { onPageEnvironment } from '@wildshard/engine/render/drawnEnvironment';
import { versionedUrl } from '@wildshard/engine/boot/bytes';
import { browserLiveJsonParser } from '@wildshard/engine/boot/liveJsonParser';
import { publicBytes } from '@wildshard/engine/boot/tables';
import type { LevelSpec } from '@wildshard/engine/level/spec';
import type { Scope } from '@wildshard/engine/app/scope';
import type { StepProgress } from '@wildshard/engine/boot/plan';
import { WORK_SLICE_MS, workSlice } from '@wildshard/engine/core/workSlice';
import { app } from '@wildshard/engine/app/runtime';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { installStripCollider } from '@wildshard/engine/physics/stripColliders';
import { ReadinessWalls, type ReadinessEdge } from '@wildshard/engine/physics/readinessWalls';
import { WATER_UNBOUNDED, waterExtent } from '@wildshard/engine/world/waves';
import type { Renderer } from '@wildshard/engine/render/renderer';
import { generatePlatform, generatePlatformSliced, type GeneratedStrip, type PlatformCell, type StripProfile } from '@wildshard/engine/sim/strips';
import { GridAssembly, type GridCell } from '../../../shared/game/grid/assembly';
import { neighbourEdges } from '../../../shared/game/grid/readinessEdges';
import { DEVSERVER, gridMode } from './menu';
import { gridCells, pageGridInstance } from '../plugin/context';
import { prepareHomeMetadata, withInitialHomeMetadata } from './homeMetadata';
import { bootSteppedTiles, stepRingsUntil } from './loadingRings';
import { holdSpawnGround, spawnGroundCell, type SpawnGround } from './spawnGround';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { PageResidency } from './pageResidency';
import { PlatformRenderResidency } from './renderResidency';
import { TileStreamer, levelPorts, type FarPlan, type LevelPrepared, type RingPorts, type RingTile, type RingWait } from '@wildshard/engine/world/tileStreamer';
import { GhostWorlds, type GhostRegion } from '../../../shared/game/grid/ghosts';
import { farRingPorts, type FarPreparationWait, type FarPrepared, type FarProxyView } from './farView';
import { decodeFarImpostor, farBandShare } from './farImpostorView';
import { FarImpostorSchema, type FarImpostor } from '@wildshard/format/shardSections';
import { bindCellCover, cellCoverPort } from './cellCover';
import { FAR_RING, type FarLookRuntime } from '../../../shared/game/grid/farProxy';
import { bakedNearFiles, NearPlaceholders, type NearPlaceholderState } from './nearPlaceholderView';
import { PHONE_NEAR_CELLS, admitsCellTiles, placeholderBlocksTiles } from './nearPlaceholderPlan';
import { TIER } from '@wildshard/engine/core/tier';
import { GridFrame, type GridFrameHost, type GridFrameState } from './frame';
import { installHazeBand } from './hazeBand';
import { LiveGridSession, type LiveGridPage, type LiveGridSessionState } from './liveSession';
import { gridShardfileEdges, gridShardfileFarBytes, gridShardfileProduct, readGridShardfileFar, readGridShardfileNear } from './products';
import { ApproachInputsDeferredError } from './productInputs';
import { GridViewAdmissions } from './viewAdmissions';
import { loadShardfileFar, loadShardfileNear } from './shardfileFar';
import { jsonResidentBytes } from '../shardfile/productCost';
import { withOwner } from '@wildshard/engine/app/ownership';
import { roadLayout } from '../../../shared/game/grid/roadLayout';
import { installVoidFloor, rimWalls } from '../../../shared/game/grid/voidFloor';
import type { RoadLookState } from './roadLook';
import { combinePlatformRoads, installPlatformRoad, installPlatformRoadSliced, type PlatformRoad } from './roadLookPlatform';
import { collisionStrips, type CollisionStrip } from '../../../shared/game/grid/collisionStrips';
import { installSoftWallLook, type SoftWallState } from './softWallLook';
import type { SeamLookState } from '../../../shared/game/grid/seamGeometry';
import { roadResident, roadViewCost, type CullPlan, type RoadResident, type RoadViewCost } from './roadCull';
import { loadGridEdgeProfiles } from '../../../shared/game/grid/edgeProfiles';
import { readGridEdges } from './edgeSources';
import { findShard } from '../shard/registry';
import { TileDecoder } from './tileDecoder';
import { clientTileRegistration, type ClientTileRegistration, clientRingCatalogue, clientRingPorts, type ClientRingInstance, type PreparedRingTile } from '../shardfile/tileContent';
import type { ClientAssets } from '../shardfile/clientAssets';
import { admittedGraphAuthority, clientMaterials } from '../shardfile/clientMaterials';
import { clientTileViews, type ClientTileViews } from '../shardfile/clientViews';
import type { ClientSkin } from '../shardfile/clientSkins';
import { setParkedMatricesFrozen, setWarmUpHeld } from '@wildshard/engine/render/precompile';
import { setBuildHeldTimed } from '@wildshard/engine/core/heldTiming';
import { NeighbourLife, type NeighbourLifeCell } from './neighbourLife';
import { NeighbourPanels } from './neighbourPanels';
import { copyMarks } from './copyIdentity';
import { CellMinimaps } from './minimapBlend';
import { leaseMapImage } from '../shardfile/mapImage';
import { crossingSaveStatus, installBorderShimmer, type BorderShimmerState, type CrossingSaveStatus } from './borderShimmer';
import { refusalReporter, saveFailedReporter } from './screenReports';
import { GAME_STRINGS } from '../../../shared/game/strings';
import { GridCellWaitingError, classifyRefusal, pageShardRefusals, refusalReason, type ShardRefusal } from './refusal';
import { tileRing } from '../shardfile/tileDriver';
import { CellLoading, type CellLoadingInput } from './cellLoading';
import { CellLoadingCard } from './cellScreens';
import { readGridSeamData, type GridSeamAddress } from '../../../shared/game/grid/seamData';
import { readCompiledGridStrips } from '../../../shared/game/grid/compiledStrips';
import { startRoadGrain } from './roadGrainPreparation';
import { startRoadSigns } from './roadSignPreparation';
import { RoadMapShare } from './roadResources';
import { clientPreparationBatch } from '../shardfile/preparationTiming';

import { admittedRuntimeProduct } from '../shardfile/runtimeProduct';
import { gridArea } from './area';
import type { ProbeArea } from '@wildshard/engine/debug/probe';

/** D12: the A1 outer ring's share of a drawn frame (ms). On the phone tier its strips, colliders and road stop 4 ms after
 *  the last drawn frame (every other build keeps WORK_SLICE_MS): streamed at the shared 8 ms it held the grid's spawn
 *  window at a p95 of 45 ms on the iOS Simulator, which passes once the ring has landed. */
const OUTER_RING_SLICE_MS = TIER === 'phone' ? 4 : WORK_SLICE_MS;
/** a stretch between its slice checks, so a stretch that starts late in the share cannot run far past it */
const OUTER_RING_STRETCH_MS = TIER === 'phone' ? 2 : 4;

/** The page lights kept for the grid's region lights (LightPool.reserve): the most one region shows at once, Pine Hollow's
 *  five cabin lights. A point light costs every lit fragment a loop step, so this is the grid's real maximum, not more;
 *  a region that shows more warns once and leaves the rest dark. */
export const GRID_REGION_POINT_LIGHTS = 5;
/** free page lights for home content that lights itself after the first render (the population projection's) */
export const GRID_HOME_SPARE_POINT_LIGHTS = 1;
const isScene = (node: Object3D): node is Scene => node instanceof Scene;

declare const __GRID_SEAM_ASSET__: GridSeamAddress;

declare const __BUILD_ID__: string; // vite.config.ts define; absent under Node

/**
 * In grid mode the level's own chunk-edge walls and veil yield to the platform, and so does its own horizon (G99: every
 * shard is a 500 m cube; a level's horizon rings and cloud sea stand past it, over the road and the neighbours, whose
 * far views are the grid's horizon now). The engine has no default horizon (G552); a level's painted strips at
 * infinity stay. The standalone path is unchanged.
 */
export function gridLevel(spec: LevelSpec): LevelSpec {
  return levelForGrid(spec);
}

/** What the session reads from the page: the player's feet in the home frame, the scene, the world, the fixed step. */
export interface GridSessionHost {
  /** The owner's allocator already includes the home before this late play-stage session constructs the platform. */
  readonly residency?: PageResidency;
  readonly scene: Object3D;
  readonly physics: Physics;
  readonly scope: Scope;
  readonly feet: () => { readonly x: number; readonly y: number; readonly z: number };
  /** Home/far coverage can load before controls; neighbour products and near views start after this boundary. */
  readonly backgroundReady?: () => boolean;
  /** Presentation-only short range while an actual crossing waits at its
   * in-world screen. Disabled in the same frame the crossing settles. */
  readonly heldFrame?: { enabled: boolean };
  /** Register once per fixed step (the page's one fixed step; never a second loop). */
  readonly onFixed: (fn: (dt: number) => void) => void;
  /** SF19a's one frame: the camera, composer and grade effects, and the page's late phase (absent: never built) */
  readonly frame?: GridFrameHost & { readonly onLate: (fn: (dt: number) => void) => void };
  /** the page's renderer: shardfile neighbours' ring tiles compile their materials on it (absent: neighbours stay far proxies) */
  readonly renderer?: Renderer;
  /** Prepare a streamed view while hidden; its current fence cancels work before retirement. */
  readonly prepareView?: (root: Object3D, current: () => boolean) => Promise<void>;
  /** D12: keep a prepared far / near view's programs for the page, so a view that retires and returns links nothing again. */
  readonly keepViewPrograms?: (view: Object3D) => void;
  /** Refresh stable page-owned views as one complete material/object inventory. */
  readonly prepareViews?: (roots: readonly Object3D[], current: () => boolean) => Promise<void>;
  /** Prepare every attached sky layer's domes under the page's lights now (`Game.warmSkyLayers`). */
  readonly prepareSkyLayers?: () => Promise<void>;
  /** Prepare an admitted, detached ring tile before its budgeted visible upload. */
  readonly prepareTile?: (tile: PreparedRingTile) => Promise<void>;
  /** G371: the drawn camera's horizontal offset from the feet, in the feet's frame (absent: the eye at the feet). The near
   *  tier plans from the eye, so a lifted or free camera gets the cells it is over; a play camera is a few metres off */
  readonly eye?: () => { readonly x: number; readonly z: number };
}
/**
 * What each cell draws now, for the readout and the captures: `playing` (the entered runtime), `frozen` (the home's
 * runtime, not stepping, when no placeholder layer draws it), `near` (its near placeholder, its far proxy hidden), `far proxy`, `tiles` (only its L1 / L0
 * ring tiles: the far proxy wholly refined away), `loading` (nothing yet).
 */
export type GridCellShows = 'playing' | 'frozen' | 'near' | 'far proxy' | 'tiles' | 'loading';
/** Which of a cell's presentation layers draw now (meshes visible), for the readout and the captures. */
export interface GridCellDrawn { readonly far: boolean; readonly near: boolean; readonly l1: number; readonly l0: number }
/** The session's readout (tests, harness, the board). */
export interface GridSessionState {
  /** Actual world-space placement pitch; diagnostic routes must use the served build's lattice. */
  readonly pitch: number;
  readonly home: string; readonly inside: string | null; readonly feet: { x: number; z: number };
  readonly cells: readonly { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number]; readonly shows: GridCellShows; readonly drawn: GridCellDrawn }[];
  readonly strips: number; readonly ringsReady: boolean;
  /** what `ringsReady` still waits on: the visible cells not yet drawn, and the far ring's plan (budget, charges, left out) */
  readonly ringsWait: { readonly cells: readonly RingWait[]; readonly far: FarPlan; readonly preparation: readonly FarPreparationWait[]; readonly waits: { readonly count: number; readonly oldest: readonly Pick<BootWait, 'label' | 'kind' | 'ageMs'>[] } };
  /** SF17b's boulevard look: segments, junctions, roundabouts, signs, lights and draws */
  readonly road: RoadLookState;
  /** the seams' materials: triangles and draws per material (phase 2, G90 / G91 / G101) */
  readonly seams: SeamLookState;
  /** G85's soft walls: how many edges are closed */
  readonly softWalls: SoftWallState;
  /** G78's border shimmer and G119's save panel (status null: no panel up) */
  readonly shimmer: BorderShimmerState;
  /** G555: the cell whose step-by-step loading screen is open (its entry or re-entry waits), or null */
  readonly cellLoading: string | null;
  /** NET-LAG NL7: the loading card's running row, by label (null: no card). */
  readonly cellStage: string | null;
  /** GC8: the `cell` path step that screen shows now and its detail, so a harness times each step. */
  readonly cellStep: { readonly step: string; readonly detail: string } | null;
  /** the allocator's grid content (MB) and the §3.2 playing total with the engine base (MB, the 1.0 GB envelope, G65) */
  readonly residentMB: number; readonly playingMB: number;
  /** Exact category sum before engine base, overlap allowance or calibration factor; used by the soak harness. */
  readonly accountedBytes: number;
  readonly rings: { readonly frame?: number; readonly far: number; readonly l1: number; readonly l0: number; readonly refused: number; readonly inFlight: number; readonly queued: number;
    readonly ghosts: { readonly count: number; readonly tiles: readonly GhostRegion[] } };
  /** SF19a's one frame (null for a host with no frame: no camera / composer) */
  readonly frame: GridFrameState | null;
  /** step 2's live crossing (null until the page attaches its player) */
  readonly live: LiveGridSessionState | null;
  /** SF25 / G66: each shardfile neighbour's client-script life (frozen cells breathe and graze) */
  readonly life: readonly NeighbourLifeCell[];
  /** G342 / G385: the near-placeholder tier's cells and resident bytes */
  readonly near: NearPlaceholderState;
}

/** The shardfile neighbours' L1 / L0 tiles (sources load late: until then the catalogue has no tile and the far proxy draws). */
function neighbourTiles(scope: Scope, prepare: (tile: PreparedRingTile) => Promise<void>, retired: (tile: RingTile, roots: readonly object[]) => void,
  frame: ((step: () => void) => void) | undefined): { instances: Map<string, ClientRingInstance>; ports: RingPorts<PreparedRingTile> } {
  const instances = new Map<string, ClientRingInstance>(), decoder = new TileDecoder();
  scope.onDispose(() => { decoder.dispose(); });
  // DL17 (G872): the neighbours decode and parse in play; their workers start in loading and stay, so no worker script is
  // fetched after control (the live parser's page owner keeps it to the page's end)
  decoder.hold(); browserLiveJsonParser().hold();
  return { instances, ports: clientRingPorts(instances, { scope, decoder, prepare, retired, ...(frame === undefined ? {} : { frame }) }) };
}

/** The far proxy and its row, fetched from the shard's baked folder (`public/assets/baked/<slug>/far.*`). */
async function loadFar(slug: string): Promise<{ prepared: FarPrepared; bytes: number }> {
  // Pure authored projects have no repo bake: their proxy comes from their product's sections and far files (O26: read
  // hash-verified on their own, not after admitting the whole product), instead of a nonexistent far.json
  const shardfile = await readGridShardfileFar(slug);
  if (shardfile !== null) return loadShardfileFar(shardfile.rows, shardfile.read);
  const response = await fetch(versionedUrl(`/assets/baked/${slug}/far.json`));
  if (!response.ok) throw new Error(`far.json ${slug}: ${String(response.status)}`);
  const row: unknown = await response.json();
  const look = farLook(row), bytes = farBytes(row), impostorRow = farImpostorRow(row);
  // G539: its camera-facing impostor beside it (a far row baked before G539 has none: the proxy draws at every distance)
  const impostor = impostorRow === undefined ? null : await (async () => {
    const image = await fetch(versionedUrl(`/assets/baked/${slug}/far-impostor.png`));
    if (!image.ok) throw new Error(`far-impostor.png ${slug}: ${String(image.status)}`);
    return decodeFarImpostor(impostorRow, new Uint8Array(await image.arrayBuffer()));
  })();
  const gltf = await (await prepareRigLoader()).createRigLoader().loadAsync(versionedUrl(`/assets/baked/${slug}/far.glb`));
  const meshes: BufferGeometry[] = [];
  gltf.scene.traverse((node) => { if (!(node instanceof Mesh)) return; const found: unknown = node.geometry; if (found instanceof BufferGeometry) meshes.push(found as BufferGeometry); });
  const geometry = meshes[0];
  if (geometry === undefined) throw new Error(`far.glb ${slug}: no mesh`);
  return { prepared: { geometry, look, impostor }, bytes };
}
const num = v.pipe(v.number(), v.finite());
/** The part of `far.json` the client reads: the resident cost and the look (the bake writes more). */
const FarRow = v.object({ far: v.object({ gpu: num, decoded: num, impostor: v.optional(FarImpostorSchema) }),
  look: v.object({ family: v.picklist(['toon', 'painterly', 'pbr']), haze: v.object({ colour: v.tuple([num, num, num]) }),
    grade: v.optional(v.object({ exposure: num, saturation: num, contrast: num, tint: v.optional(v.tuple([num, num, num])) })),
    band: v.optional(v.object({ colour: v.tuple([num, num, num]), height: num, opacity: num, own: num })) }) });
/** The part of `near.json` the client reads. */
const NearRow = v.object({ near: v.object({ gpu: num, decoded: num, content: v.optional(num), tiles: v.optional(v.literal(true)) }), look: FarRow.entries.look });
/**
 * G342 / G348: a shard's near placeholder. Its shardfile's own `near` row first (`wildshard build` bakes one for any terrain
 * shardfile, so an unknown uploaded shard draws its own), read from its sections and near files without admitting the
 * product (G608, as O26's far proxy); else its baked folder like the far proxy
 * (`scripts/bake/near-placeholder.mjs`, the first-party shards until their shardfiles carry the row). A baked view whose
 * world carries the shard's own props owns its cell; one built from the shard's own coarse tiles (`near.tiles`) never does,
 * as a shardfile's own near row never does: those tiles keep refining over it.
 */
async function loadNear(slug: string): Promise<{ prepared: FarPrepared; bytes: number; owns: boolean }> {
  const own = await readGridShardfileNear(slug);
  if (own !== null) return loadShardfileNear(own.rows, own.read);
  const baked = bakedNearFiles(slug, publicBytes());
  if (baked === null) throw new Error('No declared near placeholder; retain far proxy');
  const response = await fetch(versionedUrl(baked.row));
  if (!response.ok) throw new Error(`near.json ${slug}: ${String(response.status)}`);
  const row = v.parse(NearRow, await response.json());
  const gltf = await (await prepareRigLoader()).createRigLoader().loadAsync(versionedUrl(baked.mesh));
  let geometry: BufferGeometry | undefined;
  gltf.scene.traverse((node) => { if (geometry === undefined && node instanceof Mesh) { const found: unknown = node.geometry; if (found instanceof BufferGeometry) geometry = found as BufferGeometry; } });
  if (geometry === undefined) throw new Error(`near.glb ${slug}: no mesh`);
  return { prepared: { geometry, look: row.look }, bytes: Math.round(row.near.gpu + row.near.decoded), owns: (row.near.content ?? 0) > 0 && row.near.tiles !== true };
}
function farLook(row: unknown): FarLookRuntime { return v.parse(FarRow, row).look; }
function farImpostorRow(row: unknown): FarImpostor | undefined { return v.parse(FarRow, row).far.impostor; }
function farBytes(row: unknown): number { const { far } = v.parse(FarRow, row); return Math.round(far.gpu + far.decoded); }

/** The closed outer rim on the 7 × 7's outer road shoulder (SA34): the void's rail (G89; the empty neighbour has no sim to wait for). */
function rimEdges(assembly: GridAssembly, home: Readonly<{ origin: Readonly<{ x: number; z: number }> }>): ReadinessEdge[] {
  return rimWalls(assembly.pitch).map(wall => ({ instance: null, x: wall.x - home.origin.x, z: wall.z - home.origin.z, axis: wall.axis, halfLength: wall.halfLength, floor: 0 }));
}

type ConstructorPhase = 'fields' | 'lights' | 'home' | 'frame' | 'road' | 'presentation' | 'physics' | 'roots' | 'streaming';
/** Report wall intervals only; diagnostic failures cannot change construction. */
function constructorPreparation(): ((phase: ConstructorPhase) => void) | undefined {
  try {
    const timing = clientPreparationBatch<ConstructorPhase>('grid', 'session.constructor',
      ['fields', 'lights', 'home', 'frame', 'road', 'presentation', 'physics', 'roots', 'streaming']);
    if (timing === undefined) return undefined;
    return phase => {
      try { timing.mark(phase); if (phase === 'streaming') timing.finish(); }
      catch { /* Timing is never a construction or readiness barrier. */ }
    };
  } catch { return undefined; }
}

/** The live grid session. Installed only in grid page mode; disposed with the level scope. */
export class GridSession {
  readonly assembly: GridAssembly;
  readonly home: GridCell;
  readonly allocator: ResidencyAllocator;
  private readonly rings: TileStreamer<LevelPrepared<FarPrepared, PreparedRingTile>>;
  // Start before the original initialized fields, not only the constructor body.
  private readonly constructorTiming = constructorPreparation();
  private readonly tileGhosts = new GhostWorlds();
  private readonly neighbours: readonly GridCell[];
  private readonly clientTiles: ClientTileRegistration;
  private refreshCellCover: () => void = () => undefined;
  private readonly costs = new Map<string, number>();
  /** each neighbour cell's view root (its far proxy and ring tiles hang here) */
  private readonly viewRoots = new Map<string, Group>();
  /** each shardfile neighbour's declared far bytes, read at start: its far ring charge until the proxy loads (then `costs`) */
  private readonly declaredFar = new Map<string, number>();
  /** G107 / SF66: each shard's baked map, downscaled once and shared by all its copies. */
  private readonly mapImages: CellMinimaps;
  private readonly strips: CollisionStrip[];
  private readonly initialStripBytes: number;
  private outerStripBuild: ((scope: Scope) => Promise<readonly GeneratedStrip[]>) | undefined;
  private publishOuterStrips: ((strips: readonly GeneratedStrip[]) => void) | undefined;
  private outerStripsReady: Promise<void> | undefined;
  private readonly host: GridSessionHost;
  private initialHomeMetadata: Promise<void> | null = null;
  private last: { x: number; z: number } | null = null;
  private velocity = { x: 0, z: 0 };
  private readonly frame: GridFrame | null;
  private readonly walls: ReadinessWalls;
  private live: LiveGridSession | null = null;
  /** the road system's readouts: empty until its install (`create` runs it beside the next loading steps) lands */
  private road: RoadLookState = { segments: 0, junctions: 0, roundabouts: 0, signs: 0, lights: 0, draws: 0 };
  private seams: SeamLookState = { triangles: 0, draws: 0, buckets: {} };
  private roadRoots: readonly Object3D[] = [];
  /** whether the road install has landed (or failed: the reveal never waits on a road that cannot come) */
  private roadSettled = false;
  private roadLanding: Promise<void> = Promise.resolve();
  /** loading-speed A1: builds the outer ring's road once (null: none to build, or started) */
  private startOuterRoad: (() => void) | null = null;
  private startOuterFar: (() => void) | null = null;
  /** Initial visible fallbacks precede optional near/model decoding. Once ready,
   * ordinary distance streaming and explicit crossings keep their own fences. */
  private initialFarReady = false;
  private readonly roadPlans: Map<Mesh, CullPlan>;
  private roadTiles: RoadTileBacking | null = null;
  private readonly roadBudget: { readonly view: () => RoadViewCost | null; readonly resident: () => RoadResident };
  private readonly life: NeighbourLife;
  /** Late frames the page loop has run; `stepRingsUntil` steps the rings only while it has not. */
  private lateFrames = 0;
  private readonly admitNeighbour: ((cell: GridCell, required?: boolean) => Promise<void>) | undefined;
  private readonly admitNeighbourRender: ((cell: GridCell) => Promise<boolean>) | undefined;
  /** G222 playtest #7: each neighbour's declared doors and gates, shown exactly when its region has them standing */
  private readonly panels: NeighbourPanels;
  private readonly softWalls: { readonly step: () => void; readonly state: () => SoftWallState };
  /** G342 / G385: the near-placeholder tier, shipped for everyone: the four nearest cells draw their near view */
  private readonly near: NearPlaceholders;
  private readonly shimmer: { readonly step: () => void; readonly state: () => BorderShimmerState };
  /** G167: why a neighbour's shard can't load (its product refused, with the admission's message) and its far view's status */
  private readonly refusals = new Map<string, ShardRefusal>();
  /** SENTRY-TRIAGE S18: UNAVAILABLE reports once per cell a session (screenReports.ts) */
  private readonly reportRefusal = refusalReporter();
  private readonly issues = new Map<string, string>();
  private readonly farViews = new Set<string>();
  private readonly farPreparation: () => readonly FarPreparationWait[];
  /** each uploaded far view, for the readout's `drawn.far` (its mesh's own visibility) */
  private readonly farMeshes = new Map<string, FarProxyView>();
  private readonly farMissing = new Set<string>();
  /** each slug's shown name */
  private readonly names = new Map<string, string>();
  /** G555: the one step-by-step loading screen over a cell entry or re-entry that waits */
  private readonly cellLoading: CellLoading;
  private cellLoadingPolled = 0;
  /** when each cell's current wait began, so its screen counts only the hooks of this load */
  private readonly loadingSince = new Map<string, number>();

  /** Overlap only this page's actual initial-home metadata with remaining page setup. */
  startInitialHomeMetadata(): void {
    if (this.initialHomeMetadata !== null) return;
    this.initialHomeMetadata = prepareHomeMetadata(this.host.scope, () =>
      gridShardfileProduct(this.home.slug, { allocator: this.allocator, scope: this.host.scope }, 'metadata'));
  }
  /** Preserve the original Home failure barrier; construction is never started here. */
  waitInitialHomeMetadata(): Promise<void> { return this.initialHomeMetadata ?? Promise.resolve(); }

  /** Load every cell's edge rows (`loadGridEdgeProfiles` over the shards' own data, baked by the build: a grid entry read
   *  20 products' index and edge section through the serial content cache, 3.5 s on Jake's phone), then build the session. */
  static async create(host: GridSessionHost, progress?: StepProgress, initialHomeMetadata = false): Promise<GridSession> {
    if (host.residency === undefined) throw new Error('Grid session requires the early page residency owner');
    const timing = clientPreparationBatch('grid', 'assembly', ['setup', 'seam-source', 'edge-admission', 'compiled-page', 'worker-wait', 'road-start', 'collider-join', 'session', 'final-yield']);
    const allocator = host.residency.allocator;
    const assembly = new GridAssembly(gridMode(DEVSERVER)), empty = assembly.emptyNeighbour.edge;
    const instance = pageGridInstance();
    if (instance === null) throw new Error('A grid session needs a grid page');
    const home = assembly.cell(instance);
    const create = async (metadata?: Promise<void>): Promise<GridSession> => {
    const reach = 1.5 * assembly.pitch + 1;
    const ring = (x: number, z: number): boolean => Math.abs(x - home.origin.x) <= reach && Math.abs(z - home.origin.z) <= reach;
    const layout = roadLayout(assembly, slug => findShard(slug)?.name ?? slug);
    const grain = startRoadGrain(host.scope, allocator, instance);
    let signs: ReturnType<typeof startRoadSigns>;
    try {
    signs = startRoadSigns(host.scope, allocator, instance, layout.signs.filter(sign => ring(sign.at.x, sign.at.z)));
    timing?.mark('setup');
    let prepared = 0;
    progress?.set(0, 3, 'Grid seam data · 0 / 1 files');
    const address = __GRID_SEAM_ASSET__, abort = new AbortController();

    const forget = host.scope.capture('disposers', () => { abort.abort(); });
    const data = await readGridSeamData(address, url => fetch(url, { signal: abort.signal })).finally(forget);
    timing?.mark('seam-source');
    if (host.scope.disposed) throw new Error('Grid session left during seam preparation');
    const baked = new Map(data.edges), edgeCosts = data.edgeCosts;
    progress?.set(0, 3, `Cell edges · 0 / ${assembly.cells.length}`);
    const edges = await loadGridEdgeProfiles(assembly.cells, async (cell) => {
      try {
        const bakedEdge = baked.get(cell.slug), edge = bakedEdge ?? await readGridEdges(cell, { edges: slug => gridShardfileEdges(slug, { allocator, scope: host.scope }), fetch: url => fetch(url) });
        const bytes = (bakedEdge === undefined ? undefined : edgeCosts?.get(cell.slug)) ?? jsonResidentBytes(edge);
        const claim = allocator.reserve({ id: `product:grid:edge:${cell.instance}`, category: 'product', owner: cell.instance, bytes, distance: 0, needed: true });
        if (claim === null) throw new Error('Grid edge metadata residency deferred');
        host.scope.onDispose(claim.release); return edge;
      } catch (error) {
        console.warn(`[grid] ${cell.instance} edges stay at road level:`, error);
        const closed = { entryWidth: 0 };
        return { kind: 'declared', profiles: { north: empty, east: empty, south: empty, west: empty }, observations: { north: closed, east: closed, south: closed, west: closed } };
      } finally {
        prepared++; progress?.detail(`Cell edges · ${prepared} / ${assembly.cells.length}`);
      }
    });
    timing?.mark('edge-admission');
    if (host.scope.disposed) throw new Error('Grid session left during cell preparation');
    // Loading has no game frames to wait for. Share the usual 30 ms loading budget across cheap generator batches;
    // workSlice still observes the drawn-frame budget if this is called while the game is presenting.
    const construction = workSlice(30, host.scope);
    let batches = 0;
    progress?.set(1, 3, 'Terrain seams · 0 batches');
    const nativePlanReader = data.readPlans, inlinePlans = data.plans;
    let nativePlans: Promise<Map<string, readonly number[][]>> | undefined;
    const seamPlans = (): Promise<Map<string, readonly number[][]>> => {
      nativePlans ??= (async () => {
        if (nativePlanReader === undefined) return new Map(inlinePlans);

        const abortPlans = new AbortController(), forgetPlans = host.scope.capture('disposers', () => { abortPlans.abort(); });
        try {
          const rows = await nativePlanReader(url => fetch(url, { signal: abortPlans.signal }));
          if (host.scope.disposed || host.scope.disposing) throw new Error('Grid session left during native plan preparation');
          return new Map(rows);
        } finally { forgetPlans(); }
      })();
      return nativePlans;
    };
    const original = platformInputs(assembly, edges);
    const compiled = await readCompiledGridStrips(address.geometry, original, instance, { scope: host.scope, allocator },
      (url, signal) => fetch(url, { signal }), async () => {
        progress?.detail(`Terrain seams · ${++batches} verified shapes`); await construction.check();
      });
    const fallbackPlans = compiled === null ? await seamPlans() : undefined;
    let flatPlatform = false;
    const preparedOuter = compiled?.readOuter;
    const strips = [...(compiled?.strips ?? await platformStrips(assembly, edges, (platform, edge) => generatePlatformSliced(platform, edge, async () => {
      progress?.detail(`Terrain seams · ${++batches} batches`); await construction.check();
    }, 12, fallbackPlans, ring), () => {
      if (host.scope.disposed || host.scope.disposing) throw new Error('Grid admission scope disposed');
      flatPlatform = true;
    }))];
    timing?.mark('compiled-page');
    if (grain !== undefined) await waitFor('Grid road grain', grain.ready, 'worker');
    if (signs !== undefined) await waitFor('Grid road signs', signs.ready, 'worker');
    timing?.mark('worker-wait');
    if (host.scope.disposed || host.scope.disposing) throw new Error('Grid session left during seam preparation');
    const roadScope = host.scope.child('grid-road-construction');
    progress?.set(2, 3, `Road geometry · ${strips.length} initial seams`);
    const admission = new PlatformRenderResidency(allocator, roadScope), plans = new Map<Mesh, CullPlan>();
    const tileScope = roadScope.child('road-tiles');
    const tileBacking = new (await import('./roadTileBacking')).RoadTileBacking(
      tileScope, roadTileWriter(tileScope, caches, location.origin), { pitch: assembly.pitch, plans, camera: () => host.frame?.camera }, location.origin);
    // Use the same source set for both halves if initial certification selected
    // the existing flat fallback. Outer failures never substitute different edges.
    const outerStrips = async (owner: Scope): Promise<readonly GeneratedStrip[]> => {
      const source = platformInputs(assembly, flatPlatform ? undefined : edges);
      const background = workSlice(OUTER_RING_SLICE_MS, owner);
      const pause = async (): Promise<void> => {
        if (owner.disposed || owner.disposing || host.scope.disposed || host.scope.disposing) throw new Error('Grid session left during outer seam preparation');
        await background.check();
      };
      if (preparedOuter !== undefined) return preparedOuter(owner, pause);
      const compiledOuter = await readCompiledGridStrips(address.geometry, source, instance, { scope: owner, allocator },
        (url, signal) => fetch(url, { signal }), pause, 'outer');
      return compiledOuter?.strips ?? generatePlatformSliced(source.cells, source.empty, pause, OUTER_RING_STRETCH_MS, await seamPlans(), (x, z) => !ring(x, z)); // T10: built in play after controls, short stretches beside the frame
    };
    const roadInput = { strips, home, pitch: assembly.pitch, layout, scene: host.scene,
      scope: roadScope, camera: () => host.frame?.camera, plans, admission, tileBacking, maps: new RoadMapShare(),
      ...(grain === undefined ? {} : { grain: grain.get }), ...(signs === undefined ? {} : { signs: signs.get }) };
    const pause = async (): Promise<void> => { await construction.check(); };
    // Spawn heap (T10): no closure here may capture `compiled`. Every closure of this scope shares one context, and the
    // session's cleanups keep some of them, so a captured read kept its decoded strips and seam look (~14 MB at the
    // Driftwood spawn, 10 MB of it look normals) for the page's life. The inner road gets the look and lets it go.
    let seamChannels = compiled?.look;
    const road = (async () => {
      try { return await installPlatformRoadSliced({ ...roadInput, allocationKey: 'road.inner', within: ring,
        ...(seamChannels === undefined ? {} : { seamChannels }) }, pause); }
      finally { signs?.release(); seamChannels = undefined; }
    })();
    const outer = async (): Promise<PlatformRoad> => {
      let outerSigns: ReturnType<typeof startRoadSigns>;
      try {
        outerSigns = startRoadSigns(roadScope, allocator, instance, layout.signs.filter(sign => !ring(sign.at.x, sign.at.z)), 'outer');
        if (outerSigns !== undefined) await waitFor('Grid outer road signs', outerSigns.ready, 'worker');
        if (roadScope.disposed || roadScope.disposing) throw new Error('Grid session left during outer road preparation');
        const outerSlice = workSlice(OUTER_RING_SLICE_MS, roadScope);
        return await installPlatformRoadSliced({ ...roadInput, ...(outerSigns === undefined ? {} : { signs: outerSigns.get }),
          allocationKey: 'road.outer', within: (x, z) => !ring(x, z), voidFloor: false }, async () => { await outerSlice.check(); }, { budgetMs: OUTER_RING_STRETCH_MS });
      } finally { outerSigns?.release(); grain?.release(); strips.length = 0; } // Collision views retain positions/indices, never render-only colours.
    };
    road.catch(() => { grain?.release(); roadScope.dispose(); });
    timing?.mark('road-start');
    try {
      await construction.yield();
      // H4: Rapier's strip constructors must not accumulate into one loading task.
      // Complete the exact same collision set before publishing the session.
      for (const { mesh } of strips) {
        if (host.scope.disposed || host.scope.disposing) throw new Error('Grid session left during collider preparation');
        installStripCollider(host.physics, mesh, host.scope);
        await construction.check();
      }
      if (host.scope.disposed || host.scope.disposing) throw new Error('Grid session left during collider preparation');
      timing?.mark('collider-join');
      const session = new GridSession(host, edges, allocator, strips, { road, outer, outerStrips, publishStrips: added => { strips.push(...added); }, plans, collidersInstalled: true });
      session.initialHomeMetadata = metadata ?? null;
      timing?.mark('session');
      progress?.set(3, 3, `${assembly.cells.length} cells · ${strips.length} seams`);
      await construction.yield();
      timing?.mark('final-yield');
      return session;
    } catch (error) { roadScope.dispose(); throw error; }
    } catch (error) { signs?.release(); grain?.release(); throw error; }
    finally { timing?.finish(); }
    };
    const completed = await (initialHomeMetadata ? withInitialHomeMetadata(host.scope,
      () => gridShardfileProduct(home.slug, { allocator, scope: host.scope }, 'metadata'), create) : create());
    return completed;
  }

  constructor(host: GridSessionHost, edges?: readonly PlatformCell[], allocator?: ResidencyAllocator, prebuilt?: readonly GeneratedStrip[], preparedRoad?: { readonly road: PlatformRoad | Promise<PlatformRoad>; readonly outer?: () => Promise<PlatformRoad>; readonly outerStrips?: (scope: Scope) => Promise<readonly GeneratedStrip[]>; readonly publishStrips?: (strips: readonly GeneratedStrip[]) => void; readonly plans: Map<Mesh, CullPlan>; readonly collidersInstalled?: true }) {
    this.constructorTiming?.('fields');
    this.host = host;
    this.roadPlans = preparedRoad?.plans ?? new Map<Mesh, CullPlan>();
    // before the page's first render: the lights a region's own pool shows through (regionalWorld `mirrorInto`)
    if (isScene(host.scene)) {
      LightPool.for(host.scene).reserve(GRID_REGION_POINT_LIGHTS);
      // T7 / T10: the home population's projection light (game/population/projection.ts) asks after the first render;
      // growing the sealed pool then moved the count 5 -> 6 and rebuilt every lit program the boot had built (the 63
      // unused 5-light programs of a Driftwood visit, linked again after control)
      LightPool.for(host.scene).spare(GRID_HOME_SPARE_POINT_LIGHTS);
    }
    this.constructorTiming?.('lights');
    const mapReads = new AbortController(); host.scope.onDispose(() => { mapReads.abort(); });
    this.mapImages = new CellMinimaps(host.scope, async slug => {
      const owner = { allocator: this.allocator, scope: host.scope };
      const metadata = await gridShardfileProduct(slug, owner, 'optional-metadata');
      if (metadata === null) return undefined;
      try {
        const map = metadata.admitted.source.map; if (map === undefined) return undefined;
        const product = await gridShardfileProduct(slug, owner, { signal: mapReads.signal, files: [map.image] });
        if (product === null) return undefined;
        try { return leaseMapImage(product.admitted.source, product.admitted.assets, this.allocator, host.scope, true); }
        finally { try { await product.releaseInputs(); } finally { product.release(); } }
      } finally { metadata.release(); }
    }, identity => { const { slug: homeIdentity } = this.home; return identity === homeIdentity; },
    { revision: () => this.allocator.revision, deferred: error => error instanceof ApproachInputsDeferredError });
    const residency = host.residency;
    if (residency === undefined) throw new Error('Grid session requires the early page residency owner');
    if (allocator !== undefined && allocator !== residency.allocator) throw new Error('Grid session must share the page allocator');
    this.allocator = residency.allocator;
    const instance = pageGridInstance();
    this.assembly = new GridAssembly(gridMode(DEVSERVER));
    if (instance === null) throw new Error('A grid session needs a grid page');
    this.home = this.assembly.cell(instance);
    const home = this.home;
    // the root world is neutral highway physics and the home an owned region like every cell, so every cell is a neighbour
    this.neighbours = [...this.assembly.cells];
    const initialRing = new Set(this.neighbours.filter(cell => Math.abs(cell.cell[0] - home.cell[0]) <= 1
      && Math.abs(cell.cell[1] - home.cell[1]) <= 1).map(cell => cell.instance));
    const backgroundReady = (): boolean => host.backgroundReady?.() !== false;
    // ringsReady: the far ring charges each proxy its declared bytes before it loads, not the 1.6 MB cap, so placeholder
    // charges never leave a visible cell out of the ring (12 visible proxies of 0.4-1.6 MB fit its 14.4 MB)
    const declare = async (cell: GridCell): Promise<void> => {
      try { const bytes = await gridShardfileFarBytes(cell.slug); if (bytes !== null) this.declaredFar.set(cell.instance, bytes); }
      catch { /* the proxy's own load charges it */ }
    };
    for (const cell of this.neighbours) if (backgroundReady() || initialRing.has(cell.instance)) void declare(cell);
    if (!backgroundReady()) this.startOuterFar = () => {
      for (const cell of this.neighbours) if (!initialRing.has(cell.instance)) void declare(cell);
    };
    for (const cell of this.assembly.cells) { const manifest = findShard(cell.slug); this.names.set(cell.slug, manifest?.name ?? cell.slug); }
    this.constructorTiming?.('home');
    // the deck: one generator run (`create` runs it sliced and hands it over), one draw, the same vertices as the platform colliders
    const strips = prebuilt ?? platformStripsNow(this.assembly, edges);
    // SF19a / G158 (on for everyone since Jake's G175 pick, E450): the shard the player stands in owns the whole frame, the
    // road look owns the road, blended over 16 m at the cell edge; a host with no camera / composer builds none
    const frameHost = host.frame;
    this.frame = frameHost !== undefined ? new GridFrame({ host: frameHost, scope: host.scope, home, homeIsFrame: false, half: CHUNK_HALF, feet: () => this.world(),
      cells: this.assembly.cells.map((cell) => ({ instance: cell.instance, origin: { x: cell.origin.x, z: cell.origin.z } })) }) : null;
    const frame = this.frame;
    this.constructorTiming?.('frame');
    // SF17b look: the boulevard over the deck's road band (G80 / G81 / G93) and the VR void past the outer road (G89)
    const layout = roadLayout(this.assembly, (slug) => findShard(slug)?.name ?? slug);
    // G112: every grid admits exact CPU/GPU byte plans on its early home/region/ring allocator.
    const admission = new PlatformRenderResidency(this.allocator, host.scope);
    // the road system: `create`'s install as it lands (its frame hooks keep their latest values for it), else built now
    let platformRoad: PlatformRoad | null = null, horizon: number | undefined, weight: number | undefined;
    const take = (road: PlatformRoad, final = false): void => {
      platformRoad = platformRoad === null ? road : combinePlatformRoads(platformRoad, road);
      this.road = platformRoad.road; this.seams = platformRoad.seams; this.roadRoots = platformRoad.roots; this.roadSettled = true;
      if (horizon !== undefined) road.horizon(horizon);
      if (weight !== undefined) road.overlayLight(weight);
      this.roadTiles = platformRoad.tileBacking ?? null;
      if (this.roadTiles !== null && !this.roadTiles.started() && (final || preparedRoad?.outer === undefined)) {
        this.roadTiles.start(home.origin, layout, this.allocator, home.instance);
      }
    };
    // A1: the outer ring's road, started by `step` once play has begun and the inner ring has landed
    const outer = preparedRoad?.outer;
    if (outer !== undefined) this.startOuterRoad = () => {
      const landOuter = async (): Promise<void> => {
        const timing = clientPreparationBatch('grid', 'outer-ring', ['strips', 'road']);
        try { await this.prepareOuterStrips(); timing?.mark('strips'); const road = await outer(); timing?.mark('road'); if (!host.scope.disposed) take(road, true); }
        catch (error: unknown) {
          this.issues.set('road.outer', error instanceof Error ? error.message : String(error));
          console.warn('[grid] the outer road did not install:', error);
        } finally { timing?.finish(); }
      };
      void landOuter();
    };
    const given = preparedRoad?.road;
    if (given instanceof Promise) {
      const landing = async (): Promise<void> => {
        try { const road = await given; if (!host.scope.disposed) take(road); }
        catch (error: unknown) {
          this.roadSettled = true; this.issues.set('road', error instanceof Error ? error.message : String(error));
          console.warn('[grid] the road system did not install:', error);
        }
      };
      this.roadLanding = landing();
    } else take(given ?? installPlatformRoad({ strips, home, pitch: this.assembly.pitch, layout,
      scene: host.scene, scope: host.scope, camera: () => host.frame?.camera, plans: this.roadPlans, admission }));
    this.strips = [...collisionStrips(strips)];
    this.initialStripBytes = this.strips.reduce((bytes, strip) => bytes + strip.mesh.positions.byteLength + strip.mesh.indices.byteLength, 0);
    this.outerStripBuild = preparedRoad?.outerStrips;
    this.publishOuterStrips = preparedRoad?.publishStrips;
    // G321: inside a cell whose shard draws its own sky, its backdrop owns the horizon: the road's void floor fades by it
    if (frame !== null) host.scope.onDispose(frame.horizon(owned => { horizon = owned; platformRoad?.horizon(owned); }));
    // G103: the asphalt forced 15 m into each cell keeps the road's light under that cell's own (the road's frame weight)
    if (frame !== null) host.scope.onDispose(frame.stack(null, { weight: roadWeight => { weight = roadWeight; platformRoad?.overlayLight(roadWeight); } }));
    // G588: what stands outside that cell (the road's far reaches, the neighbours' near and far views, haze bands and ring
    // tiles) stays drawn from inside it: the neighbours are the grid's horizon (G321 part 4's fade beyond the cell is gone)
    // SF17b's per-view road budget (§3.2, G101): what the view camera draws of the road system, and what stays resident
    this.roadBudget = { view: () => { const camera = host.frame?.camera; return camera === undefined ? null : roadViewCost(this.roadRoots, camera, this.roadPlans); }, resident: () => roadResident(this.roadRoots, this.roadPlans) };
    // G85: a closed neighbour edge shows as a cyan hex shimmer
    this.constructorTiming?.('road');
    this.softWalls = installSoftWallLook({ scene: host.scene, scope: host.scope, time: () => app.clock.now,
      edges: this.neighbours.flatMap((cell) => neighbourEdges(cell, home).map((edge) => {
        const look = { instance: cell.instance, x: edge.x, z: edge.z, axis: edge.axis, halfLength: edge.halfLength };
        return cell.edgeLook === undefined ? look : Object.assign(look, { height: cell.edgeLook.height });
      })),
      ports: { closed: (id) => this.live === null || !this.live.live.ready(id) } });
    // QA 2026-11-13: a waiting cell's loading steps on SHARD SELECT's loading card, inset over the live world
    this.cellLoading = new CellLoading(new CellLoadingCard(), (waiting) => this.neighbours.some(row => row.instance === waiting));
    setParkedMatricesFrozen(true); // G580 T2: a hidden parked world skips matrix updates during its warm-up
    host.scope.onDispose(() => { this.cellLoading.close(); if (host.heldFrame !== undefined) host.heldFrame.enabled = false; setWarmUpHeld(false); setParkedMatricesFrozen(false); setBuildHeldTimed(false); });
    // G78: a shimmer line at every shard border on its real ground; G119: SAVING… / SAVE FAILED, RETRY while a crossing waits
    const rows = new Map((edges ?? []).map((cell) => [cell.instance, cell.edges]));
    let status: CrossingSaveStatus = null, polled = 0;
    // S18: SAVE FAILED, RETRY reports the first time a session shows it
    const reportSave = saveFailedReporter((id) => { try { return id === null ? '' : this.assembly.cell(id).slug; } catch { return ''; } });
    this.shimmer = installBorderShimmer({ scene: host.scene, scope: host.scope, time: () => app.clock.now,
      cells: this.assembly.cells.map((cell) => ({ x: cell.origin.x - home.origin.x, z: cell.origin.z - home.origin.z, edges: rows.get(cell.instance) ?? null })),
      ports: { feet: () => { const at = this.world(); return { x: at.x - home.origin.x, z: at.z - home.origin.z }; },
        status: () => {
          if (++polled % 4 === 0) { const crossing = this.live?.state().crossing; status = crossingSaveStatus(crossing); reportSave(status, crossing); }
          return status;
        },
        text: (shown) => (shown === 'saving' ? GAME_STRINGS.grid.saving : GAME_STRINGS.grid.saveFailed) } });
    this.constructorTiming?.('presentation');
    const nativeOrigin = { origin: { x: 0, z: 0 } };
    if (preparedRoad?.collidersInstalled !== true) for (const { mesh } of this.strips) installStripCollider(host.physics, mesh, host.scope);
    // SA34: the 7 × 7's empty cells and the band to the rail are walkable void floor at road level, never a fall
    withOwner(host.scope, () => installVoidFloor(host.physics, this.assembly.cells, this.assembly.pitch, false));
    // The normal world stage owns the home's sockets; this scope adds only rebased neighbours.
    installEntrySockets(host.physics, host.scope, this.neighbours.map((cell) => ({ x: cell.origin.x - nativeOrigin.origin.x, z: cell.origin.z - nativeOrigin.origin.z })));
    this.walls = new ReadinessWalls(host.physics, [...this.neighbours.flatMap((cell) => neighbourEdges(cell, nativeOrigin)), ...rimEdges(this.assembly, nativeOrigin)], host.scope);
    // a cell's PMREM of a new cube height fading in (drawnEnvironment.ts): the road's views take its variants before it lights
    // them (G639 desktop: Pine's 1024 and Nalati's 512 ring / road variants linked on the first road frame beside each)
    host.scope.onDispose(onPageEnvironment(() => { this.prelinkViews(); }));
    // G72, one landmass: the home level's open water stays inside its own cell (its sea surface and its swell body)
    waterExtent.uWaterHalf.value = CHUNK_HALF;
    host.scope.onDispose(() => { waterExtent.uWaterHalf.value = WATER_UNBOUNDED; });
    // neighbours: the far ring through the one allocator; each cell's root sits at its render origin
    this.constructorTiming?.('physics');
    const roots = this.viewRoots;
    for (const cell of this.neighbours) {
      // G164: a shard whose whole world is shifted vertically at runtime (its terrain field's `datum`, Driftwood's hybrid row)
      // shows its baked far proxy shifted by the same amount, as its own bake installs; absent, the root sits at road height
      const root = new Group(); root.name = `grid-cell:${cell.instance}`; root.position.set(cell.origin.x - home.origin.x, findShard(cell.slug)?.ground.terrain?.datum ?? 0, cell.origin.z - home.origin.z);
      const prepareView = host.prepareView;
      const containment = cellClip(root, CHUNK_HALF, host.scope, prepareView === undefined ? {} : { prepare: (node) => prepareView(node, () => !host.scope.disposed && node.parent !== null) });
      containment.sweep();
      root.updateMatrixWorld(); host.scene.add(root); roots.set(cell.instance, root);
      // playtest 1: a shared product's copy wears its own number panels (copyIdentity.ts)
      const marks = copyMarks(cell.instance, cell.identity);
      if (marks !== null) { root.add(marks.object); marks.object.updateMatrixWorld(true); host.scope.onDispose(marks.dispose); }
    }
    this.constructorTiming?.('roots');
    // G223: an entered regional runtime draws its own cell; its coarse root (far proxy, tiles) hides until it leaves, once
    // its coarse replacement is ready (H3.2). A world outside the tile registration keeps its root (Pine's ground is those
    // tiles, D189) unless its manifest says it draws its whole ground itself (`cellGround: 'world'`: Nalati, G784)
    const cover = cellCoverPort(id => roots.get(id), id => this.clientTiles.coverageReady?.(id) ?? true);
    this.refreshCellCover = cover.refresh;
    host.scope.onDispose(bindCellCover(host.scene, cover));
    const preparedBands = new WeakMap<FarProxyView, Object3D>();
    // G630: a shard's haze band stands in the strip outside its cell (BAND_OUTSET), so it hangs on a holder of its own beside
    // the cell root: under the root, the G550 containment fence discarded every fragment past the cell edge, the whole band
    // (Sunscar's orange dusk wall drew nothing). The holder follows the root's visibility (hidden while the cell is entered,
    // G223) in the late step below.
    const bandHolders = new Map<Object3D, Group>();
    const bandHolder = (root: Object3D): Group => {
      const held = bandHolders.get(root); if (held !== undefined) return held;
      const holder = new Group(); holder.name = `grid-band:${root.name}`; holder.position.copy(root.position); holder.updateMatrixWorld();
      host.scene.add(holder); bandHolders.set(root, holder);
      host.scope.onDispose(() => { holder.removeFromParent(); });
      return holder;
    };
    const far = farRingPorts({
      ...(host.prepareView === undefined ? {} : { prepare: async (view: FarProxyView, data: FarPrepared) => {
        const root = view.mesh.parent;
        if (root === null) throw new Error('Far view left before preparation');
        if (frame !== null && data.look.band !== undefined) {
          const holder = bandHolder(root), unband = installHazeBand(holder, data.look.band, CHUNK_HALF), dispose = view.dispose;
          view.dispose = () => { unband(); dispose(); };
          const haze = holder.getObjectByName('haze-band');
          if (haze === undefined) throw new Error('Far haze band was not installed');
          haze.visible = false; preparedBands.set(view, haze);
          await host.prepareView?.(holder, () => !host.scope.disposed && haze.parent === holder);
        }
        await host.prepareView?.(root, () => !host.scope.disposed && view.mesh.parent === root);
        if (view.mesh.parent === root) host.keepViewPrograms?.(view.mesh);
      } }),
      root: (id) => { const root = roots.get(id); if (root === undefined) throw new Error(`No grid cell root ${id}`); return root; },
      load: async (id) => {
        let loaded: Awaited<ReturnType<typeof loadFar>>;
        try { loaded = await loadFar(this.assembly.cell(id).slug); } catch (error) { this.farMissing.add(id); throw error; } // G167: no far view, A's fallback
        this.farMissing.delete(id);
        const { prepared, bytes } = loaded; this.costs.set(id, bytes); frame?.declare(id, prepared.look);
        return prepared;
      },
    });
    this.farPreparation = far.waiting;
    const framedPorts = frame === null ? far : { ...far, upload: (tile: { instance: string }, data: FarPrepared) => {
      const band = data.look.band, view = far.upload(tile, data), dispose = view.dispose;
      // SF19b (G94 / G95): a shard that declares a band shows its mood at its border from the road; inside its cell it owns the frame (G158)
      const prepared = preparedBands.get(view);
      const root = roots.get(tile.instance), unband = prepared !== undefined || band === undefined || root === undefined ? () => undefined : installHazeBand(bandHolder(root), band, CHUNK_HALF);
      if (prepared !== undefined) prepared.visible = true;
      view.dispose = () => { unband(); dispose(); };
      return view;
    } };
    // the drawn far views, for the cell screen's far-view row; G342: each one's mask is mirrored onto its near view
    const drawnFar = new Map<string, { view: FarProxyView; excluded: ReadonlySet<number> }>();
    // G607 (Jake's round-36 D): every neighbour draws its near view, whatever its distance; round 39: the phone tier only
    // its nearest PHONE_NEAR_CELLS (the rest on their far proxies, still unhazed)
    const near = new NearPlaceholders({
      allocator: this.allocator, cells: this.assembly.cells, pitch: this.assembly.pitch, root: (id) => roots.get(id),
      readyToRefine: () => this.initialFarReady,
      ...(TIER === 'phone' ? { limit: PHONE_NEAR_CELLS } : {}),
      load: (id) => loadNear(this.assembly.cell(id).slug),
      cover: (id, covered) => { const drawn = drawnFar.get(id); if (drawn !== undefined) drawn.view.mesh.visible = !covered && drawn.excluded.size < 16; },
      mask: (id) => drawnFar.get(id)?.excluded ?? new Set<number>(),
      ...(host.prepareView === undefined ? {} : { prepare: async (view: FarProxyView, current: () => boolean) => {
        await host.prepareView?.(view.mesh, current);
        if (current()) host.keepViewPrograms?.(view.mesh);
      } }) });
    this.near = near;
    host.scope.onDispose(() => { near.dispose(); });
    const farPorts = { ...framedPorts, upload: (tile: RingTile, data: FarPrepared) => {
      const view: FarProxyView = framedPorts.upload(tile, data), dispose = view.dispose;
      let retired = false;
      this.farViews.add(tile.instance); this.farMeshes.set(tile.instance, view);
      view.dispose = () => {
        this.farViews.delete(tile.instance); if (this.farMeshes.get(tile.instance) === view) this.farMeshes.delete(tile.instance);
        try { dispose(); }
        finally { if (!retired) { retired = true; this.tileGhosts.retired(tile.key, [view.mesh]); } }
      };
      const id = tile.instance, entry = { view, excluded: new Set<number>() as ReadonlySet<number> }, mask = view.mask, gone = view.dispose;
      drawnFar.set(id, entry);
      view.mask = (excluded) => { entry.excluded = excluded; mask(excluded); if (near.shows(id)) view.mesh.visible = false; near.remask(id); };
      view.dispose = () => { if (drawnFar.get(id) === entry) drawnFar.delete(id); gone(); };
      if (near.shows(id)) view.mesh.visible = false;
      return view;
    } };
    // SF25 / G66: frozen neighbours look alive (presentation-only client scripts; their sims never step here)
    this.life = new NeighbourLife({ scope: host.scope, simulation: (id) => this.live?.lifeRegion(id), active: (id) => (this.live === null ? this.home.instance : this.live.live.current()) === id });
    // one late system for the grid (the page's onLate takes one label): the alive neighbours, then the one frame's weights
    const prepareView = host.prepareView;
    this.panels = new NeighbourPanels({ scope: host.scope, region: (id) => this.live?.panelRegion(id), ...(prepareView === undefined ? {} : { prepare: prepareView }) });
    // G539: each drawn far view's band (proxy, impostor or the dithered fade between) by the camera's distance to its cell
    const eye = new Vector3();
    const bands = (): void => {
      const camera = host.frame?.camera; if (camera === undefined) return;
      camera.getWorldPosition(eye);
      for (const [id, { view }] of drawnFar) {
        const root = roots.get(id); if (root === undefined || view.band === undefined) continue;
        view.band(farBandShare(Math.hypot(Math.max(0, Math.abs(eye.x - root.position.x) - CHUNK_HALF), Math.max(0, Math.abs(eye.z - root.position.z) - CHUNK_HALF))));
      }
      for (const [root, holder] of bandHolders) holder.visible = root.visible;
    };
    // the one late system (play.ts binds every onLate to game.grid.frame): the ring tiles' static-matrix checks run in it too
    let ringStep: (() => void) | undefined;
    host.frame?.onLate((dt) => { this.lateFrames++; this.viewStep(); this.life.late(dt); this.panels.late(); bands(); frame?.frame(); ringStep?.(); });
    const tiles = neighbourTiles(host.scope, async (tile) => { await host.prepareTile?.(tile); },
      (tile, retiredRoots) => { this.tileGhosts.retired(tile.key, retiredRoots); }, host.frame === undefined ? undefined : step => { ringStep = step; }),
      tileCost = clientRingCatalogue(tiles.instances);
    // G342 round 3: a cell whose near view draws and carries its own world owns it whole (its dense
    // ground over the cell), so the rings stop refining it to its own L1 / L0 tiles, which would mask the near view near
    // the road (round 3's first A = B); a terrain-only near view (the template, its world in its tiles) keeps them; a cell
    // with no near view keeps its far proxy until entered (only the entered world lights its tiles)
    const farCosts = new Map<string, number>(), blocked = new Map<string, boolean>();
    let catalogueRevision = 0, tileRevision = -1, backgroundWasReady = backgroundReady();
    const catalogue = Object.assign((id: string, level: RingTile['level'], x: number, z: number): number | null => {
      if (!backgroundReady() && !initialRing.has(id)) return null;
      return level === 'far' ? this.costs.get(id) ?? this.declaredFar.get(id) ?? 1_600_000
        : this.placeholderBlocksTiles(id) ? null : tileCost(id, level, x, z);
    }, {
      revision: (): number => {
        const background = backgroundReady();
        if (background !== backgroundWasReady) { backgroundWasReady = background; catalogueRevision++; }
        const current = tileCost.revision?.() ?? -1;
        if (current !== tileRevision) { tileRevision = current; catalogueRevision++; }
        for (const cell of this.neighbours) {
          const bytes = this.costs.get(cell.instance) ?? this.declaredFar.get(cell.instance) ?? 1_600_000;
          const hidden = this.placeholderBlocksTiles(cell.instance);
          if (farCosts.get(cell.instance) !== bytes || blocked.get(cell.instance) !== hidden) {
            farCosts.set(cell.instance, bytes); blocked.set(cell.instance, hidden); catalogueRevision++;
          }
        }
        return catalogueRevision;
      },
    });
    this.rings = new TileStreamer(this.neighbours, this.allocator, catalogue,
      levelPorts<FarPrepared, PreparedRingTile>(farPorts, tiles.ports), { farRadius: FAR_RING.reach, uploadsPerFrame: 1, uploadBytesPerFrame: 4_000_000 });
    this.clientTiles = clientTileRegistration(tiles.instances, this.rings, tileRing, id => this.farMeshes.has(id));
    const neighbourAdmission = host.renderer === undefined ? undefined : this.tileAdmission(host.renderer, roots);
    this.admitNeighbour = neighbourAdmission?.complete;
    this.admitNeighbourRender = neighbourAdmission?.render;
    host.scope.onDispose(() => {
      this.clientTiles.dispose(); this.rings.dispose();
      for (const root of roots.values()) root.removeFromParent();
    });
    // O15: with a drawn frame, what only draws (rings, screens, shimmer, near view) steps once a frame in the late
    // system above, not on every 60 Hz fixed step: at the phone's 30 fps cap the second step of each frame redid it
    // (rings.step's tile choice and its per-frame upload budget twice a frame, on Driftwood's road entry ~1.6k Simulator
    // samples); headless hosts keep it in the fixed step
    host.onFixed((dt) => { this.step(dt, host.frame === undefined); this.life.fixed(); });
    // read at call time: a desktop images-first home settles its claim's bytes at the handoff (GC21 row 53)
    const homeClaim = residency.home(), homeResidency = (): { instance: string; bytes: number } => ({ instance: homeClaim.instance, bytes: homeClaim.bytes });
    host.scope.onDispose(app.debug.scopedExpose('grid', { state: () => this.state(), roadView: () => this.roadBudget.view(), roadResident: () => this.roadBudget.resident(),
      roadTileResidency: () => this.roadTiles?.state() ?? null,
      // G144 admission receipts read the same allocator, without reserving or changing any claim.
      residency: () => ({ cost: this.allocator.cost(), claims: this.allocator.entries(), home: homeResidency() }),
      // Per-frame travel needs the same fresh live/crossing facts, without the
      // full debug view's cells, ring accounting, skies, grades and post rows.
      travelState: (): { inside: string | null; live: ReturnType<LiveGridSession['travelState']> | null } => ({
        inside: gridCells.cell?.instance ?? null, live: this.live?.travelState() ?? null,
      }),
      // the live cell alone, for a sampler that must not build the whole readout four times a second (state() allocates it)
      current: () => (this.live === null ? null : this.live.live.current()),
    }));
    this.constructorTiming?.('streaming');
  }

  /**
   * The shardfile neighbours' ground through their own ring tiles (SF18b's `clientRingPorts`): one admitted product, asset
   * reader, material set and view set per slug (the template copies share them), each cell its own root. A neighbour that
   * fails to admit keeps its far proxy.
   */
  private tileAdmission(renderer: Renderer, roots: ReadonlyMap<string, Group>): {
    complete: (cell: GridCell, required?: boolean) => Promise<void>; render: (cell: GridCell) => Promise<boolean>;
  } {
    const scope = this.host.scope, skins = new Map<string, Promise<ReadonlyMap<string, ClientSkin>>>();
    const shared = new Map<string, Promise<{ source: ClientRingInstance['source']; assets: ClientAssets; views: ClientTileViews; compile: (entry: unknown) => Material }>>();
    const optional = new AbortController(); scope.onDispose(() => { optional.abort(); });
    const admit = async (cell: GridCell, required: boolean, offered: () => void): Promise<void> => {
      const root = roots.get(cell.instance); if (root === undefined) return;
      try {
        const owner = { allocator: this.allocator, scope };
        const product = required ? gridShardfileProduct(cell.slug, owner) : gridShardfileProduct(cell.slug, owner, { signal: optional.signal });
        if (product === null) { if (!required) throw new ApproachInputsDeferredError(); return; }
        const retained = await product; let pageOwned = false;
        try {
          let loading = shared.get(cell.slug);
          if (loading === undefined) {
            pageOwned = true; scope.onDispose(retained.release);
            loading = (async () => {
              const { admitted } = retained, source = admitted.source;
              try {
                if (scope.disposed) throw new Error('Grid product view disposed during admission');
                // A neighbour's tiles hold the authority its entered page holds, or Nine's look graphs are refused by whichever walk reaches it first.
                const presentation = await clientMaterials(source, admitted.assets, renderer, scope, { trustedGraphs: admittedGraphAuthority(source) });
                return { source, assets: retained.reader, views: clientTileViews({ terrain: source.terrain, terrainShadow: source.terrain?.shadow, terrainOrder: source.terrain?.order, ...presentation }), compile: presentation.compile };
              } catch (error) { retained.release(); throw error; }
            })();
            shared.set(cell.slug, loading);
          }
          const { source, assets, views, compile } = await loading;
          if (scope.disposed) return;
          this.clientTiles.offer(cell.instance, { source, assets, root, views });
          offered(); // Render-only pins need no life-script or panel construction.
          const bytes = retained.admitted.assets;
          try { await this.life.admit(cell, root, source, bytes, compile, skins); } catch (error) { console.warn(`[grid] ${cell.instance} stays still (client scripts):`, error); }
          try { await this.panels.admit(cell, root, source, bytes, views); } catch (error) { console.warn(`[grid] ${cell.instance} draws no doors (declared panels):`, error); }
        } finally {
          try { await retained.releaseInputs(); } finally { if (!pageOwned) retained.release(); }
        }
      } catch (error) { if (!(error instanceof ApproachInputsDeferredError)) this.refuse(cell, error); throw error; } // Required entry retains the original refusal.
    };
    const requests = new GridViewAdmissions(async (cell: GridCell, required, offered) => {
      if (scope.disposed || scope.disposing) throw new Error('Grid tile owner left');
      await admit(cell, required, offered);
    }, () => this.allocator.revision);
    return {
      complete: (cell, required) => scope.disposed || scope.disposing ? Promise.reject(new Error('Grid tile owner left')) : requests.complete(cell, required),
      render: async cell => {
        if (scope.disposed || scope.disposing) throw new Error('Grid tile owner left');
        try { await requests.render(cell); return true; }
        catch (error) { if (error instanceof ApproachInputsDeferredError) return false; throw error; }
      },
    };
  }

  /** G167: note a neighbour whose shard can't load (an M3 wait or a closing page is not a refusal), for its cell and SHARD SELECT. */
  private refuse(cell: GridCell, error: unknown): void {
    const refusal = classifyRefusal(error);
    if (refusal === null || this.host.scope.disposed) return;
    console.warn(`[grid] ${cell.instance} can't load (${refusal}):`, error);
    this.reportRefusal(cell.instance, cell.slug, refusal, error);
    this.refusals.set(cell.instance, refusal); this.issues.set(cell.instance, error instanceof Error ? error.message : String(error)); pageShardRefusals().note(cell.slug, refusal);
  }
  /**
   * G555's read-only port: the cell whose entry waits (the one the traveller is in before its gameplay is ready, else the
   * nearest unready cell within 12 m of its edge), with its readiness fences, its claims, its entered hooks since this wait
   * began and its refusal; null when none waits.
   */
  private cellLoadingInput(): CellLoadingInput | null {
    const live = this.live; if (live === null) return null;
    const current = live.live.current(), ready = (id: string): boolean => live.live.ready(id) && (current !== id || live.gameplayReady());
    let target: GridCell | undefined = current !== null && !ready(current) ? this.assembly.cell(current) : undefined;
    if (target === undefined) {
      const at = this.world();
      let best = 12;
      for (const cell of this.assembly.cells) {
        if (ready(cell.instance)) continue;
        const d = Math.hypot(Math.max(0, Math.abs(at.x - cell.origin.x) - CHUNK_HALF), Math.max(0, Math.abs(at.z - cell.origin.z) - CHUNK_HALF));
        if (d <= best) { best = d; target = cell; }
      }
    }
    if (target === undefined) { this.loadingSince.clear(); return null; }
    const id = target.instance, since = this.loadingSince.get(id) ?? diagnosticNow(); this.loadingSince.set(id, since);
    const raw = live.refusal(id), refusal = this.refusal(id);
    const reason = refusal !== null ? refusalReason(refusal)
      : raw instanceof GridCellWaitingError ? GAME_STRINGS.grid.waiting(this.shardName(id)) : null;
    let claimed = 0, product = false;
    for (const entry of this.allocator.claims()) {
      if (entry.owner === id) claimed += entry.bytes;
      if (entry.owner === 'grid' && entry.id === `product:grid:${target.slug}`) { claimed += entry.bytes; product = true; }
    }
    // its entered hooks of this run: from its latest beforeWorld (a road-prepared world ran some before the screen opened)
    const stages = live.live.readiness.status(id), timings = live.hookTimings(), own = timings.completed.filter(row => row.instance === id);
    let run = -1; own.forEach((row, index) => { if (row.hook === 'beforeWorld') run = index; });
    const hooks = new Set((run === -1 ? own.filter(row => row.start >= since) : own.slice(run)).map(row => row.hook));
    const hook = timings.current?.instance === id ? timings.current.hook : null;
    return { instance: id, slug: target.slug, name: this.shardName(id), refusal: reason, product: product || stages.runtime || stages.ready,
      claimedMB: claimed / 1e6, requested: stages.requested, runtime: stages.runtime, colliders: stages.colliders, sim: stages.sim,
      hooks, hook, hybrid: hooks.size > 0 || hook !== null, entered: current === id, gameplayReady: current === id && live.gameplayReady(),
      warm: live.warmPreparation(id) };
  }
  /** At most four times a second: the loading screen reads the allocator and the live session. */
  private stepCellLoading(): void {
    const now = diagnosticNow(); if (now - this.cellLoadingPolled < 250) return;
    this.cellLoadingPolled = now; this.cellLoading.step(this.cellLoadingInput());
    // G580 T2 (Developer): the traveller waits at the wall while its screen shows, so its warm-up may issue more a frame
    // G580 T2 / T5: a held traveller's warm-up issues more programs a frame and its builds run a bigger budget
    setWarmUpHeld(this.cellLoading.open !== null);
    setBuildHeldTimed(this.cellLoading.open !== null);
  }
  private refusal(instance: string): ShardRefusal | null {
    const live = this.live?.refusal(instance);
    return this.refusals.get(instance) ?? (live === undefined ? null : classifyRefusal(live));
  }
  private shardName(instance: string): string { const slug = this.assembly.cell(instance).slug; return this.names.get(slug) ?? slug; }

  /** Complete deferred native seams before a distant entry or road recovery. One page promise, no second scheduler. */
  prepareOuterStrips(): Promise<void> {
    if (this.outerStripsReady !== undefined) return this.outerStripsReady;
    const build = this.outerStripBuild;
    if (build === undefined) return Promise.resolve();
    this.outerStripBuild = undefined;
    const owner = this.host.scope.child('grid.outer-platform');
    const active = (): void => { if (owner.disposed || owner.disposing || this.host.scope.disposed || this.host.scope.disposing) throw new Error('Outer platform owner left'); };
    const prepare = async (): Promise<void> => {
      try {
        active(); const generated = await build(owner); active();
        const bytes = generated.reduce((sum, strip) => sum + strip.mesh.positions.byteLength + strip.mesh.indices.byteLength, 0);
        if (bytes > 0) {
          const claim = this.allocator.reserve({ id: 'sim:platform:outer', category: 'sim', owner: 'platform', bytes, distance: 0, needed: true });
          if (claim === null) throw new Error('Outer platform native residency deferred');
          owner.onDispose(claim.release);
        }
        const slice = workSlice(OUTER_RING_SLICE_MS, owner);
        for (const { mesh } of generated) {
          active(); installStripCollider(this.host.physics, mesh, owner); await slice.check();
        }
        active();
        this.strips.push(...collisionStrips(generated));
        this.publishOuterStrips?.(generated); this.publishOuterStrips = undefined;
        this.live?.refreshPlatformEntries();
      } catch (error) { owner.dispose(); throw error; }
    };
    this.outerStripsReady = prepare(); return this.outerStripsReady;
  }

  /** Step 2: the live crossing, once the page's player health and equipment exist (play.ts). */
  attach(page: LiveGridPage): LiveGridSession {
    if (this.live !== null) throw new Error('The grid session already has its live crossing');
    if (this.host.residency === undefined) throw new Error('Grid session requires the early page residency owner');
    // GO7: a home entered before the page loop (Template's data cell, Signal Dunes' client page) waits on its ring tiles
    // in loading step `home`, and only the loop's late frame steps them: every entry through this steps them until it runs
    const tiles = bootSteppedTiles(this.clientTiles, { frames: () => this.lateFrames,
      step: () => { if (!this.host.scope.disposed) { const at = this.world(); this.rings.step({ x: at.x, z: at.z, vx: 0, vz: 0 }); } },
      // a left page never wakes the wait: its entry's release settles it
      wait: () => new Promise<void>(resolve => { if (!this.host.scope.disposed) this.host.scope.timeout(16, resolve); }) });
    this.live = new LiveGridSession({ assembly: this.assembly, home: this.home, physics: this.host.physics, scope: this.host.scope, walls: this.walls, strips: this.strips, initialStripBytes: this.initialStripBytes,
      prepareStrips: cell => Math.max(Math.abs(cell.cell[0] - this.home.cell[0]), Math.abs(cell.cell[1] - this.home.cell[1])) <= 1 ? Promise.resolve() : this.prepareOuterStrips(), allocator: this.allocator,
      residency: this.host.residency.home(), tiles, lightingSettled: () => { this.prelinkViews(); }, backgroundReady: () => this.host.backgroundReady?.() !== false,
      ...(this.admitNeighbour === undefined ? {} : { prepareDataTiles: async (cell: GridCell, scope: Scope, start: { readonly x: number; readonly z: number }) => {
        await this.admitNeighbour?.(cell, true);
        // GO7: an initial data home (template-2 from Shard select) waits on these tiles in loading step `home`, before the
        // page loop steps the rings: the boot registration steps them until it does
        await tiles.enterOffered(cell.instance, scope, start);
      }, prepareNeighbourTiles: async (cell: GridCell, start: { readonly x: number; readonly z: number }, signal: AbortSignal) => {
        const owner = this.host.scope.child(`grid.tile-approach.${cell.instance}`);
        const release = (): void => { owner.dispose(); };
        owner.listen(signal, 'abort', release, { once: true });
        try {
          if (signal.aborted) throw new Error('Tile approach abandoned');
          if (await this.admitNeighbourRender?.(cell) === false) { owner.dispose(); return; }
          if (owner.disposed || owner.disposing || signal.aborted) throw new Error('Tile approach abandoned');
          const prepare = this.clientTiles.prepareOffered;
          if (prepare === undefined) throw new Error('Tile approach preparation is unavailable');
          await prepare(cell.instance, owner, start);
        } catch (error) { owner.dispose(); throw error; }
      } }),
      neighbourEdges: (cell, origin) => neighbourEdges(cell, { origin }), rimEdges: (origin) => rimEdges(this.assembly, { origin }) }, page);
    return this.live;
  }

  /** Ring prelink: once a crossing's lighting is in place, every resident neighbour view (far proxies, L1 / L0 ring tiles)
   *  links the programs that lighting needs through the page's own precompile (`prepareView`), in the background: a tile
   *  first drawn after it never links on its first frame (the 150 ms cove-pools frame), and nothing waits on it. The road's
   *  own roots (deck, boulevard, void) go too: their road-lit variants, compiled with the page's environment, are ready
   *  before the first leave (G639: Driftwood's first road frame linked seven programs, up to 1 s under load). */
  private prelinkViews(): void {
    const prepare = this.host.prepareView, scope = this.host.scope;
    if ((prepare === undefined && this.host.prepareViews === undefined) || scope.disposed || scope.disposing) return;
    prelinkGridViews(scope, [...this.viewRoots.values(), ...this.roadRoots], prepare, this.host.prepareViews);
    // the resident cells' sky domes too, under these lights (each layer was prepared under the lights it was built in)
    const skies = this.host.prepareSkyLayers;
    if (skies !== undefined) void (async (): Promise<void> => { try { await skies(); } catch (error: unknown) { console.warn('[grid] sky prelink stopped', error); } })();
  }
  /** G107 / SF66: a cell's admitted baked map once loaded, retaining the home's full raster size. */
  mapImage(instance: string): HTMLCanvasElement | ImageBitmap | null { return this.mapImages.image(this.assembly.cell(instance).slug); }
  /** the neighbours' baked maps held now (bytes), for the memory readouts */
  get mapImageBytes(): number { return this.mapImages.bytes; }
  /** The traveller's feet in grid metres, whatever frame it is in. */
  worldFeet(): { x: number; z: number } { return this.world(); }

  /** World feet (grid metres) from the home-frame feet. */
  private world(): { x: number; z: number } {
    if (this.live !== null) { const feet = this.live.worldFeet(); return { x: feet.x, z: feet.z }; }
    const feet = this.host.feet(); return { x: feet.x + this.home.origin.x, z: feet.z + this.home.origin.z };
  }

  /** One fixed step: the rings from the player's world pose and velocity, then the cell events. `view` false: the
   *  drawn parts (`viewStep`) wait for the frame's late system. */
  step(dt: number, view = true): void {
    const at = this.world();
    if (this.last !== null && dt > 0) { this.velocity = { x: (at.x - this.last.x) / dt, z: (at.z - this.last.z) / dt }; }
    this.last = at;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.startOuterFar !== null && this.host.backgroundReady?.() !== false) { const start = this.startOuterFar; this.startOuterFar = null; start(); }
    // Match L1's 400 m reach plus the rings' four-second travel lookahead. Distant
    // cells keep their baked proxy without admitting their full product at boot.
    if (this.startOuterRoad !== null && this.roadSettled && this.host.backgroundReady?.() !== false) { const start = this.startOuterRoad; this.startOuterRoad = null; start(); }
    // DL17 (G872): the cell the player is in, drawn by its regional runtime, admits no second tile copy of itself (the
    // home re-read ~225 of its files after control for it); leaving starts it while the runtime is still resident. A
    // runtime whose ground is those tiles (D189: Pine) still admits them, or its far proxy stays over the spawn
    const drawn = this.live?.runtimeDrawnCell() ?? null;
    if (this.initialFarReady && this.host.backgroundReady?.() !== false) for (const cell of this.neighbours) {
      if (cell.instance === drawn && !admitsCellTiles(cell.instance, drawn, this.clientTiles.owns(cell.instance), findShard(cell.slug)?.cellGround === 'world')) continue;
      const distance = Math.hypot(Math.max(0, Math.abs(at.x - cell.origin.x) - CHUNK_HALF), Math.max(0, Math.abs(at.z - cell.origin.z) - CHUNK_HALF));
      if (this.assembly.approaching(distance, 400 + Math.min(speed, 60) * 4)) void this.admitNeighbour?.(cell).catch(() => undefined);
    }
    this.softWalls.step();
    if (view) this.viewStep();
    const inside = this.assembly.at(at.x, at.z), active = this.live === null ? this.home.instance : this.live.live.current();
    // GC2: online, prediction on the rim of a cell the server still walls (C5) is not a departure
    const held = active !== null && this.live?.serverHolds(active) === true, origin = held ? this.assembly.cell(active).origin : null;
    const past = origin === null ? Infinity : Math.max(Math.abs(at.x - origin.x), Math.abs(at.z - origin.z)) - CHUNK_HALF;
    const presence = cellPresence(inside, active, held, past);
    if (presence.kind === 'leave') gridCells.leave();
    else if (presence.kind === 'enter') gridCells.enter({ instance: presence.instance, slug: presence.slug });
  }

  /** Tile streaming T5.3 (G775): the entered cell's resident L0 tiles (key j * 8 + i) and its origin from the home cell,
   *  for the Developer minimap overlay. */
  private overlayState: { readonly at: number; readonly state: ReturnType<GridSession['tileOverlayState']> } | null = null;
  /** T5's Developer overlay state, rebuilt at most every 250 ms (T10: rebuilt for every minimap paint it sorted every ring
   *  key, 12-13 ms of a Simulator spawn frame); residency moves slower than that and the overlay is a readout. */
  tileOverlayState(): { readonly origin: { readonly x: number; readonly z: number }; readonly render: ReadonlySet<number>; readonly bytes: ReadonlyMap<number, number> } {
    const now = diagnosticNow(), held = this.overlayState;
    if (held !== null && now - held.at < 250) return held.state;
    const state = this.readTileOverlayState(); this.overlayState = { at: now, state }; return state;
  }
  private readTileOverlayState(): ReturnType<GridSession['tileOverlayState']> {
    const entered = (this.live === null ? null : this.live.live.current()) ?? this.home.instance, cell = this.assembly.cell(entered), prefix = `${entered}:l0/`;
    const render = new Set(this.rings.resident().filter(key => key.startsWith(prefix)).map(key => {
      const [x, z] = key.slice(prefix.length).split('/').map(Number); return (z ?? 0) * 8 + (x ?? 0);
    }));
    // T5: each L0 tile's declared resident bytes, from the entered cell's admitted product (none while it is not resident)
    const bytes = new Map<number, number>();
    for (const tile of admittedRuntimeProduct(cell.slug)?.source.tiles ?? []) if (tile.lod === 0) bytes.set(tile.z * 8 + tile.x, tile.decoded + tile.gpu);
    return { origin: { x: cell.origin.x - this.home.origin.x, z: cell.origin.z - this.home.origin.z }, render, bytes };
  }

  private placeholderBlocksTiles(instance:string):boolean {
    if (this.clientTiles.preparing?.(instance) === true) return false;
    const entered=this.live===null?this.home.instance:this.live.live.current();
    return placeholderBlocksTiles(instance,entered,this.clientTiles.owns(instance),this.near.owns(instance),this.near.absent(instance));
  }

  /** What only draws, from the last fixed step's pose and velocity: the rings, the screens, the shimmer, the near view. */
  private viewStep(): void {
    this.refreshCellCover();
    const at = this.last ?? this.world(), speed = Math.hypot(this.velocity.x, this.velocity.z), clamp = speed > 60 ? 60 / speed : 1; // a respawn's jump is not a velocity
    this.rings.step({ x: at.x, z: at.z, vx: this.velocity.x * clamp, vz: this.velocity.z * clamp });
    // Home readiness alone cannot release optional model work: its parser can
    // otherwise queue ahead of far files still arriving for the startup barrier.
    if (!this.initialFarReady && this.host.backgroundReady?.() !== false && this.rings.ready()) this.initialFarReady = true;
    this.roadTiles?.step({ x: at.x, z: at.z, vx: this.velocity.x * clamp, vz: this.velocity.z * clamp });
    for (const cell of this.neighbours) if (this.placeholderBlocksTiles(cell.instance)) this.rings.retireRefinement(cell.instance);
    this.stepCellLoading();
    if (this.host.heldFrame !== undefined) this.host.heldFrame.enabled = this.cellLoading.open !== null && this.live?.travelState().crossing.phase === 'preparing';
    this.shimmer.step();
    const active = this.live === null ? this.home.instance : this.live.live.current();
    const eye = this.host.eye?.();
    if (this.host.backgroundReady?.() !== false) this.near.update(eye === undefined || !Number.isFinite(eye.x) || !Number.isFinite(eye.z) ? at : { x: at.x + eye.x, z: at.z + eye.z }, active);
  }

  /** every visible neighbour is drawn now (the entry reveal's readiness, G98) */
  ringsReady(): boolean { return this.roadSettled && this.rings.ready(); }
  /** Settles once the road system has landed (or failed): the entry's shader warm-up waits for it, so its programs are warmed. */
  roadLanded(): Promise<void> { return this.roadLanding; }

  /** PINE-FLASH (spawnGround.ts): the loader's `spawnDetail` step holds until the entered cell's ground covers its far
   *  proxy (Pine: its ring tiles, admitted now rather than after T10's background opens), or the ceiling. A cell that
   *  draws its own ground, or none drawn by a runtime, holds nothing. */
  async prepareSpawnGround(limitMs?: number): Promise<SpawnGround> {
    const live = this.live, render = this.admitNeighbourRender, drawn = live?.runtimeDrawnCell() ?? null;
    if (live === null || render === undefined || drawn === null) return 'none';
    const cell = this.assembly.cell(drawn);
    const instance = spawnGroundCell(drawn, this.clientTiles.owns(drawn), findShard(cell.slug)?.cellGround === 'world');
    if (instance === null) return 'none';
    const feet = live.worldFeet(), start = { x: feet.x - cell.origin.x, z: feet.z - cell.origin.z };
    const owner = this.host.scope.child(`grid.spawn-ground.${instance}`), prepareOffered = this.clientTiles.prepareOffered;
    try {
      return await holdSpawnGround({ instance, admit: () => render(cell), require: (id, keys, level) => this.rings.require(id, keys, level),
        ...(prepareOffered === undefined ? {} : { spawn: () => prepareOffered(instance, owner, start) }),
        pump: entry => stepRingsUntil(entry, { frames: () => this.lateFrames,
          step: () => { if (!this.host.scope.disposed) { const at = this.world(); this.rings.step({ x: at.x, z: at.z, vx: 0, vz: 0 }); } },
          wait: () => new Promise<void>(resolve => { if (!this.host.scope.disposed) this.host.scope.timeout(16, resolve); }) }),
        after: ms => new Promise<void>(resolve => { owner.timeout(ms, resolve); }), ...(limitMs === undefined ? {} : { limitMs }) },
      requirement => { owner.onDispose(requirement.release); });
    } finally { owner.dispose(); }
  }

  /** Hold the loading screen until every visible neighbour is drawn (or the time limit: the soft walls hold anyway). */
  async ready(limitMs = 20_000): Promise<boolean> {
    for (let waited = 0; ; waited += 16) {
      this.step(1 / 60);
      if (this.rings.ready()) return true;
      if (waited > limitMs) return false;
      await new Promise<void>((resolve) => { this.host.scope.timeout(16, resolve); });
    }
  }

  /** Publish the current feet's existing sky/grade owners before boot shader preparation.
   * This runs only the presentation frame; no neighbour tick, input, physics or simulation is advanced. */
  prepareFrame(): void { this.frame?.frame(); }

  /** T2E-1b: the cell the player is in, as the test probe reads it (its shard, door panels and the server's flags there).
   *  Without a live host no region is admitted, so no panel reads solid. */
  area(): ProbeArea | null {
    return gridArea({ current: this.live === null ? this.home.instance : this.live.live.current(), cells: this.assembly.cells,
      targets: id => this.panels.targets(id), flags: id => this.live?.areaFlags(id) ?? [] });
  }

  /** The readout: what each cell shows, the rings and the allocator. */
  state(): GridSessionState {
    const pending = bootWaits();
    const stats = this.rings.stats(), residentKeys = this.rings.resident(), resident = new Set(residentKeys.map((key) => key.split(':')[0]));
    const at = this.world(), cost = this.allocator.cost(), playing = this.live === null ? this.home.instance : this.live.live.current();
    const tiles = (instance: string, level: 'l1' | 'l0'): number => residentKeys.filter((key) => key.startsWith(`${instance}:${level}/`)).length;
    const drawn = (instance: string): GridCellDrawn => ({ far: this.farMeshes.get(instance)?.mesh.visible === true, near: this.near.visible(instance), l1: tiles(instance, 'l1'), l0: tiles(instance, 'l0') });
    // the home off its cell (an owned home on the road) is drawn like any neighbour; `frozen` only when no layer draws it
    const shows = (instance: string, d: GridCellDrawn): GridCellShows => instance === playing ? 'playing'
      : d.near ? 'near' : d.far ? 'far proxy' : d.l1 + d.l0 > 0 ? 'tiles' : instance === this.home.instance ? 'frozen' : resident.has(instance) ? 'far proxy' : 'loading';
    return {
      pitch: this.assembly.pitch,
      home: this.home.instance, inside: gridCells.cell?.instance ?? null, feet: { x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100 },
      cells: this.assembly.cells.map((cell) => { const d = drawn(cell.instance); return { instance: cell.instance, slug: cell.slug, cell: cell.cell, shows: shows(cell.instance, d), drawn: d }; }),
      strips: this.strips.length, road: this.road, seams: this.seams, softWalls: this.softWalls.state(), shimmer: this.shimmer.state(), cellLoading: this.cellLoading.open, cellStage: this.cellLoading.stage, cellStep: this.cellLoading.now, ringsReady: this.rings.ready(), ringsWait: { cells: this.rings.waiting(), far: this.rings.farPlan(), preparation: this.farPreparation(), waits: { count: pending.length, oldest: pending.map(({ label, kind, ageMs }) => ({ label, kind, ageMs })).sort((a, b) => b.ageMs - a.ageMs).slice(0, 16) } },
      residentMB: Math.round(cost.accounted / 1e4) / 100, playingMB: Math.round(cost.playing / 1e4) / 100,
      accountedBytes: cost.accounted,
      rings: { frame: stats.frame, far: stats.resident.far, l1: stats.resident.l1, l0: stats.resident.l0, refused: stats.refused, inFlight: stats.inFlight, queued: stats.queued,
        ghosts: { count: this.tileGhosts.count(), tiles: this.tileGhosts.regions() } },
      frame: this.frame?.state() ?? null,
      live: this.live?.state() ?? null,
      life: this.life.state(),
      near: this.near.state(),
    };
  }
}

/** Generate the platform; a platform the generator refuses (an edge past the cliff envelope, an entry off road height)
 *  falls back to road-level edges. A disposed page stops between slices and builds nothing more. */
async function platformStrips(assembly: GridAssembly, edges: readonly PlatformCell[] | undefined,
  generate: (cells: readonly PlatformCell[], empty: StripProfile) => Promise<readonly GeneratedStrip[]>, onFallback?: () => void): Promise<readonly GeneratedStrip[]> {
  const { cells, flat, empty } = platformInputs(assembly, edges);
  try { return await generate(cells, empty); } catch (error) {
    if (error instanceof Error && error.message === 'Grid admission scope disposed') throw error; // the page left mid-generation
    onFallback?.(); console.warn('[grid] the platform keeps road-level edges:', error); return generate(flat, empty);
  }
}
function platformStripsNow(assembly: GridAssembly, edges: readonly PlatformCell[] | undefined): readonly GeneratedStrip[] {
  const { cells, flat, empty } = platformInputs(assembly, edges);
  try { return generatePlatform(cells, empty); } catch (error) { console.warn('[grid] the platform keeps road-level edges:', error); return generatePlatform(flat, empty); }
}

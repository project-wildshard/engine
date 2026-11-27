import type { RegionCreatures } from './mapCreatures';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { emitFault } from '@wildshard/engine/core/faults';
import { crossingLoadingRows } from '../boot/loadingPaths';
import { loadingUnits } from '@wildshard/engine/boot/waits';
/**
 * The live crossing inside EXPERIMENTAL Wildshard (SHARD-PLATFORM SF18a / SF20a / SF17b, the grid client step 2): what
 * turns the step-1 session's closed soft walls into a real crossing. It composes sp-x2's `LiveGridHost` and sp-x1's
 * `GridCrossing` into the page's one fixed step:
 *
 * - **pre** (before the page's physics step): `beforeFixed` requests neighbours at their readiness distance and syncs the
 *   current world's soft walls; the crossing commits a prepared re-frame at the fixed boundary (one fixed step, the same
 *   page traveller: `Player.bindFrame`, `world.physics` and `app.physics` switch to the destination world).
 * - **post** (after the player's move): `afterPlayerStep` advances only the active owned region.
 * - **the render origin** (C39): the scene stays in the home cell's frame; while the traveller is in another frame the
 *   camera is offset by that frame's origin minus the home origin for the update / late / render phases only, and the
 *   offset comes off again at the next frame's input phase, so every fixed-step query reads the frame-local camera.
 * - **G68, the safe zone**: leaving a shard's cell stows silently to bare hands (no toast); entering the home cell restores
 *   its weapon; a template cell's weapon is its empty equipment (hands). G130 combat permission follows the feet's
 *   geometric cell at hit delivery, independently of the motor frame's 6/10 m hysteresis. The road is safe; each
 *   authoritative pipeline only admits the traveller inside its own cell, with regional actor-object provenance.
 * - **which cells are enterable**: shardfile shards (the template copies), each admitted as `createShardfileSim` in its
 *   own bodyless regional host with its strip duplicates; the rest refuse admission and stay far proxies behind closed
 *   walls until M3.
 */
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { createProgramKeeper, RETAINED_PROGRAM_BYTES, RETAINED_PROGRAM_LIMIT, type ProgramKeeper } from '@wildshard/engine/render/programRetention';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { WORK_SLICE_MS, workSlice } from '@wildshard/engine/core/workSlice';
import { CHUNK_HALF, ENTRY_ASPHALT } from '@wildshard/engine/core/config';
import type { DisposeStep, Scope } from '@wildshard/engine/app/scope';
import type { Events } from '@wildshard/engine/events/events';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { castRay, floorBelow } from '@wildshard/engine/physics/query';
import type { PlayerFrameQueries } from '@wildshard/engine/player/Player';
import type { PlayerHealth } from '@wildshard/engine/combat/health';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import { finishSimSteps } from '@wildshard/engine/sim/snapshot';
import { installStripCollider, PLATFORM_COLLIDER_OWNER } from '@wildshard/engine/physics/stripColliders';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { installGridBorders } from '@wildshard/engine/physics/gridBorders';
import type { ReadinessWalls, ReadinessEdge } from '@wildshard/engine/physics/readinessWalls';
import { TransferWalls, TRANSFER_WALL_BYTES } from '@wildshard/engine/physics/transferWalls';
import type { ReadinessBundle, ReadinessLink } from '@wildshard/engine/sim/readiness';
import type { GridAssembly, GridCell } from '../../../shared/game/grid/assembly';
import type { NeighbourRegion } from './neighbourLife';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { HomeResidencyClaim } from './pageResidency';
import { LiveGridHost, type LiveGridAdmission, type LiveGridFrame, type LiveGridRegion, type LiveGridState } from './live';
import { installGridCrossing, type GridCheckpointResult, type GridCrossingSession, type GridCrossingState } from '../../../shared/game/grid/crossing';
import { GridWallet, stowGridMount, type GridLoadout } from '../../../shared/game/grid/wallet';
import type { LedgerCatalogueItem } from '../../../shared/game/ledger';
import { installGridHoverSpeed } from '../../../shared/game/grid/rules';
import { installGridTravellerCombat } from '../../../shared/game/grid/travellerCombat';
import { gridHomeSim, gridCells, type GridHomeSimulation } from '../plugin/context';
import { gateEnters } from './cellPresence';
import { findShard } from '../shard/registry';
import { runtimePagePointer } from '../shard/pointer';
import { gridPostCosts, gridShardfileFolder, prioritizeGridFolder, type GridFolderMetadata } from './folders';
import { preparationAdmission, type GridAdmissionMetadata } from './preparationAdmission';
import { gridPostPairRefusal } from '../../../shared/game/grid/postPairs';
import {folderPostCost} from '../shardfile/folderCost';
import { SERVER_PLACED } from './pageEntry';
import { gridRecovery, type GridRecoveryReason, type GridRecoveryRecord } from '../../../shared/game/grid/recovery';
import { RoadRecovery, onRoad, type RoadPoint, type RoadRecoveryCell } from '../../../shared/game/grid/roadRecovery';
import { GridCellWaitingError } from './refusal';
import { withCopyLayout } from './copyLayout';
import { dataCellWorld, type RegionShell } from './regionShell';
import { installDataCellMovers, type DataCellMovers } from './dataCellMovers';
import { enterCellLooks, followCellLooks } from './dataCellLooks';
import { installDataCellBodies } from '../shardfile/touchViews';
import type { PanelRegion } from './neighbourPanels';
import { wirePage } from '../shardfile/wirePage';
import type { CollisionStrip } from '../../../shared/game/grid/collisionStrips';
import type { LocalSaveInstance } from '../../../shared/game/instanceSaves';
import { loadNavmesh } from '@wildshard/engine/physics/navmeshLoad';
import { enteredRuntime, pickInFrame } from './enteredInteract';
import { copyPrompts, copySpent, enteredCopy } from './copyPrompts';
import type { ItemRuntime } from '@wildshard/engine/combat/items';
import { cellRidePrompts } from './dataCellRides';
import { enterDataCellPlay } from './dataCellPlay';
import { PLAY_INSTALLS } from '../shardfile/playInstalls';
import { enterDataCellQuests } from './dataCellQuests';
import { hasQuests } from '../shardfile/declaredQuests';
import { enterDataCellFacts } from './dataCellFacts';
import { hasLedger } from '../shardfile/wireFacts';
import { enterDataCellHud } from './dataCellHud';
import { cellCompletionRows, enterDataCellCompletion } from './dataCellCompletion';
import { cellDeclaredAudio, enterDataCellAudio } from './dataCellAudio';
import { enterDataCellPlumbing, hasPlumbing } from './dataCellPlumbing';
import { cellLootRow, enterDataCellLoot } from './dataCellLoot';
import { enterDataCellCompendium, hasCompendium } from './dataCellCompendium';
import type { AudioData } from '@wildshard/format/audio';
import type { CompletionRows } from '@wildshard/format/completion';
import { hasDeclaredHud } from '../shardfile/declaredHud';
import { yieldGridAdmission, yieldGridConstruction } from './admissionYield';
import { RuntimePageSession, type RuntimePageResident } from '../shardfile/runtimePage';

import { enterDataCellKit, holdsItems } from './dataCellKit';
import { DATA_CELL_PLAN_ENTRIES, dataCellPlanFrame, dataCellPlanRows, enterDataCellPlan } from './dataCellPlan';
import { enterPlotAudio, pagePlotAudioPorts, plotAudioScene, type PlotAudioPorts, type PlotAudioScene } from './plotAudio';
import { shardFolderFromAdmission } from '../shardfile/runtimeFolder';
import { createRegionalRuntimeFactory, regionalRuntimeAccountedBytes, type PreparedRegionalRuntime, type RegionalRuntimePage, type RegionalRuntimeTextures } from './regionalRuntime';
import { bindHomeBuildCache } from '../shardfile/homeBuildCache';
import type { ClientTileRegistration } from '../shardfile/tileContent';
import { createRegionalWorldFoundation, hangCellDataSky, registerRegionalTextureTable, resolveRegionalRuntimeTextures } from './regionalWorld';
import { hangCellDataPost } from './cellDataPost';
import { regionalDataCellBytes } from './runtimeCost';
import { resolveLevelBounds } from '../../../shared/game/shard/runtime';
import { declaredPlayArea } from '@wildshard/engine/game/shardfile/playArea';
import type { PlayArea } from '@wildshard/format/playArea';
import { folderClosureFile, type ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import { recordingReader, vehicleSoundPort } from '../plugin/vehicleSounds';
import type { Bounds } from '@wildshard/engine/level/spec';
import { pinFrameOffset } from '@wildshard/engine/ui/hudAdapters';

/** The cached metadata claim and its later constructor enter the same immutable
 * texture policy. Fresh inputs remain borrowed only by actual construction. */
interface RegionalPreparationChoice { textures?: RegionalRuntimeTextures }

/** The page traveller the live host rebinds (the existing Player; never a second capsule). */
export interface LiveTraveller {
  readonly position: Vector3; readonly yaw: number; readonly motor: CharacterMotor; readonly camera: PerspectiveCamera;
  /** feet on the ground this step (the road respawn remembers only where the traveller stood, G101; absent: never) */
  readonly onGround?: boolean;
  /** Shard-owned riding ends at its cell border through the ride's own dismount; the hoverboard stays with the traveller. */
  readonly ride?: { dismount: () => void } | null;
  /** `queries`: the frame's own ground, water and surfaces (null: the home level's, sp-x2's frame-query primitive) */
  bindFrame: (physics: Physics, motor: CharacterMotor, queries: PlayerFrameQueries | null) => void;
  /** the board's live speed cap (SF20d `installGridHoverSpeed` owns it while the grid runs) */
  hoverSpeedLimit: (() => number) | null;
}
/** What the live wiring reads from the page once the player's health and equipment exist. */
export interface LiveGridPage {
  /** G226: the page has no shard world; its catalogue home uses the same owned factory as every other runtime shard. */
  /** Actual staged services; a neighbour never constructs another page shell. */
  readonly runtimePage?: () => RegionalRuntimePage | null;
  readonly traveller: LiveTraveller;
  readonly health: PlayerHealth;
  readonly equipment: EquipmentService;
  readonly events: Events;
  /** The existing page save service; regional continuations use stable catalogue instance ids. */
  readonly saves: SaveStore;
  /** Flush the page's real progress/loadout owner; storage refusal must hold the source frame. */
  readonly checkpoint: () => boolean;
  /** Optional polled storage readiness. Pending never grants permission; true is followed by a fresh local/native checkpoint. */
  readonly crossingSaveReady?: (instance: string) => GridCheckpointResult;
  /** Page-owned script notices; regional scripts never construct another HUD. */
  /** SS6b: the home cell's declared fall floor at a cell-local x/z (`declaredPlayArea(...).floorAt`, the rule its room reads),
   *  read on every check: a floor read once at the spawn said 25 all over Nine Dragon, where its room says −20 past 200 m.
   *  Neighbour floors come from their own declarations. */
  readonly homeFloorAt?: (x: number, z: number) => number;
  /** Profile rewards are restricted to the platform's admitted catalogue. */
  readonly catalogue: readonly LedgerCatalogueItem[];
  /** Clear harmful player effects when fixed-step feet cross the cell edge into the safe zone. */
  readonly onSafeZone?: () => void;
  /** switch the page's stepped world (world.physics and app.physics) */
  readonly setPhysics: (physics: Physics) => void;
  readonly onFixedPre: (fn: () => void) => void;
  readonly onFixedPost: (fn: () => void) => void;
  readonly onInput: (fn: () => void) => void;
  /** registered after the player's update (the camera is placed by then) */
  readonly onUpdate: (fn: () => void) => void;
}
/** What the session lends: the assembly, the home world and its walls, the strips and the one allocator. */
export interface LiveGridSessionPorts {
  /** Data-only cells publish gameplay only after their admitted entry tiles are resident. */
  readonly prepareDataTiles?: (cell: GridCell, scope: Scope, start: { readonly x: number; readonly z: number }) => Promise<void>;
  /** QA 11-24 row 69: a cell's view root (`grid-cell:<instance>`), which a data cell's declared post composite draws */
  readonly cellRoot?: (instance: string) => Object3D | undefined;
  /** Render-only destination preparation; the signal releases its temporary entry-tile pins. False: its inputs were deferred
   *  (no room yet), nothing is pinned; `required` (the road's ground, J500) reads them as an entry would. */
  readonly prepareNeighbourTiles?: (cell: GridCell, start: { readonly x: number; readonly z: number }, signal: AbortSignal, required?: boolean) => Promise<boolean>;
  /** J500: false keeps a tile-ground zone's far view beside the road instead of pinning its ground (`debug.roadGround`) */
  readonly roadGround?: boolean;
  /** Borrow the page render scheduler when an entered data region replaces neighbour views. */
  readonly tiles?: ClientTileRegistration;
  /** Told once the lighting a crossing changes is in place (an entered runtime's activation settled, or the road again
   *  after a leave), so resident neighbour views can link the programs that lighting needs before they first draw. */
  readonly lightingSettled?: () => void;
  /** Product-only neighbour prefetch waits while this is false (the page's spawn settle, T10). */
  readonly backgroundReady?: () => boolean;
  readonly residency: HomeResidencyClaim;
  readonly assembly: GridAssembly; readonly home: GridCell; readonly physics: Physics; readonly scope: Scope;
  readonly walls: ReadinessWalls; readonly strips: readonly CollisionStrip[]; readonly allocator: ResidencyAllocator;
  /** The initial highway claim; deferred strips carry their own exact supplemental claim. */
  readonly initialStripBytes?: number;
  /** Product metadata may prefetch early; constructing a region requires its complete seam set. */
  readonly prepareStrips?: (cell: GridCell) => Promise<void>;
  readonly neighbourEdges: (cell: GridCell, origin: Readonly<{ x: number; z: number }>) => ReadinessEdge[];
  readonly rimEdges: (origin: Readonly<{ x: number; z: number }>) => ReadinessEdge[];
}
/** The worker client's line in (J130, E6): the server says where this client stands, and the page's crossing follows it. */
export interface LiveGridWire {
  /** The world the newest frame came from: a cell's instance, null for the road, undefined before the first. */
  readonly site: () => string | null | undefined;
  /** The page took a new world's physics. */
  readonly rebound: (physics: Physics) => void;
  /** The server's creatures in the world the page stands in, for a cell whose creatures no manager holds. */
  readonly rows: NeighbourRegion;
  /** Every quest flag the server says this player holds in the world the page stands in (T2E-1b, the probe's area). */
  readonly flags?: () => readonly string[];
}
/** The readout: the live host's crossing telemetry, the crossing coordinator and the safe-zone state. */
export interface LiveGridSessionState {
  /** G580 T2: the distinct compiled programs kept across retired cells (null: the Developer row is off) */
  readonly keptPrograms: number | null;
  readonly live: LiveGridState; readonly crossing: GridCrossingState; readonly stowed: boolean; readonly renderOrigin: { x: number; z: number };
  /** J500: the resident worlds drawn from the road now (`syncRoadDisplays`) */
  readonly roadDisplays?: readonly string[];
  /** J500: each tile-ground zone's ground pin from the road (`roadGroundReady`) */
  readonly roadGround?: Readonly<Record<string, string>>;
  /** Entered hook intervals in the same performance clock as browser long tasks. */
  readonly runtimeTiming: ReturnType<RuntimePageSession['timings']>;
  /** Committed synchronous transitions; approach preparation wall intervals remain separate. */
  readonly crossingTiming: ReturnType<GridCrossingSession['crossing']['timings']>;
  /** O20: each road crossing's entered-callback leave (ms) before its source region retires */
  readonly leaveTiming?: readonly { instance: string; leaveMs: number }[];
  readonly crossingLoading: readonly ReturnType<typeof crossingLoadingRows>[];
  /** the board's cap now (m/s; null off the board's grid rule) and whether the home client's simulation runs (null: no handoff) */
  readonly hoverCap: number | null;
}
/** The highway's own surfaces: the deck and strips at road level, no water (G72: the outer ring is land). */
const HIGHWAY_QUERIES: PlayerFrameQueries = { heightAt: () => 0, waterSurfaceAt: () => null, platforms: [] };
/** A spawn in the active frame's local coordinates (fall recovery and respawn in a region that is not the home). */
export interface LiveGridSpawn { readonly x: number; readonly y: number | undefined; readonly z: number; readonly yaw: number }

/** The platform travel envelope at the deck's 30 m/s; a shardfile's critical bundle is its declared compressed sim. */
/** ZE21 (Jake, 2026-11-15 ~16:50 Cancún: "Having the home cell in memory when your 10m away 100m or 300m away shouldnt
 *  matter, 1000m away shouldnt matter"): the owned home stays resident for the whole road. Measured on the laptop (desktop,
 *  2992x1434@2), the home is ~216 MB of real GPU and RAM; the envelope was filled by neighbours' tile products and the cost
 *  model's fixed shares, which now yield to it (`keepHome`). */
const HOME_KEEP_METRES = Number.POSITIVE_INFINITY;
const LINK: ReadinessLink = { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: 0.25, maxStallSeconds: 10 };
/** J500 rule 2: the zone ahead builds once its readiness estimate at the traveller's speed (a sprint at least), with a quarter
 *  more, plus 8 m, covers the walk to its square. */
const ROAD_AHEAD = { minSpeed: 8, margin: 1.25, leadMetres: 8 } as const;
/** J500 rule 1 (QA 11-23-b row 17): the zone just left stays whole beside the road up to the J410 memory refusal line (engine
 *  budgets `memory/loading/*`, 1.5 GB), not the 1.0 GB playing envelope (J445's may-crash target): on a phone Driftwood alone
 *  plays 1.18 GB, so the envelope retired it the moment its gate was crossed and walking back in rebuilt it at the gate. */
/** J500: a tile-ground zone's deferred ground pin asks again after this long */
const ROAD_GROUND_RETRY_MS = 2000;
const DEPARTED_PLAYING_BYTES = 1_500_000_000;

/** G598: a preparation that fails (or a road approach abandoned for another crossing, T7) frees its half-built region as a
 *  crossing's retirement does (O20):
 *  its stepped disposal under the loading slice, never one long frame (Driftwood's entry drive held 206 ms here). */
async function disposeInSteps(region: PreparedRegionalRuntime['region']): Promise<void> {
  const retire = region.retire;
  if (retire === undefined) { region.dispose(); return; }
  const slice = workSlice(), steps = retire();
  let stretch = diagnosticNow();
  for (let step = steps.next(); step.done !== true; step = steps.next()) {
    if (diagnosticNow() - stretch >= WORK_SLICE_MS) { await slice.yield(); stretch = diagnosticNow(); }
  }
}

/** SS6b: each region product's declared play area, read once (the grid asks every fixed step). */
const regionAreas = new WeakMap<ShardFolder, { readonly area: PlayArea | undefined }>();
const regionArea = (product: ShardFolder, authored: Bounds | undefined): PlayArea | undefined => {
  let held = regionAreas.get(product);
  if (held === undefined) { held = { area: declaredPlayArea(authored, product) }; regionAreas.set(product, held); }
  return held.area;
};

const regionTransferWalls = (shell: RegionShell, radius: number): TransferWalls => new TransferWalls(() => shell.physics, [{ x: 0, z: 0 }], radius, 'exit', shell.scope);
/** A home spawn's feet. With no height: the highest surface there (`standing`), a deck included (E463). With one: at least on
 *  the terrain, as its server stands it (at least the terrain's height): the format's default `world/spawn` (y 2) put
 *  images-only Dunes' player 16 m under its dunes on `wildshard dev`, where the near tiles' faces are culled (SF22). */
export function homeSpawnFeet(height: number | undefined, terrain: () => number, standing: () => number): number {
  return height === undefined ? standing() + 0.5 : Math.max(height, terrain() + 0.1);
}

/** The live crossing for one grid page; disposed with the level scope. */
export class LiveGridSession {
  readonly live: LiveGridHost;
  private crossing: GridCrossingSession;
  private wire: LiveGridWire | null = null;
  private readonly ports: LiveGridSessionPorts;
  private readonly page: LiveGridPage;
  private readonly transferWalls = new Map<string | null, TransferWalls>();
  private readonly offset = new Vector3();
  private framePhysics: Physics;
  /** the home runtime's own simulation driver (its runtime binding offers it): the live grid drives that region, so it runs
   *  only while bound as the current frame's (never on a grid page today); taking the offer settles the boot's handoff */
  private homeSim: GridHomeSimulation | null = null;
  private readonly applied = new Vector3();
  private readonly roadWallet: GridWallet;
  /** each admitted region's authored spawn (its level's player start) and its ground / water queries, local */
  /** TC-E5b: each admitted data cell's movers, claimed for the wire as the feet enter it. */
  private readonly dataMovers = new Map<string, DataCellMovers>();
  /** SS9c: each resident cell's touchable bodies, claimed with its movers. */
  private readonly dataBodies = new Map<string, { readonly claim: () => void }>();
  private readonly regions = new Map<string, { readonly spawn: LiveGridSpawn; readonly items: Shardfile['items']['rows']; readonly queries: PlayerFrameQueries; readonly colliders: PanelRegion['colliders']; readonly prompts: ReturnType<typeof copyPrompts>; readonly audio: PlotAudioScene | null;
    /** TC-E1b: the copy's admitted source and assets, its declared kit built from them on entry */
    readonly kit: { readonly source: Shardfile; readonly assets: ReadonlyMap<string, Uint8Array>; readonly product: () => ShardFolder } | null;
    /** SS-GP7: the copy's source when it wants an entry of the one install list (races, talks, rides, held-tool lines) */
    readonly play: Shardfile | null;
    /** SS-GP1: the copy's source when it declares quests, their state and views installed on entry */
    readonly quests: Shardfile | null;
    /** SS-GP2: the copy's source when it maps facts to rewards, its granted facts recorded on entry */
    readonly facts: Shardfile | null;
    /** SS-GP3: the copy's source when it declares HUD rows (counters, boss panels), mounted on entry */
    readonly hud: Shardfile | null;
    /** SS-GP4a: the copy's completion card rows when its card opens on the quest, installed on entry */
    readonly completion: { readonly source: Shardfile; readonly rows: CompletionRows } | null;
    /** SS-GP4b: the copy's declared cues, score mode and bed when it has no audio scene, installed on entry */
    readonly declaredAudio: AudioData | null;
    /** SS-GP4c: the copy's source when it declares input contexts (its tools' keys and touch buttons), installed on entry */
    readonly plumbing: Shardfile | null;
    /** SS-GP4e: the copy's gear loot row and its folder when it pays coins, its purse and chip installed on entry */
    readonly loot: { readonly source: Shardfile; readonly row: string; readonly folder: ShardFolder } | null;
    /** SS-GP4d: the copy's compendium source, its sketches' assets and its folder, the journal installed on entry */
    readonly compendium: { readonly source: Shardfile; readonly assets: ReadonlyMap<string, Uint8Array>; readonly folder: ShardFolder } | null;
    /** OF22e2: the copy's client plan when it declares features a data cell's own installs do not cover, entered as a one-shard page enters them */
    readonly plan: { readonly folder: () => ShardFolder } | null }>();
  /** AU20: the entered data cell's own audio scene (an Open Plot's score, bed and loops), live while the feet are in it. */
  private plotAudio: { readonly instance: string; readonly scope: Scope } | null = null;
  /** TC-E1b: the entered data cell's held kit, disposed when the feet leave it */
  private dataKit: { readonly instance: string; readonly scope: Scope; runtimes: ReadonlyMap<string, ItemRuntime> | null } | null = null;
  /** SS-GP1 on: the entered data cell's other play installs by kind (`quests`, `facts`, `hud`), each live while the feet are in it */
  private readonly dataStays = new Map<string, { readonly instance: string; readonly scope: Scope }>();
  private readonly plotBanks = new Map<string, ReturnType<PlotAudioPorts['bank']>>();
  private readonly runtimeScope: Scope;
  private readonly runtimeRegions = new Map<string, PreparedRegionalRuntime>();
  /** J500 rules 1 and 2: the resident worlds drawn from the road now, each with the scope that shows it */
  private readonly roadDisplays = new Map<string, { readonly prepared: PreparedRegionalRuntime; readonly owner: Scope }>();
  /** J500: a tile-ground zone's ground tiles pinned from the road (`roadGroundReady`), each released by its abort */
  private readonly roadGround = new Map<string, { readonly abort: AbortController; ready: boolean; state: 'pinning' | 'ready' | 'deferred' | 'refused'; readonly at: number }>();
  /** GC9: worlds pre-warmed from inside an entered runtime (GC5), whose entry preparation waits for the source to be left:
   *  the runtime session prepares an entry only from the neutral road, so preparing it inside the source threw away the
   *  whole world just built ("Entry preparation requires the neutral road") and closed the cell until a retry. */
  private readonly deferredEntries = new Map<string, { readonly prepared: PreparedRegionalRuntime; readonly signal: AbortSignal | undefined }>();
  private readonly leaveTiming: { instance: string; leaveMs: number }[] = [];
  private readonly runtimeResidents = new Map<string, RuntimePageResident>();
  private readonly runtimePage: RuntimePageSession;
  private readonly startedRuntimes = new Set<string>();
  private activation: Promise<boolean> | undefined;
  /** G580 T2: the Developer choice, read at construction; the keeper is made at the first retirement */
  private keeper: ProgramKeeper | null = null;
  private checkpointsSuppressed = false;
  /** SB41: a prepared recovery's place is final; `validSaved` holds the record to that exact save, `at` and all. */
  private recoveryPrepared = false;
  /** The periodic autosave in flight: one stage a frame, superseded by any direct checkpoint (rt3-freeze). */
  private autosave: Generator<undefined, boolean> | null = null;
  private autosaveCaptured = false;
  private reportedAutosave = false;
  /** G101: the last road point, where a fall that began from the road recovers */
  private readonly road: RoadRecovery;
  private readonly respawnCells = new Map<string, RoadRecoveryCell>();

  constructor(ports: LiveGridSessionPorts, page: LiveGridPage) {
    if (ports.residency.allocator !== ports.allocator || ports.residency.instance !== ports.home.instance) throw new Error('Live grid requires its admitted home on the page allocator');
    this.ports = ports; this.page = page;
    // The one-shot boot intent identifies the home before GridSession constructs; an owned page starts on the road.
    gridCells.leave();
    this.framePhysics = ports.physics;
    const { assembly, home, scope } = ports;
    const traveller = page.traveller;
    // Register the resident parent before the live host disposer: the traveller returns before native children free.
    this.runtimeScope = scope.child('grid.runtime.residents');
    this.runtimePage = new RuntimePageSession(this.runtimeResidents, scope, { pause: yieldGridConstruction });
    scope.onDispose(gridCells.onLeave(() => { this.runtimePage.leave(); this.prepareDeferredEntries(); }));
    scope.onDispose(gridCells.onLeave(() => { this.leavePlotAudio(); this.leaveDataKit(); this.leaveDataStays(); }));
    scope.onDispose(gridCells.onEnter(cell => {
      if (!this.runtimeResidents.has(cell.instance)) { this.dataMovers.get(cell.instance)?.claim(); this.dataBodies.get(cell.instance)?.claim(); this.enterPlotAudio(cell.instance); this.enterDataKit(cell.instance); this.enterDataPlay(cell.instance); ports.lightingSettled?.(); return; }
      this.startedRuntimes.add(cell.instance);
      const activation = this.runtimePage.enter(cell);
      this.activation = activation;
      const report = async (): Promise<void> => {
        try { await activation; ports.lightingSettled?.(); } catch (error) { console.error('Regional runtime entry failed', error); }
      };
      void report();
    }));
    scope.onDispose(gridCells.onLeave(() => { ports.lightingSettled?.(); }));
    // SS-GP6: an entered data cell's look graphs read its fields and tick while the feet stand in it
    followCellLooks(scope, gridCells, instance => !this.runtimeResidents.has(instance), (instance, stay) => { enterCellLooks(instance, stay, () => this.wire === null || this.wire.site() === instance); });
    const transferScope = scope.child('grid.transfer.home');
    this.roadWallet = new GridWallet(page.saves, { id: home.instance, shard: home.slug });
    this.road = new RoadRecovery(assembly);
    this.refreshPlatformEntries();
    const player = { get position() { return traveller.position; }, get yaw() { return traveller.yaw; }, health: page.health, owner: traveller, motor: traveller.motor };
    const highwayBytes = (ports.initialStripBytes ?? ports.strips.reduce((sum, strip) => sum + strip.mesh.positions.byteLength + strip.mesh.indices.byteLength, 0))
      + assembly.cells.length * TRANSFER_WALL_BYTES;
    try { this.live = new LiveGridHost(assembly, {
      lastCell: { windowMs: 30_000, playingBytes: DEPARTED_PLAYING_BYTES, keepHome: HOME_KEEP_METRES,
        // QA 11-23-b row 17 (J500): any zone just left stays resident across the road band beside it
        keepNear: assembly.pitch - CHUNK_HALF * 2, schedule: (expire, ms) => {
        const timer = scope.child('grid.last-cell-expiry');
        timer.timeout(ms, () => { timer.dispose(); scope.run(expire); });
        return () => { timer.dispose(); };
      } },
      keepPrograms: instance => { this.keepPrograms(instance); },
      // J500 rule 2: the zone ahead starts its whole build from the road, led by speed (a sprint at least)
      ahead: ROAD_AHEAD,
      home: { mode: 'owned', instance: home.instance, bytes: ports.residency.bytes, residency: ports.residency },
      player, allocator: ports.allocator,
      highway: { bytes: highwayBytes, create: () => {
        const highwayScope = scope.child('grid.highway.platform');
        this.transferWalls.set(null, new TransferWalls(() => ports.physics, assembly.cells.map(cell => cell.origin), traveller.motor.opts.radius, 'entry', highwayScope));
        // GridSession already installed global strips/sockets/readiness walls in this neutral root. It never frees
        // root Physics or the latest traveller motor; page teardown runs after the live registry returns that motor.
        return { physics: ports.physics, walls: ports.walls, dispose: () => { highwayScope.dispose(); } };
      } },
      admit: (cell, required) => this.admit(cell, required),
      ...(ports.prepareNeighbourTiles === undefined ? {} : { prepareNeighbour: ports.prepareNeighbourTiles }),
      prioritize: (cell) => prioritizeGridFolder(cell.slug, { allocator: ports.allocator, scope }),
      pause: () => yieldGridAdmission(scope),
      prefetchable: (cell) => { const manifest = findShard(cell.slug); return manifest?.shardfile !== undefined; },
      ...(ports.backgroundReady === undefined ? {} : { backgroundReady: ports.backgroundReady }),
      bindFrame: (frame) => { this.bind(frame); },
      gameplayReady: () => this.gameplayReady(),
      readiness: { link: LINK, bundle: (cell) => this.bundle(cell) },
    }); } catch (error) { transferScope.dispose(); throw error; }
    scope.onDispose(() => { this.live.dispose(); });
    scope.onDispose(() => { for (const pin of this.roadGround.values()) pin.abort.abort(); this.roadGround.clear(); });
    this.crossing = this.installCrossing();
    installGridTravellerCombat(page.events, scope, page.health, () => {
      const active = this.runtimePage.state();
      return active.ready ? active.instance : home.instance;
    }, () => {
      const feet = this.live.worldFeet();
      return assembly.at(feet.x, feet.z)?.instance ?? null;
    }, () => {
      const active = this.runtimePage.state();
      return active.instance === null ? undefined : this.runtimeRegions.get(active.instance)?.combatActors();
    });
    // Resolve immutable authored classes once; the physics tick reads the geometric cell, never the active motor frame.
    const hoverClasses = new Map<string, 'shard' | 'road'>();
    for (const cell of assembly.cells) hoverClasses.set(cell.cell.join(','), findShard(cell.slug)?.hoverSpeedClass ?? 'shard');
    // SF20d/G540: 30 m/s on the deck and road-class padding; ordinary interiors ease down to 14 over the strip.
    installGridHoverSpeed(traveller, scope, () => {
      const feet = this.live.worldFeet(), p = assembly.pitch;
      const local = { x: feet.x - Math.round(feet.x / p) * p, y: feet.y, z: feet.z - Math.round(feet.z / p) * p };
      const speedClass = hoverClasses.get(`${Math.round(feet.x / p)},${Math.round(feet.z / p)}`) ?? 'shard';
      return { local, shardCap: 14, onHighwayDeck: feet.y < 4, speedClass };
    });
    // the freeze fence: the home client's existing driver runs only while the traveller is in the home frame (sp-x5's handoff)
    scope.onDispose(gridHomeSim.take((sim) => {
      if (sim.residency !== ports.residency) throw new Error('Home simulation handoff must retain its admitted page claim');
      this.homeSim = sim; sim.setActive(this.live.current() === home.instance);
    }));
    scope.onDispose(() => { this.homeSim?.setActive(true); this.homeSim = null; });
    page.onFixedPre(() => {
      if (scope.disposed) return;
      this.live.beforeFixed(); this.crossing.step(this.live.worldFeet());
      this.syncRoadDisplays();
      const walls = this.transferWalls.get(this.live.current());
      if (walls === undefined) throw new Error('Active transfer fence is missing');
      walls.sync();
    });
    let saveTicks = 0, wasInside = assembly.at(this.live.worldFeet().x, this.live.worldFeet().z) !== undefined;
    page.onFixedPost(() => {
      if (scope.disposed) return;
      const feet = this.live.worldFeet();
      const cell = assembly.at(feet.x, feet.z);
      // G189 is geometric, even while the physical motor still belongs to the source across the strip.
      if (wasInside && cell === undefined) page.onSafeZone?.();
      wasInside = cell !== undefined;
      this.live.afterPlayerStep();
      const recoveryCell = cell === undefined ? undefined : this.respawnCells.get(cell.instance);
      const p = traveller.position;
      const hit = traveller.onGround === true ? castRay(this.framePhysics, { x: p.x, y: p.y + 0.6, z: p.z }, { x: 0, y: -1, z: 0 }, 1.35, ['WORLD'], traveller.motor.collider) : null;
      const grounded = hit !== null && Math.abs(hit.point.y - p.y) <= 0.75;
      // Shared strips/aprons never establish a shard checkpoint. The declared 8x15 asphalt socket does.
      const entry = recoveryCell?.entryways.some(({ edge, width }) => {
        const axis = edge === 'east' || edge === 'west' ? 'x' : 'z', along = axis === 'x' ? 'z' : 'x';
        const sign = edge === 'east' || edge === 'north' ? 1 : -1;
        const depth = CHUNK_HALF - sign * (feet[axis] - recoveryCell.origin[axis]);
        return depth >= 0 && depth <= ENTRY_ASPHALT && Math.abs(feet[along] - recoveryCell.origin[along]) <= width / 2;
      }) === true;
      const shardGround = grounded && cell?.instance === this.live.current() && (hit.owner !== PLATFORM_COLLIDER_OWNER || entry);
      this.road.observe(feet, traveller.yaw, grounded, recoveryCell, shardGround);
      // rt3-freeze: the 5 s autosave captures here, at the fixed boundary, and encodes / writes a stage a frame below;
      // done in one go it froze a template cell 1.0–1.6 s every ~6.2 s on the phone.
      if (++saveTicks >= 300) { saveTicks = 0; this.captureAutosave(); }
    });
    page.onInput(() => { traveller.camera.position.sub(this.applied); this.applied.set(0, 0, 0); pinFrameOffset.set(0, 0, 0); });
    scope.onDispose(() => { this.autosave?.return(false); this.autosave = null; });
    page.onUpdate(() => { // the page has one update slot (game.grid.origin): the camera offset, then one autosave stage
      // the HUD's world pins stand in the same frame: their points move with the camera (hudAdapters.ts pinFrameOffset)
      if (this.offset.lengthSq() !== 0) { traveller.camera.position.add(this.offset); this.applied.copy(this.offset); pinFrameOffset.copy(this.offset); }
      // The capture's own frame encodes nothing more: the next stage waits for the next frame's update.
      if (scope.disposed) return;
      if (this.autosaveCaptured) this.autosaveCaptured = false; else this.stepAutosave();
    });
    scope.onDispose(() => { traveller.camera.position.sub(this.applied); this.applied.set(0, 0, 0); pinFrameOffset.set(0, 0, 0); });
    scope.listen(window, 'pagehide', () => { this.checkpoint(); });
    scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') this.checkpoint(); });
    scope.onDispose(() => { this.checkpoint(); });
  }

  private installCrossing(): GridCrossingSession {
    return installGridCrossing({ current: () => this.live.current(), prepare: (from, to) => this.prepareCrossing(from, to),
      ready: (instance) => this.live.ready(instance) && (instance === null || !this.entryPending(instance)), checkpoint: (instance) => {
        if (this.wire !== null) return true; // the server's saves are the session's
        const readiness = this.page.crossingSaveReady?.(instance) ?? true;
        return readiness === true ? this.live.checkpoint(instance) : readiness;
      }, target: (feet) => this.wire === null ? this.live.target(feet) : this.wireTarget() },
    this.ports.assembly, (instance) => {
      const runtime = this.runtimeRegions.get(instance), flush = (): boolean => true;
      if (runtime === undefined) return { checkpoint: flush, stow: () => { this.keepPrograms('home-edge:cell'); stowGridMount(this.page.traveller); }, interior: () => { this.keepPrograms('home-edge:road'); } };
      // ZE2: the home edge swaps the lights, shadows and kit drawn, so three moves every material to another program key
      // and releases the old one; walking back linked it again on the edge frame (Pine 133 to 650 ms, every lap). Each side's
      // programs are pinned as the feet leave it, so the way back finds them compiled.
      const edge = (loadout: GridLoadout): GridLoadout => ({ ...loadout, stow: () => { this.keepPrograms('home-edge:cell'); loadout.stow(); },
        interior: () => { this.keepPrograms('home-edge:road'); loadout.interior(); } });
      if (this.wire !== null) return edge({ ...runtime.loadout, checkpoint: flush });
      // rt3-crossing2: a committed runtime the traveller never entered never ran its hooks and never played: it saves as
      // the stored resident. Its own checkpoint refuses until its hooks restore, so turning back on the strip after the
      // commit held the crossing in save-failed for good.
      return edge(this.startedRuntimes.has(instance) ? runtime.loadout : { ...runtime.loadout, checkpoint: flush });
    }, this.ports.scope, (from, to) => {
      if (to !== null || from === null) return;
      const leaveStart = diagnosticNow();
      gridCells.leave(); // entered callbacks must finish before their retained native world retires
      this.live.retainDeparted(from);
      this.leaveTiming.push({ instance: from, leaveMs: diagnosticNow() - leaveStart }); if (this.leaveTiming.length > 16) this.leaveTiming.shift();
      // Keep at most this complete world until a bounded return, expiry or pressure.
      // Its independently owned neighbour tiles remain with the page's distance streamer.
    });
  }

  /** Where the server has this client. A page crosses between cells over the road, as the server's own session does. */
  private wireTarget(): string | null {
    const site = this.wire?.site(), current = this.live.current();
    if (site === undefined) return current;
    return current !== null && site !== null && site !== current ? null : site;
  }

  /** J130: the server decides crossings from here on, keeps the saves and runs the worlds, so the page's own law goes quiet.
   *  Its preparation, walls and commit stay as they are (G828, G1011). */
  bindWire(wire: LiveGridWire): void {
    this.wire = wire; this.checkpointsSuppressed = true; this.autosave?.return(false); this.autosave = null;
    this.live.followServer();
    this.ports.scope.onDispose(() => { this.wire = null; });
  }

  /** QA 11-25 row 86 (c): the entered zone's authored fight (telegraphed, attackers), which the grid's own platform level
   *  lacks; null on the road or in a data cell. */
  enteredFight(): PreparedRegionalRuntime['fight'] | null {
    const instance = this.enteredRuntimeInstance();
    return instance === null ? null : this.runtimeRegions.get(instance)?.fight ?? null;
  }

  /** The entered region's creature manager, where this cell's rows are drawn; none on the road or in a data cell. */
  enteredAnimals(): ReturnType<PreparedRegionalRuntime['animals']> {
    const instance = this.enteredRuntimeInstance();
    return instance === null ? null : this.runtimeRegions.get(instance)?.animals() ?? null;
  }

  /** QA 11-23-b row 7: the creatures the minimap shows beside the page's: the entered region's in its cell's metres, or on the
   *  road the home's, each with its frame's offset from the home frame (play.ts `mapAt`); null in a data cell or with none. */
  mapCreatures(): RegionCreatures | null {
    const road = this.roadAnimals();
    if (road !== null) return { animals: road.animals.animals, dx: 0, dz: 0 };
    const instance = this.enteredRuntimeInstance();
    const animals = instance === null ? null : this.runtimeRegions.get(instance)?.animals() ?? null;
    const cell = animals === null ? undefined : this.ports.assembly.cells.find(row => row.instance === instance);
    if (animals === null || cell === undefined) return null;
    const home = this.ports.home.origin;
    return { animals: animals.animals, dx: cell.origin.x - home.x, dz: cell.origin.z - home.z };
  }

  /** MMO-PLAN MP5.2b: on the road, the home region's creature manager and the home's origin in the world's frame, where the road's rows
   *  of the home's creatures near its edge are drawn (in the home's own metres); null in a cell or with no home world. */
  /** J500 rule 3: whether a zone is drawn whole from the road, so its far proxy may go within reach. */
  groundFromRoad(instance: string): boolean { return this.roadDisplays.has(instance); }

  roadAnimals(): { readonly animals: NonNullable<ReturnType<PreparedRegionalRuntime['animals']>>; readonly origin: { readonly x: number; readonly z: number } } | null {
    if (this.live.current() !== null) return null;
    const animals = this.runtimeRegions.get(this.ports.home.instance)?.animals() ?? null;
    return animals === null ? null : { animals, origin: this.ports.home.origin };
  }

  /** The entered cell's item rows, for the slots the server knows its held items by; none on the road. */
  enteredItems(): Shardfile['items']['rows'] | null {
    const current = this.live.current();
    return current === null ? null : this.runtimeRegions.get(current)?.items ?? this.regions.get(current)?.items ?? null;
  }

  /** Refresh unentered recovery sockets after the page publishes deferred platform seams. */
  refreshPlatformEntries(): void {
    for (const cell of this.ports.assembly.cells) {
      if (this.regions.has(cell.instance) || this.runtimeRegions.has(cell.instance)) continue;
      const entryways = this.ports.strips.flatMap((strip): RoadRecoveryCell['entryways'] => {
        const duplicate = strip.duplicates.find((row) => row.instance === cell.instance), turn = strip.turnIn;
        if (duplicate === undefined || turn === undefined) return [];
        const axis = strip.id.startsWith('gap.x.') ? 'x' : 'z', positive = duplicate.mesh.origin[axis] > 0;
        const width = turn.widths[positive ? 0 : 1];
        if (width <= 0) return [];
        return [{ edge: axis === 'x' ? positive ? 'east' : 'west' : positive ? 'north' : 'south', width }];
      });
      this.respawnCells.set(cell.instance, { instance: cell.instance, origin: cell.origin, entryways });
    }
  }

  private prepareCrossing(from: string | null, to: string | null): ReturnType<LiveGridHost['prepare']> {
    // T7: only actual entry builds a region; previous whole worlds retire before another allocation.
    if (from === null && to !== null && !this.live.state().pending.includes(to)) this.live.retry(to);
    return this.live.prepare(from, to);
  }

  private checkpointHome(): boolean {
    if (this.checkpointsSuppressed) return false;
    // There is no home gameplay owner in the neutral shell. Retry the real stored local purse/bag without flushing
    // the page's inert Progress/Inventory copies over a newer owned runtime continuation.
    return this.roadWallet.flush();
  }

  /** Save the active region and retry its pending profile/local rewards before a reload or page exit. */
  checkpoint(): boolean {
    this.autosave?.return(false); this.autosave = null; // a direct save supersedes a staged one still in flight
    return finishSimSteps(this.checkpointSteps());
  }
  /** Periodic failures are local bookkeeping; direct checkpoints retain their failure policy. */
  private autosaveFault(error: unknown): void {
    if (this.reportedAutosave) return;
    this.reportedAutosave = true; emitFault({system: 'grid.autosave', error, verdict: 'retry'});
  }
  /** The fixed boundary supersedes only the old staged job. A failed cancellation
   * cannot prevent a fresh capture or claim persistence for the failed one. */
  private captureAutosave(): void {
    const previous = this.autosave; this.autosave = null;
    try {previous?.return(false);} catch (error) {this.autosaveFault(error);}
    this.autosave = this.checkpointSteps(); this.stepAutosave(); this.autosaveCaptured = true;
  }
  /** Advance one stage without allowing a failed save to abort the shared frame. */
  private stepAutosave(): void {
    const autosave = this.autosave;
    if (autosave === null) return;
    try { if (autosave.next().done === true && this.autosave === autosave) this.autosave = null; }
    catch (error) { if (this.autosave === autosave) this.autosave = null; this.autosaveFault(error); }
  }
  /** {@link checkpoint} in stages: the first `next()` captures the region; each later one may run a frame later. */
  private *checkpointSteps(): Generator<undefined, boolean> {
    if (this.checkpointsSuppressed) return false;
    const current = this.live.current();
    const durable = current === null ? this.checkpointHome() : yield* this.live.checkpointSteps(current);
    if (!durable || this.live.current() !== current) return false; // suppression cancels a staged save outright
    return this.saveLocation();
  }

  /** Where this page stands, which is the cell its next boot opens in. On a wire it's all a page saves. */
  saveLocation(): boolean {
    // SB41: the online worker's pagehide save lands after a GPU recovery is prepared; a newer stamp would stale the record
    if (this.recoveryPrepared) return false;
    // SB41: on a wire the server decides crossings, so the page can stand in a cell with no region entered (`current` null):
    // the cell under the feet is still where it stands, and the reload's owned-home entry admits it before the resume
    const current = this.live.current(), feet = this.worldFeet(), standing = this.ports.assembly.at(feet.x, feet.z);
    const cell = current !== null ? this.ports.assembly.cell(current) : standing ?? this.ports.home;
    const inside = standing?.instance === cell.instance;
    const local = this.ports.assembly.local(feet, cell);
    return gridRecovery(this.page.saves).save(this.ports.assembly, cell, this.recoveryRoad(), inside
      ? { kind: 'cell', ...local, yaw: this.page.traveller.yaw } : { kind: 'road' });
  }

  /** GO5 (DG3): the world's door names where this player stands, cell-local. On an MMO build that is the one save, and this page's
   *  `grid.last-played` is only its hint: rewritten here, so the next entry's card names the server's place. A cell this catalogue
   *  doesn't place changes nothing. */
  serverPlace(instance: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }): boolean {
    const cell = this.ports.assembly.cells.find(row => row.instance === instance);
    if (cell === undefined || this.recoveryPrepared) return false;
    const road = { x: cell.origin.x + this.ports.assembly.pitch / 2 + 3.6, z: cell.origin.z, yaw: at.yaw }, recovery = gridRecovery(this.page.saves);
    this.page.saves.define(SERVER_PLACED).write(true);
    // A stand past the cell's interior (a rim the walls hold) still names the cell: the hint keeps the cell, with the road beside it.
    try { return recovery.save(this.ports.assembly, cell, road, { kind: 'cell', x: at.x, y: at.y, z: at.z, yaw: at.yaw }); }
    catch { try { return recovery.save(this.ports.assembly, cell, road, { kind: 'road' }); } catch { return false; } }
  }

  /** The cell (instance) this page booted in. */
  get booted(): string { return this.ports.home.instance; }

  /** Last grounded road lane; before the first road visit use the admitted home's adjacent lane. */
  recoveryRoad(): RoadPoint {
    return this.road.lastRoad() ?? { x: this.ports.home.origin.x + this.ports.assembly.pitch / 2 + 3.6,
      z: this.ports.home.origin.z, yaw: this.page.traveller.yaw };
  }

  /** Recovery only, never called by crossings: failed persistence returns the graphics recovery to title. */
  prepareRecovery(reason: Exclude<GridRecoveryReason, 'new-game'>): boolean {
    if (this.ports.scope.disposed) return false;
    // SENTRY-TRIAGE S13 (WILDSHARD-GAME-8H): on a wire the server's saves are the session's and bindWire suppressed this page's
    // checkpoints, so a recovery writes where the page stands; offline the region's checkpoint (which saves the place) lands first
    if (this.wire === null ? !this.checkpoint() : !this.saveLocation()) return false;
    if (!gridRecovery(this.page.saves).write(this.ports.assembly, this.ports.home, this.recoveryRoad(), reason)) return false;
    // The intent names exactly this checkpoint; a later pagehide/timer must not replace its location or continuation.
    this.checkpointsSuppressed = true; this.recoveryPrepared = true; this.autosave?.return(false); this.autosave = null;
    return true;
  }

  /** Capture before reset; run only after success, without flushing old state into the reset save. */
  prepareNewGameRecovery(target?: LocalSaveInstance): () => void {
    // as `prepareRecovery`: on a wire `bindWire` suppressed this page's checkpoints (the server's saves are the session's), so
    // a checkpoint here always refused and New Game said "your save is unchanged" on every grid cell (meta
    // QA-FEEDBACK-2026-11-20-mini row 5); there only where the page stands is the page's to save
    if (this.wire === null ? !this.checkpoint() : !this.saveLocation()) throw new Error('New game requires a durable current checkpoint');
    const road = this.recoveryRoad();
    const current = this.live.current();
    const home = current === null ? this.ports.home : this.ports.assembly.cell(current);
    const recovery = gridRecovery(this.page.saves);
    if (!recovery.prepareReset(this.ports.assembly, home, road, target ?? { id: home.instance, shard: home.slug })) throw new Error('New game recovery road is not durable');
    return () => {
      this.checkpointsSuppressed = true; this.autosave?.return(false); this.autosave = null;
      recovery.completeReset(this.ports.assembly);
    };
  }

  /** Ordinary admitted boot then a prepared highway transfer, with progress read from real instance saves. */
  resumeRoad(road: RoadPoint): void {
    if (!onRoad(this.ports.assembly, road.x, road.z) || ![road.x, road.z, road.yaw].every(Number.isFinite)) throw new Error('Invalid recovery road');
    if (this.live.current() !== null) throw new Error('Road recovery requires the neutral road');
    this.page.traveller.position.set(road.x, 0.5, road.z);
    this.road.observe({ x: road.x, y: 0, z: road.z }, road.yaw, true);
  }

  /** G580 T2: a retiring cell's compiled programs, kept for the next (Developer row). The keeper and its conservative
   *  residency charge are made at the first retirement, once the page renderer exists; refused, nothing is kept. */
  private keepPrograms(instance: string): void {
    if (this.ports.scope.disposed) return;
    if (this.keeper === null) {
      const game = this.page.runtimePage?.()?.world.game;
      if (game === undefined) return;
      const claim = this.ports.allocator.reserve({ id: 'page:kept-programs', category: 'page', owner: 'platform',
        bytes: RETAINED_PROGRAM_LIMIT * RETAINED_PROGRAM_BYTES, distance: 0, needed: true });
      if (claim === null) return;
      const owner = this.ports.scope.child('grid.kept-programs'); owner.onDispose(() => { claim.release(); });
      this.keeper = createProgramKeeper(game.renderer, owner, game.camera, game.rootScene);
    }
    this.keeper.keep(instance);
  }

  /** Initial staging only: admit the owned home after the page play host exists and before its first fixed tick. */
  async enterInitialHome(): Promise<void> {
    if (this.live.current() !== null) throw new Error('Owned home must start on the neutral road');
    const cell = this.ports.home, manifest = findShard(cell.slug);
    if (manifest === undefined) throw new Error('Initial owned home is absent from its catalogue');
    const spawn = manifest.spawn, feet = this.ports.assembly.world({ x: spawn.x, y: spawn.y ?? 0, z: spawn.z }, cell);
    if (this.ports.assembly.at(feet.x, feet.z)?.instance !== cell.instance) throw new Error('Initial spawn is outside its owned cell');
    const prepared = await this.prepareCrossing(null, cell.instance);
    try {
      if (this.ports.scope.disposed) throw new Error('Owned home boot disposed');
      this.page.traveller.position.set(feet.x, feet.y, feet.z);
      prepared.commit();
    } catch (error) { prepared.cancel(); throw error; }
    this.crossing.crossing.dispose(); this.crossing = this.installCrossing();
    this.startedRuntimes.add(cell.instance);
    gridCells.enter({ instance: cell.instance, slug: cell.slug });
    // T7 (Tile residency): a shard's owned home is its bodyless region, entered as a crossing enters it; no hooks run
    const region = this.runtimeRegions.has(cell.instance) ? undefined : this.regions.get(cell.instance);
    if (region !== undefined) {
      const at = this.page.traveller.position;
      this.page.traveller.position.y = this.spawnHeight(region.queries, at, spawn);
      return;
    }
    if (await this.activation !== true || !this.gameplayReady()) throw new Error('Initial owned home gameplay is not ready');
    const runtime = this.runtimeRegions.get(cell.instance);
    if (runtime === undefined) throw new Error('Initial owned runtime is missing');
    const regional = runtime.resident.runtime.world;
    if (regional !== null) {
      const colliders = regional.physics.scopedCensus(runtime.resident.scope).colliders;
      loadingUnits('Home region', 1)(1, `${cell.slug} · Physics ${colliders} colliders · Trees ${regional.forest.trees.length} forest records`);
    }
    // Source spawn height may be terrain-derived; query only after its entered world services finish installing. A spawn
    // with no height stands on the highest surface there, a deck included: terrain alone put Driftwood's pier spawn under
    // its deck at water level (E463).
    const at = this.page.traveller.position;
    this.page.traveller.position.y = this.spawnHeight(runtime.queries, at, spawn);
    runtime.loadout.interior();
  }

  /** Normal boot admits the saved instance and its continuation before applying its durable local pose. */
  resumeRecovery(record: NonNullable<GridRecoveryRecord>): { x: number; y: number; z: number; yaw: number; road: boolean } {
    if (record.instance !== this.ports.home.instance || ![record.slug].includes(this.ports.home.slug)) throw new Error('Recovery instance was not admitted');
    const saved = record.saved;
    if (saved?.location.kind !== 'cell') {
      this.resumeRoad(record.road);
      return { ...record.road, y: 0.5, road: true };
    }
    if (saved.instance !== record.instance || ![saved.slug].includes(record.slug) || this.live.current() !== record.instance) throw new Error('Recovery continuation does not match the active instance');
    const { x, y, z, yaw } = saved.location;
    const world = this.ports.assembly.world(saved.location, this.ports.home);
    if (this.ports.assembly.at(world.x, world.z)?.instance !== record.instance) throw new Error('Recovery pose is outside the admitted cell');
    this.page.traveller.position.set(x, y, z);
    this.runtimeRegions.get(record.instance)?.loadout.interior();
    return { x, y, z, yaw, road: false };
  }

  /** The traveller's world feet (grid metres), whatever frame it is in. */
  worldFeet(): { x: number; y: number; z: number } { return this.live.worldFeet(); }
  /** Retry a refused source save without reloading the prepared destination; retreat also cancels the hold safely. */
  retrySave(): void { this.crossing.crossing.retrySave(); }
  /** Original latest admission failure for classified UI; retry clears it before another generation begins. */
  refusal(instance: string): unknown { return this.live.refusal(instance); }

  private bundle(cell: GridCell): ReadinessBundle {
    const manifest = findShard(cell.slug);
    if (manifest !== undefined && runtimePagePointer(manifest) !== undefined && manifest.clientPlanRuntime === true) return { criticalWireBytes: 2_000_000, runtimePageWireBytes: 2_000_000, decodeSeconds: 1, runtimeParseSeconds: 1 };
    return { criticalWireBytes: findShard(cell.slug)?.shardfile === undefined ? 0 : 2_000_000, runtimePageWireBytes: 0, decodeSeconds: 1, runtimeParseSeconds: 0 };
  }

  /** Shardfile cells admit a bodyless regional host with their strip duplicates; every other cell waits for M3. */
  private admit(cell: GridCell, required = false): Promise<LiveGridAdmission> {
    const choice: RegionalPreparationChoice = {};
    return preparationAdmission(() => this.prepareAdmission(cell, choice, true, required), () => this.prepareAdmission(cell, choice, false));
  }

  private prepareAdmission(cell: GridCell, choice: RegionalPreparationChoice, metadata: true, required?: boolean): Promise<GridAdmissionMetadata>;
  private prepareAdmission(cell: GridCell, choice: RegionalPreparationChoice, metadata: false): Promise<LiveGridAdmission>;
  private async prepareAdmission(cell: GridCell, choice: RegionalPreparationChoice, metadata: boolean, required = true): Promise<GridAdmissionMetadata | LiveGridAdmission> {
    if (!metadata) await this.ports.prepareStrips?.(cell);
    if (this.ports.scope.disposed || this.ports.scope.disposing) throw new Error('Grid admission scope disposed');
    const folderOwner = { allocator: this.ports.allocator, scope: this.ports.scope };
    const pending = metadata ? gridShardfileFolder(cell.slug, folderOwner, required ? 'metadata' : 'optional-metadata') : gridShardfileFolder(cell.slug, folderOwner);
    if (pending === null) throw new GridCellWaitingError(`${cell.slug} is not a shardfile shard (it stays a far proxy until M3)`);
    const product = await pending;
    const retained = metadata ? { ...product, release: () => undefined } : product;
    const finish = <T extends GridAdmissionMetadata>(admission: T): T => {
      // Keep the original source/JSON metadata claim page-owned. Metadata has
      // no binary input borrow to cancel when speculative prefetch finishes.
      if (metadata) this.ports.scope.onDispose(product.release);
      return admission;
    };
    const { source, assets } = retained.admitted;
    try {
    // SF59: the original metadata admission owns the adjacent post-stack check.
    // Rehydration verifies input bytes without moving that policy check to each visit.
    if (metadata) {
      const costs = gridPostCosts(this.ports.allocator), own = folderPostCost(source, (hash) => assets.get(hash));
      const pair = gridPostPairRefusal(this.ports.assembly, cell, own, (slug) => costs.get(slug));
      if (pair !== null) throw new Error(pair);
    }
    if (source.runtime !== null || hasDeclaredClientPage(source)) {
      return finish(await (metadata ? this.admitRuntime(cell, retained, choice, true) : this.admitRuntime(cell, retained, choice, false)));
    }
    const bytes = regionalDataCellBytes(cell.slug, source, findShard(cell.slug));
    if (metadata) return finish({ bytes, isolatedPreparation: true, tilePreparation: source.tiles.some(tile => tile.lod === 0), cancel: retained.release });
    const groundResolution = source.edge.north.heights.length === 256 ? 256 : 257;
    // G220 pass 2: a shared product's copy collides with its own landmarks (copyLayout.ts); every other cell gets its source unchanged
    const copySource = withCopyLayout(source, cell.identity);
    const rapier = this.ports.physics.R, duplicates = this.ports.strips.flatMap((strip) => strip.duplicates.filter((row) => row.instance === cell.instance).map((row) => row.mesh));
    const build = (): LiveGridRegion & { readonly shell: RegionShell } => {
      const { shell, water, heightAt, colliders } = dataCellWorld(copySource, assets, rapier, groundResolution);
      try {
        for (const mesh of duplicates) installStripCollider(shell.physics, mesh, shell.scope);
        // Admission proves real, clear, dry ground first. A 5mm backstop avoids coplanar ghost contacts.
        installEntrySockets(shell.physics, shell.scope, [{ x: 0, z: 0 }], 'backstop');
        installGridBorders(shell.physics, shell.scope);
        // TC-E5b: its lift and doors stand on this page, posed off the wire once the feet are in it
        let cellFolder: ReturnType<typeof shardFolderFromAdmission> | undefined;
        const folder = (): ReturnType<typeof shardFolderFromAdmission> => (cellFolder ??= shardFolderFromAdmission(retained.admitted, shell.scope));
        // MSZ15: its vehicles sound from its own recordings, read through the cell's product
        const movers = installDataCellMovers(copySource, shell, cell.instance, vehicleSoundPort(copySource.audio, recordingReader(copySource.audio, hash => folderClosureFile(folder(), hash))));
        if (movers !== null) { this.dataMovers.set(cell.instance, movers); if (gridCells.cell?.instance === cell.instance) movers.claim(); }
        // SS9c: its touchable crates stand on this page where the server has them, once the feet are in it
        const touch = installDataCellBodies(copySource, shell, cell.instance);
        if (touch !== null) { this.dataBodies.set(cell.instance, touch); if (gridCells.cell?.instance === cell.instance) touch.claim(); }
        const transfer = regionTransferWalls(shell, this.page.traveller.motor.opts.radius), start = shell.level.player;
        const completionRows = cellCompletionRows(folder()), lootRow = cellLootRow(copySource);
        shell.physics.step();
        transfer.sync(); this.transferWalls.set(cell.instance, transfer);
        this.regions.set(cell.instance, { spawn: { x: start.at.x, y: undefined, z: start.at.z, yaw: start.yaw },
          // the admitted terrain inside the cell (one source of truth); its strips are road level (the terrain tile ends at the cell edge)
          queries: { heightAt: (x, z) => (Math.max(Math.abs(x), Math.abs(z)) <= CHUNK_HALF ? heightAt(x, z) : 0), waterSurfaceAt: (x, z) => water.restAt(x, z), platforms: [] }, colliders, items: copySource.items.rows, prompts: [...copyPrompts(copySource, copySpent(copySource)), ...cellRidePrompts(movers)], kit: holdsItems(copySource) ? { source: copySource, assets, product: folder } : null, play: PLAY_INSTALLS.some(entry => entry.wants(copySource)) ? copySource : null, quests: hasQuests(copySource) ? copySource : null, facts: hasLedger(copySource) ? copySource : null, hud: hasDeclaredHud(copySource) ? copySource : null,
          // AU20: the cell's declared audio scene, bound only while the feet stand in it (no entered hooks run here)
          audio: source.runtime === null && source.audio.scene !== undefined ? plotAudioScene(source, ((plot) => plot.has('client/plan') ? plot.section('client/plan') : undefined)(folder())) : null,
          completion: completionRows === null ? null : { source: copySource, rows: completionRows }, declaredAudio: cellDeclaredAudio(copySource), plumbing: hasPlumbing(copySource) ? copySource : null,
          loot: lootRow === null ? null : { source: copySource, row: lootRow, folder: folder() },
          compendium: hasCompendium(copySource) ? { source: copySource, assets, folder: folder() } : null,
          plan: dataCellPlanRows(folder()).length > 0 ? { folder } : null });
        this.respawnCells.set(cell.instance, { instance: cell.instance, origin: cell.origin, entryways: source.entryways });
        // TC-E1b: feet that entered before this admission finished get the cell's kit now
        if (gridCells.cell?.instance === cell.instance && this.dataKit === null) this.enterDataKit(cell.instance);
        if (gridCells.cell?.instance === cell.instance && !this.inDataStay(cell.instance)) this.enterDataPlay(cell.instance);
        // G321: its own sky inside its cell (its data look's dome and light), laid while it is resident
        {
          const request = { instance: cell.instance, slug: cell.slug, look: copySource.look, assets, page: this.page.runtimePage?.() ?? null, allocator: this.ports.allocator, scope: shell.scope };
          void (async (): Promise<void> => {
            try { await hangCellDataSky(request); } catch (error) { console.warn(`[region sky] ${cell.instance}`, error); }
          })();
        }
        // QA 11-24 row 69: its declared post look (Nine's rain, ink lines and live light) runs in its cell, as on its own page
        {
          const request = { instance: cell.instance, slug: cell.slug, source: copySource, folder, root: this.ports.cellRoot?.(cell.instance), page: this.page.runtimePage?.() ?? null, scope: shell.scope };
          void (async (): Promise<void> => {
            try { await hangCellDataPost(request); } catch (error) { console.warn(`[region post] ${cell.instance}`, error); }
          })();
        }
        const unlist = (): void => { if (this.plotAudio?.instance === cell.instance) this.leavePlotAudio(); if (this.dataKit?.instance === cell.instance) this.leaveDataKit(); this.leaveDataStays(cell.instance); this.plotBanks.delete(cell.instance); this.regions.delete(cell.instance); this.dataMovers.delete(cell.instance); this.dataBodies.delete(cell.instance); this.transferWalls.delete(cell.instance); };
        return { host: shell, shell, dispose: () => {
          unlist();
          try { shell.dispose(); } finally { retained.release(); }
        // T7 (the leave freeze: leaving template-2 drew 0.4-0.7 s frames): a crossing retires the data region in steps (O20)
        }, *retire(): Generator<DisposeStep, void> {
          unlist();
          try { yield* shell.disposeSteps(); } finally { retained.release(); }
        } };
      } catch (error) { shell.dispose(); throw error; }
    };
    return finish({ bytes, isolatedPreparation: true, cancel: retained.release, create: async () => {
      const region = build();
      try {
        const feet = this.live.worldFeet();
        const inside = (offset: number): number => Math.max(-CHUNK_HALF, Math.min(CHUNK_HALF, offset));
        await this.ports.prepareDataTiles?.(cell, region.shell.scope, { x: inside(feet.x - cell.origin.x), z: inside(feet.z - cell.origin.z) });
        return region;
      } catch (error) {
        try { region.dispose(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Data entry and cleanup failed', { cause: cleanup }); }
        throw error;
      }
    } });
    } catch (error) { try { retained.release(); } finally { product.release(); } throw error; }
  }

  private admitRuntime(cell: GridCell, retained: GridFolderMetadata, choice: RegionalPreparationChoice, metadata: true): Promise<GridAdmissionMetadata>;
  private admitRuntime(cell: GridCell, retained: GridFolderMetadata, choice: RegionalPreparationChoice, metadata: false): Promise<LiveGridAdmission>;
  private async admitRuntime(cell: GridCell, retained: GridFolderMetadata, choice: RegionalPreparationChoice, metadata: boolean): Promise<GridAdmissionMetadata | LiveGridAdmission> {
    const manifest = findShard(cell.slug), declaration = retained.admitted.source.runtime;
    const dataPage = hasDeclaredClientPage(retained.admitted.source);
    if (manifest === undefined || !dataPage && declaration === null) throw new GridCellWaitingError('Missing declared regional page owner');
    const page = this.page.runtimePage?.();
    if (page === undefined || page === null) throw new GridCellWaitingError('Regional page services are not ready');
    // PZ22 (WILDSHARD-GAME-8G): Auto picks KTX2 only for a shard whose table is registered (DL17), so the table goes in
    // before the one texture choice is made; resolved first, Driftwood read "no KTX2 set" and drew images on an iPhone.
    if (choice.textures === undefined) await registerRegionalTextureTable(manifest);
    const textures = choice.textures ??= resolveRegionalRuntimeTextures(manifest, this.ports.allocator.cost().input), bytes = regionalRuntimeAccountedBytes(retained.admitted, manifest, textures.mode);
    const prepareEntry = async (): Promise<void> => {
      if (declaration === null) return;
      if (manifest.clientPlanRuntime !== true) throw new GridCellWaitingError('Client-plan runtime requires its built-in manifest policy');
      if (manifest.load === undefined) throw new GridCellWaitingError('Missing compiled built-in loader');
      // The built-in loader still owns its literal CSS imports. Prepare them
      // before entered features; importing it constructs no world or plugin.
      await manifest.load();
    };
    // Metadata may expose render-only approach capability while its importer
    // runs. LiveGridHost still awaits prepareRuntime before publishing product
    // readiness; fresh construction always imports before creating its owner.
    if (!metadata) await prepareEntry();
    // Only admitted declarative/client-plan worlds supply reversible construction bindings. The live host
    // also requires the strict page/owner projection and serializes every constructor through its cleanup.
    const isolatedPreparation = dataPage || manifest.clientPlanRuntime === true;
    if (metadata) return { bytes, exclusiveRuntime: true, isolatedPreparation, tilePreparation: retained.admitted.source.tiles.some(tile => tile.lod === 0), cancel: retained.release, prepareRuntime: prepareEntry };
    let closed = false;
    const release = (): void => { if (closed) return; closed = true; retained.release(); };
    return { bytes, exclusiveRuntime: true, isolatedPreparation, cancel: release, prepareRuntime: prepareEntry, create: async (claim, signal) => {
      const factory = createRegionalRuntimeFactory({ home: this.ports.home.origin,
        prepareFoundation: createRegionalWorldFoundation({ rapier: this.ports.physics.R, ...(this.ports.tiles === undefined ? {} : { tiles: this.ports.tiles }), navmesh: level => loadNavmesh(level.id, level.bakedId ?? level.id, level.navigation), pause: () => yieldGridConstruction(this.runtimeScope),
          install: host => {
            for (const strip of this.ports.strips) for (const row of strip.duplicates) if (row.instance === cell.instance) installStripCollider(host.physics, row.mesh, host.scope);
            installEntrySockets(host.physics, host.scope, [{ x: 0, z: 0 }], 'backstop');
            installGridBorders(host.physics, host.scope);
            this.transferWalls.set(cell.instance, regionTransferWalls(host, this.page.traveller.motor.opts.radius));
          }, checkpoint: () => true,
        }),
      });
      let prepared: PreparedRegionalRuntime;
      try {
        if (cell.instance === this.ports.home.instance) bindHomeBuildCache(retained.admitted.source);
        const feet = this.live.worldFeet();
        // A world built from the road (GC36) takes its entry at the cell's edge, the nearest point the feet will arrive at
        const inside = (offset: number): number => Math.max(-CHUNK_HALF, Math.min(CHUNK_HALF, offset));
        const entryPoint = { x: inside(feet.x - cell.origin.x), z: inside(feet.z - cell.origin.z) };
        prepared = await factory({ cell, admitted: retained.admitted, manifest, page, textures, allocator: this.ports.allocator, claim, scope: this.runtimeScope, entryPoint });
      }
      catch (error) { this.transferWalls.delete(cell.instance); throw error; }
      this.runtimeRegions.set(cell.instance, prepared); this.runtimeResidents.set(cell.instance, prepared.resident);
      this.respawnCells.set(cell.instance, { instance: cell.instance, origin: cell.origin, entryways: retained.admitted.source.entryways });
      try {
        await this.runtimePage.prepare(cell.instance);
        if (this.runtimePage.state().instance === null) { if (!await this.runtimePage.prepareEntry(cell.instance, signal)) throw new Error('Admitted entry preparation left its requested cell'); }
        else this.deferredEntries.set(cell.instance, { prepared, signal });
        prepared.park?.(); // Only actual entry demand reaches here; keep its frame hidden until commit.
      }
      catch (error) {
        this.runtimeRegions.delete(cell.instance); this.runtimeResidents.delete(cell.instance); this.transferWalls.delete(cell.instance);
        await disposeInSteps(prepared.region);
        throw error;
      }
      let disposalFailure: Error | undefined;
      // Forget this visit once its world is gone, by either path (a newer preparation of the same cell keeps its own rows).
      // The stepped retirement used to bypass this, so each visited cell kept its last retired runtime (O18, sp-o4).
      let forgotten = false;
      const forget = (): void => {
        if (forgotten) return;
        forgotten = true;
        if (this.deferredEntries.get(cell.instance)?.prepared === prepared) this.deferredEntries.delete(cell.instance);
        if (this.runtimeRegions.get(cell.instance) === prepared) {
          this.startedRuntimes.delete(cell.instance);
          this.runtimeRegions.delete(cell.instance); this.runtimeResidents.delete(cell.instance); this.transferWalls.delete(cell.instance);
        }
        release();
      };
      const retireSteps = prepared.region.retire;
      return { ...prepared.region, checkpoint: () => !this.startedRuntimes.has(cell.instance) ? true
        : this.runtimePage.state().instance === cell.instance && !this.runtimePage.state().ready ? false : prepared.checkpoint(), dispose: () => {
        if (disposalFailure !== undefined) throw disposalFailure;
        try { prepared.region.dispose(); }
        catch (error) { disposalFailure = error instanceof Error ? error : new Error(String(error)); throw disposalFailure; }
        forget();
      }, ...(retireSteps === undefined ? {} : { *retire(): ReturnType<typeof retireSteps> { yield* retireSteps(); forget(); } }) };
    } };
  }

  /** AU20: the feet entered a data cell; bind its declared audio scene to the page's mixer until they leave. */
  private enterPlotAudio(instance: string): void {
    this.leavePlotAudio();
    const scene = this.regions.get(instance)?.audio ?? null, page = this.page.runtimePage?.() ?? null;
    if (scene === null || page === null) return;
    const own = pagePlotAudioPorts(page.context.app, page.world.player, instance);
    if (own === null) return;
    // one bank read per resident cell: dropped with the region (unlist), so a re-entry lends the bank it already decoded
    const ports: PlotAudioPorts = { ...own, bank: (data) => {
      let read = this.plotBanks.get(instance);
      if (read === undefined) { read = own.bank(data); this.plotBanks.set(instance, read); void read.catch(() => { if (this.plotBanks.get(instance) === read) this.plotBanks.delete(instance); }); }
      return read;
    } };
    const owner = this.ports.scope.child(`grid.plot-audio.${instance}`);
    this.plotAudio = { instance, scope: owner };
    try { enterPlotAudio(scene, owner, ports); }
    catch (error) { this.leavePlotAudio(); ports.fault(error); }
  }
  /** TC-E1b: the feet entered a data cell; its declared items are the page's held kit until they leave. */
  private enterDataKit(instance: string): void {
    this.leaveDataKit();
    const kit = this.regions.get(instance)?.kit ?? null, page = this.page.runtimePage?.() ?? null;
    if (kit === null || page === null) return;
    const entry = this.ports.scope.child(`grid.data-kit.${instance}`);
    this.dataKit = { instance, scope: entry, runtimes: null };
    const enter = async (): Promise<void> => {
      try { await enterDataCellKit(kit.source, kit.assets, page, entry, () => this.wire === null || this.wire.site() === instance,
        (runtimes) => { if (this.dataKit?.scope === entry) this.dataKit.runtimes = runtimes; }, kit.product); } catch (error: unknown) {
        if (this.dataKit?.scope === entry) this.leaveDataKit();
        console.error(`[grid] ${instance}'s declared kit refused`, error);
      }
    };
    void enter();
  }
  /** SS-GP1 on: the feet entered a data cell; its quests, ledger facts and declared HUD install until they leave. */
  private enterDataPlay(instance: string): void {
    const region = this.regions.get(instance), page = this.page.runtimePage?.() ?? null;
    if (region === undefined || page === null) return;
    const { quests, facts, hud, completion, declaredAudio, plumbing, loot, compendium, play } = region;
    // SS-GP7: the one install list's entries (races, talks, rides, held-tool lines), on the cell's side of it
    if (play !== null) this.enterDataStay('play', instance, async (stay, here) => { await enterDataCellPlay(play, page, stay, instance, here,
      { prompts: region.prompts, movers: this.dataMovers.get(instance)?.movers ?? null, items: () => (this.dataKit?.instance === instance ? this.dataKit.runtimes : null) }); });
    if (quests !== null) this.enterDataStay('quests', instance, (stay, here) => enterDataCellQuests(quests, page, stay, instance, here));
    if (facts !== null) this.enterDataStay('facts', instance, (stay, here) => { enterDataCellFacts(facts, { saves: this.page.saves, catalogue: this.page.catalogue, progress: () => page.play.progress }, stay, instance, here); });
    if (hud !== null) this.enterDataStay('hud', instance, (stay, here) => { enterDataCellHud(hud, page, stay, instance, here); });
    if (completion !== null) this.enterDataStay('completion', instance, (stay, here) => { enterDataCellCompletion(completion.source, completion.rows, page, stay, instance, here); });
    if (declaredAudio !== null) this.enterDataStay('audio', instance, (stay, here) => { enterDataCellAudio(declaredAudio, page, stay, here, play?.quests.races); });
    if (plumbing !== null) this.enterDataStay('plumbing', instance, (stay, here) => { enterDataCellPlumbing(plumbing, page, stay, instance, here); });
    if (loot !== null) this.enterDataStay('loot', instance, async (stay) => { await enterDataCellLoot(loot.source, loot.row, loot.folder, page, stay, instance); });
    // OF22e2, OF22n: the client plan features a data cell's own installs do not cover (Nine's city, sets, movers' views, portal
    // veil). The scene keeps the home's frame (C39): the home draws in the page context's frame, a road entry at its offset
    if (region.plan !== null) {
      const { folder } = region.plan, frame = dataCellPlanFrame(this.ports.assembly.cell(instance), this.ports.home);
      if (DATA_CELL_PLAN_ENTRIES.has(frame === null ? 'home' : 'road')) this.enterDataStay('plan', instance, async (stay) => { await enterDataCellPlan(folder(), page, stay, frame); });
    }
    if (compendium !== null) this.enterDataStay('compendium', instance, async (stay) => { await enterDataCellCompendium(compendium.source, compendium.assets, compendium.folder, page, stay, instance); });
  }
  /** One play install of the entered cell, by kind: its stay scope ends when the feet leave. `here` says whether the wire is this cell's. */
  private enterDataStay(kind: string, instance: string, install: (stay: Scope, here: () => boolean) => Promise<void> | void): void {
    this.leaveDataStay(kind);
    const stay = this.ports.scope.child(`grid.data-${kind}.${instance}`);
    this.dataStays.set(kind, { instance, scope: stay });
    const enter = async (): Promise<void> => {
      try { await install(stay, () => this.wire === null || this.wire.site() === instance); } catch (error: unknown) {
        if (this.dataStays.get(kind)?.scope === stay) this.leaveDataStay(kind);
        console.error(`[grid] ${instance}'s declared ${kind} refused`, error);
      }
    };
    void enter();
  }
  private inDataStay(instance: string): boolean { return [...this.dataStays.values()].some(entered => entered.instance === instance); }
  private leaveDataStay(kind: string): void {
    const entered = this.dataStays.get(kind); this.dataStays.delete(kind);
    entered?.scope.dispose();
  }
  /** Every play install, or only `instance`'s. */
  private leaveDataStays(instance?: string): void {
    for (const [kind, entered] of this.dataStays) if (instance === undefined || entered.instance === instance) this.leaveDataStay(kind);
  }
  private leaveDataKit(): void {
    const entered = this.dataKit; this.dataKit = null;
    entered?.scope.dispose();
  }
  private leavePlotAudio(): void {
    const entered = this.plotAudio; this.plotAudio = null;
    entered?.scope.dispose();
  }

  /** Live scalar warm-up progress for this destination, never the last trace of a different region. */
  warmPreparation(instance: string): NonNullable<PreparedRegionalRuntime['warmPreparation']> | null {
    return this.runtimeRegions.get(instance)?.warmPreparation ?? null;
  }
  /** The entered cell its resident regional runtime draws (the home's built world on arrival), else null. */
  runtimeDrawnCell(): string | null {
    const current = this.live.current();
    return current !== null && this.runtimeRegions.has(current) ? current : null;
  }
  /** GC6 (QA 11-14 row 6): a world built ahead whose entry still prepares (deferred inside the source, or running on the
   *  road). Inside the cell its gameplay gate (`frameReady`) stops the page's frames, and that preparation's warm-up waits on
   *  drawn frames: the traveller stood in the cell with no control for good. Its crossing holds on the road instead. */
  entryPending(instance: string): boolean { return this.deferredEntries.has(instance) || this.queuedEntries.has(instance) || this.runtimePage.preparing().includes(instance); }
  /** GC6: whether any world built ahead still prepares its entry (the road then builds with the urgent budget) */
  entriesPending(): boolean { return this.deferredEntries.size > 0 || this.queuedEntries.size > 0 || this.runtimePage.preparing().length > 0; }
  /** GC6: entries taken from `deferredEntries` and waiting their turn behind another's preparation (`prepareInTurn`) */
  private readonly queuedEntries = new Set<string>();
  /** GC9: once the source is left (the runtime session is neutral), each world pre-warmed inside it prepares its entry, so the
   *  crossing finds it ready; a crossing that arrives first holds on the road until it is (`entryPending`, GC6). */
  private prepareDeferredEntries(): void {
    // one at a time, nearest first: an entry preparation binds the page's one construction environment
    const feet = this.live.worldFeet(), gap = (instance: string): number => {
      const origin = this.ports.assembly.cell(instance).origin; return Math.hypot(origin.x - feet.x, origin.z - feet.z);
    };
    const rows = [...this.deferredEntries].sort(([a], [b]) => gap(a) - gap(b));
    this.deferredEntries.clear();
    for (const [instance] of rows) this.queuedEntries.add(instance);
    this.deferredPreparation = this.prepareInTurn(this.deferredPreparation, rows);
  }
  private async prepareInTurn(previous: Promise<void>, rows: readonly (readonly [string, { readonly prepared: PreparedRegionalRuntime; readonly signal: AbortSignal | undefined }])[]): Promise<void> {
    await previous;
    for (const [instance, row] of rows) await this.prepareEntryOnRoad(instance, row);
  }
  private deferredPreparation: Promise<void> = Promise.resolve();
  private async prepareEntryOnRoad(instance: string, row: { readonly prepared: PreparedRegionalRuntime; readonly signal: AbortSignal | undefined }): Promise<void> {
    const live = (): boolean => this.runtimeRegions.get(instance) === row.prepared && row.signal?.aborted !== true;
    // prepareEntry registers its installation synchronously, so the entry stays pending across this hand-over
    this.queuedEntries.delete(instance);
    const entered = (): boolean => this.runtimePage.state().instance === instance;
    if (!live() || this.runtimePage.state().instance !== null) { if (live() && !entered()) this.deferredEntries.set(instance, row); return; }
    let prepared = false;
    try { prepared = await this.runtimePage.prepareEntry(instance, row.signal); }
    catch (error) { console.warn(`[grid] ${instance}: entry preparation on the road`, error); }
    // a turn back into the source meanwhile (its entry made the session active) waits for the next leave
    if (!prepared && live() && this.runtimePage.state().instance !== null && !entered()) this.deferredEntries.set(instance, row);
  }
  /** G555: the entered runtime hooks' timings (the one running and those finished), for the cell loading screen. */
  hookTimings(): ReturnType<RuntimePageSession['timings']> { return this.runtimePage.timings(); }
  /** GC6: the entered runtime, whether its hooks finished, the hook running, the last finished, and the entries preparing */
  runtimePageState(): { readonly instance: string | null; readonly ready: boolean; readonly hook: string | null; readonly last: string | null; readonly preparing: readonly string[]; readonly deferred: readonly string[]; readonly warm: readonly string[] } {
    const state = this.runtimePage.state(), timings = this.runtimePage.timings(), last = timings.completed.at(-1);
    return { ...state, hook: timings.current === null ? null : `${timings.current.instance}:${timings.current.hook}`,
      last: last === undefined ? null : `${last.instance}:${last.hook}:${last.outcome}`, preparing: this.runtimePage.preparing(), deferred: [...this.deferredEntries.keys()],
      warm: this.runtimePage.preparing().map(id => { const w = this.warmPreparation(id); return w === null ? `${id}:-` : `${id}:${w.phase}:${w.completed ? 'done' : w.progress?.detail ?? ''}`; }) };
  }
  /** GC2: the server still has this client in `instance` (an online cell is still walled, C5). */
  serverHolds(instance: string): boolean { return this.wire !== null && this.wire.site() === instance; }

  /** The frame gate (`play.ts`). Feet back in the current cell's interior with its hooks never entered (an online rim, a
   *  correction landing between fixed steps) would shut the gate on hooks only an entry starts, and the fixed step that
   *  enters never runs behind a shut gate: enter here (GC2). */
  frameReady(): boolean {
    const current = this.live.current(), feet = this.live.worldFeet(), cell = this.ports.assembly.at(feet.x, feet.z);
    if (cell !== undefined && gateEnters(current, cell.instance, gridCells.cell?.instance ?? null, current !== null && this.runtimeRegions.has(current))) gridCells.enter({ instance: cell.instance, slug: cell.slug });
    return this.gameplayReady();
  }

  /** Admission opens the strip first; hooks freeze gameplay only after the committed traveller reaches the interior. */
  gameplayReady(): boolean {
    const current = this.live.current();
    if (current === null || !this.runtimeRegions.has(current)) return true;
    const feet = this.live.worldFeet();
    if (this.ports.assembly.at(feet.x, feet.z)?.instance !== current) return true;
    const state = this.runtimePage.state(); return state.instance === current && state.ready;
  }

  /** Actual regional aim bodies only after entered hooks complete; parked neighbours and the road supply none. */
  aimAnimals(): ReturnType<PreparedRegionalRuntime['aimAnimals']> {
    const state = this.runtimePage.state();
    if (!state.ready || state.instance === null || this.live.current() !== state.instance) return [];
    const feet = this.live.worldFeet();
    if (this.ports.assembly.at(feet.x, feet.z)?.instance !== state.instance) return [];
    return this.runtimeRegions.get(state.instance)?.aimAnimals() ?? [];
  }

  /** grid-interact: the entered runtime's own prompts, only after its hooks complete and while the feet stand in its cell
   *  (`enteredRuntime`); in an entered template copy, its declared interactions on its own lane (template-prompts,
   *  `copyPrompts.ts`); none on the road or mid-crossing. They are frame-local: pick them with `pickPrompt`. */
  interactables(): ReturnType<PreparedRegionalRuntime['interactables']> {
    const instance = this.enteredRuntimeInstance();
    if (instance !== null) return this.runtimeRegions.get(instance)?.interactables() ?? [];
    const feet = this.live.worldFeet(), copy = enteredCopy({ current: this.live.current(), feetCell: this.ports.assembly.at(feet.x, feet.z)?.instance }, (id) => this.regions.has(id));
    return copy === null ? [] : this.regions.get(copy)?.prompts ?? [];
  }
  /** The page prompt in the active frame: `list` (the home's or `interactables()`) against the camera less the render
   *  origin applied this frame (C39), with the active frame's physics. */
  pickPrompt<T extends ReturnType<PreparedRegionalRuntime['interactables']>[number]>(list: readonly T[], camera: Readonly<Vector3>, physics: Physics | null): T | undefined {
    return pickInFrame(list, camera, this.applied, physics, this.eye);
  }
  private readonly eye = new Vector3();
  private enteredRuntimeInstance(): string | null {
    const feet = this.live.worldFeet();
    return enteredRuntime({ runtimePage: this.runtimePage.state(), current: this.live.current(), feetCell: this.ports.assembly.at(feet.x, feet.z)?.instance });
  }

  /** The fixed-boundary rebind: the page's stepped world, the player's motor and the render origin. */
  /**
   * J500 rules 1 and 2 (QA 11-23-b row 17): on the road, every ready resident runtime world (the zone just left, the one
   * built ahead) is drawn from outside its cell in place of its far and near placeholders. Inside a cell none is; the entered
   * one keeps its road display until its entry is ready, so the walk in never shows a frame without it.
   */
  private syncRoadDisplays(): void {
    const current = this.live.current(), entered = this.runtimePage.state();
    const drawn = this.live.drawnFromRoad();
    // a tile-ground zone's pinned ground goes with its road display (an entered one holds its own tiles)
    for (const [instance, pin] of this.roadGround) if (!drawn.includes(instance) || instance === current) { pin.abort.abort(); this.roadGround.delete(instance); }
    const wanted = new Set(drawn.filter(instance => this.roadGroundReady(instance)));
    if (current !== null && this.roadDisplays.has(current) && !(entered.instance === current && entered.ready)) wanted.add(current);
    for (const [instance, shown] of this.roadDisplays) {
      if (wanted.has(instance) && this.runtimeRegions.get(instance) === shown.prepared) continue;
      this.roadDisplays.delete(instance); shown.owner.dispose();
    }
    for (const instance of wanted) {
      const prepared = this.runtimeRegions.get(instance);
      if (prepared?.display === undefined || this.roadDisplays.has(instance) || !this.live.ready(instance)) continue;
      const owner = this.ports.scope.child(`grid.road-display.${instance}`);
      this.roadDisplays.set(instance, { prepared, owner });
      prepared.display(owner);
    }
  }

  /**
   * J500: whether a zone built from the road has its ground to draw on: once played its tiles are up; a zone whose world draws
   * its own ground (`cellGround: 'world'`, Nalati) has it. A zone whose ground is its tiles (Pine) drew its pieces floating over
   * nothing, so its tiles are pinned first, from the edge nearest the walker (the render-only approach pin a gate uses), and it
   * draws once they are up.
   */
  private roadGroundReady(instance: string): boolean {
    if (this.startedRuntimes.has(instance) || this.runtimeRegions.get(instance)?.ownsGround === true) return true;
    const prepare = this.ports.prepareNeighbourTiles;
    if (prepare === undefined || this.ports.roadGround === false) return false;
    const held = this.roadGround.get(instance);
    // a deferred pin (no room for its inputs yet) asks again after a while
    if (held !== undefined && !(held.state === 'deferred' && diagnosticNow() - held.at > ROAD_GROUND_RETRY_MS)) return held.ready;
    held?.abort.abort();
    const cell = this.ports.assembly.cell(instance), feet = this.live.worldFeet(), edge = CHUNK_HALF - 8;
    const start = { x: Math.max(-edge, Math.min(edge, feet.x - cell.origin.x)), z: Math.max(-edge, Math.min(edge, feet.z - cell.origin.z)) };
    const pin: { readonly abort: AbortController; ready: boolean; state: 'pinning' | 'ready' | 'deferred' | 'refused'; at: number } = { abort: new AbortController(), ready: false, state: 'pinning', at: diagnosticNow() };
    this.roadGround.set(instance, pin);
    void (async () => {
      try {
        const pinned = await prepare(cell, start, pin.abort.signal, true);
        if (pin.abort.signal.aborted) return;
        pin.ready = pinned; pin.state = pinned ? 'ready' : 'deferred'; pin.at = diagnosticNow();
      }
      // a refused pin stays (not ready) until the zone leaves the road's view, so it is not asked again every frame
      catch (error) { if (!pin.abort.signal.aborted) { pin.state = 'refused'; console.warn(`[grid] ${instance} ground from the road:`, error); } }
    })();
    return false;
  }

  private bind(frame: LiveGridFrame): void {
    this.framePhysics = frame.physics;
    const runtime = frame.instance === null ? undefined : this.runtimeRegions.get(frame.instance);
    const runtimeQueries = runtime === undefined ? undefined : { ...runtime.queries,
      heightAt: (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) <= CHUNK_HALF ? runtime.queries.heightAt(x, z) : 0,
      waterSurfaceAt: (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) <= CHUNK_HALF ? runtime.queries.waterSurfaceAt(x, z) : null };
    this.page.traveller.bindFrame(frame.physics, frame.motor, frame.instance === null ? HIGHWAY_QUERIES : runtimeQueries ?? this.regions.get(frame.instance)?.queries ?? HIGHWAY_QUERIES);
    this.page.setPhysics(frame.physics);
    this.wire?.rebound(frame.physics);
    this.offset.set(frame.origin.x - this.ports.home.origin.x, 0, frame.origin.z - this.ports.home.origin.z);
    if (this.homeSim?.disposed() === true) this.homeSim = null;
    this.homeSim?.setActive(false);   // the live grid drives every owned region
  }

  /**
   * Where fall recovery and respawn put the traveller when it is not in the home frame (null: the home's own spawn): an
   * admitted region's authored start, or on the highway the deck under the feet (road level). A fall that began from the
   * road (G101: no ground inside a cell since) recovers on the road, in the active frame's coordinates, whatever the frame.
   */
  spawn(): LiveGridSpawn | null {
    const road = this.road.target();
    if (road !== null) {
      const x = this.ports.home.origin.x + this.offset.x, z = this.ports.home.origin.z + this.offset.z; // the active frame's origin
      return { x: road.x - x, y: 0.5, z: road.z - z, yaw: road.yaw };
    }
    const current = this.live.current();
    const p = this.page.traveller.position;
    if (current === null) return { x: p.x, y: 0.5, z: p.z, yaw: this.page.traveller.yaw };
    const runtime = this.runtimeRegions.get(current);
    if (runtime !== undefined) {
      // the authored start's height defaults to 0 when the source omits it: never respawn under a deck (E463)
      const start = runtime.region.host.level.player;
      return { x: start.at.x, y: Math.max(start.at.y, this.standingHeight(runtime.queries, start.at.x, start.at.z, start.at.x, start.at.z) + 0.05), z: start.at.z, yaw: start.yaw };
    }
    return this.regions.get(current)?.spawn ?? { x: 0, y: undefined, z: 0, yaw: 0 };
  }
  /** A home spawn's feet (`homeSpawnFeet`), in the region's local x / z. */
  private spawnHeight(queries: PlayerFrameQueries, at: { readonly x: number; readonly z: number }, spawn: { readonly x: number; readonly y?: number; readonly z: number }): number {
    return homeSpawnFeet(spawn.y, () => queries.heightAt(spawn.x, spawn.z), () => this.standingHeight(queries, at.x, at.z, spawn.x, spawn.z));
  }
  /** Where a spawn with no authored height stands: the region's terrain or water surface, its platform queries (decks,
   *  hulls), and a collider up to 2 m above that (a pier deck over the sea), never a roof overhead (physics x / z in the
   *  active frame; the queries take the source's local x / z). */
  private standingHeight(queries: PlayerFrameQueries, px: number, pz: number, lx: number, lz: number): number {
    let top = Math.max(queries.heightAt(lx, lz), queries.waterSurfaceAt(lx, lz) ?? Number.NEGATIVE_INFINITY);
    for (const platform of queries.platforms) { const y = platform(lx, lz); if (y !== undefined && y > top) top = y; }
    const floor = floorBelow(this.framePhysics, px, pz, top + 2, 4);
    return floor !== undefined && floor > top ? floor : top;
  }
  /** The geometric region's kill floor, independent of the 6/10 m motor-frame hysteresis. */
  fallFloor(): number {
    const feet = this.worldFeet(), cell = this.ports.assembly.at(feet.x, feet.z);
    if (cell === undefined) return -60;
    const runtime = this.runtimeRegions.get(cell.instance);
    const active = this.runtimePage.state();
    // The entry can be at road level while its asynchronous world hook is still installing its bounds.
    // Like regional input/gameplay, authored recovery must wait for that entered installation.
    if (runtime !== undefined && (active.instance !== cell.instance || !active.ready)) return -CHUNK_HALF;
    const authored = findShard(cell.slug)?.bounds, x = feet.x - cell.origin.x, z = feet.z - cell.origin.z; // the cell's own x/z
    // SS6b: a home or region with a product reads its floor at the player's x/z by the rule its room reads (`declaredPlayArea`)
    const product = runtime?.resident.product;
    const declared = runtime === undefined
      ? cell.instance === this.ports.home.instance ? this.page.homeFloorAt?.(x, z) : authored?.floor
      : product === undefined ? resolveLevelBounds(authored, runtime.resident.runtime.hooks)?.floor : regionArea(product, authored)?.floorAt(x, z);
    return Math.max(-CHUNK_HALF, declared ?? -CHUNK_HALF);
  }

  /** Named home checkpoints apply only after its genuine entry, never while road recovery owns the fall. */
  ownsHomeRecovery(): boolean {
    const feet = this.worldFeet();
    return this.road.target() === null && this.live.current() === this.ports.home.instance
      && this.ports.assembly.at(feet.x, feet.z)?.instance === this.ports.home.instance;
  }

  /** The active frame's identity (the home instance, a region, or null for the highway). */
  frame(): string | null { return this.live.current(); }

  /** What a cell's panels read: its solids here, and a field's row (a player field's owned line) while the wire stands in it. */
  panelRegion(instance: string): PanelRegion | undefined {
    const region = this.regions.get(instance);
    return region === undefined ? undefined : { colliders: region.colliders, field: name => this.wire?.site() === instance ? wirePage.row(name) : undefined,
      line: name => this.wire?.site() === instance ? wirePage.line(name) : undefined };
  }
  /** A cell's quest flags, as the server holds them: only where the wire stands. */
  areaFlags(instance: string): readonly string[] { return this.wire?.site() === instance ? this.wire.flags?.() ?? [] : []; }
  /** What draws a cell's life: the server's rows, which exist only where the page stands. */
  /** A cell's public shared state row, as its client lane reads it: only where the wire stands. */
  lifeField(instance: string, name: string): number | undefined { return this.wire?.site() === instance ? wirePage.row(name) : undefined; }
  lifeRegion(instance: string): NeighbourRegion | undefined { return this.wire?.site() === instance ? this.wire.rows : undefined; }

  /** Fresh per-frame travel facts; setup/final witnesses use the complete state readout. */
  travelState(): Pick<LiveGridSessionState, 'live' | 'crossing' | 'runtimeTiming'> {
    return { live: this.live.state(), crossing: this.crossing.crossing.state(), runtimeTiming: this.runtimePage.timings() };
  }

  state(): LiveGridSessionState {
    const cap = this.page.traveller.hoverSpeedLimit?.();
    return { keptPrograms: this.keeper?.size ?? 0, live: this.live.state(), crossing: this.crossing.crossing.state(), stowed: this.page.equipment.stowed, renderOrigin: { x: this.offset.x, z: this.offset.z }, runtimeTiming: this.runtimePage.timings(), crossingTiming: this.crossing.crossing.timings(), leaveTiming: this.leaveTiming.map(row => ({ ...row })), crossingLoading: this.crossing.crossing.timings().map(crossingLoadingRows),
      hoverCap: cap === undefined ? null : Math.round(cap * 100) / 100, roadDisplays: [...this.roadDisplays.keys()].sort(),
      roadGround: Object.fromEntries([...this.roadGround].map(([instance, pin]) => [instance, pin.state])) };
  }
}

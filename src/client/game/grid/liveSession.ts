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
import { Vector3, type PerspectiveCamera } from 'three';
import { createProgramKeeper, RETAINED_PROGRAM_BYTES, RETAINED_PROGRAM_LIMIT, type ProgramKeeper } from '@wildshard/engine/render/programRetention';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { WORK_SLICE_MS, workSlice } from '@wildshard/engine/core/workSlice';
import { CHUNK_HALF, CONTENT_CAPS, ENTRY_ASPHALT } from '@wildshard/engine/core/config';
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
import { prepareApproachProductInputs } from './approachProductInputs';
import { installGridCrossing, type GridCheckpointResult, type GridCrossingSession, type GridCrossingState } from '../../../shared/game/grid/crossing';
import { GridWallet, stowGridMount } from '../../../shared/game/grid/wallet';
import type { LedgerCatalogueItem } from '../../../shared/game/ledger';
import { installGridHoverSpeed } from '../../../shared/game/grid/rules';
import { installGridTravellerCombat } from '../../../shared/game/grid/travellerCombat';
import { gridHomeSim, gridCells, type GridHomeSimulation } from '../plugin/context';
import { gateEnters } from './cellPresence';
import { findShard } from '../shard/registry';
import { gridPostCosts, gridShardfileProduct, prioritizeGridProduct, type GridProductMetadata } from './products';
import { preparationAdmission, type GridAdmissionMetadata } from './preparationAdmission';
import { gridPostPairRefusal } from '../../../shared/game/grid/postPairs';
import {productPostCost} from '../shardfile/productCost';
import { SERVER_PLACED } from './pageEntry';
import { gridRecovery, type GridRecoveryReason, type GridRecoveryRecord } from '../../../shared/game/grid/recovery';
import { RoadRecovery, onRoad, type RoadPoint, type RoadRecoveryCell } from '../../../shared/game/grid/roadRecovery';
import { GridCellWaitingError } from './refusal';
import { withCopyLayout } from './copyLayout';
import { dataCellWorld, type RegionShell } from './regionShell';
import type { PanelRegion } from './neighbourPanels';
import { wirePage } from '../shardfile/wirePage';
import type { CollisionStrip } from '../../../shared/game/grid/collisionStrips';
import type { LocalSaveInstance } from '../../../shared/game/instanceSaves';
import { loadNavmesh } from '@wildshard/engine/physics/navmeshLoad';
import { enteredRuntime, pickInFrame } from './enteredInteract';
import { copyPrompts, enteredCopy } from './copyPrompts';
import { yieldGridAdmission, yieldGridConstruction } from './admissionYield';
import { HybridRuntimeSession, type HybridResident } from '../shardfile/hybrid';

import { createRegionalRuntimeFactory, regionalRuntimeAccountedBytes, type PreparedRegionalRuntime, type RegionalRuntimePage, type RegionalRuntimeTextures } from './regionalRuntime';
import { bindHomeBuildCache } from '../shardfile/homeBuildCache';
import type { ClientTileRegistration } from '../shardfile/tileContent';
import { createRegionalWorldFoundation, hangCellDataSky, resolveRegionalRuntimeTextures } from './regionalWorld';
import { regionalDataCellBytes } from './runtimeCost';
import { resolveLevelBounds } from '../../../shared/game/shard/runtime';

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
  /** G226: the page has no shard world; its catalogue home uses the same owned factory as every other hybrid. */
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
  /** The home runtime's resolved higher fall floor; neighbour floors come from their own declarations. */
  readonly homeFallFloor?: number;
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
  /** Render-only destination preparation; the signal releases its temporary entry-tile pins. */
  readonly prepareNeighbourTiles?: (cell: GridCell, start: { readonly x: number; readonly z: number }, signal: AbortSignal) => Promise<void>;
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
}
/** The readout: the live host's crossing telemetry, the crossing coordinator and the safe-zone state. */
export interface LiveGridSessionState {
  /** G580 T2: the distinct compiled programs kept across retired cells (null: the Developer row is off) */
  readonly keptPrograms: number | null;
  readonly live: LiveGridState; readonly crossing: GridCrossingState; readonly stowed: boolean; readonly renderOrigin: { x: number; z: number };
  /** Entered hook intervals in the same performance clock as browser long tasks. */
  readonly runtimeTiming: ReturnType<HybridRuntimeSession['timings']>;
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
const LINK: ReadinessLink = { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: 0.25, maxStallSeconds: 10 };

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

const regionTransferWalls = (shell: RegionShell, radius: number): TransferWalls => new TransferWalls(() => shell.physics, [{ x: 0, z: 0 }], radius, 'exit', shell.scope);
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
  /** the home runtime's own simulation driver (its hybrid binding offers it): the live grid drives that region, so it runs
   *  only while bound as the current frame's (never on a grid page today); taking the offer settles the boot's handoff */
  private homeSim: GridHomeSimulation | null = null;
  private readonly applied = new Vector3();
  private readonly roadWallet: GridWallet;
  /** each admitted region's authored spawn (its level's player start) and its ground / water queries, local */
  private readonly regions = new Map<string, { readonly spawn: LiveGridSpawn; readonly items: Shardfile['items']['rows']; readonly queries: PlayerFrameQueries; readonly colliders: PanelRegion['colliders']; readonly prompts: ReturnType<typeof copyPrompts> }>();
  private readonly runtimeScope: Scope;
  private readonly runtimeRegions = new Map<string, PreparedRegionalRuntime>();
  private readonly leaveTiming: { instance: string; leaveMs: number }[] = [];
  private readonly runtimeResidents = new Map<string, HybridResident>();
  private readonly hybrid: HybridRuntimeSession;
  private readonly startedRuntimes = new Set<string>();
  private activation: Promise<boolean> | undefined;
  /** G580 T2: the Developer choice, read at construction; the keeper is made at the first retirement */
  private keeper: ProgramKeeper | null = null;
  private checkpointsSuppressed = false;
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
    this.hybrid = new HybridRuntimeSession(this.runtimeResidents, scope, { pause: yieldGridConstruction });
    scope.onDispose(gridCells.onLeave(() => { this.hybrid.leave(); }));
    scope.onDispose(gridCells.onEnter(cell => {
      if (!this.runtimeResidents.has(cell.instance)) { ports.lightingSettled?.(); return; }
      this.startedRuntimes.add(cell.instance);
      const activation = this.hybrid.enter(cell);
      this.activation = activation;
      const report = async (): Promise<void> => {
        try { await activation; ports.lightingSettled?.(); } catch (error) { console.error('Regional runtime entry failed', error); }
      };
      void report();
    }));
    scope.onDispose(gridCells.onLeave(() => { ports.lightingSettled?.(); }));
    const transferScope = scope.child('grid.transfer.home');
    this.roadWallet = new GridWallet(page.saves, { id: home.instance, shard: home.slug });
    this.road = new RoadRecovery(assembly);
    this.refreshPlatformEntries();
    const player = { get position() { return traveller.position; }, get yaw() { return traveller.yaw; }, health: page.health, owner: traveller, motor: traveller.motor };
    const highwayBytes = (ports.initialStripBytes ?? ports.strips.reduce((sum, strip) => sum + strip.mesh.positions.byteLength + strip.mesh.indices.byteLength, 0))
      + assembly.cells.length * TRANSFER_WALL_BYTES;
    try { this.live = new LiveGridHost(assembly, {
      lastCell: { windowMs: 30_000, playingBytes: CONTENT_CAPS.playing, schedule: (expire, ms) => {
        const timer = scope.child('grid.last-cell-expiry');
        timer.timeout(ms, () => { timer.dispose(); scope.run(expire); });
        return () => { timer.dispose(); };
      } },
      keepPrograms: instance => { this.keepPrograms(instance); },
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
      prepareTransport: (cell, signal) => prepareApproachProductInputs(cell.slug, { allocator: ports.allocator, scope }, signal, assembly.local(traveller.position, cell)),
      ...(ports.prepareNeighbourTiles === undefined ? {} : { prepareNeighbour: ports.prepareNeighbourTiles }),
      prioritize: (cell) => prioritizeGridProduct(cell.slug, { allocator: ports.allocator, scope }),
      pause: () => yieldGridAdmission(scope),
      prefetchable: (cell) => { const manifest = findShard(cell.slug); return (manifest?.shardfile ?? manifest?.gridShardfile) !== undefined; },
      ...(ports.backgroundReady === undefined ? {} : { backgroundReady: ports.backgroundReady }),
      bindFrame: (frame) => { this.bind(frame); },
      gameplayReady: () => this.gameplayReady(),
      readiness: { link: LINK, bundle: (cell) => this.bundle(cell) },
    }); } catch (error) { transferScope.dispose(); throw error; }
    scope.onDispose(() => { this.live.dispose(); });
    this.crossing = this.installCrossing();
    installGridTravellerCombat(page.events, scope, page.health, () => {
      const active = this.hybrid.state();
      return active.ready ? active.instance : home.instance;
    }, () => {
      const feet = this.live.worldFeet();
      return assembly.at(feet.x, feet.z)?.instance ?? null;
    }, () => {
      const active = this.hybrid.state();
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
    page.onInput(() => { traveller.camera.position.sub(this.applied); this.applied.set(0, 0, 0); });
    scope.onDispose(() => { this.autosave?.return(false); this.autosave = null; });
    page.onUpdate(() => { // the page has one update slot (game.grid.origin): the camera offset, then one autosave stage
      if (this.offset.lengthSq() !== 0) { traveller.camera.position.add(this.offset); this.applied.copy(this.offset); }
      // The capture's own frame encodes nothing more: the next stage waits for the next frame's update.
      if (scope.disposed) return;
      if (this.autosaveCaptured) this.autosaveCaptured = false; else this.stepAutosave();
    });
    scope.onDispose(() => { traveller.camera.position.sub(this.applied); this.applied.set(0, 0, 0); });
    scope.listen(window, 'pagehide', () => { this.checkpoint(); });
    scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') this.checkpoint(); });
    scope.onDispose(() => { this.checkpoint(); });
  }

  private installCrossing(): GridCrossingSession {
    return installGridCrossing({ current: () => this.live.current(), prepare: (from, to) => this.prepareCrossing(from, to),
      ready: (instance) => this.live.ready(instance), checkpoint: (instance) => {
        if (this.wire !== null) return true; // the server's saves are the session's
        const readiness = this.page.crossingSaveReady?.(instance) ?? true;
        return readiness === true ? this.live.checkpoint(instance) : readiness;
      }, target: (feet) => this.wire === null ? this.live.target(feet) : this.wireTarget() },
    this.ports.assembly, (instance) => {
      const runtime = this.runtimeRegions.get(instance), flush = (): boolean => true;
      if (runtime === undefined) return { checkpoint: flush, stow: () => { stowGridMount(this.page.traveller); }, interior: () => undefined };
      if (this.wire !== null) return { ...runtime.loadout, checkpoint: flush };
      // rt3-crossing2: a committed runtime the traveller never entered never ran its hooks and never played: it saves as
      // the stored resident. Its own checkpoint refuses until its hooks restore, so turning back on the strip after the
      // commit held the crossing in save-failed for good.
      return this.startedRuntimes.has(instance) ? runtime.loadout : { ...runtime.loadout, checkpoint: flush };
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

  /** The entered region's creature manager, where this cell's rows are drawn; none on the road or in a data cell. */
  enteredAnimals(): ReturnType<PreparedRegionalRuntime['animals']> {
    const instance = this.enteredRuntimeInstance();
    return instance === null ? null : this.runtimeRegions.get(instance)?.animals() ?? null;
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
    const current = this.live.current(), cell = current === null ? this.ports.home : this.ports.assembly.cell(current);
    const feet = this.worldFeet();
    const inside = this.ports.assembly.at(feet.x, feet.z)?.instance === current;
    const local = this.ports.assembly.local(feet, cell);
    return gridRecovery(this.page.saves).save(this.ports.assembly, cell, this.recoveryRoad(), inside
      ? { kind: 'cell', ...local, yaw: this.page.traveller.yaw } : { kind: 'road' });
  }

  /** GO5 (DG3): the world's door names where this player stands, cell-local. On an MMO build that is the one save, and this page's
   *  `grid.last-played` is only its hint: rewritten here, so the next entry's card names the server's place. A cell this catalogue
   *  doesn't place changes nothing. */
  serverPlace(instance: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }): boolean {
    const cell = this.ports.assembly.cells.find(row => row.instance === instance);
    if (cell === undefined) return false;
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
    if (this.ports.scope.disposed || !this.checkpoint()) return false;
    if (!gridRecovery(this.page.saves).write(this.ports.assembly, this.ports.home, this.recoveryRoad(), reason)) return false;
    // The intent names exactly this checkpoint; a later pagehide/timer must not replace its location or continuation.
    this.checkpointsSuppressed = true; this.autosave?.return(false); this.autosave = null;
    return true;
  }

  /** Capture before reset; run only after success, without flushing old state into the reset save. */
  prepareNewGameRecovery(target?: LocalSaveInstance): () => void {
    if (!this.checkpoint()) throw new Error('New game requires a durable current checkpoint');
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
    // T7 (Tile residency): a data shard's owned home is its bodyless region, entered as a crossing enters it; no hooks run
    const region = this.runtimeRegions.has(cell.instance) ? undefined : this.regions.get(cell.instance);
    if (region !== undefined) {
      const at = this.page.traveller.position;
      this.page.traveller.position.y = spawn.y ?? this.standingHeight(region.queries, at.x, at.z, spawn.x, spawn.z) + 0.5;
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
    this.page.traveller.position.y = spawn.y ?? this.standingHeight(runtime.queries, at.x, at.z, spawn.x, spawn.z) + 0.5;
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
    if (manifest?.gridShardfile !== undefined && manifest.clientPlanRuntime === true) return { criticalWireBytes: 2_000_000, hybridWireBytes: 2_000_000, decodeSeconds: 1, runtimeParseSeconds: 1 };
    return { criticalWireBytes: findShard(cell.slug)?.shardfile === undefined ? 0 : 2_000_000, hybridWireBytes: 0, decodeSeconds: 1, runtimeParseSeconds: 0 };
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
    const productOwner = { allocator: this.ports.allocator, scope: this.ports.scope };
    const pending = metadata ? gridShardfileProduct(cell.slug, productOwner, required ? 'metadata' : 'optional-metadata') : gridShardfileProduct(cell.slug, productOwner);
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
      const costs = gridPostCosts(this.ports.allocator), own = productPostCost(source, (hash) => assets.get(hash));
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
        const transfer = regionTransferWalls(shell, this.page.traveller.motor.opts.radius), start = shell.level.player;
        shell.physics.step();
        transfer.sync(); this.transferWalls.set(cell.instance, transfer);
        this.regions.set(cell.instance, { spawn: { x: start.at.x, y: undefined, z: start.at.z, yaw: start.yaw },
          // the admitted terrain inside the cell (one source of truth); its strips are road level (the terrain tile ends at the cell edge)
          queries: { heightAt: (x, z) => (Math.max(Math.abs(x), Math.abs(z)) <= CHUNK_HALF ? heightAt(x, z) : 0), waterSurfaceAt: (x, z) => water.restAt(x, z), platforms: [] }, colliders, items: copySource.items.rows, prompts: copyPrompts(copySource) });
        this.respawnCells.set(cell.instance, { instance: cell.instance, origin: cell.origin, entryways: source.entryways });
        // G321: its own sky inside its cell (its data look's dome and light), laid while it is resident
        {
          const request = { instance: cell.instance, slug: cell.slug, look: copySource.look, assets, page: this.page.runtimePage?.() ?? null, allocator: this.ports.allocator, scope: shell.scope };
          void (async (): Promise<void> => {
            try { await hangCellDataSky(request); } catch (error) { console.warn(`[region sky] ${cell.instance}`, error); }
          })();
        }
        const unlist = (): void => { this.regions.delete(cell.instance); this.transferWalls.delete(cell.instance); };
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
        await this.ports.prepareDataTiles?.(cell, region.shell.scope, { x: feet.x - cell.origin.x, z: feet.z - cell.origin.z });
        return region;
      } catch (error) {
        try { region.dispose(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Data entry and cleanup failed', { cause: cleanup }); }
        throw error;
      }
    } });
    } catch (error) { try { retained.release(); } finally { product.release(); } throw error; }
  }

  private admitRuntime(cell: GridCell, retained: GridProductMetadata, choice: RegionalPreparationChoice, metadata: true): Promise<GridAdmissionMetadata>;
  private admitRuntime(cell: GridCell, retained: GridProductMetadata, choice: RegionalPreparationChoice, metadata: false): Promise<LiveGridAdmission>;
  private async admitRuntime(cell: GridCell, retained: GridProductMetadata, choice: RegionalPreparationChoice, metadata: boolean): Promise<GridAdmissionMetadata | LiveGridAdmission> {
    const manifest = findShard(cell.slug), declaration = retained.admitted.source.runtime;
    const dataPage = hasDeclaredClientPage(retained.admitted.source);
    if (manifest === undefined || !dataPage && declaration === null) throw new GridCellWaitingError('Missing declared regional page owner');
    const page = this.page.runtimePage?.();
    if (page === undefined || page === null) throw new GridCellWaitingError('Regional page services are not ready');
    const textures = choice.textures ??= resolveRegionalRuntimeTextures(manifest, this.ports.allocator.cost().input), bytes = regionalRuntimeAccountedBytes(retained.admitted, manifest, textures.mode);
    const prepareEntry = async (): Promise<void> => {
      if (declaration === null) return;
      if (manifest.clientPlanRuntime !== true) throw new GridCellWaitingError('Client-plan runtime requires its built-in manifest policy');
      if (manifest.load === undefined) throw new GridCellWaitingError('Missing compiled first-party loader');
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
        const entryPoint = { x: feet.x - cell.origin.x, z: feet.z - cell.origin.z };
        prepared = await factory({ cell, admitted: retained.admitted, manifest, page, textures, allocator: this.ports.allocator, claim, scope: this.runtimeScope, entryPoint });
      }
      catch (error) { this.transferWalls.delete(cell.instance); throw error; }
      this.runtimeRegions.set(cell.instance, prepared); this.runtimeResidents.set(cell.instance, prepared.resident);
      this.respawnCells.set(cell.instance, { instance: cell.instance, origin: cell.origin, entryways: retained.admitted.source.entryways });
      try {
        await this.hybrid.prepare(cell.instance);
        if (!await this.hybrid.prepareEntry(cell.instance, signal)) throw new Error('Admitted entry preparation left its requested cell');
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
        if (this.runtimeRegions.get(cell.instance) === prepared) {
          this.startedRuntimes.delete(cell.instance);
          this.runtimeRegions.delete(cell.instance); this.runtimeResidents.delete(cell.instance); this.transferWalls.delete(cell.instance);
        }
        release();
      };
      const retireSteps = prepared.region.retire;
      return { ...prepared.region, checkpoint: () => !this.startedRuntimes.has(cell.instance) ? true
        : this.hybrid.state().instance === cell.instance && !this.hybrid.state().ready ? false : prepared.checkpoint(), dispose: () => {
        if (disposalFailure !== undefined) throw disposalFailure;
        try { prepared.region.dispose(); }
        catch (error) { disposalFailure = error instanceof Error ? error : new Error(String(error)); throw disposalFailure; }
        forget();
      }, ...(retireSteps === undefined ? {} : { *retire(): ReturnType<typeof retireSteps> { yield* retireSteps(); forget(); } }) };
    } };
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
  /** G555: the entered runtime hooks' timings (the one running and those finished), for the cell loading screen. */
  hookTimings(): ReturnType<HybridRuntimeSession['timings']> { return this.hybrid.timings(); }
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
    const state = this.hybrid.state(); return state.instance === current && state.ready;
  }

  /** Actual regional aim bodies only after entered hooks complete; parked neighbours and the road supply none. */
  aimAnimals(): ReturnType<PreparedRegionalRuntime['aimAnimals']> {
    const state = this.hybrid.state();
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
    return enteredRuntime({ hybrid: this.hybrid.state(), current: this.live.current(), feetCell: this.ports.assembly.at(feet.x, feet.z)?.instance });
  }

  /** The fixed-boundary rebind: the page's stepped world, the player's motor and the render origin. */
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
    const active = this.hybrid.state();
    // The entry can be at road level while its asynchronous world hook is still installing its bounds.
    // Like regional input/gameplay, authored recovery must wait for that entered installation.
    if (runtime !== undefined && (active.instance !== cell.instance || !active.ready)) return -CHUNK_HALF;
    const authored = findShard(cell.slug)?.bounds;
    const declared = runtime === undefined
      ? cell.instance === this.ports.home.instance ? this.page.homeFallFloor : authored?.floor
      : resolveLevelBounds(authored, runtime.resident.runtime.hooks)?.floor;
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

  /** What a cell's panels read: its solids here, and a field's row while the wire stands in it. */
  panelRegion(instance: string): PanelRegion | undefined {
    const region = this.regions.get(instance);
    return region === undefined ? undefined : { colliders: region.colliders, field: name => this.wire?.site() === instance ? wirePage.row(name) : undefined };
  }
  /** What draws a cell's life: the server's rows, which exist only where the page stands. */
  lifeRegion(instance: string): NeighbourRegion | undefined { return this.wire?.site() === instance ? this.wire.rows : undefined; }

  /** Fresh per-frame travel facts; setup/final witnesses use the complete state readout. */
  travelState(): Pick<LiveGridSessionState, 'live' | 'crossing' | 'runtimeTiming'> {
    return { live: this.live.state(), crossing: this.crossing.crossing.state(), runtimeTiming: this.hybrid.timings() };
  }

  state(): LiveGridSessionState {
    const cap = this.page.traveller.hoverSpeedLimit?.();
    return { keptPrograms: this.keeper?.size ?? 0, live: this.live.state(), crossing: this.crossing.crossing.state(), stowed: this.page.equipment.stowed, renderOrigin: { x: this.offset.x, z: this.offset.z }, runtimeTiming: this.hybrid.timings(), crossingTiming: this.crossing.crossing.timings(), leaveTiming: this.leaveTiming.map(row => ({ ...row })), crossingLoading: this.crossing.crossing.timings().map(crossingLoadingRows),
      hoverCap: cap === undefined ? null : Math.round(cap * 100) / 100 };
  }
}

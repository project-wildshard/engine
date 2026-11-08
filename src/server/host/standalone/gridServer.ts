// P1-E3.9, E5.2b: the grid in the server worker. One world steps at a time and each keeps its own clock and room, as the MMO's
// will; a crossing hands the client over with `travel`. It reads `simulation.ts`, `room.ts` and `roomNet.ts`, never
// `LiveGridHost`, whose ports are the page's.
//
// The boot decision: a grid session starts with its owner on the road, because `GridSimulation` is built around a highway host
// whose lead holds a motor, and `enter` then moves that lead into the home cell before the first tick. So a fresh boot, a
// restored cell and a save made on the road all take one path. The road and each cell's seams are the page's own strips, from
// C2's grid pack, held near the player the way a native cell's solids are, so no save carries them.
import { withOwner } from '@wildshard/engine/app/ownership';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { LedgerBook } from '@wildshard/engine/net/ledgerBook';
import type { ChatReports } from '@wildshard/engine/net/chat';
import type { NetTickInput } from '@wildshard/engine/net/room';
import { groups } from '@wildshard/engine/physics/groups';
import { NearColliders, solidReach } from '@wildshard/engine/physics/nearColliders';
import { stripCollider } from '@wildshard/engine/physics/stripColliders';
import { addEdgeWalls } from '@wildshard/engine/physics/terrain';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimHost, type SimLevel } from '@wildshard/engine/sim';
import { bootTask, bootWork } from '@wildshard/engine/boot/timing';
import { SIM_API_VERSION } from '@wildshard/engine/sim/apiVersion';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import { questBooks } from '@wildshard/engine/quest/players';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import type { ForwardedStorage } from '@wildshard/engine/saves/forwardedStorage';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Transport } from '@wildshard/engine/net/transport';
import { GridAssembly, type GridCell, type GridPoint } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { carryRefusedSave, importPageProgress } from '@wildshard/engine/game/grid/durability';
import { heldArmsOf } from '@wildshard/engine/game/weapons/nativeHeld';
import { gridRecovery } from '@wildshard/engine/game/grid/recovery';
import { regionalRuntimeCheckpoint } from '@wildshard/engine/game/grid/runtimeCheckpoint';
import { GridRoom } from '@wildshard/engine/game/grid/room';
import { commandsOf, GridNetRooms } from '@wildshard/engine/game/grid/roomNet';
import { GridSimulation, type GridResident } from '@wildshard/engine/game/grid/simulation';
import { bindShardfileSim, createShardfileSim, HOST_PROBE, type ShardfileSimPorts, type ShardfileSimulation } from '@wildshard/engine/game/plugin/simulation';
import { installRoomRespawn } from '@wildshard/engine/game/roomRespawn';
import { hasNativeAssembly } from '@wildshard/engine/game/shardfile/nativeAssembly';
import { installDeclaredClimate } from '@wildshard/engine/game/shardfile/declaredClimate';
import { landedBy } from '@wildshard/engine/combat/damageBook';
import { installPlayerOwned, type PlayerOwned } from '@wildshard/engine/game/loot/playerOwned';
import { QUEST_OWNED } from '@wildshard/engine/game/quest/nativeComposition';
import { shardRows } from '@wildshard/engine/sim/shardRows';
import { createQuestLedger } from '@wildshard/engine/game/quest/ledger';
import { serverPlaces } from '@wildshard/engine/game/quest/serverPlaces';
import { createTrustedHeadlessResident, type HeadlessRuntimeInput } from '../headlessRuntime';
import type { HeadlessEffect } from '../../../shared/host/tickProtocol';
import { cellDocuments, CONTINUATION, ContinuationSlots, SITE, siteDocuments, type SavedContinuation, type SavedSite } from './continuation';
import { FallFloor } from './fallFloor';
import { ledgerFilings } from './ledgerFilings';
import { netBuys, netWorldInput, stepResident } from '../../../shared/host/standalone/netInput';
import { STORY_ACT } from '@wildshard/engine/net/acts';
import { installServerChapters } from '@wildshard/engine/game/quest/serverChapters';
import { installServerDoors } from '@wildshard/engine/game/quest/serverDoors';
import { pageOpenDoors } from '@wildshard/engine/game/shardfile/buildingDoor';
import { pageRuntimeState } from '@wildshard/engine/game/shardfile/runtimeState';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { pageSavedFlags } from '@wildshard/engine/world/interact/flags';

/** Worlds the worker holds beside the road, and so what a crossroads costs a phone (E5.2b, J68): the one its player stands in. */
export const STANDALONE_RESIDENTS = 1;
/** Ground under the whole grid, far below the road's strips, and a player's pace on them. */
const ROAD_HALF_SIZE = 2000, ROAD_SPEED = 8;
/** A capsule's stand above its ground: one set down touching it cannot leave. */
const ROAD_SKIN = 0.02;
/** Below this a player has left a cell's world: what a page's grid recovery falls back to where a shard declares no floor. */
const FALL_FLOOR = -CHUNK_HALF;
/** A cell's fall recovery, off what its shard declares. */
const fallFloorOf = (input: HeadlessRuntimeInput, host: SimHost, lone: boolean): FallFloor => new FallFloor(Math.max(FALL_FLOOR, input.shard.manifest?.bounds?.floor ?? FALL_FLOOR), lone, host.level.player.at);
/** A cell wall's thickness and half its height. */
const WALL = 0.5, WALL_HEIGHT = 30;
/** How far out from a cell's edge its wall stands. */
const WALL_OFF = 2;
const ROAD: SimLevel = { version: SIM_API_VERSION, id: 'grid-road', seed: 1, ground: { size: ROAD_HALF_SIZE * 2, height: FALL_FLOOR }, player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: ROAD_SPEED }, entities: [], quests: [], weapon: HOST_PROBE };

/** One world the worker has open: its host, and how it takes a tick and reports what the tick granted. */
interface CellWorld extends GridResident {
  /** Take over a page's progress in this cell, or what a save this build refused still says, in a world made fresh for it. False keeps the fresh world. */
  readonly adopt: (refused: SimSnapshot | undefined) => boolean;
  readonly effects: () => readonly HeadlessEffect[];
  readonly step: (inputs: readonly NetTickInput[]) => void;
  readonly fact: (name: string, entity: string) => { readonly id: string; readonly status: 'granted' | 'duplicate' | 'pending' } | null;
  /** What the player holds in this shard. */
  readonly owned: PlayerOwned;
  readonly fall: FallFloor;
}
/** What the grid needs of its host. */
export interface GridServerOptions {
  readonly slug: string; readonly build: string; readonly book: LedgerBook; readonly saves: SaveStore; readonly storage: ForwardedStorage; readonly savePrefix: string;
  /** A cell's server inputs, read when it is admitted and dropped once its world is built. */
  readonly load: (slug: string) => Promise<HeadlessRuntimeInput>;
  /** The road's collision, read once at boot: the road's own, and each cell's copy of the seams beside it. */
  readonly strips: () => Promise<readonly GridCollisionStrip[]>;
  /** A save read back but would not restore, and boot moved to the one before it. */
  readonly refused?: (error: unknown) => void;
  readonly reports?: ChatReports;
  /** A world's tick finished, in how many milliseconds. */
  readonly stepped: (host: SimHost, ms: number) => void;
  readonly now: () => number;
  /** A one-shard page: this cell alone, inside its own walls, with no crossing out of it, whether the grid places it or not. */
  readonly lone?: boolean;
  /** A proof's way in: start on the road at this world point, as no player can, rather than in the home cell. */
  readonly arrival?: Readonly<GridPoint>;
  /** A proof's override of `STANDALONE_RESIDENTS`. */
  readonly residents?: number;
}

/** What boot hands the session it built. */
interface GridParts {
  readonly options: GridServerOptions;
  readonly worlds: Map<string, CellWorld>;
  readonly slots: (instance: string) => ContinuationSlots<SavedContinuation>;
  readonly sites: ContinuationSlots<SavedSite>;
  /** Saves this session has made. */
  readonly saved: number;
}

/** Keep these strips as data in `host`'s world until its player is near, as the page streams them. A world with no list yet gets one. */
function holdStrips(host: SimHost, meshes: readonly GridCollisionStrip['mesh'][]): void {
  if (meshes.length === 0) return;
  let { near } = host.physics;
  if (near === null) { near = new NearColliders(); near.attach(host.physics); host.physics.near = near; }
  for (const mesh of meshes) {
    near.hold({ x: mesh.origin.x, z: mesh.origin.z, reach: solidReach(mesh.positions), make: physics => withOwner(host.scope, () => stripCollider(physics, mesh)) });
  }
}
/**
 * A wall around every cell in the road's own world, as the page's readiness walls are while a cell loads. A player stops just short of
 * a cell until its world is ready and the crossing takes them in, 6 m out at most; the road never runs on under a cell's own
 * hills, where a late hand-off would set them down inside one. A cell's terrain can end in a bank above road level at its very edge,
 * and a capsule set down touching that bank stays stuck in it, so the wall stands clear of it.
 */
function addCellWalls(road: SimHost, cells: readonly GridCell[]): void {
  const { R, world } = road.physics, reach = CHUNK_HALF + WALL_OFF + WALL / 2, long = reach + WALL / 2;
  withOwner(road.scope, () => {
    for (const { origin } of cells) for (const [x, z, hx, hz] of [[reach, 0, WALL / 2, long], [-reach, 0, WALL / 2, long], [0, reach, long, WALL / 2], [0, -reach, long, WALL / 2]] as const)
      world.createCollider(R.ColliderDesc.cuboid(hx, WALL_HEIGHT, hz).setTranslation(origin.x + x, WALL_HEIGHT, origin.z + z).setCollisionGroups(groups('WORLD')));
  });
}
/** The four slabs around a cell, in its own coordinates. A restored world has them already: its save holds its colliders. */
/** A lone cell has the walls a shard's own page stands inside. */
function addLoneWalls(host: SimHost): void { withOwner(host.scope, () => { addEdgeWalls(host.physics); }); }

/** A cell with no native plan: a data shard, which any host can run from its output. */
async function openDataCell(input: HeadlessRuntimeInput, snapshot: string | SimSnapshot | undefined, effects: HeadlessEffect[], lone: boolean): Promise<Pick<CellWorld, 'host' | 'dispose'> & { readonly sim: () => ShardfileSimulation | undefined }> {
  await Promise.resolve();
  const { shard, assets, rapier } = input;
  const ports: ShardfileSimPorts = { rapier,
    quest: { fact: (name, actorId) => { effects.push({ kind: 'fact', name, actorId }); }, coins: (amount, actorId) => { effects.push({ kind: 'coins', amount, actorId }); } } };
  const fresh = createShardfileSim(shard, assets, ports);
  if (snapshot === undefined) { if (lone) addLoneWalls(fresh.host); return { host: fresh.host, sim: () => fresh, dispose: () => { fresh.dispose(); } }; }
  const { level } = fresh.host; fresh.dispose();
  const installed: { value?: ReturnType<typeof bindShardfileSim> } = {};
  const host = restoreSimHost(level, { rapier }, typeof snapshot === 'string' ? decodeSimSnapshot(snapshot) : snapshot, restored => { installed.value = bindShardfileSim(restored, shard, assets, { ...ports, restoring: true }); });
  return { host, sim: () => installed.value, dispose: () => { (installed.value ?? { dispose: () => { host.dispose(); } }).dispose(); } };
}

/** The one client this worker serves is on the wire as the host's own player. A room with more players keeps this seat. */
const SESSION_PLAYER = 'actor.player';
function sessionPlayer(host: SimHost): PlayerSim {
  const player = host.players.get(SESSION_PLAYER);
  if (player === undefined) throw new Error('The session player has no body in this host');
  return player;
}

/** A saved world, if its bytes still read at all. */
function readableSnapshot(snapshot: string): SimSnapshot | undefined { try { return decodeSimSnapshot(snapshot); } catch { return undefined; } }

/** A world's continuation. The solids held near its player are out of it while it is taken: they are in no save. */
function capture(host: SimHost): string {
  const { near } = host.physics, { position } = sessionPlayer(host);
  near?.suspend();
  try { return serializeSimSnapshot(snapshotSimHostBytes(host)); } finally { near?.resume(position.x, position.z); }
}

/** How far past a place's own radius a client's word for it holds: it saw it a frame ago, and the server is a command behind. */
const SEEN_SLACK = 1.5;
/** A named place is the page's to notice, and the server's to check. One the page resolves against a placed object has no world position here, so its word stands: a `seen:` flag draws a map, and pays nothing. */
function bindDiscovery(host: SimHost, places: readonly PlaceArea[]): void {
  const areas = new Map(places.map(place => [`seen:${place.id}`, place]));
  actRoutes(host).seen = (player, flag) => {
    const area = areas.get(flag), feet = host.players.get(player)?.position;
    if (feet === undefined || (area !== undefined && Math.hypot(feet.x - area.x, feet.z - area.z) > area.r * SEEN_SLACK)) return;
    const books = questBooks(host);
    books.claim([flag]); books.of(player).flags.set(flag);
  };
}

/** What the player holds in a cell. A shard with goods sells them here. */
function ownedOf(host: SimHost, input: HeadlessRuntimeInput): PlayerOwned {
  const economy = input.shard.rows.loot.find(row => row.economy !== undefined)?.economy, sold = economy !== undefined && 'exchange' in economy ? economy.exchange : undefined;
  return installPlayerOwned(host, input.shard.identity.slug, sold ?? null, !shardRows(host).owned.has(QUEST_OWNED), input.shard);
}

/** Whether this output runs on the trusted headless owner. */
const nativeCell = (input: HeadlessRuntimeInput): boolean => input.product !== undefined && (hasNativeAssembly(input.product) || input.product.has('sim/runtime-plan'));

/** The worker's grid: the road, whichever cell its player is in, and the room each is on the wire through. */
export class StandaloneGrid {
  readonly grid: GridSimulation;
  readonly assembly: GridAssembly;
  /** The save this boot resumed, if any. */
  readonly restored: SavedContinuation | SavedSite | undefined;
  private readonly options: GridServerOptions;
  private readonly worlds: Map<string, CellWorld>;
  private readonly slots: (instance: string) => ContinuationSlots<SavedContinuation>;
  private readonly sites: ContinuationSlots<SavedSite>;
  private readonly room: GridRoom;
  private readonly rooms: GridNetRooms;
  private settling: Promise<boolean> = Promise.resolve(true);
  private saved: number;
  private constructor(built: Pick<StandaloneGrid, 'grid' | 'assembly' | 'restored'> & GridParts) {
    this.grid = built.grid; this.assembly = built.assembly; this.restored = built.restored; this.saved = built.saved; this.options = built.options; this.worlds = built.worlds; this.slots = built.slots; this.sites = built.sites;
    const { book, build, reports } = built.options;
    this.room = new GridRoom(this.grid, this.assembly, { loadout: () => ({ checkpoint: () => true, stow: () => undefined, interior: () => undefined }) });
    this.rooms = new GridNetRooms(this.grid, this.room, this.assembly, { held: true, build, book, lone: built.options.lone === true, ...(reports === undefined ? {} : { reports }),
      step: (site, inputs) => this.step(site, inputs), filings: (site, first) => this.filings(site, first) });
  }

  /** Open the session: at its save if it has one that restores, else in the home cell's spawn. */
  static async boot(options: GridServerOptions): Promise<StandaloneGrid> {
    const mode = { developer: false, devserver: false }, assembly = options.lone === true ? new GridAssembly(mode, undefined, options.slug) : new GridAssembly(mode), home = new Map([...assembly.cells].reverse().map(cell => [cell.slug, cell])).get(options.slug);
    if (home === undefined) throw new Error(`Standalone needs a grid cell: ${options.slug}`);
    const { saves, storage, savePrefix } = options, worlds = new Map<string, CellWorld>(), cells = new Map<string, ContinuationSlots<SavedContinuation>>();
    let settle: (held: ContinuationSlots<SavedContinuation>) => void = () => undefined;
    // A lone cell's world has walls and a grid cell's has a rim, so neither can restore the other's continuation. Facts and page progress they share.
    const documents = options.lone === true ? (instance: string): readonly [string, string] => cellDocuments(`lone-${instance}`) : cellDocuments;
    const continuation = saves.define(CONTINUATION), sites = new ContinuationSlots(saves.define(SITE), siteDocuments(options.lone === true ? `lone-${home.instance}` : 'grid'), storage, savePrefix);
    const slots = (instance: string): ContinuationSlots<SavedContinuation> => {
      const held = cells.get(instance) ?? new ContinuationSlots(continuation, documents(instance), storage, savePrefix);
      cells.set(instance, held);
      return held;
    };
    const candidate = sites.candidates().find(row => row.saved.site === null || assembly.cells.some(cell => cell.instance === row.saved.site));
    if (candidate !== undefined) sites.restored(candidate);
    // A session with no save of its own opens where the page's save last stood.
    const place = candidate !== undefined || options.arrival !== undefined || options.lone === true ? null : gridRecovery(saves).lastPlace(assembly);
    const arrival = options.arrival ?? (place?.location.kind === 'road' ? { x: place.road.x, y: 0, z: place.road.z } : undefined);
    const site = arrival !== undefined ? null : candidate === undefined ? place?.instance ?? home.instance : candidate.saved.site;
    const firstSlug = site === null ? home.slug : assembly.cell(site).slug, first = await bootTask('server:product-inputs', () => options.load(firstSlug)), { rapier } = first, lent = new Map([[firstSlug, first]]);
    let resumed: SavedContinuation | undefined;
    const input = (cell: GridCell): Promise<HeadlessRuntimeInput> => { const held = lent.get(cell.slug); lent.clear(); return held === undefined ? options.load(cell.slug) : Promise.resolve(held); };
    const open = async (cell: GridCell, cached: SimSnapshot | undefined): Promise<CellWorld> => {
      const source = await input(cell);
      if (cached !== undefined) return StandaloneGrid.world(cell, source, cached, options);
      const held = slots(cell.instance), rows = held.candidates();
      for (const row of rows) {
        try { const world = await StandaloneGrid.world(cell, source, row.saved.snapshot, options); held.restored(row); resumed = row.saved; return world; }
        catch (error) { held.setAside(row); options.refused?.(error); }
      }
      // A later build can refuse a whole world over one thing it changed. The player's progress is still in there, and goes on from a fresh world.
      const refused = rows.map(row => ({ row, saved: readableSnapshot(row.saved.snapshot) })).find(row => row.saved !== undefined);
      const world = await StandaloneGrid.world(cell, source, undefined, options, refused?.saved);
      try { if (!world.adopt(refused?.saved)) options.refused?.(new Error(`Saved progress in ${cell.instance} would not restore`)); }
      catch (error) { options.refused?.(error); }
      resumed = refused?.row.saved;
      return world;
    };
    const strips = options.lone === true ? [] : await bootTask('server:road-collision-inputs', options.strips);
    const road = bootWork('server:road-physics-and-collision', () => StandaloneGrid.road(rapier, assembly.cells, strips, site === null ? candidate?.saved.road : undefined, arrival, options.refused));
    const grid: GridSimulation = new GridSimulation(assembly, { highway: { host: road, dispose: () => { road.dispose(); } }, maxResidents: options.residents ?? STANDALONE_RESIDENTS,
      load: async (cell, cached) => {
        const world = await open(cell, cached);
        holdStrips(world.host, strips.flatMap(strip => strip.duplicates.filter(row => row.instance === cell.instance).map(row => row.mesh)));
        worlds.set(cell.instance, world); return { host: world.host, dispose: () => { worlds.delete(cell.instance); world.dispose(); } }; },
      durable: (instance, host) => {
        const held = slots(instance), wrote = held.write({ tick: host.state.tick, snapshot: capture(host), ledger: options.book.snapshot() });
        settle(held);
        return wrote;
      } });
    if (site !== null) await grid.enter(site);
    if (site !== null && place?.location.kind === 'cell') {
      const { x, y, z, yaw } = place.location, seat = sessionPlayer(grid.host());
      seat.position.set(x, y, z); seat.yaw = yaw; seat.motor.resetAt(seat.position);
    }
    const restored = site === null ? candidate?.saved : resumed;
    const server = new StandaloneGrid({ grid, assembly, restored, options, worlds, slots, sites, saved: candidate?.saved.tick ?? 0 });
    settle = held => { void server.settle([held]); };
    return server;
  }

  private static road(rapier: Rapier, cells: readonly GridCell[], strips: readonly GridCollisionStrip[], saved: string | undefined, arrival: Readonly<GridPoint> | undefined, refused: GridServerOptions['refused']): SimHost {
    if (saved !== undefined) {
      try {
        const restored = restoreSimHost(ROAD, { rapier }, decodeSimSnapshot(saved));
        holdStrips(restored, strips.map(strip => strip.mesh));
        return restored;
      } catch (error) { refused?.(error); } // a road holds no progress but where the player stood
    }
    const road = createSimHost(ROAD, { rapier }), [x, y, z] = readableSnapshot(saved ?? '')?.players[0]?.position ?? [], stood = arrival ?? (x === undefined || y === undefined || z === undefined ? undefined : { x, y, z });
    addCellWalls(road, cells);
    holdStrips(road, strips.map(strip => strip.mesh));
    const player = sessionPlayer(road);
    if (stood !== undefined) { player.position.set(stood.x, Math.max(stood.y, ROAD_SKIN), stood.z); player.motor.resetAt(player.position); }
    road.physics.near?.update(player.position.x, player.position.z);
    return road;
  }

  private static async world(cell: GridCell, input: HeadlessRuntimeInput, snapshot: string | SimSnapshot | undefined, options: GridServerOptions, refused?: SimSnapshot): Promise<CellWorld> {
    const declared = new Set(input.shard.ledger.map(row => row.fact)), placed = { id: cell.instance, shard: input.shard.identity.slug };
    const ledger = createQuestLedger(options.saves, input.shard, cell.instance), fact: CellWorld['fact'] = (name, entity) => declared.has(name) ? ledger(name, entity) : null;
    if (nativeCell(input)) {
      // J68: a native assembly keeps its ground whole and its solids as data. A saved world holds none of them, so a throwaway fresh one lists them.
      const near = input.product !== undefined && hasNativeAssembly(input.product) ? new NearColliders() : undefined, around = near === undefined ? { room: true } : { room: true, near };
      if (near !== undefined && snapshot !== undefined) (await bootTask('server:restore-collision-inventory', () => createTrustedHeadlessResident(input, undefined, around))).dispose();
      // A world with no save of its own takes the page's: the flags and records its fights read as they install.
      const page = snapshot === undefined ? { flags: [...new Set([...[input.shard.identity.slug, cell.instance].flatMap(level => pageSavedFlags(level)), ...refused?.flags ?? []])], state: pageRuntimeState(options.saves, cell.instance) } : undefined;
      const resident = await bootTask(snapshot === undefined ? 'server:simulation-and-collision-create' : 'server:continuation-restore', () => createTrustedHeadlessResident(input, snapshot, page === undefined ? around : { ...around, page })), { host } = resident;
      bindDiscovery(host, input.product === undefined ? [] : await serverPlaces(input.product)); await installServerChapters(host, input.product, input.shard, resident.fact); await installServerDoors(host, input.product, snapshot === undefined ? pageOpenDoors(options.saves, placed) : undefined);
      if (snapshot === undefined && options.lone === true) addLoneWalls(host);
      host.respawn.served = true; actRoutes(host).introLocks = true;
      const owned = ownedOf(host, input);
      return { host, owned, fall: fallFloorOf(input, host, options.lone === true), dispose: () => { resident.dispose(); }, fact, effects: () => resident.effects,
        adopt: () => { regionalRuntimeCheckpoint(options.saves, placed, input.shard.identity.revision).restore({ animals: [...host.entities.values()] }); return true; }, step: inputs => {
        const player = sessionPlayer(host);
        near?.update(player.position.x, player.position.z);
        stepResident(resident, player.id, inputs);
      } };
    }
    const effects: HeadlessEffect[] = [], { host, dispose, sim } = await bootTask(snapshot === undefined ? 'server:data-simulation-and-collision' : 'server:data-continuation-restore', () => openDataCell(input, snapshot, effects, options.lone === true));
    installRoomRespawn(host, []);
    installDeclaredClimate(host, input.shard.rows);
    bindDiscovery(host, input.product === undefined ? [] : await serverPlaces(input.product));
    host.respawn.served = true; actRoutes(host).introLocks = true;
    return { host, owned: ownedOf(host, input), fall: fallFloorOf(input, host, options.lone === true), dispose, fact, effects: () => effects, adopt: saved => { const held = sim(); return held === undefined || (saved === undefined ? importPageProgress(options.saves, placed, input.shard, held) : carryRefusedSave(input.shard, held, saved)); }, step: inputs => {
      effects.length = 0;
      // A data shard's prompts answer whoever stands at them; an id they don't offer that player is dropped, since an input may not end the server.
      const routes = actRoutes(host);
      for (const { player, acts } of inputs) for (const act of acts) {
        const claim = act.kind === 'interact' ? routes.claims.get(act.id) : undefined;
        if (act.kind === 'interact' && act.id.startsWith('seen:') && routes.seen !== null) routes.seen(player, act.id);
        else if (act.kind === 'interact' && act.id.startsWith(STORY_ACT)) routes.story?.(player, act.id.slice(STORY_ACT.length));
        else if (claim !== undefined) claim(player);
        else if (act.kind === 'interact' && sim()?.selectedInteraction(player) === act.id) sim()?.interact(act.id, player);
        else if (act.kind !== 'climate' && act.kind !== 'buy' && act.kind !== 'board' && act.kind !== 'wear') routes.refused++;
      }
      host.step(commandsOf(inputs));
    } };
  }

  private step(site: string | null, inputs: readonly NetTickInput[]): boolean {
    const started = this.options.now(), world = site === null ? undefined : this.worlds.get(site);
    const routes = actRoutes(this.grid.hostOf(site));
    netWorldInput(routes, inputs); netBuys(routes, inputs);
    const stepping = sessionPlayer(this.grid.hostOf(site));
    this.grid.hostOf(site).physics.near?.update(stepping.position.x, stepping.position.z);
    if (world === undefined) this.grid.stepSite(site, commandsOf(inputs)); else world.step(inputs);
    const host = this.grid.hostOf(site), player = sessionPlayer(host);
    // The page used to catch a fall, on its own body. The server's world has nothing below it, so it would fall for ever.
    world?.fall.step(player, () => { host.combat.fall(player.health, player.position, { kind: 'out-of-world', label: '' }); });
    this.options.stepped(host, this.options.now() - started);
    return true;
  }
  private filings(site: string | null, first: string): ReturnType<typeof ledgerFilings> {
    const world = site === null ? undefined : this.worlds.get(site);
    if (world === undefined) return [];
    const filings = ledgerFilings(world.host, first, world.effects(), world.fact);
    for (const filing of filings) world.owned.file(filing);
    return filings;
  }
  /** Worlds held beside the road. */
  get residents(): number { return this.worlds.size; }
  /** Solids kept as data by the world the player stands in, and those it holds now. */
  get near(): { readonly held: number; readonly live: number } { return this.host.physics.near?.counts ?? { held: 0, live: 0 }; }
  /** Characters of save documents this worker keeps a copy of. */
  get docsChars(): number {
    const { storage } = this.options;
    let total = 0;
    for (let index = 0; index < storage.length; index++) total += storage.getItem(storage.key(index) ?? '')?.length ?? 0;
    return total;
  }
  /** The host the session's player stands in. */
  get host(): SimHost { return this.grid.host(); }
  /** Connect the session's client; it waits for `open`. */
  connect(transport: Transport): void { this.rooms.connect(SESSION_PLAYER, transport); }
  /** A harness's move: the wire counts it, and the client snaps to it. */
  place(at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }, player: string = SESSION_PLAYER): void {
    const seat = mountedPlayerOf(this.host, player);
    if (seat?.mounted === true) seat.teleport(at.x, at.z, at.yaw); else this.host.players.get(player)?.resetPose(at, at.yaw);
  }
  /** A harness's flag on this player's own book. */
  raise(flag: string): void { questBooks(this.host).of(SESSION_PLAYER).flags.set(flag); }
  /** A proof's second client: a real link, in the cell this session stands in. Two phones come this way, once a server admits them. */
  join(at: { readonly join: string; readonly x: number; readonly y: number; readonly z: number }, transport: Transport): void {
    this.room.join(at.join, at, 0, this.grid.current(SESSION_PLAYER));
    this.rooms.connect(at.join, transport);
  }
  /** A harness's word on this world's blows from a player: real hits, and a long fight's end within a proof's reach. */
  hardHits(by: number): void {
    const { host } = this;
    host.events.answer('damage.modify', req => req === null || landedBy(req, host.players) === null ? req : { ...req, amount: req.amount * by }, host.scope, { order: 90 });
    for (const player of host.players.values()) heldArmsOf(host)?.of(player).refill(); // a boss's heart takes its arrows whole, and it wants more than a quiver
  }
  /** A Developer's `?bossGod`, on the pipeline that now lands the blow, and a lair's script, whose contact wears no fight's tag. */
  bossGod(): void { this.host.combat.playerRules(this.host.scope, { bossGod: true }); actRoutes(this.host).god = true; }
  open(): void { this.rooms.open(); }
  tick(): void { this.rooms.tick(); }
  /** Resolves true when every write so far reached the real storage, and tells `held` which of its saves that makes good. */
  private settle(held: readonly { settled: (durable: boolean) => void }[]): Promise<boolean> {
    this.settling = this.settling.then(() => this.options.storage.settled()).then(durable => { for (const slots of held) slots.settled(durable); return durable; });
    return this.settling;
  }
  /** Save where the session stands. The document for that place first, then the site that names it. */
  async save(): Promise<{ readonly tick: number; readonly durable: boolean }> {
    const site = this.grid.current(), { host } = this, { tick } = host.state, wire = capture(host), ledger = this.options.book.snapshot();
    const cell = site === null ? undefined : this.slots(site);
    const wrote = (cell?.write({ tick, snapshot: wire, ledger }) ?? true) && this.sites.write({ tick: ++this.saved, site, ...(site === null ? { road: wire, ledger } : {}) });
    return { tick, durable: await this.settle(cell === undefined ? [this.sites] : [cell, this.sites]) && wrote };
  }
  dispose(): void { this.rooms.dispose(); this.room.dispose(); this.grid.dispose(); }
}

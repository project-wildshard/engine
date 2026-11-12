// P1-E3.9, E5.2b: the grid in the server worker. One world steps at a time and each keeps its own clock and room, as the MMO's
// will; a crossing hands the client over with `travel`. It reads `simulation.ts`, `room.ts` and `roomNet.ts`, never
// `LiveGridHost`, whose ports are the page's.
//
// The boot decision: a grid session starts with its owner on the road, because `GridSimulation` is built around a highway host
// whose lead holds a motor, and `enter` then moves that lead into the home cell before the first tick. So a fresh boot, a
// restored cell and a save made on the road all take one path. The road and each cell's seams are the page's own strips, from
// C2's grid pack, held near the player the way a native cell's solids are, so no save carries them.
import { withOwner } from '@wildshard/engine/app/ownership';
import type { LedgerBook } from '@wildshard/engine/net/ledgerBook';
import type { ChatReports } from '@wildshard/engine/net/chat';
import type { NetTickInput } from '@wildshard/engine/net/room';
import { NearColliders, solidReach } from '@wildshard/engine/physics/nearColliders';
import { stripCollider } from '@wildshard/engine/physics/stripColliders';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimHost } from '@wildshard/engine/sim';
import { bootTask, bootWork } from '@wildshard/engine/boot/timing';
import { questBooks } from '@wildshard/engine/quest/players';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import type { ForwardedStorage } from '@wildshard/engine/saves/forwardedStorage';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { Transport } from '@wildshard/engine/net/transport';
import { GridAssembly, type GridCell, type GridPoint } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { heldArmsOf } from '@wildshard/engine/game/weapons/nativeHeld';
import { gridRecovery } from '@wildshard/engine/game/grid/recovery';
import { GridRoom } from '@wildshard/engine/game/grid/room';
import { commandsOf, GridNetRooms } from '@wildshard/engine/game/grid/roomNet';
import { GridSimulation } from '@wildshard/engine/game/grid/simulation';
import { landedBy } from '@wildshard/engine/combat/damageBook';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { openCellWorld, type CellWorld, type CellWorldOptions } from './cellWorld';
import { addCellWalls, ROAD } from './roadWorld';
import { netBuys, netWorldInput } from '../../../shared/host/standalone/netInput';
import { cellDocuments, CONTINUATION, ContinuationSlots, SITE, siteDocuments, type SavedContinuation, type SavedSite } from './continuation';
import { ledgerFilings } from './ledgerFilings';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';

/** Worlds the worker holds beside the road, and so what a crossroads costs a phone (E5.2b, J68): the one its player stands in. */
export const STANDALONE_RESIDENTS = 1;
/** A capsule's stand above its ground: one set down touching it cannot leave. */
const ROAD_SKIN = 0.02;

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
    const cellOptions: CellWorldOptions = { saves, lone: options.lone === true };
    const open = async (cell: GridCell, cached: SimSnapshot | undefined): Promise<CellWorld> => {
      const source = await input(cell);
      if (cached !== undefined) return openCellWorld(cell, source, cached, cellOptions);
      const held = slots(cell.instance), rows = held.candidates();
      for (const row of rows) {
        try { const world = await openCellWorld(cell, source, row.saved.snapshot, cellOptions); held.restored(row); resumed = row.saved; return world; }
        catch (error) { held.setAside(row); options.refused?.(error); }
      }
      // A later build can refuse a whole world over one thing it changed. The player's progress is still in there, and goes on from a fresh world.
      const refused = rows.map(row => ({ row, saved: readableSnapshot(row.saved.snapshot) })).find(row => row.saved !== undefined);
      const world = await openCellWorld(cell, source, undefined, cellOptions, refused?.saved);
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
    const filings = ledgerFilings(world.host, first, world.effects(), (name, entity, player) => player === first ? world.fact(name, entity, player) : null);
    for (const filing of filings) world.owned.of(filing.player).file(filing);
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

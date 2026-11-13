// E7.3: one cell of the world (J178). C5: no road yet; GC15's `handOver` moves a seat to a cell on the same worker. C3: the first human takes the host's own seat, and a vacant lead
// seat is refilled first. C6: every solid stays in memory. It holds no socket: a seat's `Transport` comes from the world's door.
import type { ChatReports } from '@wildshard/engine/net/chat';
import { LedgerBook, type LedgerFiling } from '@wildshard/engine/net/ledgerBook';
import { NetRoom, type NetTickInput } from '@wildshard/engine/net/room';
import { SimNetWorld } from '@wildshard/engine/net/simWorld';
import type { Transport } from '@wildshard/engine/net/transport';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { carryMotion } from '@wildshard/engine/game/grid/simulation';
import { netBuys, netWorldInput } from '../../../shared/host/standalone/netInput';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import { LEAD_SEAT, type CellWorld } from '../standalone/cellWorld';
import { openWorld } from '../openWorld';
import type { FallFloor } from '../standalone/fallFloor';
import { ledgerFilings } from '../standalone/ledgerFilings';
import { questBooks } from '@wildshard/engine/quest/players';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { carryDoc, exportPlayer, importPlayer, parseDoc, PLAYER_DOC_VERSION, type PlayerDoc } from './playerDoc';
import { PlayerStore, recoverPlayer } from './playerStore';
import { ShopGate } from './shopGate';
import { HOLD_MS, type ResumeAt, type RoomNews, type SeatEntry } from './cellProtocol';
import { LEFT } from './socketPump';
import type {PlaytestHit} from './playtest';
import { cellFrame, cellName } from './gridCells';
import {hitHistoryOf} from '@wildshard/engine/combat/rewind';
import { entrywaysStand, floorBelow } from '@wildshard/engine/physics/query';
import type { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { buildStrips } from '../standalone/roadWorld';
import { crossedTo, finite, type CrossArrival, type CrossTarget } from './crossing';

/** A fresh seat's step aside from the spawn, in metres, in turn. */
const SPAWN_ASIDE: readonly number[] = [0, 1, -1, 0.5, -0.5];
/** GC15: how far above a crossing's arrival its ground is looked for (a bank, not a roof), and how far above that ground it stands. */
const ARRIVAL_LIFT = 8, ARRIVAL_SKIN = 0.05;
/** How often a seat's clean checkpoints are looked for, in ticks. */
const CHECK_TICKS = 30;
/** E7.4: a change waits this long for more of its kind, and a seated player writes this often whatever happens. */
const DEBOUNCE_MS = 1000, EVERY_MS = 60_000;

/** A player who holds a seat, with or without a live link. */
interface Seat {
  readonly device: string; readonly name: string; readonly body: string; readonly store: PlayerStore; readonly fall: FallFloor;
  transport: Transport | null;
  /** The link's client in this room's `NetRoom`, and how to stop hearing its close, while it stands. */
  client: number | null; closeOff: (() => void) | null;
  /** When an open hold ends, or null while the link stands. */
  holdEnds: number | null;
  /** The last `seq` written: a read seeds it, so a restart's writes land on what is there (E7.4). */
  seq: number;
  /** WR7: the doc this seat was read from, whose fields this server does not know go back out with every write. */
  readonly read: PlayerDoc | null;
  /** The last receipt in a write. */
  receipted: number;
  /** When a change first waited for a checkpoint, and when one last went. */
  dirtyAt: number | null; savedAt: number;
  /** What a checkpoint watches: the stand they go back to, and their quest book. */
  stand: unknown; version: number;
  /** GC15: the room this seat last asked to cross into, and on which tick. */
  asked?: string; askedAt?: number;
}
/** GC15: the worker's road a cell opens onto: its name, the grid that places both, and the seams the cell's own world builds. */
export interface DedicatedRoomRoad { readonly name: string; readonly assembly: GridAssembly; readonly seams: readonly GridCollisionStrip['mesh'][] }
/** How a room is built. */
export interface DedicatedRoomOptions {
  /** The shard it runs: its pack, its stores and its save rows. */
  readonly slug: string; readonly build: string;
  /** GO3: the grid instance this room is, which names it everywhere else and numbers its frames. Left out, the shard's own grid cell. */
  readonly cell?: string;
  /**
   * GC15 (`WORLD_CROSSING=worker`): this worker's road, which the cell opens onto instead of standing lone. Its seam
   * strips are built into the cell's world, and a seat whose feet leave the cell asks the door to cross onto the road.
   */
  readonly road?: DedicatedRoomRoad;
  /** Stamped on every grant id, so a restarted room can't repeat one (E7.4). */
  readonly bootId: string;
  readonly input: HeadlessRuntimeInput;
  readonly now: () => number;
  readonly post: (news: RoomNews) => void;
  readonly reports?: ChatReports;
  /** A proof's override of `HOLD_MS`. */
  readonly holdMs?: number;
  readonly playtest?:(row:PlaytestHit)=>void;
}

/** How `loot/personal` marks what a player has been paid. */
const LOOT_ROW = 'loot:';
/** A fact's entity with the seat taken out of it: a player who comes back to another seat is the same player, and the same fact (E7.4). */
const portableEntity = (entity: string, body: string): string => entity === body ? 'player' : entity.startsWith(`${body}:`) ? entity.slice(body.length + 1) : entity;

/** One cell's room. */
export class DedicatedRoom implements CrossTarget {
  readonly net: NetRoom;
  readonly host: SimHost;
  readonly cell: CellWorld;
  readonly book: LedgerBook = new LedgerBook();
  readonly sim: SimNetWorld;
  /** Seats by device: J111's id is the only name a returning player has. */
  private readonly seats: Map<string, Seat>;
  private readonly bodies: Map<string, Seat>;
  private readonly playerRefusals: Map<string, string>;
  private readonly options: DedicatedRoomOptions;
  private readonly shop: ShopGate;
  /** The lead's seat as nobody has used it: what clears it for the next player. */
  private readonly blank: PlayerDoc;
  private constructor(options: DedicatedRoomOptions, cell: CellWorld, seats: Map<string, Seat>, bodies: Map<string, Seat>, playerRefusals: Map<string, string>) {
    this.options = options; this.cell = cell; this.host = cell.host; this.seats = seats; this.bodies = bodies; this.playerRefusals = playerRefusals;
    this.sim = new SimNetWorld(this.host, cellFrame(this.name), () => this.filings());
    this.sim.identified = (body, identity): boolean => {
      const seat = bodies.get(body);
      if (seat === undefined || seat.device !== identity.player) { playerRefusals.set(body, 'identity'); return false; }
      actRoutes(this.host).identities.set(body, seat.device);
      return true;
    };
    this.sim.nameOf = body => bodies.get(body)?.name;
    this.net = new NetRoom({ world: this.sim, build: options.build, book: this.book, step: inputs => { this.step(inputs); }, shout: line => { options.post({ kind: 'chat', line }); }, ...(options.reports === undefined ? {} : { reports: options.reports }) });
    this.net.open();
    this.parkLead();
    this.shop = new ShopGate(this.host);
    if(options.playtest!==undefined){
      const history=hitHistoryOf(this.host);if(history!==undefined)history.measureRewinds=true;
      this.host.events.on('damage.dealt',({req,dealt})=>{options.playtest?.({kind:'hit',tick:this.host.state.tick,amount:dealt,network:req.attackSeq!==undefined,rewind:req.rewind??{requested:0,applied:0,clamped:false}});},this.host.scope);
    }
    // E7.7: a room shares one sky, and no client's word moves it.
    actRoutes(this.host).climate = null;
    actRoutes(this.host).time = null;
    delete actRoutes(this.host).day;
    this.blank = exportPlayer(this.host, this.lead, { store: {}, ledger: { serial: 0, rows: [] } });
  }
  /** The grid instance this room is (GO3). */
  get name(): string { return this.options.cell ?? cellName(this.options.slug); }
  /** Open the shard's world, with nobody in it. */
  static async boot(options: DedicatedRoomOptions): Promise<DedicatedRoom> {
    const { input, slug } = options, seats = new Map<string, Seat>(), bodies = new Map<string, Seat>(), playerRefusals = new Map<string, string>();
    const seated = (body: string): Seat => {
      const seat = bodies.get(body);
      if (seat === undefined) throw new Error(`No seat for ${body}`);
      return seat;
    };
    // SERVER-PARITY HS1: the one world-build entry a shard's CI journeys tick too
    const cell = await openWorld(input, { room: true, cell: options.cell ?? cellName(slug), saves, lone: options.road === undefined,
      owned: body => seated(body).store.slots,
      profiles: {
        read: identity => seats.get(identity)?.store.rewards.read(slug).players[identity] ?? null,
        write: (identity, state) => {
          const seat = seats.get(identity); if (seat === undefined) return false;
          return seat.store.rewards.write({ legacyOwner: null, players: { [identity]: state } }, slug);
        },
        refused: body => { playerRefusals.set(body, 'reward-store'); },
      },
      facts: (name, entity, body, source) => {
        const seat = bodies.get(body);
        return seat === undefined ? null : seat.store.facts(source, slug)(name, portableEntity(entity, body));
      } });
    if (options.road !== undefined) buildStrips(cell.host, options.road.seams);
    return new DedicatedRoom(options, cell, seats, bodies, playerRefusals);
  }
  /** Where a new client should load, what a player with no save stands on. */
  get spawn(): ResumeAt { const { at, yaw } = this.host.level.player; return { x: at.x, y: at.y, z: at.z, yaw }; }
  /** Seats taken, by link or by hold. */
  get taken(): number { return this.seats.size; }
  /** Seats whose link is down and whose hold is open. */
  get holding(): number { let held = 0; for (const seat of this.seats.values()) if (seat.transport === null) held++; return held; }
  /** Whether this device already holds a seat here. */
  holds(device: string): boolean { return this.seats.has(device); }
  /** The body id a device's seat has here. */
  bodyId(device: string): string | undefined { return this.seats.get(device)?.body; }
  /** The body a device stands in. */
  bodyOf(device: string): PlayerSim | undefined { const seat = this.seats.get(device); return seat === undefined ? undefined : this.host.players.get(seat.body); }

  private get lead(): PlayerSim {
    const seat = this.host.players.get(LEAD_SEAT);
    if (seat === undefined) throw new Error('A room has no lead seat');
    return seat;
  }
  /** The lead's body leaves the world, and its seat stays for the systems bound to it. `removePlayer` refuses it. */
  /** Seats taken since this world began. */
  private joined = 0;
  /** GC15: bodies a crossing set down that haven't had a tick yet. A world that slept has no scene queries until it steps. */
  private readonly arriving = new Set<string>();
  private parkLead(): void { const { lead } = this; lead.motor.setEnabled(false); this.host.parked.add(lead.id); }
  private unparkLead(): void { const { lead } = this; this.host.parked.delete(lead.id); lead.motor.setEnabled(true); }

  /** Take a seat the door cleared, or give back the one this device holds. The room hears the `hello` the door read, and answers `welcome` as it would on any link. */
  seat(entry: SeatEntry, transport: Transport, hello: () => void): void {
    const held = this.seats.get(entry.device);
    if (held !== undefined) { this.rejoin(held, transport, hello); return; }
    if (entry.held === true) { transport.close('stalled'); return; } // its hold ended on the way here, and its save is what it comes back to
    const placed = this.place(entry, transport);
    if (typeof placed === 'string') { this.refused(entry, transport, hello, placed); return; }
    this.settle(placed);
    this.link(placed, transport, hello);
    this.flushRefusals();
    if (this.seats.get(entry.device) === placed) this.options.post({ kind: 'seated', device: entry.device, body: placed.body, seats: this.seats.size });
  }
  /**
   * A body for this entry: its doc checked and recovered, its seat in the maps, its body in the world, at `at` if given (a crossing's
   * arrival) else where its doc stood. No link yet. The reason, with nothing left behind, when it can't.
   */
  private place(entry: SeatEntry, transport: Transport, at?: ResumeAt): Seat | string {
    const lead = !this.bodies.has(LEAD_SEAT), body = lead ? LEAD_SEAT : entry.body, { spawn, host, book } = this, now = this.options.now();
    let doc = entry.doc;
    try { if (doc !== null) {
      if (parseDoc(doc, PLAYER_DOC_VERSION, this.options.slug) === null) throw new Error('Invalid player document');
      const bounds = this.options.input.shard.manifest?.bounds, reach = host.level.ground.size / 2, slack = 64;
      if (doc.at.x < (bounds?.x0 ?? -reach) - slack || doc.at.x > (bounds?.x1 ?? reach) + slack || doc.at.z < (bounds?.z0 ?? -reach) - slack || doc.at.z > (bounds?.z1 ?? reach) + slack) throw new Error('Player position is outside the world');
      doc = recoverPlayer(doc, entry.recovery ?? [], this.options.input, this.options.slug);
    } }
    catch (error) { return `recovery: ${String(error)}`; }
    const store = new PlayerStore(doc?.store ?? {}, () => { const own = this.seats.get(entry.device); if (own !== undefined) this.dirty(own); });
    const seat: Seat = { device: entry.device, name: entry.name, read: entry.doc, body, store, fall: this.cell.fallFloor(), transport, client: null, closeOff: null, holdEnds: null, seq: entry.seq, receipted: doc?.ledger.serial ?? 0, dirtyAt: null, savedAt: now, stand: null, version: 0 };
    this.seats.set(entry.device, seat); this.bodies.set(body, seat);
    if (lead) this.unparkLead();
    // Two who join together would otherwise stand inside each other.
    const aside = SPAWN_ASIDE[(this.joined++) % SPAWN_ASIDE.length] ?? 0, stand = { ...spawn, x: spawn.x + aside };
    const player = lead ? this.lead : host.addPlayer(body, at ?? doc?.at ?? stand, at?.yaw ?? doc?.at.yaw ?? spawn.yaw);
    player.netName = entry.name;
    if (lead) player.resetPose(stand, spawn.yaw);
    book.seat(body, doc?.ledger ?? { serial: 0, rows: [] });
    // Bind owned modifiers to the fresh body baseline before restoring its already modified health.
    try { this.cell.owned.of(body); if (doc !== null) importPlayer(this.host, player, doc); if (at !== undefined) player.resetPose(at, at.yaw); }
    catch (error) {
      // No save or live link is installed on a failed continuation. Keep the durable copies intact.
      this.seats.delete(entry.device); this.bodies.delete(body); this.cell.owned.drop(body); book.seat(body, { serial: 0, rows: [] });
      if (lead) this.clearLead(); else host.removePlayer(body);
      return `doc: ${String(error)}`;
    }
    return seat;
  }
  /** GC30: whether a walker off the road stands at this cell's entryways (`entrywaysStand`); else its worker's road walls it. */
  entrywaysStand(): boolean { return entrywaysStand(this.host.physics, ARRIVAL_LIFT); }
  /** GC15: this seat's feet left for cell `to`, standing at `at` in that cell's own frame. The door reads their save there and orders `handOver`. */
  crossing(device: string, to: string, at: ResumeAt): void {
    if ((this.seats.get(device)?.transport ?? null) !== null) this.options.post({ kind: 'crossing', device, to, at });
  }
  /**
   * GC15 (MP1.6 inside a worker): this seat walks into `target`, a cell on the same worker. A body is made there first, from `entry` (the
   * door's read of their save on that shard) standing at `at`; only then is their save here written, their body here let go and their
   * link handed over with `NetRoom.handOff` (`travel`, then the target's welcome and full frame), so the seat is held throughout and the
   * socket never closes. False when they do not stand in the target after: either nothing moved (`holds` here is still true), or the
   * target refused the body it had just made, and the seat is gone from both.
   */
  handOver(device: string, target: CrossTarget, entry: SeatEntry, at: ResumeAt): boolean {
    const seat = this.seats.get(device), transport = seat?.transport ?? null;
    if (seat === undefined || transport === null || seat.client === null || !this.net.live(seat.client) || target === this || target.holds(device)) return false;
    // GC34: the walker's own motion goes with them; a rider's lives on the mount it leaves here, so it arrives on foot from rest
    const arrived = target.admit(entry, transport, at, mountedPlayerOf(this.host, seat.body)?.mounted === true ? undefined : this.host.players.get(seat.body));
    if (typeof arrived === 'string') return false;
    mountedPlayerOf(this.host, seat.body)?.dismount();
    this.write(seat, 'cross');
    seat.closeOff?.(); seat.closeOff = null; seat.transport = null;
    const client = this.net.handOff(seat.client, target.net, target.sim.playerOf(arrived.body));
    seat.client = null;
    this.release(seat);
    return arrived.land(client);
  }
  /** GC15: a crossing seat's body here, from the door's read of its save on this shard (the previous copy if that one won't import). */
  admit(entry: SeatEntry, transport: Transport, at: ResumeAt, motion?: PlayerSim): CrossArrival | string {
    const { previous, ...current } = entry, { device } = entry;
    let arrived = this.place(current, transport, at), recovered = false;
    if (typeof arrived === 'string' && previous !== undefined) { arrived = this.place({ ...current, doc: previous.doc, recovery: previous.recovery }, transport, at); recovered = typeof arrived !== 'string'; }
    if (typeof arrived === 'string') return arrived;
    if (recovered) this.options.post({ kind: 'recovered', device, seq: entry.seq });
    const seat = arrived, player = this.host.players.get(seat.body);
    if (motion !== undefined && player !== undefined) carryMotion(motion, player);
    this.arriving.add(seat.body);
    return { body: seat.body, land: client => {
      this.settle(seat);
      // A link that dropped on the way is a link that dropped here: the seat holds, as any closed link's does.
      if (client === null) this.closed(seat, transport, 'crossed'); else this.bind(seat, transport, client);
      this.write(seat, 'cross');
      this.flushRefusals();
      return this.seats.get(device) === seat;
    } };
  }
  private refused(entry: SeatEntry, transport: Transport, hello: () => void, reason: string): void {
    const { previous, ...current } = entry;
    if (previous !== undefined) {
      this.seat({ ...current, doc: previous.doc, recovery: previous.recovery }, transport, hello);
      if (this.seats.has(entry.device)) this.options.post({ kind: 'recovered', device: entry.device, seq: entry.seq });
      return;
    }
    this.options.post({ kind: 'refused', device: entry.device, reason }); transport.close('refused');
    this.options.post({ kind: 'left', device: entry.device, seats: this.seats.size });
  }
  /** What a checkpoint compares against is as it stands now. */
  private settle(seat: Seat): void {
    seat.stand = this.host.respawn.stand(seat.body); seat.version = questBooks(this.host).of(seat.body).version;
  }
  private dirty(seat: Seat): void { seat.dirtyAt ??= this.options.now(); }
  /** Write this player's doc, and the receipts it has not yet carried. */
  private write(seat: Seat, reason: string): void {
    const player = this.host.players.get(seat.body), { options, book } = this;
    if (player === undefined) return;
    const ledger = book.rowOf(seat.body), receipts = ledger.rows.filter(row => row.serial > seat.receipted).map(row => ({ serial: row.serial, factId: row.id, grant: row.grant, name: row.name, amount: row.amount }));
    seat.receipted = ledger.serial; seat.seq++; seat.dirtyAt = null; seat.savedAt = options.now();
    options.post({ kind: 'save', write: { player: seat.device, name: seat.name, shard: options.slug, cell: this.name, build: options.build, saveVersion: PLAYER_DOC_VERSION, seq: seat.seq, reason, receipts, doc: carryDoc(seat.read, exportPlayer(this.host, player, { store: seat.store.documents(), ledger })) } });
  }
  private rejoin(seat: Seat, transport: Transport, hello: () => void): void {
    const old = seat.transport;
    seat.transport = transport; seat.holdEnds = null;
    old?.close('replaced');
    this.link(seat, transport, hello);
    this.flushRefusals();
    if (this.seats.get(seat.device) === seat) this.options.post({ kind: 'seated', device: seat.device, body: seat.body, seats: this.seats.size });
  }
  private link(seat: Seat, transport: Transport, hello: () => void): void {
    this.bind(seat, transport, this.net.join(transport, this.sim.playerOf(seat.body)));
    hello();
  }
  private bind(seat: Seat, transport: Transport, client: number): void {
    seat.closeOff?.();
    seat.transport = transport; seat.client = client;
    seat.closeOff = transport.onClose(reason => { this.closed(seat, transport, reason); });
  }
  private closed(seat: Seat, transport: Transport, reason: string): void {
    if (seat.transport !== transport) return; // a newer link has this seat
    seat.transport = null; seat.client = null; seat.closeOff?.(); seat.closeOff = null;
    if (reason === LEFT) { this.leave(seat, 'leave'); return; }
    const silent = 'silentMs' in transport && typeof transport.silentMs === 'number' ? transport.silentMs : 0;
    seat.holdEnds = this.options.now() + (this.options.holdMs ?? HOLD_MS) - silent;
  }
  /** The player is gone: their body goes, or the lead's seat goes back to waiting. */
  private leave(seat: Seat, reason: string): void {
    mountedPlayerOf(this.host, seat.body)?.dismount();
    this.write(seat, reason);
    this.release(seat);
  }
  /** Forget a retired seat without checkpointing progress whose store was refused. */
  private release(seat: Seat): void {
    this.playerRefusals.delete(seat.body);
    actRoutes(this.host).identities.delete(seat.body);
    this.seats.delete(seat.device); this.bodies.delete(seat.body); this.cell.owned.drop(seat.body); this.book.seat(seat.body, { serial: 0, rows: [] });
    if (seat.body === LEAD_SEAT) this.clearLead(); else this.host.removePlayer(seat.body);
    this.options.post({ kind: 'left', device: seat.device, seats: this.seats.size });
  }
  private flushRefusals(): void {
    for (const [body, reason] of this.playerRefusals) {
      this.playerRefusals.delete(body);
      const seat = this.bodies.get(body); if (seat === undefined) continue;
      const transport = seat.transport; seat.transport = null;
      mountedPlayerOf(this.host, body)?.dismount();
      this.options.post({ kind: 'refused', device: seat.device, reason });
      this.release(seat);
      transport?.close('refused');
    }
  }
  /** The seat goes back to how boot left it, and what it was paid goes with who earned it: the next player's bounty is their own (J105). */
  private clearLead(): void {
    actRoutes(this.host).identities.delete(LEAD_SEAT);
    const { ledgerDedupe } = this.host.slots, paid = `${LOOT_ROW}${LEAD_SEAT}:`;
    ledgerDedupe.splice(0, ledgerDedupe.length, ...ledgerDedupe.filter(row => !row.startsWith(paid)));
    importPlayer(this.host, this.lead, this.blank); this.parkLead();
  }
  private step(inputs: readonly NetTickInput[]): void {
    const { host, cell } = this, routes = actRoutes(host);
    const accepted = inputs.map(input => ({ ...input, acts: input.acts.filter(act => { if (act.kind !== 'climate') return true; routes.refused++; return false; }) }));
    this.shop.step(accepted);
    netWorldInput(routes, accepted); netBuys(routes, accepted);
    cell.step(accepted);
    this.standArrivals();
    // The page used to catch a fall, on its own body. The server's world has nothing below it, so it would fall for ever.
    for (const seat of this.seats.values()) {
      const player = host.players.get(seat.body);
      if (player !== undefined) seat.fall.step(player, () => { host.combat.fall(player.health, player.position, { kind: 'out-of-world', label: '' }); });
    }
  }
  /** The road can run lower than a cell's edge: a crossing's body set down inside the bank would fall out of the world. It stands on the top. */
  private standArrivals(): void {
    for (const body of this.arriving) {
      this.arriving.delete(body);
      const player = this.host.players.get(body);
      if (player === undefined || !finite(player.position)) continue;
      const { x, y, z } = player.position, top = floorBelow(this.host.physics, x, z, y + ARRIVAL_LIFT, ARRIVAL_LIFT * 2);
      if (top === undefined || top <= y + ARRIVAL_SKIN) continue;
      // GC34: set on the top, the walker keeps the ground speed, board, push and dash it crossed with (a reset stands it still, on foot)
      const { x: vx, z: vz } = player.velocity, { on, hoverAir, hoverBob } = player.board, impulse = player.impulse.clone(), dash = { ...player.dash };
      player.resetPose({ x, y: top + ARRIVAL_SKIN, z }, player.yaw);
      if (on) player.setBoard(true);
      player.board.hoverAir = hoverAir; player.board.hoverBob = hoverBob;
      player.velocity.x = vx; player.velocity.z = vz; player.impulse.copy(impulse); Object.assign(player.dash, dash);
    }
  }
  private filings(): readonly LedgerFiling[] {
    // MP3.1: a grant the player's book already holds (a replayed tick, a boot id that came round again) is paid once, so it never
    // reaches the purse a second time while the book refuses its receipt.
    const { host, cell, bodies, book } = this, filings = ledgerFilings(host, LEAD_SEAT, cell.effects(), cell.fact, this.options.bootId).filter(filing => bodies.has(filing.player) && !this.playerRefusals.has(filing.player) && !book.has(filing.player, filing.id));
    for (const filing of filings) { cell.owned.of(filing.player).file(filing); const seat = bodies.get(filing.player); if (seat !== undefined) this.dirty(seat); }
    return filings;
  }
  /** One fixed tick: holds that ran out, then the world. */
  tick(): void {
    this.flushRefusals();
    if (this.host.state.tick % CHECK_TICKS === 0) this.check(this.options.now());
    this.net.tick();
    this.flushRefusals();
    this.trigger();
  }
  /** GC15 (the GC15a list's item 3): a linked seat whose feet left this cell asks the door to cross onto the worker's road. */
  private trigger(): void {
    const { road } = this.options;
    if (road === undefined) return;
    const here = road.assembly.cell(this.name), { tick } = this.host.state;
    for (const seat of this.seats.values()) {
      const player = this.host.players.get(seat.body);
      if (seat.transport === null || player === undefined || !finite(player.position)) continue;
      const crossed = crossedTo(road.assembly, here, player.position);
      if (crossed === undefined || crossed.cell !== null) { delete seat.asked; continue; }
      if (seat.asked === road.name && tick - (seat.askedAt ?? 0) < CHECK_TICKS) continue;
      seat.asked = road.name; seat.askedAt = tick;
      this.crossing(seat.device, road.name, { ...crossed.at, yaw: player.yaw });
    }
  }
  /** Holds that ran out, and checkpoints that are due (E7.4). */
  private check(now: number): void {
    const books = questBooks(this.host), { respawn } = this.host;
    for (const seat of this.seats.values()) {
      if (seat.holdEnds !== null && now >= seat.holdEnds) { this.leave(seat, 'hold'); continue; }
      const stand = respawn.stand(seat.body), { version } = books.of(seat.body);
      if (stand !== seat.stand || version !== seat.version) { seat.stand = stand; seat.version = version; this.dirty(seat); }
      if ((seat.dirtyAt !== null && now - seat.dirtyAt >= DEBOUNCE_MS) || now - seat.savedAt >= EVERY_MS) this.write(seat, 'checkpoint');
    }
  }
  /** Everyone goes, as at SIGTERM: their last checkpoint now, and a close that says a restart is why. */
  drain(): void {
    for (const seat of this.seats.values()) { this.write(seat, 'restart'); seat.holdEnds = null; const { transport } = seat; seat.transport = null; transport?.close('restart'); }
  }
  dispose(): void { this.net.dispose(); this.cell.dispose(); }
}

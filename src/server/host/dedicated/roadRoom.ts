// GC15 (GRID-CROSSING, GC15a list item 1): a worker's road, the ground between its cells (62.5 m at staging's pitch), as a room. Its frame
// is the world's and goes out as frame 0, as a grid page numbers the road (`GridNetRooms`). It keeps no progress: a seat on it is a body,
// a link and a hold, and its save stays in the cell it left. Seats come and go only by crossing; a reconnect while held comes back here.
import type { ChatReports } from '@wildshard/engine/net/chat';
import { NetRoom, type NetTickInput } from '@wildshard/engine/net/room';
import { SimNetWorld } from '@wildshard/engine/net/simWorld';
import type { Transport } from '@wildshard/engine/net/transport';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { carryMotion } from '@wildshard/engine/game/grid/simulation';
import type { GridAssembly, GridCell } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { commandsOf } from '@wildshard/engine/game/grid/roomNet';
import { LEAD_SEAT } from '../standalone/cellWorld';
import { HOLD_MS, type ResumeAt, type RoomNews, type SeatEntry } from './cellProtocol';
import { crossedTo, finite, type CrossArrival, type CrossTarget } from './crossing';
import { FallFloor } from '../standalone/fallFloor';
import { placeOnRoad } from '../standalone/roadWorld';
import { LEFT } from './socketPump';

/** How often a seat whose crossing is asked for asks again, and how often holds are looked at, in ticks. */
const ASK_TICKS = 30;
/**
 * Below this a body has left the road's strips: it goes back to the last strip it stood on. The road's ground lies far below, and
 * the walls round other workers' cells stand from 0 m up, so a body down there could walk under them.
 */
const ROAD_FLOOR = -60;

interface RoadSeat {
  readonly device: string; readonly name: string; readonly body: string;
  transport: Transport | null; client: number | null; closeOff: (() => void) | null; holdEnds: number | null;
  /** The cell this seat last asked to cross into, and on which tick. */
  asked: string | null; askedAt: number;
  readonly fall: FallFloor;
}
export interface RoadRoomOptions {
  /** `roadName(first cell on this worker)`. */
  readonly name: string; readonly build: string;
  /** The road's world (`openRoad`): this room disposes it. */
  readonly host: SimHost;
  readonly assembly: GridAssembly;
  /** The cells a seat may cross into from here: this worker's. */
  readonly hosts: (instance: string) => boolean;
  readonly now: () => number;
  readonly post: (news: RoomNews) => void;
  readonly reports?: ChatReports;
  readonly holdMs?: number;
}

export class RoadRoom implements CrossTarget {
  readonly net: NetRoom;
  readonly sim: SimNetWorld;
  readonly host: SimHost;
  private readonly options: RoadRoomOptions;
  private readonly seats = new Map<string, RoadSeat>();
  /** The grid the trigger reads: the options' until a placement grows it (SA34a). */
  private assembly: GridAssembly;
  constructor(options: RoadRoomOptions) {
    this.options = options; this.host = options.host; this.assembly = options.assembly;
    // The road's level has a lead seat of its own, which nobody takes: every crossing seat is a body of its own.
    const lead = this.host.players.get(LEAD_SEAT);
    if (lead !== undefined) { lead.motor.setEnabled(false); this.host.parked.add(lead.id); }
    this.sim = new SimNetWorld(this.host, 0);
    this.sim.nameOf = body => [...this.seats.values()].find(seat => seat.body === body)?.name;
    this.net = new NetRoom({ world: this.sim, build: options.build, step: inputs => { this.step(inputs); }, shout: line => { options.post({ kind: 'chat', line }); }, ...(options.reports === undefined ? {} : { reports: options.reports }) });
    this.net.open();
  }
  get name(): string { return this.options.name; }
  /** Nobody starts on the road. */
  get spawn(): ResumeAt { return { x: 0, y: 0, z: 0, yaw: 0 }; }
  get taken(): number { return this.seats.size; }
  get holding(): number { let held = 0; for (const seat of this.seats.values()) if (seat.transport === null) held++; return held; }
  holds(device: string): boolean { return this.seats.has(device); }
  bodyId(device: string): string | undefined { return this.seats.get(device)?.body; }
  bodyOf(device: string): PlayerSim | undefined { const seat = this.seats.get(device); return seat === undefined ? undefined : this.host.players.get(seat.body); }

  admit(entry: SeatEntry, transport: Transport, at: ResumeAt, motion?: PlayerSim): CrossArrival | string {
    if (this.seats.has(entry.device)) return 'held';
    const player = this.host.addPlayer(entry.body, at, at.yaw);
    player.netName = entry.name;
    player.resetPose(at, at.yaw);
    if (motion !== undefined) carryMotion(motion, player);
    const seat: RoadSeat = { device: entry.device, name: entry.name, body: entry.body, transport, client: null, closeOff: null, holdEnds: null, asked: null, askedAt: 0, fall: new FallFloor(ROAD_FLOOR, true, at) };
    this.seats.set(entry.device, seat);
    return { body: seat.body, land: client => {
      if (client === null) this.closed(seat, transport, 'crossed'); else this.bind(seat, transport, client);
      return this.seats.get(entry.device) === seat;
    } };
  }
  /** A held seat's player dials again. The door only seats here a device this road holds. */
  seat(entry: SeatEntry, transport: Transport, hello: () => void): void {
    const seat = this.seats.get(entry.device);
    // Its hold ran out on the way here: the door still counts it, so say it left.
    if (seat === undefined) { transport.close('stalled'); this.options.post({ kind: 'left', device: entry.device, seats: this.seats.size }); return; }
    const old = seat.transport;
    seat.transport = transport; seat.holdEnds = null;
    old?.close('replaced');
    this.bind(seat, transport, this.net.join(transport, this.sim.playerOf(seat.body)));
    hello();
    this.options.post({ kind: 'seated', device: seat.device, body: seat.body, seats: this.seats.size });
  }
  /** The seat walks off the road into `target`, a cell on this worker: its body there first, then its link (`DedicatedRoom.handOver`'s order). */
  handOver(device: string, target: CrossTarget, entry: SeatEntry, at: ResumeAt): boolean {
    const seat = this.seats.get(device), transport = seat?.transport ?? null;
    if (seat === undefined || transport === null || seat.client === null || !this.net.live(seat.client) || target.holds(device)) return false;
    // GC34: the walker's own motion goes with them; a rider's lives on the mount it leaves here, so it arrives on foot from rest
    const arrived = target.admit(entry, transport, at, mountedPlayerOf(this.host, seat.body)?.mounted === true ? undefined : this.host.players.get(seat.body));
    if (typeof arrived === 'string') return false;
    mountedPlayerOf(this.host, seat.body)?.dismount();
    seat.closeOff?.(); seat.closeOff = null; seat.transport = null;
    const client = this.net.handOff(seat.client, target.net, target.sim.playerOf(arrived.body));
    seat.client = null;
    this.release(seat);
    return arrived.land(client);
  }
  /**
   * SA34a: cells placed on the running world (SA33). The trigger reads the grown grid, so feet inside a placed cell this worker hosts ask
   * to cross into it; the void floor is laid again without their squares, their strips go in, and `walled` (placed cells on other workers)
   * get the walls every other worker's cell has.
   */
  place(assembly: GridAssembly, strips: readonly GridCollisionStrip[], walled: readonly Pick<GridCell, 'origin'>[]): void {
    this.assembly = assembly;
    placeOnRoad(this.host, assembly.cells, strips, walled);
  }
  private bind(seat: RoadSeat, transport: Transport, client: number): void {
    seat.closeOff?.();
    seat.transport = transport; seat.client = client;
    seat.closeOff = transport.onClose(reason => { this.closed(seat, transport, reason); });
  }
  private closed(seat: RoadSeat, transport: Transport, reason: string): void {
    if (seat.transport !== transport) return;
    seat.transport = null; seat.client = null; seat.closeOff?.(); seat.closeOff = null;
    if (reason === LEFT) { this.release(seat); return; }
    const silent = 'silentMs' in transport && typeof transport.silentMs === 'number' ? transport.silentMs : 0;
    seat.holdEnds = this.options.now() + (this.options.holdMs ?? HOLD_MS) - silent;
  }
  private release(seat: RoadSeat): void {
    if (this.seats.get(seat.device) !== seat) return;
    this.seats.delete(seat.device);
    this.host.removePlayer(seat.body);
    this.options.post({ kind: 'left', device: seat.device, seats: this.seats.size });
  }
  private step(inputs: readonly NetTickInput[]): void {
    this.host.step(commandsOf(inputs));
    for (const seat of this.seats.values()) { const player = this.host.players.get(seat.body); if (player !== undefined) seat.fall.step(player, () => undefined); }
  }
  /** One fixed tick: holds that ran out, the world, then each linked seat's feet. */
  tick(): void {
    const { tick } = this.host.state, now = this.options.now();
    if (tick % ASK_TICKS === 0) for (const seat of this.seats.values()) if (seat.holdEnds !== null && now >= seat.holdEnds) this.release(seat);
    this.net.tick();
    for (const seat of this.seats.values()) {
      const player = this.host.players.get(seat.body);
      if (seat.transport === null || player === undefined || !finite(player.position)) continue;
      const crossed = crossedTo(this.assembly, null, player.position);
      const to = crossed?.cell?.instance ?? null;
      if (crossed === undefined || to === null || !this.options.hosts(to)) { seat.asked = null; continue; }
      if (seat.asked === to && this.host.state.tick - seat.askedAt < ASK_TICKS) continue;
      seat.asked = to; seat.askedAt = this.host.state.tick;
      this.options.post({ kind: 'crossing', device: seat.device, to, at: { ...crossed.at, yaw: player.yaw } });
    }
  }
  /** Everyone goes, as at SIGTERM. The road has nothing to write: each seat's save is in the cell it left. */
  drain(): void { for (const seat of this.seats.values()) { seat.holdEnds = null; const { transport } = seat; seat.transport = null; transport?.close('restart'); } }
  dispose(): void { this.net.dispose(); this.host.dispose(); }
}

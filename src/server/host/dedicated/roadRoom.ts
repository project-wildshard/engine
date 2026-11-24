// GC15 (GRID-CROSSING, GC15a list item 1): a worker's road, the ground between its cells (62.5 m at staging's pitch), as a room. Its frame
// is the world's and goes out as frame 0, as a grid page numbers the road (`GridNetRooms`). It keeps no progress: a seat on it is a body,
// a link and a hold, and its save stays in the cell it left. Seats come and go only by crossing; a reconnect while held comes back here.
import type { ChatReports } from '@wildshard/engine/net/chat';
import { NetRoom, type NetTickInput } from '@wildshard/engine/net/room';
import { SimNetWorld } from '@wildshard/engine/net/simWorld';
import type { Transport } from '@wildshard/engine/net/transport';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { carryMotion, motionOf } from '@wildshard/engine/game/grid/simulation';
import { gridBoardLimitAt } from '@wildshard/engine/game/grid/rules';
import type { GridAssembly, GridCell } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { commandsOf } from '@wildshard/engine/game/grid/roomNet';
import { LEAD_SEAT } from '../standalone/cellWorld';
import { HOLD_MS, type ResumeAt, type RoomNews, type SeatEntry } from './cellProtocol';
import { crossedTo, finite, type CrossArrival, type CrossTarget } from './crossing';
import { FallFloor } from '../standalone/fallFloor';
import { openCellWalls, openHomeFor, placeOnRoad } from '../standalone/roadWorld';
import { LEFT, SeatTransport } from './socketPump';
import { cellFrame } from './gridCells';
import { arrivalPose, bufferAt } from '@wildshard/engine/game/grid/zoneWalls';
import { decodeEnter, encodeEnter } from '@wildshard/engine/net/socketFrames';

/** How often a seat whose crossing is asked for asks again, and how often holds are looked at, in ticks. */
const ASK_TICKS = 30;
/**
 * Below this a body has left the road's strips: it goes back to the last strip it stood on. The road's ground lies far below, and
 * the walls round other workers' cells stand from 0 m up, so a body down there could walk under them.
 */
const ROAD_FLOOR = -60;
/**
 * ZE9a: the longest a body stands frozen at a gate. The door answers an entry within the page's own load wait (`READY_MS`, 120 s) and
 * lifts the freeze itself (ZE9b); this is the road's own floor under that, so no body is ever held for good.
 */
export const FREEZE_MS = 150_000;
/** ZE9b: how far above the gate's ground the traveller is set down past it, so an entry asphalt a touch higher never buries the feet. */
const ARRIVAL_LIFT = 0.5;
/** Why the road won't take an `enter` word, as its answer says. */
export type EnterRefusal = 'malformed' | 'home' | 'not-at-gate' | 'entering';

interface RoadSeat {
  readonly device: string; readonly name: string; readonly body: string;
  transport: Transport | null; client: number | null; closeOff: (() => void) | null; holdEnds: number | null;
  /** The cell this seat last asked to cross into, and on which tick. */
  asked: string | null; askedAt: number;
  /** ZE6: the cell this seat walked onto the road from, the one whose walls its motor passes and the only one the road crosses it into. */
  readonly home: string | null;
  readonly fall: FallFloor;
  /** ZE9a: the cell this seat is entering by its gate, and when the road lets it go anyway; its body stands still, its inputs dropped. */
  frozen: { readonly cell: string; readonly until: number } | null;
  /** The listener on its link's controls (its `enter` word). */
  controlOff: (() => void) | null;
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
  /** ZE9a: `FREEZE_MS` unless a test says otherwise. */
  readonly freezeMs?: number;
}

export class RoadRoom implements CrossTarget {
  readonly net: NetRoom;
  readonly sim: SimNetWorld;
  readonly host: SimHost;
  private readonly options: RoadRoomOptions;
  private readonly seats = new Map<string, RoadSeat>();
  /** GC15 (3): cells on other workers this road crosses into (`open`), their walls down. */
  private readonly opened = new Set<string>();
  /** The grid the trigger reads: the options' until a placement grows it (SA34a). */
  private assembly: GridAssembly;
  constructor(options: RoadRoomOptions) {
    this.options = options; this.host = options.host; this.assembly = options.assembly;
    // The road's level has a lead seat of its own, which nobody takes: every crossing seat is a body of its own.
    const lead = this.host.players.get(LEAD_SEAT);
    if (lead !== undefined) { lead.motor.setEnabled(false); this.host.parked.add(lead.id); }
    // ZE9a: a frozen body is led (it goes on the wire), so its client predicts no step of its own while it stands at the gate
    const frozen = (body: string): boolean => { for (const seat of this.seats.values()) if (seat.frozen !== null && seat.body === body) return true; return false; };
    this.host.leading.push(player => frozen(player.id));
    // Own native motion as well as prediction: dropping input alone still permits idle and impulse movement.
    this.host.events.answer('player.traversal', answer => {
      const player = this.host.traversing;
      return player !== null && frozen(player.id) ? true : answer;
    }, this.host.scope);
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
  /** GC4: someone on this road stands within `reach` of `origin` on both axes (a cell's square grown by how near counts). */
  near(origin: { readonly x: number; readonly z: number }, reach: number): boolean {
    for (const seat of this.seats.values()) { const at = this.host.players.get(seat.body)?.position; if (at !== undefined && Math.abs(at.x - origin.x) <= reach && Math.abs(at.z - origin.z) <= reach) return true; }
    return false;
  }
  /** MP5.2a: each seat's body and the home it walked out of. */
  homes(): Map<string, string | null> { const homes = new Map<string, string | null>(); for (const seat of this.seats.values()) homes.set(seat.body, seat.home); return homes; }
  /** MP5.2a: the grid as this road reads it now (a placement grows it). */
  get grid(): GridAssembly { return this.assembly; }
  /** ZE9a: the cell this seat is entering by its gate, its body frozen, or null. */
  entering(device: string): string | null { return this.seats.get(device)?.frozen?.cell ?? null; }
  bodyOf(device: string): PlayerSim | undefined { const seat = this.seats.get(device); return seat === undefined ? undefined : this.host.players.get(seat.body); }

  admit(entry: SeatEntry, transport: Transport, at: ResumeAt, motion?: PlayerSim): CrossArrival | string {
    if (this.seats.has(entry.device)) return 'held';
    const player = this.host.addPlayer(entry.body, at, at.yaw);
    player.netName = entry.name; player.roadPlace = true;
    // QA 11-15 row 8: the road's board cap is the page's (G60: 30 m/s on the deck, easing to 14 over a cell's strip); its frame is the world's
    player.hoverSpeedLimit = () => gridBoardLimitAt(this.assembly, player.position);
    player.resetPose(at, at.yaw);
    if (motion !== undefined) carryMotion(motion, player);
    const home = entry.home ?? null;
    if (home !== null) openHomeFor(this.host, player.motor, home);
    const seat: RoadSeat = { device: entry.device, name: entry.name, body: entry.body, transport, client: null, closeOff: null, holdEnds: null, asked: null, askedAt: 0, home, fall: new FallFloor(ROAD_FLOOR, true, at), frozen: null, controlOff: null };
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
    this.options.post({ kind: 'seated', device: seat.device, body: seat.body, seats: this.seats.size, ...(entry.admission === undefined ? {} : { admission: entry.admission }) });
  }
  /** GC15 (3): cells on other workers whose entryways stand: their walls on this road come down and a walker crosses into them. */
  open(cells: readonly string[]): void {
    const fresh = cells.filter(cell => !this.options.hosts(cell) && !this.opened.has(cell));
    openCellWalls(this.host, fresh);
    for (const cell of fresh) this.opened.add(cell);
  }
  /**
   * GC15 (3): the seat walks off the road into `to`, a cell on another worker. Its client hears `travel` (`NetRoom.handOut`), the seat goes
   * from here with no hold, and its port says `out` with the walker's motion and last stepped `seq` (MP1.6b), after everything else it was
   * sent: the door moves the socket.
   * False when nothing went (no live link here).
   */
  /** QA 11-23-b row 38: whether a seat here can be handed out into `to`, a cell on another worker (`open` has opened it). */
  opens(to: string): boolean { return this.opened.has(to); }
  handOut(device: string, to: string): boolean {
    const seat = this.seats.get(device), transport = seat?.transport ?? null, player = seat === undefined ? undefined : this.host.players.get(seat.body);
    if (seat === undefined || !(transport instanceof SeatTransport) || seat.client === null || player === undefined || !this.opened.has(to)) return false;
    const motion = mountedPlayerOf(this.host, seat.body)?.mounted === true ? null : motionOf(player);
    const out = this.net.handOut(seat.client, cellFrame(to));
    if (out === null) return false;
    mountedPlayerOf(this.host, seat.body)?.dismount();
    seat.closeOff?.(); seat.closeOff = null; seat.transport = null; seat.client = null;
    transport.handOut(motion, out.seq);
    this.release(seat);
    return true;
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
  place(assembly: GridAssembly, strips: readonly GridCollisionStrip[], walled: readonly GridCell[]): void {
    this.assembly = assembly;
    placeOnRoad(this.host, assembly.cells, strips, walled);
  }
  private bind(seat: RoadSeat, transport: Transport, client: number): void {
    seat.closeOff?.(); seat.controlOff?.(); seat.controlOff = null;
    seat.transport = transport; seat.client = client;
    seat.closeOff = transport.onClose(reason => { seat.controlOff?.(); seat.controlOff = null; this.closed(seat, transport, reason); });
    if (transport instanceof SeatTransport) seat.controlOff = transport.onControl((control, bytes) => { if (control === 'enter') this.enter(seat, transport, bytes); });
  }
  /**
   * ZE9a (J352): the seat's client reached a gate's 0 and says `enter` {cell}. Taken only while its feet stand in that cell's buffer on
   * this road, never into its home: the body stops where it stands, its inputs are dropped and nothing moves it until the freeze lifts.
   * Riders get off. Anything else is answered `refused` with the reason, and the body plays on.
   */
  private enter(seat: RoadSeat, transport: SeatTransport, bytes: ArrayBuffer): void {
    const word = decodeEnter(bytes), player = this.host.players.get(seat.body);
    const refuse = (refused: EnterRefusal): void => { transport.control('enter', encodeEnter({ cell: word?.cell ?? '', refused })); };
    if (word === null || word.refused !== undefined || player === undefined || !finite(player.position)) { refuse('malformed'); return; }
    if (seat.frozen !== null) { refuse('entering'); return; }
    if (word.cell === seat.home) { refuse('home'); return; }
    const at = bufferAt(this.assembly.cells, { instance: seat.home ?? '' }, player.position);
    if (at?.instance !== word.cell) { refuse('not-at-gate'); return; }
    mountedPlayerOf(this.host, seat.body)?.dismount();
    const { x, y, z } = player.position;
    player.resetPose({ x, y, z }, player.yaw);
    // NetRoom has already queued catch-up commands for this tick. Park the entire
    // player so neither the ordinary motion phase nor an extra command can move it.
    this.host.parked.add(player.id); this.host.shown.add(player.id);
    seat.frozen = { cell: word.cell, until: this.options.now() + (this.options.freezeMs ?? FREEZE_MS) };
    // ZE9b: the door answers `arrive` with the pose past the gate and moves the seat there once the page is ready
    const pose = arrivalPose(at, player.position);
    this.options.post({ kind: 'entering', device: seat.device, to: word.cell, at: { x: pose.x, y: y + ARRIVAL_LIFT, z: pose.z, yaw: pose.yaw } });
  }
  /** ZE9b: the door called the entry off; the body plays on where it stands. */
  thaw(device: string): void { const seat = this.seats.get(device); if (seat !== undefined) { this.host.parked.delete(seat.body); this.host.shown.delete(seat.body); seat.frozen = null; } }
  private closed(seat: RoadSeat, transport: Transport, reason: string): void {
    if (seat.transport !== transport) return;
    seat.transport = null; seat.client = null; seat.closeOff?.(); seat.closeOff = null;
    if (reason === LEFT) { this.release(seat); return; }
    const silent = 'silentMs' in transport && typeof transport.silentMs === 'number' ? transport.silentMs : 0;
    seat.holdEnds = this.options.now() + (this.options.holdMs ?? HOLD_MS) - silent;
  }
  private release(seat: RoadSeat): void {
    if (this.seats.get(seat.device) !== seat) return;
    seat.controlOff?.(); seat.controlOff = null; seat.frozen = null;
    this.host.parked.delete(seat.body); this.host.shown.delete(seat.body);
    this.seats.delete(seat.device);
    this.host.removePlayer(seat.body);
    this.options.post({ kind: 'left', device: seat.device, seats: this.seats.size });
  }
  private step(inputs: readonly NetTickInput[]): void {
    const frozen = new Set<string>();
    for (const seat of this.seats.values()) if (seat.frozen !== null) frozen.add(seat.body);
    this.host.step(commandsOf(frozen.size === 0 ? inputs : inputs.filter(input => !frozen.has(input.player))));
    for (const seat of this.seats.values()) { const player = this.host.players.get(seat.body); if (player !== undefined) seat.fall.step(player, () => undefined); }
  }
  /** One fixed tick: holds that ran out, the world, then each linked seat's feet. */
  tick(): void {
    const { tick } = this.host.state, now = this.options.now();
    if (tick % ASK_TICKS === 0) for (const seat of this.seats.values()) {
      if (seat.holdEnds !== null && now >= seat.holdEnds) this.release(seat);
      else if (seat.frozen !== null && now >= seat.frozen.until) this.thaw(seat.device);
    }
    this.net.tick();
    for (const seat of this.seats.values()) {
      const player = this.host.players.get(seat.body);
      if (seat.transport === null || seat.frozen !== null || player === undefined || !finite(player.position)) continue;
      const crossed = crossedTo(this.assembly, null, player.position);
      const to = crossed?.cell?.instance ?? null;
      // ZE6 (J352): the road crosses a seat into its own home only; every other cell's buffer leads to its gate (zone entry), not in
      if (crossed === undefined || to === null || to !== seat.home || !this.options.hosts(to)) { seat.asked = null; continue; }
      if (seat.asked === to && this.host.state.tick - seat.askedAt < ASK_TICKS) continue;
      seat.asked = to; seat.askedAt = this.host.state.tick;
      this.options.post({ kind: 'crossing', device: seat.device, to, at: { ...crossed.at, yaw: player.yaw } });
    }
  }
  /** Everyone goes, as at SIGTERM. The road has nothing to write: each seat's save is in the cell it left. */
  drain(): void { for (const seat of this.seats.values()) { seat.holdEnds = null; const { transport } = seat; seat.transport = null; transport?.close('restart'); } }
  dispose(): void { this.net.dispose(); this.host.dispose(); }
}

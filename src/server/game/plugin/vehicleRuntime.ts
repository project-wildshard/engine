import type { SimHost } from '@wildshard/engine/sim';
import { KinematicMover } from '@wildshard/engine/physics/mover';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { clearStand, floorBelow } from '@wildshard/engine/physics/query';
import { tagOf } from '@wildshard/engine/physics/surface';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { STEER_PROBE } from '@wildshard/engine/sim/moverMotion';
import { stepVehicle, vehicleAt, type VehicleCommand, type VehicleState, type VehicleWorld } from '@wildshard/engine/sim/vehicle';
import type { MoverBox, MoverPose } from '@wildshard/format/moverPose';
import type { VehicleDock, VehicleKind, VehicleSeat, Vehicles } from '@wildshard/format/vehicles';
import { dockHulls } from '../../../shared/game/shardfile/shardVehicles';

/**
 * MIRROR-SALT-ZONE MSZ8 and MSZ9: the vehicles a cell's server runs, beside `MoverRuntime`. It spawns each kind from its
 * docks (a `shared` dock's vehicle at once, a `player` dock's on a player's ask, one each, on a clear dock), owns each
 * vehicle's kinematic body and hull (`dockHulls`, the kind's boxes), and steps it with MSZ7's `stepVehicle` from its
 * driver's stick (`riderStick`). A per-player vehicle goes `VEHICLE_IDLE_DESPAWN` s after its driver leaves; a shared one
 * left away from its dock goes back to it after the dock's `respawn` s.
 *
 * MSZ9: each free seat offers a prompt within `SEAT_REACH` (the kind's *drive* label for its driver, *ride* for a
 * passenger); boarding leads the body on its seat (as `carryNative` leads a carry's rider), and leaving sets it down at the
 * seat's leave point, or the nearest clear ground when that is blocked. A seat empties when its rider disconnects, parks,
 * dies or is moved away (a teleport), and `leave` is what a gate calls. Until a page drives this runtime, MSZ6's steer
 * carries drive the docks.
 */
export const VEHICLE_IDLE_DESPAWN = 60;
/** m within which a free seat's prompt shows. */
export const SEAT_REACH = 2.5;
/** m from its dock within which a shared vehicle counts as home (it does not snap back). */
const HOME_RADIUS = 1;
/** m a seated body may be found from where it was led before it counts as moved away (a teleport). */
const MOVED_AWAY = 3;
const NEUTRAL: VehicleCommand = { throttle: 0, turn: 0, boost: false };
const DRIVE_LABEL = 'Drive', RIDE_LABEL = 'Ride';

/** A free seat's prompt: who takes it from where. A per-player vehicle's driver seat is its `owner`'s alone. */
export interface VehicleSeatPrompt {
  readonly id: string; readonly vehicle: string; readonly seat: number; readonly role: VehicleSeat['role'];
  readonly label: string; readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly radius: number;
  readonly owner: string | null;
}
/** The wire id of a seat's prompt, and of a player dock's (which spawns that player's vehicle and seats them to drive). */
export const vehicleSeatPrompt = (vehicle: string, seat: number): string => `${vehicle}.seat.${String(seat)}`;
export const vehicleDockPrompt = (dock: string): string => `${dock}.dock`;

/** What a server lends its vehicles. */
export interface VehicleRuntimePorts {
  readonly physics: () => Physics;
  /** The driver's stick this tick in the vehicle's frame (heading `yaw`), or none without a command. */
  readonly stick: (driver: string, yaw: number) => VehicleCommand | undefined;
}
/** One vehicle out in the cell. */
interface Live {
  readonly id: string;
  readonly dock: VehicleDock;
  readonly kind: VehicleKind;
  /** The player a `player` dock spawned it for; none for a shared one. */
  readonly owner: string | null;
  readonly body: KinematicMover;
  readonly world: VehicleWorld;
  state: VehicleState;
  /** Who sits in each of the kind's seats. */
  readonly seats: (string | null)[];
  /** s since its driver left (or since it spawned riderless). */
  idle: number;
}

const poseOf = (state: VehicleState): MoverPose => ({ position: { x: state.x, y: state.y, z: state.z }, euler: { x: state.pitch, y: state.yaw, z: -state.roll }, enabled: true });
/** A point of the kind's frame (x right, y up, z back) in the cell, about its heading. */
function worldPoint(state: VehicleState, local: readonly [number, number, number]): { x: number; y: number; z: number } {
  const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw), [x, y, z] = local;
  return { x: state.x + x * cos + z * sin, y: state.y + y, z: state.z - x * sin + z * cos };
}
/** How far its hull reaches forward (its frame's -z), back and to the side: where its wheels read the ground. */
function reachOf(boxes: readonly MoverBox[]): { readonly bow: number; readonly stern: number; readonly side: number } {
  const most = (pick: (box: MoverBox) => number): number => boxes.reduce((far, box) => Math.max(far, pick(box)), 0.5);
  return { bow: most(box => -box.z + box.hz), stern: most(box => box.z + box.hz), side: most(box => Math.abs(box.x) + box.hx) };
}

export class VehicleRuntime {
  private readonly kinds: ReadonlyMap<string, VehicleKind>;
  private readonly docks: ReadonlyMap<string, VehicleDock>;
  private readonly hulls: ReadonlyMap<string, readonly MoverBox[]>;
  private readonly live = new Map<string, Live>();
  private readonly ports: VehicleRuntimePorts;
  /** Where each seated player was led last step. */
  private readonly led = new Map<string, { x: number; y: number; z: number }>();
  /** The bound host: its players, and its prompts claimed by wire id. */
  private host: SimHost | null = null;
  private routes: ReturnType<typeof actRoutes> | null = null;
  constructor(vehicles: Vehicles, ports: VehicleRuntimePorts) {
    this.ports = ports;
    this.kinds = new Map(vehicles.kinds.map(kind => [kind.id, kind]));
    this.docks = new Map(vehicles.docks.map(dock => [dock.id, dock]));
    this.hulls = dockHulls(vehicles);
    for (const dock of vehicles.docks) if (dock.per === 'shared') this.spawnAt(dock, null);
  }
  /** The vehicle a dock gives `player`: a shared dock's one, or this player's own from a `player` dock (spawned once). */
  spawn(dockId: string, player: string): string {
    const dock = this.docks.get(dockId); if (dock === undefined) throw new Error(`Unknown vehicle dock ${dockId}`);
    if (dock.per === 'shared') return dockId;
    const id = `${dockId}~${player}`;
    return this.live.has(id) ? id : this.spawnAt(dock, player);
  }
  /** Whether a player dock stands clear for a new vehicle: no other vehicle's centre within its hull's reach. */
  clear(dockId: string): boolean {
    const dock = this.docks.get(dockId), boxes = this.hulls.get(dockId); if (dock === undefined || boxes === undefined) return false;
    const { bow, stern, side } = reachOf(boxes), reach = Math.hypot(Math.max(bow, stern), side) * 2;
    return [...this.live.values()].every(vehicle => Math.hypot(vehicle.state.x - dock.at[0], vehicle.state.z - dock.at[2]) >= reach);
  }
  /** Every vehicle out now. */
  ids(): readonly string[] { return [...this.live.keys()]; }
  /** Who drives it, or null. */
  driver(id: string): string | null { const vehicle = this.get(id); return vehicle.seats[vehicle.kind.seats.findIndex(seat => seat.role === 'driver')] ?? null; }
  /** Who sits in each seat. */
  riders(id: string): readonly (string | null)[] { return [...this.get(id).seats]; }
  /** The seat a player holds, if any. */
  seatOf(player: string): { readonly vehicle: string; readonly seat: number } | undefined {
    for (const vehicle of this.live.values()) { const seat = vehicle.seats.indexOf(player); if (seat !== -1) return { vehicle: vehicle.id, seat }; }
    return undefined;
  }
  /** Where a seat is now: its rider's feet. */
  seatPoint(id: string, seat: number): { x: number; y: number; z: number } {
    const vehicle = this.get(id), row = vehicle.kind.seats[seat]; if (row === undefined) throw new Error(`No seat ${String(seat)} on ${id}`);
    return worldPoint(vehicle.state, row.at);
  }
  /** Every free seat's prompt, and each player dock's while it stands clear. */
  prompts(): readonly VehicleSeatPrompt[] {
    const seats = [...this.live.values()].flatMap(vehicle => vehicle.kind.seats.flatMap((row, seat): VehicleSeatPrompt[] => vehicle.seats[seat] !== null ? [] : [{
      id: vehicleSeatPrompt(vehicle.id, seat), vehicle: vehicle.id, seat, role: row.role, at: worldPoint(vehicle.state, row.at), radius: SEAT_REACH,
      label: row.role === 'driver' ? vehicle.kind.labels?.drive ?? DRIVE_LABEL : vehicle.kind.labels?.ride ?? RIDE_LABEL,
      owner: row.role === 'driver' ? vehicle.owner : null }]));
    const docks = [...this.docks.values()].filter(dock => dock.per === 'player' && this.clear(dock.id)).map((dock): VehicleSeatPrompt => ({
      id: vehicleDockPrompt(dock.id), vehicle: dock.id, seat: 0, role: 'driver', at: { x: dock.at[0], y: dock.at[1], z: dock.at[2] }, radius: SEAT_REACH,
      label: this.kinds.get(dock.kind)?.labels?.drive ?? DRIVE_LABEL, owner: null }));
    return [...seats, ...docks];
  }
  /** Take a free seat (the first free one, or `seat`): a per-player vehicle's driver seat only its owner, one seat a player. */
  board(id: string, player: string, seat?: number): boolean {
    const vehicle = this.get(id);
    if (this.seatOf(player) !== undefined) return false;
    const index = seat ?? vehicle.seats.findIndex((rider, at) => rider === null && (vehicle.kind.seats[at]?.role !== 'driver' || vehicle.owner === null || vehicle.owner === player));
    const row = vehicle.kind.seats[index];
    if (row === undefined || vehicle.seats[index] !== null || (row.role === 'driver' && vehicle.owner !== null && vehicle.owner !== player)) return false;
    vehicle.seats[index] = player; if (row.role === 'driver') vehicle.idle = 0;
    return true;
  }
  /** A player gets out (the leave press, a gate): set down at the seat's leave point, or the nearest clear ground. */
  leave(player: string): { x: number; y: number; z: number } | undefined {
    const held = this.seatOf(player); if (held === undefined) return undefined;
    const vehicle = this.get(held.vehicle), row = vehicle.kind.seats[held.seat];
    vehicle.seats[held.seat] = null; this.led.delete(player);
    if (row?.role === 'driver') vehicle.idle = 0;
    const body = this.host?.players.get(player);
    if (row === undefined || body === undefined) return undefined;
    const at = this.setDown(vehicle, row, body.motor.opts);
    body.position.set(at.x, at.y, at.z); body.velocity.set(0, 0, 0); body.motor.resetAt(body.position); body.carried = false;
    return at;
  }
  /** Pose of a vehicle now. */
  pose(id: string): MoverPose { return poseOf(this.get(id).state); }
  /** How fast it goes along its heading (m/s). */
  speed(id: string): number { return this.get(id).state.forward; }
  /** One fixed step of every vehicle: drive, pose the body, then despawn or bring home the idle ones. */
  step(dt: number): void {
    for (const vehicle of this.live.values()) {
      const driver = this.driver(vehicle.id), command = driver === null ? NEUTRAL : this.ports.stick(driver, vehicle.state.yaw) ?? NEUTRAL;
      vehicle.state = stepVehicle(vehicle.state, command, vehicle.kind.handling, vehicle.world, dt);
      vehicle.body.setPose(poseOf(vehicle.state));
      if (driver !== null) continue;
      vehicle.idle += dt;
      if (vehicle.seats.some(rider => rider !== null)) continue; // a passenger keeps it out
      if (vehicle.owner !== null) { if (vehicle.idle >= VEHICLE_IDLE_DESPAWN) this.despawn(vehicle.id); continue; }
      const [x, , z] = vehicle.dock.at;
      if (vehicle.idle >= vehicle.dock.respawn && Math.hypot(vehicle.state.x - x, vehicle.state.z - z) > HOME_RADIUS) this.home(vehicle);
    }
  }
  /** Lead each seated body onto its seat; a seat whose rider left the world, parked, died or was moved away empties. */
  seat(host: Pick<SimHost, 'players' | 'parked'>): void {
    for (const vehicle of this.live.values()) vehicle.kind.seats.forEach((row, index) => {
      const player = vehicle.seats[index]; if (player === null || player === undefined) return;
      const body = host.players.get(player), last = this.led.get(player);
      const moved = body !== undefined && last !== undefined && Math.hypot(body.position.x - last.x, body.position.y - last.y, body.position.z - last.z) > MOVED_AWAY;
      if (body === undefined || host.parked.has(player) || !body.health.alive || moved) {
        vehicle.seats[index] = null; this.led.delete(player); if (row.role === 'driver') vehicle.idle = 0;
        if (body !== undefined) body.carried = false;
        return;
      }
      const at = worldPoint(vehicle.state, row.at);
      body.position.set(at.x, at.y, at.z); body.motor.resetAt(body.position); body.velocity.set(0, 0, 0); body.fall.grounded = false; body.carried = true;
      if (row.role === 'driver') body.yaw = vehicle.state.yaw;
      this.led.set(player, at);
    });
  }
  /** Run on a host: step and seat before its bodies, claim each prompt by its wire id, and keep led bodies out of the hulls. */
  bind(host: SimHost): void {
    this.host = host; this.routes = actRoutes(host);
    for (const vehicle of this.live.values()) this.claim(vehicle);
    for (const dock of this.docks.values()) if (dock.per === 'player') this.routes.claims.set(vehicleDockPrompt(dock.id), player => {
      const body = host.players.get(player);
      if (body === undefined || !this.clear(dock.id) || Math.hypot(body.position.x - dock.at[0], body.position.z - dock.at[2]) > SEAT_REACH) return;
      const id = this.spawn(dock.id, player);
      this.board(id, player, this.get(id).kind.seats.findIndex(seat => seat.role === 'driver'));
    });
    host.leading.push(body => this.seatOf(body.id) !== undefined);
    host.onStep('vehicles', dt => { this.step(dt); this.seat(host); });
  }
  /** Remove every body (a Map keeps iterating past an entry deleted under it). */
  dispose(): void { for (const id of this.live.keys()) this.despawn(id); }

  private get(id: string): Live { const vehicle = this.live.get(id); if (vehicle === undefined) throw new Error(`No vehicle ${id}`); return vehicle; }
  private claim(vehicle: Live): void {
    const routes = this.routes; if (routes === null) return;
    vehicle.kind.seats.forEach((row, seat) => {
      routes.claims.set(vehicleSeatPrompt(vehicle.id, seat), player => {
        // the claimant's body must be within reach of the seat (the page offers it only there)
        const at = worldPoint(vehicle.state, row.at), body = this.host?.players.get(player)?.position;
        if (!this.live.has(vehicle.id) || body === undefined || Math.hypot(body.x - at.x, body.z - at.z) > SEAT_REACH) return;
        this.board(vehicle.id, player, seat);
      });
    });
  }
  private spawnAt(dock: VehicleDock, owner: string | null): string {
    const kind = this.kinds.get(dock.kind), boxes = this.hulls.get(dock.id);
    if (kind === undefined || boxes === undefined) throw new Error(`Vehicle dock ${dock.id} has no kind or hull`);
    const id = owner === null ? dock.id : `${dock.id}~${owner}`, state = vehicleAt({ x: dock.at[0], y: dock.at[1], z: dock.at[2] }, dock.yaw);
    // the floor under it, through its own hull (or it would climb onto itself)
    const floor = (x: number, z: number, fromY: number): number | undefined => floorBelow(this.ports.physics(), x, z, fromY, STEER_PROBE.up + STEER_PROBE.down, undefined, collider => tagOf(collider)?.owner !== id);
    const body = new KinematicMover(this.ports.physics(), boxes, poseOf(state), id);
    const vehicle: Live = { id, dock, kind, owner, body, world: { floor, ...reachOf(boxes) }, state, seats: kind.seats.map(() => null), idle: 0 };
    this.live.set(id, vehicle); this.claim(vehicle);
    return id;
  }
  private despawn(id: string): void {
    const vehicle = this.live.get(id); if (vehicle === undefined) return;
    vehicle.body.dispose(); this.live.delete(id);
    vehicle.kind.seats.forEach((_row, seat) => { this.routes?.claims.delete(vehicleSeatPrompt(id, seat)); });
  }
  private home(vehicle: Live): void {
    vehicle.state = vehicleAt({ x: vehicle.dock.at[0], y: vehicle.dock.at[1], z: vehicle.dock.at[2] }, vehicle.dock.yaw); vehicle.idle = 0;
    vehicle.body.resetPose(poseOf(vehicle.state));
  }
  /** The seat's leave point when a body stands clear there; else the other side's; else the nearest clear ground round it. */
  private setDown(vehicle: Live, row: VehicleSeat, size: { readonly radius: number; readonly height: number }): { x: number; y: number; z: number } {
    const physics = this.ports.physics(), [lx, ly, lz] = row.leave, side = vehicle.world.side;
    const tries: (readonly [number, number, number])[] = [row.leave, [-lx, ly, lz]];
    for (let ring = 1; ring <= 4; ring++) for (let k = 0; k < 8; k++) {
      const angle = k * Math.PI / 4, r = side + ring * 0.75;
      tries.push([Math.cos(angle) * r, ly, Math.sin(angle) * r + lz]);
    }
    for (const local of tries) {
      const at = worldPoint(vehicle.state, local), feet = clearStand(physics, at.x, at.z, at.y, size);
      if (feet !== undefined) return { x: at.x, y: feet, z: at.z };
    }
    return worldPoint(vehicle.state, row.leave);
  }
}

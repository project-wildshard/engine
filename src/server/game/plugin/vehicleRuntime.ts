import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { KinematicMover } from '@wildshard/engine/physics/mover';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { clearStand, floorBelow } from '@wildshard/engine/physics/query';
import { tagOf } from '@wildshard/engine/physics/surface';
import { GROUP, queryGroups } from '@wildshard/engine/physics/groups';
import type { Cuboid } from '@dimforge/rapier3d-simd';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { STEER_PROBE } from '@wildshard/engine/sim/moverMotion';
import { publishScriptBody, publishWorldState, withdrawScriptBody, type StateNetRow } from '@wildshard/engine/sim/shardRows';
import { stepVehicle, vehicleAt, type VehicleCommand, type VehicleHit, type VehicleImpact, type VehicleState, type VehicleStepOut, type VehicleWorld } from '@wildshard/engine/sim/vehicle';
import type { MoverBox, MoverPose } from '@wildshard/format/moverPose';
import type { VehicleDock, VehicleKind, VehicleSeat, Vehicles } from '@wildshard/format/vehicles';
import { dockHulls } from '../../../shared/game/shardfile/shardVehicles';
import { playerVehicle, vehicleDockPrompt, vehicleLeavePrompt, vehicleSeatPrompt, vehicleSeatRow, vehicleWornRow } from '../../../shared/game/shardfile/wirePrompts';
import { riderStick } from './mover';

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
 * dies or is moved away (a teleport), and `leave` is what a gate calls.
 *
 * MSZ9b: `bind` puts it on a host's wire and in its saves. Each vehicle's pose is a `script:` row of its own (there while it is
 * out), each taken seat a `state` row (`vehicleSeatRow`), and a seated rider's leave press goes by `vehicleLeavePrompt`. A
 * seated body answers the host's `player.traversal` ask, so its walk stands down while the seat leads it. A save keeps every
 * vehicle out, its state, seats and body handle; a save from before the vehicles restores with them fresh at their docks.
 *
 * MSZ14 (J459 call 4 B): hits wear a vehicle down. A hit whose change of speed passes `VEHICLE_WEAR.from` takes health by
 * the rest (so a wall at speed costs a lot, a walker or a creature almost nothing, and the lighter of two vehicles more);
 * under `VEHICLE_SMOKE` of its health it smokes (a `vehicleWornRow`); at none it is wrecked: its riders are set down beside
 * it, it goes, and its dock has it back after the dock's `respawn` s (a shared dock spawns it again, a player dock takes that
 * player's ask again). Ramming hurts no creature (call 4 B).
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
/** The host step and save adapter a bound runtime goes by. */
export const VEHICLE_STEP = 'vehicles';

/** A free seat's prompt: who takes it from where. A per-player vehicle's driver seat is its `owner`'s alone. */
export interface VehicleSeatPrompt {
  readonly id: string; readonly vehicle: string; readonly seat: number; readonly role: VehicleSeat['role'];
  readonly label: string; readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly radius: number;
  readonly owner: string | null;
}

/** What a server lends its vehicles. */
export interface VehicleRuntimePorts {
  readonly physics: () => Physics;
  /** The driver's stick this tick in the vehicle's frame (heading `yaw`), or none without a command. */
  readonly stick: (driver: string, yaw: number) => VehicleCommand | undefined;
  /** A host being restored: no body is made until its saved world is back (`physicsRestored`). */
  readonly restoring?: boolean;
}
/** One vehicle out in the cell. */
interface Live {
  readonly id: string;
  readonly dock: VehicleDock;
  readonly kind: VehicleKind;
  /** The player a `player` dock spawned it for; none for a shared one. */
  readonly owner: string | null;
  /** Its body in the host's world; none between a restore's adapters and its world. */
  body: KinematicMover | null;
  readonly world: VehicleWorld;
  state: VehicleState;
  /** Who sits in each of the kind's seats. */
  readonly seats: (string | null)[];
  /** s since its driver left (or since it spawned riderless). */
  idle: number;
  /** MSZ14: what is left of its health. */
  health: number;
}

const finite = v.pipe(v.number(), v.finite());
const Saved = v.strictObject({
  vehicles: v.pipe(v.array(v.strictObject({
    id: v.pipe(v.string(), v.maxLength(256)), dock: v.pipe(v.string(), v.maxLength(128)), owner: v.nullable(v.pipe(v.string(), v.maxLength(128))),
    state: v.strictObject({ x: finite, y: finite, z: finite, yaw: finite, forward: finite, slip: finite, pitch: finite, roll: finite }),
    seats: v.pipe(v.array(v.nullable(v.pipe(v.string(), v.maxLength(128)))), v.maxLength(8)), idle: finite,
    handle: v.pipe(finite, v.minValue(0)), health: v.exactOptional(finite),
  })), v.maxLength(256)),
  wrecks: v.exactOptional(v.pipe(v.array(v.strictObject({ id: v.pipe(v.string(), v.maxLength(256)), dock: v.pipe(v.string(), v.maxLength(128)), left: finite })), v.maxLength(256))),
  led: v.pipe(v.array(v.tuple([v.pipe(v.string(), v.maxLength(128)), finite, finite, finite])), v.maxLength(256)),
});
type SavedVehicles = v.InferOutput<typeof Saved>;

const poseOf = (state: VehicleState): MoverPose => ({ position: { x: state.x, y: state.y, z: state.z }, euler: { x: state.pitch, y: state.yaw, z: -state.roll }, enabled: true });
/** MSZ13: the hull's cast box rides this far over the vehicle's base (m), clear of the ground's bumps, and is this tall: a
 *  kerb or a ramp is the floor probe's, a wall, a vehicle or a walker the cast's. */
const HULL_LIFT = 0.35, HULL_HEIGHT = 1.2;
/** A ground normal shorter than this is a floor or a ramp, not a wall: the cast leaves it to the floor probe. */
const WALL_NORMAL = 0.5;
/** What a vehicle's hull meets besides a static solid: another vehicle gives a little back; a walker or a creature (kg) is
 *  pushed aside, so gives nothing back. */
const VEHICLE_RESTITUTION = { solid: 0.35, vehicle: 0.3, walker: 0 } as const;
const WALKER_MASS = 90, CREATURE_MASS = 150;
/** m/s a walker in a vehicle's way is pushed aside at, at least: no harm (MSZ13), just out of the way. */
const PUSH_ASIDE = 4;
/** MSZ14: a kind with no `health` has this much. */
export const VEHICLE_HEALTH = 100;
/** MSZ14: a hit wears a vehicle by `per` health for each m/s its speed changes past `from` m/s: a wall at a buggy's top speed
 *  (22 m/s, a change of 30) costs the default about 40, so the third such hit wrecks it; a scrape or a bump costs nothing. */
export const VEHICLE_WEAR = { from: 8, per: 1.8 } as const;
/** MSZ14: under this share of its health a vehicle smokes. */
export const VEHICLE_SMOKE = 0.3;
/** MSZ14: a vehicle wrecked this step, where it broke up. */
export interface VehicleWreckEvent { readonly vehicle: string; readonly at: { readonly x: number; readonly y: number; readonly z: number } }
/** MSZ13: one hit this step, as the host's sounds and damage read it (MSZ14, MSZ15). */
export interface VehicleImpactEvent { readonly vehicle: string; readonly strength: number; readonly owner: unknown }
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
  /** A restore's vehicles, waiting for their saved world. */
  private restored: SavedVehicles | null = null;
  /** MSZ14: each wrecked vehicle's id, its dock, and the s left before the dock has it back. */
  private readonly wrecked = new Map<string, { readonly dock: VehicleDock; left: number }>();
  private lastWrecks: VehicleWreckEvent[] = [];
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
    const id = playerVehicle(dockId, player);
    return this.live.has(id) ? id : this.spawnAt(dock, player);
  }
  /** MSZ14: what is left of a vehicle's health, as a share of its kind's. */
  health(id: string): number { const vehicle = this.get(id); return vehicle.health / (vehicle.kind.health ?? VEHICLE_HEALTH); }
  /** MSZ14: the vehicles wrecked last step. */
  wrecks(): readonly VehicleWreckEvent[] { return this.lastWrecks; }
  /** MSZ14: s before a wrecked vehicle's dock has it back, or none while it is out (or was never wrecked). */
  respawning(id: string): number | undefined { return this.wrecked.get(id)?.left; }
  /** Whether a player dock stands clear for a new vehicle: no other vehicle's centre within its hull's reach. */
  clear(dockId: string): boolean {
    const dock = this.docks.get(dockId), boxes = this.hulls.get(dockId); if (dock === undefined || boxes === undefined) return false;
    const { bow, stern, side } = reachOf(boxes), reach = Math.hypot(Math.max(bow, stern), side) * 2;
    return [...this.live.values()].every(vehicle => Math.hypot(vehicle.state.x - dock.at[0], vehicle.state.z - dock.at[2]) >= reach);
  }
  /** Every vehicle out now. */
  ids(): readonly string[] { return [...this.live.keys()]; }
  /** The dock a vehicle out now came from. */
  dockOf(id: string): string { return this.get(id).dock.id; }
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
  /** MSZ13: the hits of the last step, strongest first. */
  impacts(): readonly VehicleImpactEvent[] { return this.lastImpacts; }
  private lastImpacts: VehicleImpactEvent[] = [];
  /** One fixed step of every vehicle: drive, pose the body, then despawn or bring home the idle ones. */
  step(dt: number): void {
    const out: VehicleStepOut = { blocked: false, sliding: 0, impact: null };
    this.lastImpacts = []; this.lastWrecks = [];
    for (const [id, wreck] of this.wrecked) {
      wreck.left -= dt; if (wreck.left > 0) continue;
      this.wrecked.delete(id);
      if (wreck.dock.per === 'shared' && !this.live.has(id)) this.spawnAt(wreck.dock, null);
    }
    for (const vehicle of this.live.values()) {
      const driver = this.driver(vehicle.id), command = driver === null ? NEUTRAL : this.ports.stick(driver, vehicle.state.yaw) ?? NEUTRAL;
      out.impact = null;
      vehicle.state = stepVehicle(vehicle.state, command, vehicle.kind.handling, vehicle.world, dt, out);
      if (out.impact !== null && out.impact !== undefined) this.hand(vehicle, out.impact);
      vehicle.body?.setPose(poseOf(vehicle.state));
      if (driver !== null) continue;
      vehicle.idle += dt;
      if (vehicle.seats.some(rider => rider !== null)) continue; // a passenger keeps it out
      if (vehicle.owner !== null) { if (vehicle.idle >= VEHICLE_IDLE_DESPAWN) this.despawn(vehicle.id); continue; }
      const [x, , z] = vehicle.dock.at;
      if (vehicle.idle >= vehicle.dock.respawn && Math.hypot(vehicle.state.x - x, vehicle.state.z - z) > HOME_RADIUS) this.home(vehicle);
    }
    for (const vehicle of this.live.values()) if (vehicle.health <= 0) this.wreck(vehicle); // a Map iterates on past a deleted entry
  }
  /** MSZ14: a hit's wear on one vehicle: its change of speed past `VEHICLE_WEAR.from`. */
  private wear(vehicle: Live, change: number): void {
    if (change > VEHICLE_WEAR.from) vehicle.health = Math.max(0, vehicle.health - (change - VEHICLE_WEAR.from) * VEHICLE_WEAR.per);
  }
  /** MSZ14: a vehicle worn out: its riders set down beside it, then it goes until its dock has it back. */
  private wreck(vehicle: Live): void {
    for (const rider of vehicle.seats) if (rider !== null) this.leave(rider);
    this.lastWrecks.push({ vehicle: vehicle.id, at: { x: vehicle.state.x, y: vehicle.state.y, z: vehicle.state.z } });
    this.despawn(vehicle.id);
    this.wrecked.set(vehicle.id, { dock: vehicle.dock, left: vehicle.dock.respawn });
  }
  /** MSZ13: a hit's other side: another vehicle takes the impulse over its mass, a walker is pushed aside (no harm); the hit is
   *  heard (`impacts`). */
  private hand(vehicle: Live, impact: VehicleImpact): void {
    this.lastImpacts.push({ vehicle: vehicle.id, strength: impact.strength, owner: impact.owner });
    this.lastImpacts.sort((a, b) => b.strength - a.strength);
    const push = Math.hypot(impact.impulse.x, impact.impulse.z);
    this.wear(vehicle, push / vehicle.kind.handling.mass);
    const other = typeof impact.owner === 'string' ? this.live.get(impact.owner) : undefined;
    if (other !== undefined) {
      this.wear(other, push / other.kind.handling.mass);
      const mass = other.kind.handling.mass, s = other.state, dx = impact.impulse.x / mass, dz = impact.impulse.z / mass;
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      other.state = { ...s, forward: s.forward + dx * fx + dz * fz, slip: s.slip + dx * rx + dz * rz };
      return;
    }
    const walker = typeof impact.owner === 'string' ? this.host?.players.get(impact.owner) : undefined;
    if (walker === undefined || this.seatOf(walker.id) !== undefined) return;
    // aside: away from the vehicle's line, on whichever side the walker stands
    const s = vehicle.state, rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw), side = (walker.position.x - s.x) * rx + (walker.position.z - s.z) * rz >= 0 ? 1 : -1;
    walker.knockBack(walker.position.x - rx * side, walker.position.z - rz * side, Math.max(PUSH_ASIDE, impact.strength));
  }
  /** MSZ13: what vehicle `id`'s hull (its reach as one box, lifted clear of the ground) meets moving by `move` from `from`. */
  private hullHit(id: string, reach: { readonly bow: number; readonly stern: number; readonly side: number }, from: { readonly x: number; readonly y: number; readonly z: number }, move: { readonly x: number; readonly z: number }, yaw: number): VehicleHit | null {
    const physics = this.ports.physics(), length = Math.hypot(move.x, move.z); if (length < 1e-6) return null;
    const vehicle = this.live.get(id), riders = new Set(vehicle?.seats.filter((rider): rider is string => rider !== null));
    const back = (reach.stern - reach.bow) / 2, sin = Math.sin(yaw), cos = Math.cos(yaw);
    const shape = this.hullShape(physics, reach);
    const centre = { x: from.x + back * sin, y: from.y + HULL_LIFT + HULL_HEIGHT / 2, z: from.z + back * cos };
    const hit = physics.world.castShape(centre, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, { x: move.x / length, y: 0, z: move.z / length }, shape, 0, length, false,
      physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(['WORLD', 'PLAYER', 'CREATURE'], 'WORLD'), undefined, undefined, collider => {
        const owner = tagOf(collider)?.owner; return owner !== id && !(typeof owner === 'string' && riders.has(owner));
      });
    if (hit === null) return null;
    // the surface's normal, out of what was hit: against the move (a cast's two normals face each other)
    const ground = Math.hypot(hit.normal1.x, hit.normal1.z); if (ground < WALL_NORMAL) return null;
    const facing = hit.normal1.x * move.x + hit.normal1.z * move.z > 0 ? -1 : 1;
    const owner = tagOf(hit.collider)?.owner ?? null, normal = { x: facing * hit.normal1.x / ground, z: facing * hit.normal1.z / ground };
    const other = typeof owner === 'string' ? this.live.get(owner) : undefined, walker = typeof owner === 'string' ? this.host?.players.get(owner) : undefined;
    const at = hit.time_of_impact / length;
    if (other !== undefined) {
      const s = other.state, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      return { at, normal, owner, mass: other.kind.handling.mass, velocity: { x: fx * s.forward + rx * s.slip, z: fz * s.forward + rz * s.slip }, restitution: VEHICLE_RESTITUTION.vehicle };
    }
    if (walker !== undefined) return { at, normal, owner, mass: WALKER_MASS, velocity: { x: walker.velocity.x, z: walker.velocity.z }, restitution: VEHICLE_RESTITUTION.walker };
    const creature = ((hit.collider.collisionGroups() >>> 16) & GROUP.CREATURE) !== 0;
    // a creature has no push law yet (MSZ14 brings its hit by speed): the hull bumps it, slowing, then rolls on through
    if (creature) return hit.time_of_impact <= 1e-4 ? null : { at, normal, owner, mass: CREATURE_MASS, velocity: { x: 0, z: 0 }, restitution: VEHICLE_RESTITUTION.walker };
    return { at, normal, owner, mass: Infinity, velocity: { x: 0, z: 0 }, restitution: VEHICLE_RESTITUTION.solid };
  }
  private readonly shapes = new Map<string, Cuboid>();
  private hullShape(physics: Physics, reach: { readonly bow: number; readonly stern: number; readonly side: number }): Cuboid {
    const key = `${String(reach.bow)}:${String(reach.stern)}:${String(reach.side)}`;
    let shape = this.shapes.get(key);
    if (shape === undefined) { shape = new physics.R.Cuboid(reach.side, HULL_HEIGHT / 2, (reach.bow + reach.stern) / 2); this.shapes.set(key, shape); }
    return shape;
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
  /** Every taken seat as its `state` row. */
  seatRows(): readonly StateNetRow[] {
    const rows: StateNetRow[] = [];
    for (const vehicle of this.live.values()) {
      vehicle.seats.forEach((player, seat) => { if (player !== null) rows.push({ name: vehicleSeatRow(vehicle.id, seat, player), value: 1 }); });
      if (vehicle.health < VEHICLE_SMOKE * (vehicle.kind.health ?? VEHICLE_HEALTH)) rows.push({ name: vehicleWornRow(vehicle.id), value: 1 });
    }
    return rows;
  }
  /**
   * Run on a host: step and seat before its bodies, put each vehicle and taken seat on its wire, claim each prompt by its wire id,
   * keep led bodies out of the hulls and their walk standing down, and keep its vehicles in the host's saves.
   */
  bind(host: SimHost): void {
    this.host = host; this.routes = actRoutes(host);
    for (const vehicle of this.live.values()) this.claim(vehicle);
    for (const dock of this.docks.values()) if (dock.per === 'player') this.routes.claims.set(vehicleDockPrompt(dock.id), player => {
      const body = host.players.get(player);
      if (body === undefined || this.wrecked.has(playerVehicle(dock.id, player)) || !this.clear(dock.id) || Math.hypot(body.position.x - dock.at[0], body.position.z - dock.at[2]) > SEAT_REACH) return;
      const id = this.spawn(dock.id, player);
      this.board(id, player, this.get(id).kind.seats.findIndex(seat => seat.role === 'driver'));
    });
    host.leading.push(body => this.seatOf(body.id) !== undefined);
    host.events.answer('player.traversal', dt => {
      const player = host.traversing;
      if (typeof dt !== 'number' || player === null) return dt; // an earlier answer stands
      return this.seatOf(player.id) !== undefined ? true : dt;
    }, host.scope);
    publishWorldState(host, VEHICLE_STEP, () => this.seatRows());
    host.scope.onDispose(() => { this.dispose(); });
    host.onStep(VEHICLE_STEP, dt => { this.step(dt); this.seat(host); }, {
      snapshot: () => this.snapshot(), restore: value => { this.restored = v.parse(Saved, value); },
      physicsRestored: () => { this.reconnect(); }, joined: true,
    });
  }
  /** Remove every body (a Map keeps iterating past an entry deleted under it). */
  dispose(): void { for (const id of this.live.keys()) this.despawn(id); }

  private snapshot(): SavedVehicles {
    return { vehicles: [...this.live.values()].map(vehicle => {
      const handle = vehicle.body?.body.handle; if (handle === undefined) throw new Error(`Vehicle ${vehicle.id} has no body to save`);
      return { id: vehicle.id, dock: vehicle.dock.id, owner: vehicle.owner, state: { ...vehicle.state }, seats: [...vehicle.seats], idle: vehicle.idle, handle, health: vehicle.health };
    }), led: [...this.led].map(([player, at]) => [player, at.x, at.y, at.z] as [string, number, number, number]),
    wrecks: [...this.wrecked].map(([id, wreck]) => ({ id, dock: wreck.dock.id, left: wreck.left })) };
  }
  /** After a restore's world: its saved vehicles on their saved bodies, or (a save from before them) fresh ones at their docks. */
  private reconnect(): void {
    const saved = this.restored; this.restored = null;
    const fresh = [...this.live.values()].filter(vehicle => vehicle.owner === null).map(vehicle => vehicle.dock);
    // the old bodies were in the world the restore replaced: drop them and their rows, not their colliders
    for (const vehicle of this.live.values()) { vehicle.body = null; this.unpublish(vehicle.id); }
    this.live.clear(); this.led.clear(); this.wrecked.clear();
    if (saved === null) { for (const dock of fresh) this.spawnAt(dock, null); return; }
    for (const row of saved.wrecks ?? []) { const dock = this.docks.get(row.dock); if (dock !== undefined) this.wrecked.set(row.id, { dock, left: row.left }); }
    for (const row of saved.vehicles) {
      const dock = this.docks.get(row.dock);
      if (dock === undefined || row.id !== (row.owner === null ? dock.id : playerVehicle(dock.id, row.owner))) throw new Error(`Invalid vehicle continuation ${row.id}`);
      const vehicle = this.spawnAt(dock, row.owner, row.handle), live = this.get(vehicle);
      if (row.seats.length !== live.kind.seats.length) throw new Error(`Invalid vehicle seats ${row.id}`);
      live.state = row.state; live.idle = row.idle; if (row.health !== undefined) live.health = row.health; row.seats.forEach((player, seat) => { live.seats[seat] = player; });
    }
    for (const [player, x, y, z] of saved.led) this.led.set(player, { x, y, z });
  }
  private get(id: string): Live { const vehicle = this.live.get(id); if (vehicle === undefined) throw new Error(`No vehicle ${id}`); return vehicle; }
  private claim(vehicle: Live): void {
    const routes = this.routes, host = this.host; if (routes === null || host === null) return;
    vehicle.kind.seats.forEach((row, seat) => {
      routes.claims.set(vehicleSeatPrompt(vehicle.id, seat), player => {
        // the claimant's body must be within reach of the seat (the page offers it only there)
        const live = this.live.get(vehicle.id), body = host.players.get(player)?.position;
        if (live === undefined || body === undefined) return;
        const at = worldPoint(live.state, row.at);
        if (Math.hypot(body.x - at.x, body.z - at.z) > SEAT_REACH) return;
        this.board(vehicle.id, player, seat);
      });
    });
    routes.claims.set(vehicleLeavePrompt(vehicle.id), player => { if (this.seatOf(player)?.vehicle === vehicle.id) this.leave(player); });
    publishScriptBody(host, vehicle.id, () => poseOf(this.live.get(vehicle.id)?.state ?? vehicle.state));
  }
  private unpublish(id: string): void {
    const vehicle = this.live.get(id), host = this.host; if (vehicle === undefined || host === null) return;
    vehicle.kind.seats.forEach((_row, seat) => { this.routes?.claims.delete(vehicleSeatPrompt(id, seat)); });
    this.routes?.claims.delete(vehicleLeavePrompt(id)); withdrawScriptBody(host, id);
  }
  private spawnAt(dock: VehicleDock, owner: string | null, handle?: number): string {
    const kind = this.kinds.get(dock.kind), boxes = this.hulls.get(dock.id);
    if (kind === undefined || boxes === undefined) throw new Error(`Vehicle dock ${dock.id} has no kind or hull`);
    const id = owner === null ? dock.id : playerVehicle(dock.id, owner), state = vehicleAt({ x: dock.at[0], y: dock.at[1], z: dock.at[2] }, dock.yaw);
    // the floor under it, through its own hull (or it would climb onto itself)
    const floor = (x: number, z: number, fromY: number): number | undefined => floorBelow(this.ports.physics(), x, z, fromY, STEER_PROBE.up + STEER_PROBE.down, undefined, collider => tagOf(collider)?.owner !== id);
    const body = this.ports.restoring === true && handle === undefined && this.host === null ? null : new KinematicMover(this.ports.physics(), boxes, poseOf(state), id, false, handle);
    const reach = reachOf(boxes);
    const vehicle: Live = { id, dock, kind, owner, body, world: { floor, ...reach, hit: (from, move, yaw) => this.hullHit(id, reach, from, move, yaw) }, state, seats: kind.seats.map(() => null), idle: 0, health: kind.health ?? VEHICLE_HEALTH };
    this.live.set(id, vehicle); this.claim(vehicle);
    return id;
  }
  private despawn(id: string): void {
    const vehicle = this.live.get(id); if (vehicle === undefined) return;
    this.unpublish(id); vehicle.body?.dispose(); this.live.delete(id);
  }
  private home(vehicle: Live): void {
    vehicle.state = vehicleAt({ x: vehicle.dock.at[0], y: vehicle.dock.at[1], z: vehicle.dock.at[2] }, vehicle.dock.yaw); vehicle.idle = 0;
    vehicle.body?.resetPose(poseOf(vehicle.state));
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

/**
 * MSZ12: a seated driver's controls as the vehicle reads them, whatever way the driver looks (the chase view, a look round):
 * the raw stick's forward is the throttle (back brakes, then reverses) and its side the turn, as W and S, A and D, or the
 * phone's move stick; sprint (Shift, the BOOST disc) boosts; BRAKE, the handbrake (Space, a held BRAKE) and the horn ride as
 * held buttons. A command with no raw stick (a headless tape's world move) is read along the vehicle's heading, as before.
 */
export function driverStick(host: Pick<SimHost, 'tickCommand'>, player: string, yaw: number): VehicleCommand | undefined {
  const command = host.tickCommand(player); if (command === undefined) return undefined;
  const steer = command.commandVersion === 1 ? command.steer : undefined, clamp = (value: number): number => Math.max(-1, Math.min(1, value));
  const stick = steer === undefined ? riderStick(host, player, yaw) : { throttle: clamp(steer.keyY + steer.stickY), turn: clamp(steer.keyX + steer.stickX), boost: command.boost === true || command.sprint === true };
  if (stick === undefined) return undefined;
  return { ...stick, ...(command.brake === true ? { brake: true } : {}), ...(command.handbrake === true ? { handbrake: true } : {}) };
}

/** MSZ9b: a host's vehicles, run and on its wire; null for a product with no docks. Each server path calls this once. */
export function installVehicles(host: SimHost, vehicles: Vehicles, restoring = false): VehicleRuntime | null {
  if (vehicles.docks.length === 0) return null;
  const runtime = new VehicleRuntime(vehicles, { physics: () => host.physics, stick: (driver, yaw) => driverStick(host, driver, yaw), restoring });
  runtime.bind(host);
  return runtime;
}

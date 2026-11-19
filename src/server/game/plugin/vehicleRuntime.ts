import { KinematicMover } from '@wildshard/engine/physics/mover';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { floorBelow } from '@wildshard/engine/physics/query';
import { tagOf } from '@wildshard/engine/physics/surface';
import { STEER_PROBE } from '@wildshard/engine/sim/moverMotion';
import { stepVehicle, vehicleAt, type VehicleCommand, type VehicleState, type VehicleWorld } from '@wildshard/engine/sim/vehicle';
import type { MoverBox, MoverPose } from '@wildshard/format/moverPose';
import type { VehicleDock, VehicleKind, Vehicles } from '@wildshard/format/vehicles';
import { dockHulls } from '../../../shared/game/shardfile/shardVehicles';

/**
 * MIRROR-SALT-ZONE MSZ8: the vehicles a cell's server runs, beside `MoverRuntime`. It spawns each kind from its docks (a
 * `shared` dock's vehicle at once, a `player` dock's on a player's ask, one each), owns each vehicle's kinematic body and
 * hull (`dockHulls`, the kind's boxes), and steps it with MSZ7's `stepVehicle` from its driver's stick (`riderStick`). A
 * per-player vehicle goes `VEHICLE_IDLE_DESPAWN` s after its driver leaves; a shared one left away from its dock goes back
 * to it after the dock's `respawn` s. Seats, prompts and modes are MSZ9's; until it wires this runtime to a page, MSZ6's
 * steer carries drive the docks.
 */
export const VEHICLE_IDLE_DESPAWN = 60;
/** m from its dock within which a shared vehicle counts as home (it does not snap back). */
const HOME_RADIUS = 1;
const NEUTRAL: VehicleCommand = { throttle: 0, turn: 0, boost: false };

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
  driver: string | null;
  /** s since its driver left (or since it spawned riderless). */
  idle: number;
}

const poseOf = (state: VehicleState): MoverPose => ({ position: { x: state.x, y: state.y, z: state.z }, euler: { x: state.pitch, y: state.yaw, z: -state.roll }, enabled: true });
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
  /** Every vehicle out now. */
  ids(): readonly string[] { return [...this.live.keys()]; }
  /** Who drives it, or null. */
  driver(id: string): string | null { return this.get(id).driver; }
  /** Take the driver's seat of a free vehicle; a per-player one only its owner. */
  board(id: string, player: string): boolean {
    const vehicle = this.get(id);
    if (vehicle.driver !== null || (vehicle.owner !== null && vehicle.owner !== player)) return false;
    vehicle.driver = player; vehicle.idle = 0; return true;
  }
  /** Its driver gets out; it coasts to a stop. */
  leave(id: string): void { const vehicle = this.get(id); vehicle.driver = null; vehicle.idle = 0; }
  /** Where it is now. */
  pose(id: string): MoverPose { return poseOf(this.get(id).state); }
  /** How fast it goes along its heading (m/s). */
  speed(id: string): number { return this.get(id).state.forward; }
  /** One fixed step of every vehicle: drive, pose the body, then despawn or bring home the idle ones. */
  step(dt: number): void {
    for (const vehicle of this.live.values()) {
      const command = vehicle.driver === null ? NEUTRAL : this.ports.stick(vehicle.driver, vehicle.state.yaw) ?? NEUTRAL;
      vehicle.state = stepVehicle(vehicle.state, command, vehicle.kind.handling, vehicle.world, dt);
      vehicle.body.setPose(poseOf(vehicle.state));
      if (vehicle.driver !== null) continue;
      vehicle.idle += dt;
      if (vehicle.owner !== null) { if (vehicle.idle >= VEHICLE_IDLE_DESPAWN) this.despawn(vehicle.id); continue; }
      const [x, , z] = vehicle.dock.at;
      if (vehicle.idle >= vehicle.dock.respawn && Math.hypot(vehicle.state.x - x, vehicle.state.z - z) > HOME_RADIUS) this.home(vehicle);
    }
  }
  /** Remove every body (a Map keeps iterating past an entry deleted under it). */
  dispose(): void { for (const id of this.live.keys()) this.despawn(id); }

  private get(id: string): Live { const vehicle = this.live.get(id); if (vehicle === undefined) throw new Error(`No vehicle ${id}`); return vehicle; }
  private spawnAt(dock: VehicleDock, owner: string | null): string {
    const kind = this.kinds.get(dock.kind), boxes = this.hulls.get(dock.id);
    if (kind === undefined || boxes === undefined) throw new Error(`Vehicle dock ${dock.id} has no kind or hull`);
    const id = owner === null ? dock.id : `${dock.id}~${owner}`, state = vehicleAt({ x: dock.at[0], y: dock.at[1], z: dock.at[2] }, dock.yaw);
    // the floor under it, through its own hull (or it would climb onto itself)
    const floor = (x: number, z: number, fromY: number): number | undefined => floorBelow(this.ports.physics(), x, z, fromY, STEER_PROBE.up + STEER_PROBE.down, undefined, collider => tagOf(collider)?.owner !== id);
    const body = new KinematicMover(this.ports.physics(), boxes, poseOf(state), id);
    this.live.set(id, { id, dock, kind, owner, body, world: { floor, ...reachOf(boxes) }, state, driver: null, idle: 0 });
    return id;
  }
  private despawn(id: string): void { this.live.get(id)?.body.dispose(); this.live.delete(id); }
  private home(vehicle: Live): void {
    vehicle.state = vehicleAt({ x: vehicle.dock.at[0], y: vehicle.dock.at[1], z: vehicle.dock.at[2] }, vehicle.dock.yaw); vehicle.idle = 0;
    vehicle.body.resetPose(poseOf(vehicle.state));
  }
}

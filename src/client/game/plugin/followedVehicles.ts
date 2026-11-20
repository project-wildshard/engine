import { Vector3, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { KinematicMover } from '@wildshard/engine/physics/mover';
import { queryGroups } from '@wildshard/engine/physics/groups';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { MoverBox, MoverPose } from '@wildshard/format/moverPose';
import type { VehicleDock, VehicleKind, Vehicles } from '@wildshard/format/vehicles';
import { dockHulls } from '../../../shared/game/shardfile/shardVehicles';
import { parseVehicleSeatRow, playerVehicle, vehicleDockOf, vehicleDockPrompt, vehicleLeavePrompt, vehicleSeatPrompt } from '../../../shared/game/shardfile/wirePrompts';
import { vehiclePoint, type MoverView } from './followedMovers';

/** m within which a seat's or a dock's prompt shows (the server's `SEAT_REACH`). */
const SEAT_REACH = 2.5;
const DRIVE_LABEL = 'Drive', RIDE_LABEL = 'Ride', LEAVE_LABEL = 'Get out';
const SCRIPT = 'script:', STATE = 'state:';
const restPose = (dock: VehicleDock): MoverPose => ({ position: { x: dock.at[0], y: dock.at[1], z: dock.at[2] }, euler: { x: 0, y: dock.yaw, z: 0 }, enabled: true });

/** A prompt that follows what it offers: `radius` places it (0 hides it) and `wireId` names what a press asks for. */
function followingPrompt(position: Vector3, label: string, radius: () => number, wireId: () => string): Interactable {
  return { position, label, onInteract: () => undefined, get radius() { return radius(); }, get wireId() { return wireId(); } };
}
/** One vehicle this page follows: its collider in the page's physics, its drawn look, and its last row. */
interface Followed { readonly id: string; readonly dock: VehicleDock; readonly kind: VehicleKind; readonly body: KinematicMover; readonly look: ((pose: MoverPose) => void) | null; pose: MoverPose; readonly view: MoverView }

/** What a page lends the vehicles it follows. */
export interface FollowedVehiclePorts {
  readonly physics: Physics; readonly scope: Scope;
  /** A kind's drawn look for one vehicle of it (a copy of its props panel), posed by its rows; none draws nothing. */
  readonly look?: (kind: VehicleKind, id: string) => ((pose: MoverPose) => void) | null;
}

/**
 * MIRROR-SALT-ZONE MSZ9b: the vehicles on a page, as the server's `VehicleRuntime` puts them on the wire. Nothing steps here:
 * each vehicle's `script:` row poses its hull (a kinematic body the page's walk meets, as `FollowedMovers` does a mover's) and
 * its look, and each taken seat's `state` row says who sits where. A per-player vehicle's row comes and goes with it, so its
 * body is made on its first row and freed when its row leaves; a shared dock's stands at its dock from the start.
 *
 * Its prompts are a fixed few that follow the vehicles: for each kind's seat, the nearest free one of that kind (a per-player
 * vehicle's driver seat only for its owner); each player dock's while it stands clear and this player has no vehicle out;
 * and one leave prompt over this player's own seat. A press goes by wire id and the server decides.
 */
export class FollowedVehicles {
  readonly vehicles: Vehicles;
  private readonly kinds: ReadonlyMap<string, VehicleKind>;
  private readonly docks: ReadonlyMap<string, VehicleDock>;
  private readonly hulls: ReadonlyMap<string, readonly MoverBox[]>;
  private readonly ports: FollowedVehiclePorts;
  private readonly live = new Map<string, Followed>();
  /** Who sits in each seat, by vehicle, as the newest rows say. */
  private readonly seats = new Map<string, (string | null)[]>();
  /** This page's player, as its wire's welcome names it. */
  private me: string | null = null;
  /** This page's player's feet, as the last frame had them: a seat's prompt goes to the nearest free one. */
  private readonly feet = { x: 0, z: 0 };
  private readonly made: Interactable[];
  constructor(vehicles: Vehicles, ports: FollowedVehiclePorts) {
    this.vehicles = vehicles; this.ports = ports;
    this.kinds = new Map(vehicles.kinds.map(kind => [kind.id, kind]));
    this.docks = new Map(vehicles.docks.map(dock => [dock.id, dock]));
    this.hulls = dockHulls(vehicles);
    for (const dock of vehicles.docks) if (dock.per === 'shared') this.follow(dock.id, restPose(dock));
    ports.scope.onDispose(() => { for (const vehicle of this.live.values()) vehicle.body.dispose(); this.live.clear(); });
    this.made = this.makePrompts();
  }
  /** Every vehicle this page has out now. */
  ids(): readonly string[] { return [...this.live.keys()]; }
  /** The docks it knows, by id. */
  dockIds(): readonly string[] { return [...this.docks.keys()]; }
  /** A vehicle's pose as its newest row said. */
  pose(id: string): MoverPose | undefined { return this.live.get(id)?.pose; }
  /** Its kind. */
  kindOf(id: string): VehicleKind | undefined { return this.live.get(id)?.kind ?? this.kinds.get(this.docks.get(vehicleDockOf(id))?.kind ?? ''); }
  /** Who sits in each seat. */
  riders(id: string): readonly (string | null)[] { return this.seats.get(id) ?? this.kindOf(id)?.seats.map(() => null) ?? []; }
  /** The seat `player` (this page's when absent) holds, if any. */
  seatOf(player: string | null = this.me): { readonly vehicle: string; readonly seat: number } | undefined {
    if (player === null) return undefined;
    for (const [vehicle, seats] of this.seats) { const seat = seats.indexOf(player); if (seat !== -1 && this.live.has(vehicle)) return { vehicle, seat }; }
    return undefined;
  }
  /** MSZ10: `player`'s seat as its body is drawn: the vehicle's heading and the seat's pose; null out of one. */
  seated(player: string): { readonly yaw: number; readonly pose: 'sit' | 'stand' } | null {
    const held = this.seatOf(player), vehicle = held === undefined ? undefined : this.live.get(held.vehicle), row = held === undefined ? undefined : vehicle?.kind.seats[held.seat];
    return vehicle === undefined || row === undefined ? null : { yaw: vehicle.pose.euler.y, pose: row.pose };
  }
  /** Where a seat stands now: its rider's feet. */
  seatPoint(id: string, seat: number): [number, number, number] | undefined {
    const vehicle = this.live.get(id), row = vehicle?.kind.seats[seat];
    return vehicle === undefined || row === undefined ? undefined : vehiclePoint(vehicle.pose, row.at);
  }
  /** MSZ11: m clear from `from` toward `to` before a world surface, `id`'s own hull aside (the chase view's arm); the whole way
   *  when nothing is between. */
  clear(id: string, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
    const physics = this.ports.physics, dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return 0;
    const ray = new physics.R.Ray({ x: from.x, y: from.y, z: from.z }, { x: dx / length, y: dy / length, z: dz / length });
    const hit = physics.castRay(ray, length, true, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(['WORLD']), undefined, undefined, collider => tagOf(collider)?.owner !== id);
    return hit === null ? length : hit.timeOfImpact;
  }
  /** The view a vehicle's row poses, when its dock is one of these: its body is made on its first row. */
  view(id: string): MoverView | undefined {
    const known = this.live.get(id); if (known !== undefined) return known.view;
    return this.docks.has(vehicleDockOf(id)) ? { pose: pose => { this.follow(id, pose); } } : undefined;
  }
  /** Pose a vehicle off its row: its collider and its look. */
  follow(id: string, pose: MoverPose): void {
    const vehicle = this.live.get(id) ?? this.make(id, pose); if (vehicle === null) return;
    vehicle.pose = pose; vehicle.body.setPose(pose); vehicle.look?.(pose);
  }
  /**
   * Once a frame, the wire's entity ids: the vehicles out (a per-player one whose row left goes) and the seats taken. `me` is
   * this page's player and `feet` where it stands.
   */
  sync(ids: Iterable<string>, me: string | null, feet: { readonly x: number; readonly z: number }): void {
    this.me = me; this.feet.x = feet.x; this.feet.z = feet.z;
    const out = new Set<string>(); this.seats.clear();
    for (const id of ids) {
      if (id.startsWith(SCRIPT)) { const vehicle = id.slice(SCRIPT.length); if (this.docks.has(vehicleDockOf(vehicle))) out.add(vehicle); continue; }
      if (!id.startsWith(STATE)) continue;
      const row = parseVehicleSeatRow(id.slice(STATE.length)); if (row === null) continue;
      let seats = this.seats.get(row.vehicle);
      if (seats === undefined) { seats = this.kindOf(row.vehicle)?.seats.map(() => null) ?? []; this.seats.set(row.vehicle, seats); }
      if (row.seat < seats.length) seats[row.seat] = row.player;
    }
    for (const [id, vehicle] of this.live) if (vehicle.dock.per === 'player' && !out.has(id)) { vehicle.body.dispose(); this.live.delete(id); }
  }
  /** The prompts this page offers for its vehicles: the same objects every call, which follow the vehicles. */
  prompts(): Interactable[] { return this.made; }

  private make(id: string, pose: MoverPose): Followed | null {
    const dock = this.docks.get(vehicleDockOf(id)), kind = dock === undefined ? undefined : this.kinds.get(dock.kind), boxes = dock === undefined ? undefined : this.hulls.get(dock.id);
    if (dock === undefined || kind === undefined || boxes === undefined) return null;
    const vehicle: Followed = { id, dock, kind, body: new KinematicMover(this.ports.physics, boxes, pose, id), look: this.ports.look?.(kind, id) ?? null, pose,
      view: { pose: next => { this.follow(id, next); } } };
    this.live.set(id, vehicle);
    return vehicle;
  }
  private makePrompts(): Interactable[] {
    const prompts: Interactable[] = [];
    // each kind's seat: the nearest vehicle of that kind with it free, that this player may take (a per-player driver seat, its owner)
    for (const kind of this.kinds.values()) kind.seats.forEach((row, seat) => {
      const position = new Vector3();
      let chosen: Followed | null = null;
      const pick = (): number => {
        chosen = null;
        if (this.me === null || this.seatOf() !== undefined) return 0;
        let near = Infinity;
        for (const vehicle of this.live.values()) {
          if (vehicle.kind !== kind || (this.seats.get(vehicle.id)?.[seat] ?? null) !== null) continue;
          if (row.role === 'driver' && vehicle.dock.per === 'player' && vehicle.id !== playerVehicle(vehicle.dock.id, this.me)) continue;
          const at = vehiclePoint(vehicle.pose, row.at), d = Math.hypot(at[0] - this.feet.x, at[2] - this.feet.z);
          if (d < near) { near = d; chosen = vehicle; position.set(...at); }
        }
        return chosen === null ? 0 : SEAT_REACH;
      };
      prompts.push(followingPrompt(position, row.role === 'driver' ? kind.labels?.drive ?? DRIVE_LABEL : kind.labels?.ride ?? RIDE_LABEL, pick,
        () => vehicleSeatPrompt(chosen?.id ?? kind.id, seat)));
    });
    // each player dock's, while it stands clear and this player has none of its vehicles out
    for (const dock of this.docks.values()) if (dock.per === 'player') {
      const shown = (): number => (this.me !== null && this.seatOf() === undefined && !this.live.has(playerVehicle(dock.id, this.me)) && this.dockClear(dock) ? SEAT_REACH : 0);
      prompts.push(followingPrompt(new Vector3(dock.at[0], dock.at[1], dock.at[2]), this.kinds.get(dock.kind)?.labels?.drive ?? DRIVE_LABEL, shown, () => vehicleDockPrompt(dock.id)));
    }
    // one way out a kind, over this player's own seat
    for (const kind of this.kinds.values()) {
      const position = new Vector3();
      let leaving: string | null = null;
      const shown = (): number => {
        const held = this.seatOf(), at = held === undefined || this.live.get(held.vehicle)?.kind !== kind ? undefined : this.seatPoint(held.vehicle, held.seat);
        leaving = at === undefined || held === undefined ? null : held.vehicle;
        if (at === undefined) return 0;
        position.set(...at); return SEAT_REACH;
      };
      prompts.push(followingPrompt(position, kind.labels?.leave ?? LEAVE_LABEL, shown, () => vehicleLeavePrompt(leaving ?? kind.id)));
    }
    return prompts;
  }
  /** Whether a player dock stands clear: no vehicle's centre within its hull's reach (the server's `clear`). */
  private dockClear(dock: VehicleDock): boolean {
    const boxes = this.hulls.get(dock.id) ?? [], most = (pick: (box: MoverBox) => number): number => boxes.reduce((far, box) => Math.max(far, pick(box)), 0.5);
    const reach = Math.hypot(Math.max(most(box => -box.z + box.hz), most(box => box.z + box.hz)), most(box => Math.abs(box.x) + box.hx)) * 2;
    return [...this.live.values()].every(vehicle => Math.hypot(vehicle.pose.position.x - dock.at[0], vehicle.pose.position.z - dock.at[2]) >= reach);
  }
}

/** A kind's look for one vehicle: a copy of its props panel (a library panel, drawn nowhere itself), hung beside it. */
export function panelLook(panels: ReadonlyMap<string, Object3D> | undefined, scope: Scope): (kind: VehicleKind, id: string) => ((pose: MoverPose) => void) | null {
  return kind => {
    const panel = panels?.get(kind.panel), parent = panel?.parent;
    if (panel === undefined || parent === null || parent === undefined) return null;
    const copy = panel.clone(); copy.visible = true; copy.matrixAutoUpdate = false; parent.add(copy);
    scope.onDispose(() => { copy.removeFromParent(); });
    return pose => {
      copy.position.set(pose.position.x, pose.position.y, pose.position.z); copy.rotation.set(pose.euler.x, pose.euler.y, pose.euler.z, 'YXZ');
      copy.updateMatrix(); copy.visible = pose.enabled;
    };
  };
}

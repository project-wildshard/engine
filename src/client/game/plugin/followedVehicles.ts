import { Color, Material, Mesh, Vector3, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { KinematicMover } from '@wildshard/engine/physics/mover';
import { queryGroups } from '@wildshard/engine/physics/groups';
import { floorBelow } from '@wildshard/engine/physics/query';
import { STEER_PROBE } from '@wildshard/engine/sim/moverMotion';
import type { VehicleWorld } from '@wildshard/engine/sim/vehicle';
import { castVehicleHull, edgeHit, VEHICLE_RESTITUTION, vehicleCommandOf, vehicleReach, type HullShapes } from '@wildshard/engine/sim/vehicleHull';
import type { SimCommand } from '@wildshard/engine/sim';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { MoverBox, MoverPose } from '@wildshard/format/moverPose';
import type { VehicleDock, VehicleKind, Vehicles } from '@wildshard/format/vehicles';
import { dockHulls, dockUnlocked, vehicleGrip } from '../../../shared/game/shardfile/shardVehicles';
import type { AudioData } from '@wildshard/format/audio';
import { parseVehicleHornRow, parseVehicleSeatRow, parseVehicleWornRow, parseVehicleWreckRow, playerVehicle, vehicleDockOf, vehicleDockPrompt, vehicleLeavePrompt, vehicleSeatPrompt } from '../../../shared/game/shardfile/wirePrompts';
import { vehiclePoint, type MoverView } from './followedMovers';
import { rowState, statePose, VehiclePrediction, type VehicleRow } from './vehiclePrediction';
import { vehicleSoundSources, VehicleSounds, type VehicleHearing, type VehicleSoundOut, type VehicleSoundState } from './vehicleSounds';

/** m within which a seat's or a dock's prompt shows (the server's `SEAT_REACH`). */
const SEAT_REACH = 2.5;
const DRIVE_LABEL = 'Drive', RIDE_LABEL = 'Ride', LEAVE_LABEL = 'Get out';
const SCRIPT = 'script:', STATE = 'state:';
const restPose = (dock: VehicleDock): MoverPose => ({ position: { x: dock.at[0], y: dock.at[1], z: dock.at[2] }, euler: { x: 0, y: dock.yaw, z: 0 }, enabled: true });

/** A prompt that follows what it offers: `radius` places it (0 hides it) and `wireId` names what a press asks for. */
function followingPrompt(position: Vector3, label: string, radius: () => number, wireId: () => string): Interactable {
  return { position, label, onInteract: () => undefined, get radius() { return radius(); }, get wireId() { return wireId(); } };
}
/** MSZ14b: one vehicle's drawn look: posed off its rows, hidden when its row leaves (a despawn or a wreck) until it is back. */
export interface VehicleLook {
  readonly pose: (pose: MoverPose) => void; readonly hide: () => void;
  /** its main colours, most used first (a wreck's chunks are thrown in them) */
  readonly colours?: () => readonly (readonly [number, number, number])[];
}
/** MSZ14b: what a page draws of a hurt vehicle (`VehicleFx`): a worn one's smoke each frame, a wrecked one's break-apart. */
export interface VehicleFxPort {
  readonly smokeFrom: (id: string, pose: MoverPose, dt: number) => void;
  readonly burst: (pose: MoverPose, colours?: readonly (readonly [number, number, number])[]) => void;
  readonly frame: (dt: number, smoking: ReadonlySet<string>) => void;
}
/** One vehicle this page follows: its collider in the page's physics, its drawn look, and its last row. */
interface Followed { readonly id: string; readonly dock: VehicleDock; readonly kind: VehicleKind; readonly body: KinematicMover; look: VehicleLook | null; pose: MoverPose; readonly view: MoverView }

/** MSZ16: what the wire says of a driven vehicle as a command goes: its row in the newest frame (when that frame carried one),
 *  and how many of the commands this page sent the server has not stepped yet, this one among them. */
export interface VehicleWire { readonly row: (id: string) => VehicleRow | null; readonly behind: number }
/** MSZ16: a page's driving as a proof reads it (`FollowedVehicles.report`). */
export interface VehicleReport {
  readonly driving: string | null; readonly corrections: number; readonly snaps: number; readonly worst: number;
  readonly docks: readonly (readonly [string, number, number])[];
}
/** What a page lends the vehicles it follows. */
export interface FollowedVehiclePorts {
  readonly physics: Physics; readonly scope: Scope;
  /** A kind's drawn look for one vehicle of it (a copy of its props panel), posed by its rows; none draws nothing. Made once
   *  an id: a vehicle back from a despawn or a wreck shows the same look again. */
  readonly look?: (kind: VehicleKind, id: string) => VehicleLook | null;
  /** MSZ14b: a hurt vehicle's smoke and break-apart; none draws neither. */
  readonly fx?: VehicleFxPort;
  /** MSZ15: where its vehicles' sounds go and the shard's cues and recordings its kinds' `sounds` rows name; none is silent. */
  readonly sounds?: { readonly out: VehicleSoundOut; readonly audio: Pick<AudioData, 'cues' | 'recordings'> };
}
/** MSZ15: where one vehicle was drawn over the last moments, for its sound: its velocity is read over `MOTION_WINDOW` s, so a
 *  held or caught-up frame of its rows does not read as a lurch. */
interface Motion { readonly back: { t: number; x: number; z: number }[]; t: number; vx: number; vz: number; quiet: number; peak: number }
/** MSZ15: s a velocity is read over (and a hit against the one before it), m/s of change across that that is a hit (harder
 *  than any brake), s a hit stays heard, and the m in one frame that is a jump (a respawn, a vehicle brought home), not a move. */
const MOTION_WINDOW = 0.1, HIT_CHANGE = 5, HIT_QUIET = 0.3, JUMP = 5;
/** MSZ14c: a page's look and fx for its vehicles, lent once its panels are drawn (a grid cell's load after its physics). */
export interface VehicleDress { readonly look: (kind: VehicleKind, id: string) => VehicleLook | null; readonly fx?: VehicleFxPort }

/**
 * MIRROR-SALT-ZONE MSZ9b: the vehicles on a page, as the server's `VehicleRuntime` puts them on the wire. Nothing steps here:
 * each vehicle's `script:` row poses its hull (a kinematic body the page's walk meets, as `FollowedMovers` does a mover's) and
 * its look, and each taken seat's `state` row says who sits where. A per-player vehicle's row comes and goes with it, so its
 * body is made on its first row and freed when its row leaves; a shared dock's stands at its dock from the start.
 *
 * Its prompts are a fixed few that follow the vehicles: for each kind's seat, the nearest free one of that kind (a per-player
 * vehicle's driver seat only for its owner); each player dock's while it stands clear and this player has no vehicle out;
 * and one leave prompt over this player's own seat. A press goes by wire id and the server decides.
 *
 * MSZ16: the one vehicle this page's player drives is predicted, not followed: each command the page sends steps it here
 * (`VehiclePrediction`, through this page's world), its rows settle it, and its collider and look stand where the page has it.
 * A passenger's vehicle, and everyone else's, follows its rows.
 */
export class FollowedVehicles {
  readonly vehicles: Vehicles;
  private readonly kinds: ReadonlyMap<string, VehicleKind>;
  private readonly docks: ReadonlyMap<string, VehicleDock>;
  private readonly hulls: ReadonlyMap<string, readonly MoverBox[]>;
  private readonly grip: Pick<VehicleWorld, 'gripAt'>;
  private readonly ports: FollowedVehiclePorts;
  private readonly live = new Map<string, Followed>();
  /** Who sits in each seat, by vehicle, as the newest rows say. */
  private readonly seats = new Map<string, (string | null)[]>();
  /** MSZ14: the vehicles worn enough to smoke, off their `vehicleWornRow`s. */
  private readonly wornOut = new Set<string>();
  /** MSZ14b: the vehicles wrecked and not yet back at their docks, off their `vehicleWreckRow`s. */
  private readonly wrecks = new Set<string>();
  /** MSZ14b: each vehicle's look, kept while it is gone so it shows again when it is back. */
  private readonly looks = new Map<string, VehicleLook | null>();
  /** MSZ14c: the look and fx this page draws with: its ports', or the dress lent later (`dress`). */
  private lookOf: FollowedVehiclePorts['look']; private fx: VehicleFxPort | undefined;
  /** This page's player, as its wire's welcome names it. */
  private me: string | null = null;
  private ownedFlags: ReadonlySet<string> | undefined;
  /** This page's player's feet, as the last frame had them: a seat's prompt goes to the nearest free one. */
  private readonly feet = { x: 0, z: 0 };
  private readonly made: Interactable[];
  /** MSZ16: the vehicle this page's player drives, stepped here on its commands. */
  private predicted: { readonly id: string; readonly run: VehiclePrediction } | null = null;
  private readonly shapes: HullShapes = new Map();
  /** MSZ15: the vehicles' sounds, the horns held (off their `vehicleHornRow`s), each one's motion off its drawn poses, and
   *  the throttle and horn of this page's own driving. */
  private readonly sounds: VehicleSounds | null;
  private readonly horns = new Set<string>();
  private readonly motions = new Map<string, Motion>();
  private readonly mine = { throttle: 0, horn: false };
  constructor(vehicles: Vehicles, ports: FollowedVehiclePorts) {
    this.vehicles = vehicles; this.ports = ports; this.lookOf = ports.look; this.fx = ports.fx;
    this.kinds = new Map(vehicles.kinds.map(kind => [kind.id, kind]));
    this.docks = new Map(vehicles.docks.map(dock => [dock.id, dock]));
    this.hulls = dockHulls(vehicles);
    this.grip = vehicleGrip(vehicles);
    for (const dock of vehicles.docks) if (dock.per === 'shared') this.follow(dock.id, restPose(dock));
    // MSZ14c: a look outlives this follower (a grid cell's panels outlast its physics), so it hides as the follower goes
    ports.scope.onDispose(() => { for (const vehicle of this.live.values()) vehicle.body.dispose(); this.live.clear(); for (const look of this.looks.values()) look?.hide(); });
    this.made = this.makePrompts();
    const sounds = ports.sounds;
    this.sounds = sounds === undefined ? null : new VehicleSounds(sounds.out, kind => vehicleSoundSources(kind, sounds.audio));
    ports.scope.onDispose(() => { this.sounds?.dispose(); });
  }
  /** MSZ14c: draw with `dress` from now on: a vehicle out with no look yet takes one where its row stands. */
  dress(dress: VehicleDress): void {
    this.lookOf = dress.look; this.fx = dress.fx;
    for (const [id, look] of this.looks) if (look === null) this.looks.delete(id);
    for (const vehicle of this.live.values()) if (vehicle.look === null) { vehicle.look = this.lookFor(vehicle.kind, vehicle.id); vehicle.look?.pose(vehicle.pose); }
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
  /** Pose a vehicle off its row: its collider and its look. The vehicle this page drives stands where it predicts it. */
  follow(id: string, pose: MoverPose): void {
    if (this.predicted?.id === id) return;
    const vehicle = this.live.get(id) ?? this.make(id, pose); if (vehicle === null) return;
    vehicle.pose = pose; vehicle.body.setPose(pose); vehicle.look?.pose(pose);
  }
  /**
   * Once a frame, the wire's entity ids: the vehicles out (a per-player one whose row left goes) and the seats taken. `me` is
   * this page's player and `feet` where it stands.
   */
  sync(ids: Iterable<string>, me: string | null, feet: { readonly x: number; readonly z: number }, ownedFlags?: ReadonlySet<string>): void {
    this.ownedFlags = ownedFlags;
    this.me = me; this.feet.x = feet.x; this.feet.z = feet.z;
    const out = new Set<string>(); this.seats.clear(); this.wornOut.clear(); this.wrecks.clear(); this.horns.clear();
    for (const id of ids) {
      if (id.startsWith(SCRIPT)) { const vehicle = id.slice(SCRIPT.length); if (this.docks.has(vehicleDockOf(vehicle))) out.add(vehicle); continue; }
      if (!id.startsWith(STATE)) continue;
      const worn = parseVehicleWornRow(id.slice(STATE.length)); if (worn !== null) { this.wornOut.add(worn); continue; }
      const wreck = parseVehicleWreckRow(id.slice(STATE.length)); if (wreck !== null) { this.wrecks.add(wreck); continue; }
      const horn = parseVehicleHornRow(id.slice(STATE.length)); if (horn !== null) { this.horns.add(horn); continue; }
      const row = parseVehicleSeatRow(id.slice(STATE.length)); if (row === null) continue;
      let seats = this.seats.get(row.vehicle);
      if (seats === undefined) { seats = this.kindOf(row.vehicle)?.seats.map(() => null) ?? []; this.seats.set(row.vehicle, seats); }
      if (row.seat < seats.length) seats[row.seat] = row.player;
    }
    // a vehicle whose row left is gone: a per-player one despawned, or any one wrecked (MSZ14); its look hides, and a wrecked
    // one breaks apart where it stood (MSZ14b)
    for (const [id, vehicle] of this.live) if (!out.has(id)) {
      vehicle.body.dispose(); this.live.delete(id); vehicle.look?.hide();
      if (this.wrecks.has(id)) this.fx?.burst(vehicle.pose, vehicle.look?.colours?.() ?? []);
    }
    // MSZ16: out of the driver's seat (left, set down, wrecked), the vehicle follows its rows again
    if (this.predicted !== null && !this.driving(this.predicted.id)) this.predicted = null;
  }
  /**
   * MSZ16: one command this page sent, as the server will read it: when this page's player drives a vehicle here, it steps the
   * vehicle on it and settles on the newest row. The first command in the seat starts the prediction off that row.
   */
  command(command: SimCommand, wire: VehicleWire): void {
    const held = this.seatOf(), vehicle = held === undefined ? undefined : this.live.get(held.vehicle);
    if (held === undefined || vehicle === undefined || !this.driving(vehicle.id)) { this.predicted = null; return; }
    if (this.predicted?.id !== vehicle.id) {
      const row = wire.row(vehicle.id);
      this.predicted = { id: vehicle.id, run: new VehiclePrediction(vehicle.kind.handling, this.worldOf(vehicle), rowState(row ?? { pose: vehicle.pose }, { forward: 0, slip: 0 })) };
    }
    const { run } = this.predicted, stick = vehicleCommandOf(command, run.state().yaw);
    run.step(stick);
    this.mine.throttle = Math.abs(stick.throttle); this.mine.horn = stick.horn === true; // MSZ15: heard at once, not a row later
    const row = wire.row(vehicle.id), snaps = run.snaps;
    if (row !== null && run.settle(row, wire.behind)) { this.driven.corrections++; this.driven.snaps += run.snaps - snaps; this.driven.worst = Math.max(this.driven.worst, run.worst); }
    this.place(vehicle, run);
  }
  /** MSZ16, a drawn frame of `dt` s: a correction eases out of the driven vehicle; each worn one smokes (MSZ14b). */
  frame(dt: number): void {
    const predicted = this.predicted, vehicle = predicted === null ? undefined : this.live.get(predicted.id);
    if (predicted !== null && vehicle !== undefined) { predicted.run.ease(dt); this.place(vehicle, predicted.run); }
    this.hear(dt);
    const fx = this.fx; if (fx === undefined) return;
    for (const id of this.wornOut) { const worn = this.live.get(id); if (worn !== undefined) fx.smokeFrom(id, worn.pose, dt); }
    fx.frame(dt, this.wornOut);
  }
  /** MSZ16, what a proof reads: the vehicle this page's player drives, every correction its rows made (and the snaps among
   *  them, and the widest gap), and where each dock stands. */
  report(): VehicleReport {
    return { driving: this.predicted?.id ?? null, ...this.driven, docks: [...this.docks.values()].map(dock => [dock.id, dock.at[0], dock.at[2]] as const) };
  }
  private readonly driven = { corrections: 0, snaps: 0, worst: 0 };
  /** MSZ18: whether the vehicle this page's player drives met the cell's edge since the last ask. */
  takeEdge(): boolean { return this.predicted?.run.takeEdge() ?? false; }
  /** MSZ16: the prediction of the vehicle this page's player drives, while it drives one. */
  prediction(): VehiclePrediction | null { return this.predicted?.run ?? null; }
  /** MSZ15: what a proof reads of a vehicle's sound now: its loop's rate, its skid, its wind and its hits so far. */
  sound(id: string): VehicleSoundState | undefined { return this.sounds?.state(id); }
  /** MSZ15, a drawn frame: each vehicle out as its sound hears it. The one this page drives speaks for itself (its prediction's
   *  speeds and hits, and the stick); every other one moves as its drawn poses show it, a sudden change of velocity a hit. */
  private hear(dt: number): void {
    const sounds = this.sounds; if (sounds === null || dt <= 0) return;
    const held = this.seatOf(), hearings: VehicleHearing[] = [];
    for (const vehicle of this.live.values()) {
      const { x, y, z } = vehicle.pose.position, yaw = vehicle.pose.euler.y, motion = this.motionOf(vehicle.id, x, z, dt);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), aboard = held?.vehicle === vehicle.id;
      const run = this.predicted?.id === vehicle.id ? this.predicted.run : null, state = run?.state();
      hearings.push({
        id: vehicle.id, kind: vehicle.kind, at: { x, y, z }, aboard,
        forward: state?.forward ?? motion.vx * fx + motion.vz * fz, slip: state?.slip ?? motion.vx * rx + motion.vz * rz,
        throttle: run === null ? 0 : this.mine.throttle, horn: this.horns.has(vehicle.id) || (run !== null && this.mine.horn),
        impact: run !== null ? run.takeImpact() : motion.struck,
      });
    }
    for (const id of this.motions.keys()) if (!this.live.has(id)) this.motions.delete(id);
    sounds.frame(dt, hearings, this.feet);
  }
  /** MSZ15: a vehicle's velocity off its drawn poses over the last `MOTION_WINDOW` s, and how hard it was hit this frame: the
   *  most its velocity changed from the window before, when no brake could make it (heard once, as that change passes its
   *  peak, then quiet for `HIT_QUIET` s). A jump starts it again from rest. */
  private motionOf(id: string, x: number, z: number, dt: number): Motion & { readonly struck: number } {
    let motion = this.motions.get(id);
    const last = motion?.back[motion.back.length - 1];
    if (motion === undefined || last === undefined || Math.hypot(x - last.x, z - last.z) > JUMP) {
      motion = { back: [], t: 0, vx: 0, vz: 0, quiet: 0, peak: 0 }; this.motions.set(id, motion);
    }
    motion.t += dt; motion.quiet = Math.max(0, motion.quiet - dt);
    const { back, t } = motion; back.push({ t, x, z });
    while (back.length > 2 && (back[1]?.t ?? t) <= t - 2 * MOTION_WINDOW) back.shift();
    const at = (when: number): { t: number; x: number; z: number } | undefined => { let found: { t: number; x: number; z: number } | undefined; for (const row of back) if (row.t <= when) found = row; return found; };
    const mid = at(t - MOTION_WINDOW), first = mid === undefined ? undefined : at(mid.t - MOTION_WINDOW);
    if (mid === undefined || t - mid.t <= 0) return { ...motion, struck: 0 };
    motion.vx = (x - mid.x) / (t - mid.t); motion.vz = (z - mid.z) / (t - mid.t);
    let struck = 0;
    if (first !== undefined && mid.t - first.t > 0 && motion.quiet === 0) {
      const change = Math.hypot(motion.vx - (mid.x - first.x) / (mid.t - first.t), motion.vz - (mid.z - first.z) / (mid.t - first.t));
      // heard at its peak: the windows take a few frames to see the whole of a bounce
      if (change >= HIT_CHANGE && change > motion.peak) motion.peak = change;
      else if (motion.peak > 0) { struck = motion.peak; motion.peak = 0; motion.quiet = HIT_QUIET; }
    }
    return { ...motion, struck };
  }
  /** MSZ14: whether a vehicle is worn enough to smoke (its look reads it, MSZ14b). */
  worn(id: string): boolean { return this.wornOut.has(id); }
  /** The prompts this page offers for its vehicles: the same objects every call, which follow the vehicles. */
  prompts(): Interactable[] { return this.made; }

  /** Whether this page's player holds `id`'s driver seat. */
  private driving(id: string): boolean {
    const held = this.seatOf(), vehicle = this.live.get(id);
    return held?.vehicle === id && vehicle?.kind.seats[held.seat]?.role === 'driver';
  }
  /** The driven vehicle's collider where the page has it, its look (and every seat's point) where it is drawn. */
  private place(vehicle: Followed, run: VehiclePrediction): void {
    vehicle.body.setPose(statePose(run.state()));
    const drawn = statePose(run.drawnState()); vehicle.pose = drawn; vehicle.look?.pose(drawn);
  }
  /** MSZ16: the world a driven vehicle steps through on this page, as the server's (`VehicleRuntime.spawnAt`): the floor under
   *  it through its own hull, and its hull's cast against what this page has (the world and the other vehicles; walkers and
   *  creatures are the server's, and its rows bring their pushes). */
  private worldOf(vehicle: Followed): VehicleWorld {
    const physics = this.ports.physics, id = vehicle.id, reach = vehicleReach(this.hulls.get(vehicle.dock.id) ?? []), mine = (collider: Parameters<typeof tagOf>[0]): boolean => tagOf(collider)?.owner !== id;
    return {
      floor: (x, z, fromY) => floorBelow(physics, x, z, fromY, STEER_PROBE.up + STEER_PROBE.down, undefined, mine), ...reach, ...this.grip,
      hit: (from, move, yaw) => {
        const hit = castVehicleHull(physics, this.shapes, reach, from, move, yaw, queryGroups(['WORLD'], 'WORLD'), mine), edge = edgeHit(from, move);
        if (hit === null || (edge !== null && edge.at < hit.at)) return edge; // MSZ18: the cell's edge, as the server has it
        const owner = tagOf(hit.collider)?.owner ?? null, other = typeof owner === 'string' ? this.live.get(owner) : undefined;
        return other === undefined ? { at: hit.at, normal: hit.normal, owner, mass: Infinity, velocity: { x: 0, z: 0 }, restitution: VEHICLE_RESTITUTION.solid }
          : { at: hit.at, normal: hit.normal, owner, mass: other.kind.handling.mass, velocity: { x: 0, z: 0 }, restitution: VEHICLE_RESTITUTION.vehicle };
      },
    };
  }
  private make(id: string, pose: MoverPose): Followed | null {
    const dock = this.docks.get(vehicleDockOf(id)), kind = dock === undefined ? undefined : this.kinds.get(dock.kind), boxes = dock === undefined ? undefined : this.hulls.get(dock.id);
    if (dock === undefined || kind === undefined || boxes === undefined) return null;
    const vehicle: Followed = { id, dock, kind, body: new KinematicMover(this.ports.physics, boxes, pose, id), look: this.lookFor(kind, id), pose,
      view: { pose: next => { this.follow(id, next); } } };
    this.live.set(id, vehicle);
    return vehicle;
  }
  private lookFor(kind: VehicleKind, id: string): VehicleLook | null {
    let look = this.looks.get(id);
    if (look === undefined) { look = this.lookOf?.(kind, id) ?? null; this.looks.set(id, look); }
    return look;
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
      const shown = (): number => (this.me !== null && dockUnlocked(dock, this.ownedFlags) && this.seatOf() === undefined && !this.live.has(playerVehicle(dock.id, this.me)) && this.dockClear(dock) ? SEAT_REACH : 0);
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

/** A kind's look for one vehicle: a copy of its props panel (a library panel, drawn nowhere itself), hung beside it; hidden
 *  while the vehicle is gone (MSZ14b). */
export function panelLook(panels: ReadonlyMap<string, Object3D> | undefined, scope: Scope): (kind: VehicleKind, id: string) => VehicleLook | null {
  const made = new Map<string, VehicleLook>(); // one copy an id, however often a follower asks (MSZ14c: a cell re-admitted)
  return (kind, id) => {
    const known = made.get(id); if (known !== undefined) return known;
    const panel = panels?.get(kind.panel), parent = panel?.parent;
    if (panel === undefined || parent === null || parent === undefined) return null;
    const copy = panel.clone(); copy.visible = true; copy.matrixAutoUpdate = false; parent.add(copy);
    scope.onDispose(() => { copy.removeFromParent(); });
    const look: VehicleLook = {
      pose: pose => {
        copy.position.set(pose.position.x, pose.position.y, pose.position.z); copy.rotation.set(pose.euler.x, pose.euler.y, pose.euler.z, 'YXZ');
        copy.updateMatrix(); copy.visible = pose.enabled;
      },
      hide: () => { copy.visible = false; },
      colours: () => panelColours(copy),
    };
    made.set(id, look);
    return look;
  };
}

/** MSZ14b: a panel's main colours, by how many of its meshes wear each (at most three, most used first). */
export function panelColours(panel: Object3D): readonly (readonly [number, number, number])[] {
  const counts = new Map<number, number>();
  panel.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const material: unknown = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!(material instanceof Material) || !('color' in material) || !(material.color instanceof Color)) return;
    const hex = material.color.getHex(); counts.set(hex, (counts.get(hex) ?? 0) + 1);
  });
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex]) => new Color(hex).toArray() as [number, number, number]);
}

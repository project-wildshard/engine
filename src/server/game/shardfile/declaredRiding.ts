import * as v from 'valibot';
import { Vector3 } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost, SimPlayerMotionSample, SimRide, SimValue } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { tagOf } from '@wildshard/engine/physics/surface';
import { withOwner } from '@wildshard/engine/app/ownership';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { commandReins, MountedBody, mountedMotorOptions, type HorseSpeeds, type MountedRider, type MountedWorld, type ReinsFrameRow } from '../../../shared/game/riding/physics';

/** ONE-FORMAT CC40b1 (Q27, Q-S3, Q-C7): the one riding primitive on the declared path. Any spawned creature whose species
 * row carries `mount` (shard-format CC40a) takes a rider: a `ride` act's `mount` seats the player on the nearest one in
 * reach, the reins drive it at the row's gaits (walk, then gallop on sprint) on `MountedBody`, and `dismount` stands the
 * player beside it. No shard program decides anything: the rules are the row's. Saves carry each seat and its capsule. */
export interface DeclaredRiding {
  /** The creature a player rides, or null on foot. */
  readonly ridden: (player: string) => AnimalSim | null;
  /** The gait speeds a mount species rides at. */
  readonly speeds: (species: string) => HorseSpeeds | undefined;
  readonly mount: (player: string, id?: string) => boolean;
  readonly dismount: (player: string) => void;
}

/** How far from a mount's centre a player may climb on, in metres beyond its scale. */
const REACH = 3;
const STEP_ID = 'riding.declared';
/** A flying mount cruises at least this high, whatever its flight row's altitude (a ground flyer's 0 would never leave). */
const MIN_ALTITUDE = 4;

/** A mount row's gaits as the reins read them: a missing trot or canter falls a third or two thirds of the way up. */
export function mountSpeeds(gaits: { readonly walk: number; readonly trot?: number; readonly canter?: number; readonly gallop: number }): HorseSpeeds {
  const { walk, gallop } = gaits, span = gallop - walk;
  return { walk, trot: gaits.trot ?? walk + span / 3, canter: gaits.canter ?? walk + 2 * span / 3, gallop };
}

const num = v.pipe(v.number(), v.finite());
const FlightSaved = v.strictObject({ lift: num, phase: v.picklist(['climb', 'cruise', 'descend']) });
const SeatSaved = v.strictObject({ player: v.string(), horse: v.string(), body: v.unknown(), motor: v.unknown(),
  rider: v.strictObject({ velocity: v.tuple([num, num, num]), onGround: v.boolean() }), flight: v.exactOptional(v.nullable(FlightSaved)) });
const Saved = v.strictObject({ version: v.literal(1), seats: v.pipe(v.array(SeatSaved), v.maxLength(64)) });

/** CC40b2: a flying mount's air state. `lift` is metres above the ground under it; null on the ground. */
interface Flight { lift: number; phase: 'climb' | 'cruise' | 'descend' }
/** What a `fly` mount flies with: its species `flight` row's altitude and climb and dive rates. */
interface Wings { readonly altitude: number; readonly climb: number; readonly dive: number }

interface Seat {
  readonly player: PlayerSim; readonly body: MountedBody; readonly rider: MountedRider;
  horse: AnimalSim | null; flight: Flight | null; jumpWas: boolean; savedMotor: NonNullable<ConstructorParameters<typeof CharacterMotor>[2]> | null;
}

/** Install the riding primitive when any species declares a mount; null when none does. */
export function installDeclaredRiding(host: SimHost, shard: Pick<Shardfile, 'rows'>): DeclaredRiding | null {
  const gaits = new Map(shard.rows.species.flatMap(row => row.mount === undefined ? [] : [[row.id, mountSpeeds(row.mount.gaits)] as const]));
  if (gaits.size === 0) return null;
  const wings = new Map(shard.rows.species.flatMap(row => row.mount?.fly !== true || row.flight === undefined ? []
    : [[row.id, { altitude: Math.max(MIN_ALTITUDE, row.flight.altitude), climb: row.flight.climbRate, dive: row.flight.diveRate }] as const]));
  const seats = new Map<string, Seat>();
  const heightAt = (x: number, z: number): number => host.groundHeightAt(x, z);
  const world: MountedWorld = { get physics() { return host.physics; }, heightAt, waterLevel: () => -Infinity, wetAt: undefined,
    stampede: () => null, thrown: () => undefined };
  /** A ridden creature's own capsule stands aside under the mount's, and comes back where the ride left it. */
  const holdOwnBody = (a: AnimalSim, ridden: boolean): void => {
    if (!(a.motor instanceof CharacterMotor)) return;
    if (!ridden) a.motor.resetAt(a.position);
    a.motor.setEnabled(!ridden);
  };
  const riddenBy = (a: AnimalSim): Seat | undefined => [...seats.values()].find(seat => seat.horse === a);
  const free = (seat: Seat): void => {
    const a = seat.horse; if (a === null) return;
    if (seat.flight !== null) { seat.body.feet.y = heightAt(seat.body.feet.x, seat.body.feet.z); seat.flight = null; }
    a.position.copy(seat.body.feet); a.yaw = seat.body.heading; a.driven = false; a.levelGround = false;
    a.yOffset = Math.max(0, seat.body.feet.y - heightAt(seat.body.feet.x, seat.body.feet.z));
    a.setMotion(a.yaw, 0, 2);
    seat.body.motor?.dispose(); seat.body.motor = null; seat.body.gait = 'stand';
    holdOwnBody(a, false);
    seat.horse = null;
  };
  const seatFor = (player: PlayerSim): Seat => {
    const known = seats.get(player.id); if (known?.player === player) return known;
    player.modes.register({ id: 'ride', hud: 'ride' }, host.scope);
    const speeds = { walk: 1, trot: 2, canter: 3, gallop: 4 };
    const seat: Seat = { player, body: new MountedBody(speeds), rider: { position: player.position, velocity: new Vector3(), onGround: true, sprinting: false, crouching: false, speedFactor: 1 },
      horse: null, savedMotor: null, flight: null, jumpWas: false };
    seats.set(player.id, seat);
    return seat;
  };
  const dismountSeat = (seat: Seat): void => {
    const a = seat.horse; if (a === null) return;
    const side = a.yaw + Math.PI / 2, x = a.position.x + Math.cos(side) * 1.5, z = a.position.z - Math.sin(side) * 1.5;
    free(seat);
    seat.rider.position.set(x, heightAt(x, z), z); seat.rider.velocity.set(0, 0, 0); seat.rider.onGround = true;
    seat.player.motor.setEnabled(true); seat.player.fall.grounded = true; seat.player.velocity.y = 0;
    seat.player.modes.exit('ride');
  };
  /** One step in the air: the reins steer and pace it as on the ground (no motor, nothing to stand on), then the
   * lift climbs to the cruise altitude or dives to the ground; touching down hands the feet back to the motor. */
  const flyStep = (seat: Seat, a: AnimalSim, air: Flight, w: Wings, dt: number): void => {
    const body = seat.body, motor = body.motor;
    body.motor = null;
    try { body.stepBody(dt, a, seat.rider, world); } finally { body.motor = motor; }
    if (air.phase === 'climb') { air.lift = Math.min(w.altitude, air.lift + w.climb * dt); if (air.lift >= w.altitude) air.phase = 'cruise'; }
    else if (air.phase === 'descend') air.lift = Math.max(0, air.lift - w.dive * dt);
    const ground = heightAt(body.feet.x, body.feet.z);
    body.feet.y = ground + air.lift; a.position.y = body.feet.y; a.levelGround = true;
    seat.rider.onGround = false;
    if (air.phase === 'descend' && air.lift <= 0) {
      seat.flight = null; body.feet.y = ground; a.position.y = ground; seat.rider.onGround = true;
      if (motor !== null) { motor.resetAt(body.feet); motor.setEnabled(true); }
    }
    if (seat.horse !== null) body.placeRider(dt, 1, a, seat.rider, world);
  };
  const frame: ReinsFrameRow = { forward: 0, turn: 0, touchX: 0, touchY: 0, gallop: false, jump: false, drawing: false, moveScale: 1,
    phase: 0, feet: { x: 0, z: 0 }, roads: undefined, inBounds: () => true, refuses: () => false, wet: false };
  const motion = { velocityX: 0, velocityZ: 0, grounded: true, swimming: false, hover: false };
  const rideOf = (seat: Seat): SimRide => ({
    motionSample: (): SimPlayerMotionSample => { motion.velocityX = seat.rider.velocity.x; motion.velocityZ = seat.rider.velocity.z; motion.grounded = seat.rider.onGround; return motion; },
    mount: () => seat.horse?.entityId ?? '',
    // OF25b: no page has a law for this ride (a shard whose page declares no Mount), so it says no ride words: the server leads
    // the seated body (`host.leading` below) and the page follows it, sending the reins as it would its walk.
    capture: () => 0,
    read: (command, dt) => {
      const a = seat.horse; if (a === null) return;
      if (!a.alive) { dismountSeat(seat); return; }
      if (command !== undefined) seat.player.yaw = command.yaw;
      seat.player.impulse.set(0, 0, 0);
      commandReins(frame, command); frame.feet = seat.body.feet; frame.moveScale = seat.player.moveScale;
      seat.body.read(dt, frame);
      const w = wings.get(a.species);
      if (w !== undefined) {
        const press = frame.jump && !seat.jumpWas; seat.jumpWas = frame.jump; seat.body.jumpQueued = false;
        if (press && seat.flight === null) { seat.flight = { lift: 0, phase: 'climb' }; seat.body.motor?.setEnabled(false); }
        else if (press && seat.flight !== null) seat.flight.phase = 'descend';
      }
    },
    step: dt => {
      const a = seat.horse; if (a === null) return;
      const air = seat.flight, w = wings.get(a.species);
      if (air !== null && w !== undefined) { flyStep(seat, a, air, w, dt); return; }
      seat.body.stepBody(dt, a, seat.rider, world);
      if (seat.horse !== null) seat.body.placeRider(dt, 1, a, seat.rider, world);
    },
  });
  const rides = new Map<Seat, SimRide>();
  const rideFor = (seat: Seat): SimRide => { const known = rides.get(seat); if (known !== undefined) return known; const ride = rideOf(seat); rides.set(seat, ride); return ride; };
  const canTake = (a: AnimalSim | undefined): a is AnimalSim => a !== undefined && a.alive && !a.driven && gaits.has(a.species) && riddenBy(a) === undefined;
  const seatOn = (seat: Seat, a: AnimalSim): void => {
    const speeds = gaits.get(a.species); if (speeds === undefined) throw new Error('Mount species lost its gaits');
    const body = new MountedBody(speeds);
    Object.assign(seat, { body });
    seat.flight = null; seat.jumpWas = false;
    seat.horse = a; a.driven = true; a.yOffset = 0; a.setMotion(a.yaw, 0, 2); holdOwnBody(a, true);
    body.heading = a.yaw; body.speed = 0; body.feet.copy(a.position);
    body.motor = withOwner(null, () => new CharacterMotor(host.physics, mountedMotorOptions(a.scale, a)));
    body.settleBody(); body.landBody(world); body.eyeY = body.feet.y;
    seat.player.motor.setEnabled(false);
    rides.delete(seat);
    seat.player.modes.enter('ride', rideFor(seat));
  };
  const mount = (player: string, id?: string): boolean => {
    const p = host.players.get(player); if (p === undefined) return false;
    const seat = seatFor(p); if (seat.horse !== null) return false;
    const near = id !== undefined ? [host.entities.get(id)] : [...host.entities.values()]
      .filter(a => Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) <= REACH * Math.max(1, a.scale))
      .sort((a, b) => Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) - Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z));
    const a = near.find(canTake);
    if (a === undefined || Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) > REACH * Math.max(1, a.scale)) return false;
    seatOn(seat, a);
    return true;
  };
  const dismount = (player: string): void => { const seat = seats.get(player); if (seat !== undefined) dismountSeat(seat); };
  // OF25b: a seated rider is the server's to move; its page takes the frames as they come and never waits on a ride of its own.
  host.leading.push(player => { const seat = seats.get(player.id); return seat?.player === player && seat.horse !== null; });
  const routes = actRoutes(host);
  routes.ride = (player, action) => { if (action === 'mount') mount(player); else if (action === 'dismount') dismount(player); };
  routes.mountable = id => canTake(host.entities.get(id));
  host.onStep(STEP_ID, () => {
    for (const [id, seat] of seats) if (!host.players.has(id) || host.players.get(id) !== seat.player) { free(seat); seats.delete(id); }
  }, {
    snapshot: (): SimValue => ({ version: 1, seats: [...seats.values()].flatMap(seat => seat.horse === null ? [] : [{ player: seat.player.id, horse: seat.horse.entityId,
      body: seat.body.snapshotBody() as unknown as SimValue, motor: (seat.body.motor?.snapshot() ?? null) as unknown as SimValue,
      rider: { velocity: seat.rider.velocity.toArray(), onGround: seat.rider.onGround },
      ...(seat.flight === null ? {} : { flight: { ...seat.flight } }) }]) }),
    restore: value => {
      const saved = v.parse(Saved, value);
      for (const row of saved.seats) {
        const p = host.players.get(row.player), a = host.entities.get(row.horse), speeds = a === undefined ? undefined : gaits.get(a.species);
        if (p === undefined || a === undefined || speeds === undefined) throw new Error('Invalid declared ride continuation');
        const seat = seatFor(p), body = new MountedBody(speeds); body.restoreBody(row.body);
        Object.assign(seat, { body }); seat.horse = a; seat.savedMotor = row.motor as Seat['savedMotor'];
        seat.rider.velocity.fromArray(row.rider.velocity); seat.rider.onGround = row.rider.onGround;
        seat.flight = row.flight === undefined || row.flight === null ? null : { ...row.flight };
        a.driven = true; holdOwnBody(a, true); p.motor.setEnabled(false); rides.delete(seat); p.modes.enter('ride', rideFor(seat));
      }
    },
    physicsRestored: () => {
      for (const seat of seats.values()) {
        const a = seat.horse, state = seat.savedMotor; if (a === null || state === null) continue;
        const c = host.physics.world.getCollider(state.colliderHandle);
        if (tagOf(c)?.owner !== a) throw new Error('Invalid declared ride capsule');
        seat.body.motor = withOwner(null, () => new CharacterMotor(host.physics, mountedMotorOptions(a.scale, a), state)); seat.savedMotor = null;
        if (seat.flight !== null) seat.body.motor.setEnabled(false);
      }
    },
  }, 'afterBodies');
  host.scope.onDispose(() => { for (const seat of seats.values()) { seat.body.motor?.dispose(); seat.body.motor = null; } });
  return { ridden: player => seats.get(player)?.horse ?? null, speeds: species => gaits.get(species), mount, dismount };
}

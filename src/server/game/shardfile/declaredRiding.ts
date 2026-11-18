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
import { commandReins, MountedBody, RIDE_WORDS, mountedMotorOptions, type HorseSpeeds, type MountedRider, type MountedWorld, type ReinsFrameRow } from '../../../shared/game/riding/physics';

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

/** A mount row's gaits as the reins read them: a missing trot or canter falls a third or two thirds of the way up. */
export function mountSpeeds(gaits: { readonly walk: number; readonly trot?: number; readonly canter?: number; readonly gallop: number }): HorseSpeeds {
  const { walk, gallop } = gaits, span = gallop - walk;
  return { walk, trot: gaits.trot ?? walk + span / 3, canter: gaits.canter ?? walk + 2 * span / 3, gallop };
}

const num = v.pipe(v.number(), v.finite());
const SeatSaved = v.strictObject({ player: v.string(), horse: v.string(), body: v.unknown(), motor: v.unknown(),
  rider: v.strictObject({ velocity: v.tuple([num, num, num]), onGround: v.boolean() }) });
const Saved = v.strictObject({ version: v.literal(1), seats: v.pipe(v.array(SeatSaved), v.maxLength(64)) });

interface Seat {
  readonly player: PlayerSim; readonly body: MountedBody; readonly rider: MountedRider;
  horse: AnimalSim | null; savedMotor: NonNullable<ConstructorParameters<typeof CharacterMotor>[2]> | null;
}

/** Install the riding primitive when any species declares a mount; null when none does. */
export function installDeclaredRiding(host: SimHost, shard: Pick<Shardfile, 'rows'>): DeclaredRiding | null {
  const gaits = new Map(shard.rows.species.flatMap(row => row.mount === undefined ? [] : [[row.id, mountSpeeds(row.mount.gaits)] as const]));
  if (gaits.size === 0) return null;
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
      horse: null, savedMotor: null };
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
  const frame: ReinsFrameRow = { forward: 0, turn: 0, touchX: 0, touchY: 0, gallop: false, jump: false, drawing: false, moveScale: 1,
    phase: 0, feet: { x: 0, z: 0 }, roads: undefined, inBounds: () => true, refuses: () => false, wet: false };
  const motion = { velocityX: 0, velocityZ: 0, grounded: true, swimming: false, hover: false };
  const rideOf = (seat: Seat): SimRide => ({
    motionSample: (): SimPlayerMotionSample => { motion.velocityX = seat.rider.velocity.x; motion.velocityZ = seat.rider.velocity.z; motion.grounded = seat.rider.onGround; return motion; },
    mount: () => seat.horse?.entityId ?? '',
    capture: (out, at) => { seat.body.captureRide(out, at); return RIDE_WORDS; },
    read: (command, dt) => {
      const a = seat.horse; if (a === null) return;
      if (!a.alive) { dismountSeat(seat); return; }
      if (command !== undefined) seat.player.yaw = command.yaw;
      seat.player.impulse.set(0, 0, 0);
      commandReins(frame, command); frame.feet = seat.body.feet; frame.moveScale = seat.player.moveScale;
      seat.body.read(dt, frame);
    },
    step: dt => {
      const a = seat.horse; if (a === null) return;
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
  const routes = actRoutes(host);
  routes.ride = (player, action) => { if (action === 'mount') mount(player); else if (action === 'dismount') dismount(player); };
  routes.mountable = id => canTake(host.entities.get(id));
  host.onStep(STEP_ID, () => {
    for (const [id, seat] of seats) if (!host.players.has(id) || host.players.get(id) !== seat.player) { free(seat); seats.delete(id); }
  }, {
    snapshot: (): SimValue => ({ version: 1, seats: [...seats.values()].flatMap(seat => seat.horse === null ? [] : [{ player: seat.player.id, horse: seat.horse.entityId,
      body: seat.body.snapshotBody() as unknown as SimValue, motor: (seat.body.motor?.snapshot() ?? null) as unknown as SimValue,
      rider: { velocity: seat.rider.velocity.toArray(), onGround: seat.rider.onGround } }]) }),
    restore: value => {
      const saved = v.parse(Saved, value);
      for (const row of saved.seats) {
        const p = host.players.get(row.player), a = host.entities.get(row.horse), speeds = a === undefined ? undefined : gaits.get(a.species);
        if (p === undefined || a === undefined || speeds === undefined) throw new Error('Invalid declared ride continuation');
        const seat = seatFor(p), body = new MountedBody(speeds); body.restoreBody(row.body);
        Object.assign(seat, { body }); seat.horse = a; seat.savedMotor = row.motor as Seat['savedMotor'];
        seat.rider.velocity.fromArray(row.rider.velocity); seat.rider.onGround = row.rider.onGround;
        a.driven = true; holdOwnBody(a, true); p.motor.setEnabled(false); rides.delete(seat); p.modes.enter('ride', rideFor(seat));
      }
    },
    physicsRestored: () => {
      for (const seat of seats.values()) {
        const a = seat.horse, state = seat.savedMotor; if (a === null || state === null) continue;
        const c = host.physics.world.getCollider(state.colliderHandle);
        if (tagOf(c)?.owner !== a) throw new Error('Invalid declared ride capsule');
        seat.body.motor = withOwner(null, () => new CharacterMotor(host.physics, mountedMotorOptions(a.scale, a), state)); seat.savedMotor = null;
      }
    },
  }, 'afterBodies');
  host.scope.onDispose(() => { for (const seat of seats.values()) { seat.body.motor?.dispose(); seat.body.motor = null; } });
  return { ridden: player => seats.get(player)?.horse ?? null, speeds: species => gaits.get(species), mount, dismount };
}

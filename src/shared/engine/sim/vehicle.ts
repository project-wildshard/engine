import type { VehicleHandling } from '@wildshard/format/vehicles';
import { steerGround } from './moverMotion';

/**
 * MIRROR-SALT-ZONE MSZ7: how a vehicle drives, one fixed step at a time, the server's and its driver's page alike (MSZ16
 * replays it). Pure and deterministic: the same state, command, handling and floor give the same next state, bit for bit.
 *
 * It keeps a velocity, not just a speed: `forward` along the heading and `slip` across it. The stick's throttle drives
 * `forward` toward its top speed at `accel` (the hoverboard's momentum, `board.ts`), a back stick brakes at `brake` and,
 * once stopped, reverses toward `reverse`; let go, it coasts. Turning swings the heading, and the old velocity, now partly
 * sideways, is pulled back under the vehicle by the tyres' grip, at most `grip` g: a turn that asks for more slides, and
 * `drift` keeps a slide going (the board's carve drag, with a limit). Off the stick, its slope pulls it back down a climb.
 * The body stays a `KinematicMover`: this step only says where it goes; walls come from the floor probes of the steer
 * carry (`steerGround`, `steerReach`): a rise past a step at the bow (or the stern, reversing) stops it (MSZ13 bounces).
 * Heading follows the player's convention: forward is (-sin yaw, -cos yaw), a right turn lowers yaw.
 */

/** The driver's stick this step: throttle forward (back brakes, then reverses), turn right, boost, the handbrake and (MSZ12)
 *  the BRAKE, which brakes to a stop and holds there, never into reverse. */
export interface VehicleCommand {
  readonly throttle: number;
  readonly turn: number;
  readonly boost: boolean;
  readonly handbrake?: boolean;
  readonly brake?: boolean;
}
/** Where a vehicle is and how it moves. `forward` and `slip` are m/s along and across (right) its heading. */
export interface VehicleState {
  readonly x: number; readonly y: number; readonly z: number;
  readonly yaw: number;
  readonly forward: number;
  readonly slip: number;
  /** Nose up and left side up (rad), from the ground under its wheels; zero for a vehicle that keeps its height. */
  readonly pitch: number;
  readonly roll: number;
}
/** What the world lends a step: the floor probe (down from `fromY`, through its own hull) and the hull's reach. */
export interface VehicleWorld {
  readonly floor: (x: number, z: number, fromY: number) => number | undefined;
  /** How far its bow and stern stand from its centre, and its half width (m): where its wheels read the ground. */
  readonly bow: number; readonly stern: number; readonly side: number;
}
/** What a step found besides the next state. */
export interface VehicleStepOut {
  /** A wall stopped it this step. */
  blocked: boolean;
  /** The slide across its heading (m/s) after the tyres pulled: a skid sounds from it (MSZ15). */
  sliding: number;
}

/** m/s². */
export const VEHICLE_GRAVITY = 9.81;
/** m/s² a released vehicle slows by (rolling drag); the handbrake adds its `brake`. */
export const VEHICLE_COAST = 1.5;
/** m/s below which the stick turns it in proportion: a parked car does not spin on the spot. */
export const VEHICLE_TURN_SPEED = 3;
/** The share of its grip a tyre keeps once sliding, at `drift` 1 (at 0 it keeps all of it, and the slide ends at once). */
const SLIDE_GRIP = 0.25;
/** A sideways speed (m/s) past which the vehicle slides rather than rolls. */
const SLIDE_START = 0.5;
/** The handbrake keeps this share of the grip: it swings the tail out. */
const HANDBRAKE_GRIP = 0.3;
/** How much harder than its grip holds a turn may swing it: the slip it leaves is a slide. */
const OVERSTEER = 1.5;
/** m between wall probes along a step: under `steerGround`'s bow window, so no step passes into a wall. */
const WALL_PROBE = 0.25;
const COORD = 250;

const signed = (x: number): number => Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
const toward = (from: number, to: number, by: number): number => from < to ? Math.min(to, from + by) : Math.max(to, from - by);
const tau = 2 * Math.PI;
const wrap = (angle: number): number => Math.max(-Math.PI, Math.min(Math.PI, angle - Math.floor(angle / tau + 0.5) * tau));
const clampCoord = (value: number): number => Math.max(-COORD, Math.min(COORD, value));

/** A vehicle at rest at `at`, heading `yaw`. */
export function vehicleAt(at: { readonly x: number; readonly y: number; readonly z: number }, yaw: number): VehicleState {
  return { x: at.x, y: at.y, z: at.z, yaw, forward: 0, slip: 0, pitch: 0, roll: 0 };
}

/** The forward speed the stick asks for this step, and how fast it gets there (m/s, m/s²). */
function forwardTarget(state: VehicleState, command: VehicleCommand, handling: VehicleHandling): { readonly target: number; readonly rate: number } {
  const throttle = signed(command.throttle), top = handling.speed * (command.boost ? handling.boost : 1);
  if (command.handbrake === true) return { target: 0, rate: handling.brake + VEHICLE_COAST };
  if (command.brake === true) return { target: 0, rate: handling.brake };
  if (throttle > 0) {
    if (state.forward < 0) return { target: 0, rate: handling.brake * throttle }; // rolling back: forward stick brakes first
    // SS-MS2a2's sail: a full sail adds its push downwind, holds it back upwind, never past a stand
    const wind = handling.wind, forwardX = -Math.sin(state.yaw), forwardZ = -Math.cos(state.yaw);
    const along = wind === undefined ? 0 : throttle * wind.push * (wind.toward[0] * forwardX + wind.toward[1] * forwardZ) / Math.hypot(wind.toward[0], wind.toward[1]);
    return { target: Math.max(0, throttle * top + along), rate: handling.accel };
  }
  if (throttle < 0) {
    if (state.forward > 0) return { target: 0, rate: handling.brake * -throttle }; // a back stick brakes to a stop …
    return { target: throttle * handling.reverse, rate: handling.accel }; // … then reverses
  }
  return { target: 0, rate: VEHICLE_COAST };
}

/** One step of `dt` seconds. */
export function stepVehicle(state: VehicleState, command: VehicleCommand, handling: VehicleHandling, world: VehicleWorld, dt: number, out?: VehicleStepOut): VehicleState {
  if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Invalid vehicle step');
  // the slope under it pulls along its heading (nose up holds it back)
  const pull = -VEHICLE_GRAVITY * Math.sin(state.pitch);
  const { target, rate } = forwardTarget(state, command, handling);
  let forward = state.forward + pull * dt;
  forward = toward(forward, target, rate * dt);
  // the heading turns with the stick, in proportion below VEHICLE_TURN_SPEED and the other way reversing
  // and at speed no faster than its front tyres can swing it: past its grip it slides (`OVERSTEER` lets the tail out)
  const steer = Math.min(1, Math.abs(forward) / VEHICLE_TURN_SPEED) * Math.sign(forward);
  const most = Math.abs(forward) > 0 ? OVERSTEER * handling.grip * VEHICLE_GRAVITY / Math.abs(forward) : Infinity;
  const yawRate = Math.max(-most, Math.min(most, signed(command.turn) * handling.turn * steer));
  const yaw = wrap(state.yaw - yawRate * dt), turned = yaw - state.yaw;
  // the old velocity, seen from the new heading: what the turn left sideways is slip
  const cos = Math.cos(turned), sin = Math.sin(turned);
  const along = forward * cos - state.slip * sin;
  let slip = forward * sin + state.slip * cos;
  // the tyres pull the slip back under the vehicle, at most their grip; a slide keeps less of it, the more it drifts
  const grip = handling.grip * VEHICLE_GRAVITY * (command.handbrake === true ? HANDBRAKE_GRIP : 1);
  const held = Math.abs(slip) > SLIDE_START ? grip * (1 - (1 - SLIDE_GRIP) * handling.drift) : grip;
  slip = toward(slip, 0, held * dt);
  forward = along;
  // move, probing ahead of its bow (its stern, reversing) every WALL_PROBE m: a wall stops it at the last clear point
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw), rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  const dx = (forwardX * forward + rightX * slip) * dt, dz = (forwardZ * forward + rightZ * slip) * dt;
  const backing = forward < 0, facing = backing ? yaw + Math.PI : yaw, reach = backing ? world.stern : world.bow;
  const probes = Math.max(1, Math.ceil(Math.hypot(dx, dz) / WALL_PROBE));
  let moved = 0, blocked = false;
  for (let i = 0; i < probes; i++) {
    const at = { x: state.x + dx * i / probes, y: state.y, z: state.z + dz * i / probes };
    if (steerGround(world.floor, at, facing, reach).blocked) { blocked = true; break; }
    moved = (i + 1) / probes;
  }
  if (blocked) { forward = 0; slip = 0; }
  const x = clampCoord(state.x + dx * moved), z = clampCoord(state.z + dz * moved);
  let y = state.y, pitch = 0, tilt = 0;
  if (handling.ground) {
    const at = { x, y: state.y, z }, under = steerGround(world.floor, at, yaw, world.bow).ground;
    if (under !== undefined) y = clampCoord(under);
    const top = y + 2, height = (ox: number, oz: number): number => world.floor(x + ox, z + oz, top) ?? y;
    const front = height(forwardX * world.bow, forwardZ * world.bow), back = height(-forwardX * world.stern, -forwardZ * world.stern);
    const left = height(-rightX * world.side, -rightZ * world.side), right = height(rightX * world.side, rightZ * world.side);
    pitch = Math.atan2(front - back, world.bow + world.stern);
    tilt = Math.atan2(left - right, 2 * world.side);
  }
  if (out !== undefined) { out.blocked = blocked; out.sliding = slip; }
  return { x, y, z, yaw, forward, slip, pitch, roll: tilt };
}

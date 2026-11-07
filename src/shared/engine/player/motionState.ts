/**
 * The player's motion state as plain data (P1-E5.3-C1): what a step reads and writes, so a predictor can hold it per
 * command and put it back to replay (E5-REPLICATION §5.2). `createMotionState` makes one; the client's Player reads and
 * writes its public fields through it, and the server's PlayerSim is its own.
 *
 * A capture is flat numbers in a caller's `Float64Array`, one `MOTION_WORDS` long, so a ring of them allocates once. It
 * holds the state and the capsule's `MotorState` (the step reads the last move's ground for the slide, and the pinned
 * deck for the carry). No valibot: nothing here crosses a trust boundary, and it runs per command.
 *
 * Null is NaN, a boolean is 0 or 1, and a body or collider is its Rapier handle, or -1. A field added to the state without
 * a word here fails `test/motion-state.test.ts`.
 */
import { Vector3 } from 'three';
import { MOTOR_WORDS, type CharacterMotor } from '../physics/CharacterMotor';
import type { BoardState } from './board';
import type { PlayerMotionState } from './motion';

const STATE_WORDS = 36;
/** The words a predictor compares (`matches`). */
export const CAPTURED: {
  readonly x: 0; readonly y: 1; readonly z: 2; readonly yaw: 9; readonly grounded: 11; readonly board: 22; readonly swim: 25; readonly carried: number;
} = { x: 0, y: 1, z: 2, yaw: 9, grounded: 11, board: 22, swim: 25, carried: STATE_WORDS + 10 };
/** The length of one capture. */
export const MOTION_WORDS: number = STATE_WORDS + MOTOR_WORDS;

/**
 * The fall's ground as the board's, which is the one alias left: `stepBoard` takes the board as its state and riding near
 * the ride height is that ground. It goes when the board law takes `fall`.
 */
function ridingOn(fall: { grounded: boolean }): BoardState & { on: boolean } {
  return { on: false, hoverAir: false, hoverBob: 0, get onGround() { return fall.grounded; }, set onGround(on) { fall.grounded = on; } };
}

/** A motion state at rest at the origin, as a Player starts: on the ground, with its jump clocks running. */
export function createMotionState(): PlayerMotionState {
  const fall = { grounded: true };
  return { position: new Vector3(), yaw: 0, tick: 0, moveScale: 1, impulse: new Vector3(), velocity: new Vector3(), fall,
    shove: { t: 0, vx: 0, vz: 0 }, dash: { t: 0, vx: 0, vz: 0 }, dodge: { cd: 0, t: 0 }, lock: { r0: 0 }, jump: { ago: Infinity, left: 0 },
    board: ridingOn(fall), swim: { on: false, stood: false, diving: false, climbTo: null, climbCooldown: 0, strokeTime: 0 },
    footing: { water: null, depth: 0, wading: false, onPlatform: false, sliding: false } };
}

const word = (value: number | null): number => value ?? Number.NaN;
const nullable = (value: number): number | null => Number.isNaN(value) ? null : value;
const read = (from: Float64Array, at: number): number => from[at] ?? 0;

/** Write `s` and its capsule into `out` at `at`. */
export function captureMotion(s: PlayerMotionState, motor: CharacterMotor, out: Float64Array, at = 0): void {
  const { position: p, velocity: v, impulse, fall, shove, dash, dodge, jump, board, swim, footing } = s;
  out[at] = p.x; out[at + 1] = p.y; out[at + 2] = p.z;
  out[at + 3] = v.x; out[at + 4] = v.y; out[at + 5] = v.z;
  out[at + 6] = impulse.x; out[at + 7] = impulse.y; out[at + 8] = impulse.z;
  out[at + 9] = s.yaw; out[at + 10] = s.moveScale; out[at + 11] = Number(fall.grounded);
  out[at + 12] = shove.t; out[at + 13] = shove.vx; out[at + 14] = shove.vz;
  out[at + 15] = dash.t; out[at + 16] = dash.vx; out[at + 17] = dash.vz;
  out[at + 18] = dodge.cd; out[at + 19] = dodge.t;
  out[at + 20] = jump.ago; out[at + 21] = jump.left;
  out[at + 22] = Number(board.on); out[at + 23] = Number(board.hoverAir); out[at + 24] = board.hoverBob;
  out[at + 25] = Number(swim.on); out[at + 26] = Number(swim.stood); out[at + 27] = Number(swim.diving); out[at + 28] = word(swim.climbTo);
  out[at + 29] = swim.climbCooldown; out[at + 30] = swim.strokeTime;
  out[at + 31] = word(footing.water); out[at + 32] = footing.depth;
  out[at + 33] = Number(footing.wading) + 2 * Number(footing.onPlatform) + 4 * Number(footing.sliding);
  out[at + 34] = s.lock.r0; out[at + 35] = s.tick;
  motor.captureState(out, at + STATE_WORDS);
}

/** Put `s` and its capsule back from a capture at `at`. A body the capture stood on and the world has since dropped is let go. */
export function restoreMotion(s: PlayerMotionState, motor: CharacterMotor, from: Float64Array, at = 0): void {
  const { position, velocity, impulse, fall, shove, dash, dodge, board, swim, footing } = s;
  position.set(read(from, at), read(from, at + 1), read(from, at + 2)); velocity.set(read(from, at + 3), read(from, at + 4), read(from, at + 5)); impulse.set(read(from, at + 6), read(from, at + 7), read(from, at + 8));
  s.yaw = read(from, at + 9); s.moveScale = read(from, at + 10); fall.grounded = read(from, at + 11) !== 0;
  shove.t = read(from, at + 12); shove.vx = read(from, at + 13); shove.vz = read(from, at + 14);
  dash.t = read(from, at + 15); dash.vx = read(from, at + 16); dash.vz = read(from, at + 17);
  dodge.cd = read(from, at + 18); dodge.t = read(from, at + 19);
  s.jump.ago = read(from, at + 20); s.jump.left = read(from, at + 21);
  board.on = read(from, at + 22) !== 0; board.hoverAir = read(from, at + 23) !== 0; board.hoverBob = read(from, at + 24);
  swim.on = read(from, at + 25) !== 0; swim.stood = read(from, at + 26) !== 0; swim.diving = read(from, at + 27) !== 0; swim.climbTo = nullable(read(from, at + 28));
  swim.climbCooldown = read(from, at + 29); swim.strokeTime = read(from, at + 30);
  footing.water = nullable(read(from, at + 31)); footing.depth = read(from, at + 32);
  const flags = read(from, at + 33);
  footing.wading = (flags & 1) !== 0; footing.onPlatform = (flags & 2) !== 0; footing.sliding = (flags & 4) !== 0;
  s.lock.r0 = read(from, at + 34); s.tick = read(from, at + 35);
  motor.restoreState(from, at + STATE_WORDS);
}

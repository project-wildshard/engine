import type { Vector3 } from 'three';
import { boardShoved, type BoardState } from './board';

/** How fast a transient player impulse fades (1/s): each fixed step scales it by e^(-rate · dt). */
export const IMPULSE_DECAY_RATE = 3.5;
/** Below this squared speed (m²/s²) a fading impulse stops outright, so it never creeps forever. */
export const IMPULSE_REST_SQ = 0.05;

/**
 * The player's transient-impulse law, shared by the client's Player and the headless SimHost so the two never drift:
 * a shove (a wisp's burst, a gale wall, an updraft) adds world velocity in m/s, every displacement goes through the motor
 * with that velocity added to the step's own, and after each step the impulse decays.
 */
export function addImpulse(impulse: Vector3, velocity: Readonly<Vector3>): void {
  if (![velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new Error('Player impulse must be finite');
  impulse.add(velocity);
}
/** One shove of a player's body: refused while something else owns the motion (`refused`: a ride, a carry, a lock) or in the
 *  water. An upward one leaves the ground: the board lifts off, the feet let go. */
export function applyImpulse(s: { readonly impulse: Vector3; readonly fall: { grounded: boolean }; readonly board: BoardState & { readonly on: boolean }; readonly swim: { readonly on: boolean } }, velocity: Readonly<Vector3>, refused: boolean): void {
  if (![velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new Error('Player impulse must be finite');
  if (refused || s.swim.on) return;
  addImpulse(s.impulse, velocity);
  if (velocity.y > 0) { if (s.board.on) boardShoved(s.board, velocity.y); else s.fall.grounded = false; }
}
/** One step's fade: scale by e^(-IMPULSE_DECAY_RATE · dt), then zero it once its squared speed is under IMPULSE_REST_SQ. */
export function decayImpulse(impulse: Vector3, dt: number): void {
  impulse.multiplyScalar(Math.exp(-IMPULSE_DECAY_RATE * dt));
  if (impulse.lengthSq() < IMPULSE_REST_SQ) impulse.set(0, 0, 0);
}

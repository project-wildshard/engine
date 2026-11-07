import { Vector3 } from 'three';
import type { Actor, DamageRequest } from '../combat/pipeline';

/** On-foot gravity (m/s²). There is no terminal velocity: a fall speeds up until the feet find ground. */
export const PLAYER_GRAVITY = 22;
/** A landing faster than this (m/s downward) on dry ground is hard: the fall-damage path. */
export const HARD_LANDING_SPEED = 9;
/** Health a hard landing costs (PlayerHurt.fall). */
export const HARD_FALL_DAMAGE = 8;

/**
 * The on-foot player's fall law, shared by the client's Player and the headless SimHost so the two never drift.
 * Each fixed step gravity is added to the vertical speed first; the whole move (speed + any impulse) goes through the
 * motor; when the motor reports ground the downward speed stops, and the step that touches down from the air lands.
 */
export function fallStep(vy: number, dt: number): number { return vy - PLAYER_GRAVITY * dt; }
/** Grounded after a move: a downward speed stops, an upward one (a jump's or a shove hop's first step) is kept. */
export function groundedVelocity(vy: number): number {
  if (vy < 0) return 0; // exactly the client's `if (v.y < 0) v.y = 0` (a -0 is kept, as before)
  return vy;
}
/** How much water under the feet softens a landing (0 dry … 1 at half a metre deep). */
export function landingCushion(wet: boolean, groundDepth: number): number { return wet ? Math.min(1, groundDepth / 0.5) : 0; }
/** A touchdown at `vy` m/s (negative = down) is hard when it is fast and the water doesn't take it. */
export function hardLanding(vy: number, cushion: number): boolean { return vy < -HARD_LANDING_SPEED && cushion < 0.6; }
/** The environmental hit a hard landing deals (the client's PlayerHurt.fall and the headless host file the same one). */
export function hardFallHit(target: Actor, at: Readonly<Vector3>): DamageRequest {
  return { source: 'env', sourceTags: ['env.fall'], target, amount: HARD_FALL_DAMAGE, point: at.clone(), dir: new Vector3() };
}

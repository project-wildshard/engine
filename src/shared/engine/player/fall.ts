import { Vector3 } from 'three';
import type { Actor, DamageRequest } from '../combat/pipeline';
import { DOUBLE_JUMP, DOUBLE_JUMP_KEEP, JUMP_SPEED } from './jump';

/** On-foot gravity (m/s²). There is no terminal velocity: a fall speeds up until the feet find ground. */
export const PLAYER_GRAVITY = 22;
/**
 * The highest the feet rise above the take-off with a single and a double jump on dry ground (m), the double jump pressed
 * at its best moment: about 3.0 m with today's numbers.
 */
export const MAX_JUMP_APEX: number = maxJumpApex(JUMP_SPEED, DOUBLE_JUMP, DOUBLE_JUMP_KEEP, PLAYER_GRAVITY);
/** The drop a player walks away from: the highest jump, landing on ground as far below the take-off as a jump rises. */
export const SAFE_FALL: number = 2 * MAX_JUMP_APEX;
/** The extra downward speed one 30 fps step of gravity can add before the touchdown is seen (phones step slower). */
const STEP_SLACK: number = PLAYER_GRAVITY / 30;
/**
 * A landing faster than this (m/s downward) on dry ground is hard: the fall-damage path. QA 2026-11-23-b row 12 (Jake,
 * v0.1.74): it was 9 m/s, under a flat double jump's ~11.5 m/s, so a jump hurt. Now only a fall past SAFE_FALL does.
 */
export const HARD_LANDING_SPEED: number = Math.sqrt(2 * PLAYER_GRAVITY * SAFE_FALL) + STEP_SLACK;
/** Health a hard landing costs (PlayerHurt.fall). */
export const HARD_FALL_DAMAGE = 8;

/**
 * The on-foot player's fall law, shared by the client's Player and the headless SimHost so the two never drift.
 * Each fixed step gravity is added to the vertical speed first; the whole move (speed + any impulse) goes through the
 * motor; when the motor reports ground the downward speed stops, and the step that touches down from the air lands.
 */
export function fallStep(vy: number, dt: number): number { return vy - PLAYER_GRAVITY * dt; }
/** The apex of a jump at `launch` plus a double jump (`keep` of the rising speed, + `double`), at its best moment. */
export function maxJumpApex(launch: number, double: number, keep: number, gravity: number): number {
  // height at press (launch² - v²)/2g, then (keep v + double)²/2g more; d/dv = 0 at v = keep·double / (1 - keep²)
  const v = Math.min(launch, Math.max(0, (keep * double) / (1 - keep * keep)));
  return (launch * launch - v * v + (keep * v + double) ** 2) / (2 * gravity);
}
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

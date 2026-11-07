/** Seconds a creature hit's knockback lasts; its speed fades linearly to 0 over it. */
export const SHOVE_TIME = 0.18;
/** Upward speed (m/s) a knockback gives a grounded player, so it reads as a knock, not a slide. */
export const SHOVE_HOP = 1.6;

/** A running knockback: seconds left and the starting world velocity (m/s, xz). */
export interface ShoveState { t: number; vx: number; vz: number }

/**
 * The player's creature-hit knockback, shared by the client's Player (PlayerHurt files it on a `feel.blow` hit) and
 * the headless SimHost so the two never drift: a blow dealing `dealt` knocks the player 5 + min(4, 0.15 · dealt) m/s
 * straight away from where it landed, overriding the walk input and fading out over SHOVE_TIME through the motor.
 */
export function hitShoveSpeed(dealt: number): number { return 5 + Math.min(4, dealt * 0.15); }
/** Start a knockback away from (fromX, fromZ); a blow from right on top of the player knocks it straight back along `yaw`. */
export function startShove(shove: ShoveState, x: number, z: number, fromX: number, fromZ: number, yaw: number, speed: number): void {
  const dx = x - fromX, dz = z - fromZ, d = Math.hypot(dx, dz);
  const ux = d > 1e-3 ? dx / d : Math.sin(yaw), uz = d > 1e-3 ? dz / d : Math.cos(yaw); // on top of us: straight back
  shove.vx = ux * speed; shove.vz = uz * speed; shove.t = SHOVE_TIME;
}
/** A grounded player's vertical speed once knocked (it leaves the ground). */
export function shoveHop(vy: number): number { return Math.max(vy, SHOVE_HOP); }
/** Advance a running knockback one step; returns the fraction of its starting velocity this step moves at. */
export function stepShove(shove: ShoveState, dt: number): number {
  shove.t = Math.max(0, shove.t - dt);
  return shove.t / SHOVE_TIME;
}

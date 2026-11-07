import type { LocalSteer } from '../input/commands';

/** Shipping on-foot speed selection, shared by the page and an opted-in simulation driver.
 * Wade fraction is the page's already-resolved [0,1] depth; the caller owns sprint/crouch eligibility. */
export function walkingSpeed(crouching: boolean, sprinting: boolean, wadeFraction: number, moveScale: number, effectMoveScale: number): number {
  return (crouching ? 2.2 : sprinting ? 7.2 : 4.3) * (1 - 0.55 * wadeFraction) * moveScale * effectMoveScale;
}
/** The wade's share of the on-foot speed (walkingSpeed's depth term): a host with its own base speed scales it by this. */
export function wadeScale(wadeFraction: number): number { return 1 - 0.55 * wadeFraction; }

/** The page's horizontal velocity approach, including its original operation order. */
export function walkVelocity(current: number, target: number, acceleration: number, dt: number): number {
  return current + (target - current) * Math.min(1, acceleration * dt);
}

/** Resolve clamped keyboard-plus-stick input to world axes. Stick strength
 * already passed the device deadzone; partial input stays partial. */
export function localWalkingMove(steer: LocalSteer, yaw: number, out: { x: number; z: number }): void {
  const str = Math.max(-1, Math.min(1, steer.keyX + steer.stickX));
  const fwd = Math.max(-1, Math.min(1, steer.keyY + steer.stickY));
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  out.x = -sin * fwd + cos * str; out.z = -cos * fwd - sin * str;
  const length = Math.hypot(out.x, out.z);
  if (length > 1) { out.x /= length; out.z /= length; }
}

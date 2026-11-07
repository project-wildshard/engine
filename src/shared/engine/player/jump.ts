/** m/s an on-foot jump launches at on dry ground (jumpSpeed scales it down in water). */
export const JUMP_SPEED = 7.2;
/** m/s the second jump on foot adds (E120: 6.8 → 8.6, ~1.7 m on top of the first: wading beside the pier you clear its deck by ~0.2 m). */
export const DOUBLE_JUMP = 8.6;
/** The ground grace window (ms) a level gets unless it authors its own (Player.coyoteMs). */
export const COYOTE_MS = 100;

/** The on-foot jump's clocks: ms since the feet last stood on ground, and the air jumps left (the double jump). */
export interface JumpState { ago: number; left: number }

/**
 * The on-foot jump law, shared by the client's Player and the headless SimHost so the two never drift (SF72). Every walk
 * step runs `jumpClock` on the previous step's ground first; a jump press then asks `jump`, before the step's gravity.
 */
export function jumpClock(state: JumpState, grounded: boolean, dt: number): void {
  state.ago = grounded ? 0 : state.ago + dt * 1000;
  if (grounded) state.left = 1; // one more jump available once you've left the ground
}
/** The launch speed: wading (`wadeT` 0 dry … 1 at WADE_MAX deep), the water saps the push-off. */
export function jumpSpeed(wadeT: number): number { return JUMP_SPEED * (1 - 0.35 * wadeT); }
/**
 * A jump press: on the ground or within `coyoteMs` of leaving it (and not `blocked`: crouching, sliding) it launches at
 * `launch` m/s; else in the air with a jump left it is the double jump (30 % of a rising speed kept, + DOUBLE_JUMP).
 * Returns the new vertical speed, or null when the press does nothing. Either jump leaves the ground.
 */
export function jump(state: JumpState, grounded: boolean, vy: number, coyoteMs: number, blocked: boolean, launch: number): number | null {
  if ((grounded || state.ago <= coyoteMs) && !blocked) { state.ago = Infinity; return launch; }
  if (!grounded && state.left > 0) { state.left--; return Math.max(vy, 0) * 0.3 + DOUBLE_JUMP; }
  return null;
}

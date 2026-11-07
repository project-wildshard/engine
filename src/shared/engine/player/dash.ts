/** m a dodge covers … */
export const DODGE_DIST = 3;
/** … over this long (12 m/s), toward the move input; no input = a backstep. */
export const DODGE_TIME = 0.25;
/** s from one dodge's start to the next (E59: 0.6 → 0.8, shown as a sweep on the DODGE disc). */
export const DODGE_COOLDOWN = 0.8;
/** m ahead of the feet: deep water there (no deck under it) ends a dash — it never carries you off a pier. */
export const DASH_PROBE = 0.5;

/** A running dash (a dodge or a sword's lunge): seconds left and its world velocity (m/s, xz). */
export interface DashState { t: number; vx: number; vz: number }
/** The dodge's clocks: the cooldown still to run and the burst's seconds left (the boar tusk's i-frames). */
export interface DodgeState { cd: number; t: number }
interface Vec2 { x: number; z: number }

/**
 * The on-foot dash law (DODGE and the sword's lunge), shared by the client's Player and the headless SimHost so the two
 * never drift (SF72): a dash moves at a fixed velocity for its time, whatever the input says (gravity, collisions and
 * the pier-edge probe still apply); its last step brakes to a quarter, a wall ends it, a knockback overrides it.
 */
export function startDash(dash: DashState, vx: number, vz: number, time: number): boolean {
  if (time <= 0) return false;
  dash.vx = vx; dash.vz = vz; dash.t = time;
  return true;
}
/** The lunge: dash toward (x, z) from (px, pz), stopping `stopAt` m short, over `time` s; false when already that close. */
export function dashToward(dash: DashState, px: number, pz: number, x: number, z: number, stopAt: number, time: number): boolean {
  const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz), go = d - stopAt;
  if (go < 0.15) return false;
  return startDash(dash, dx / d * go / time, dz / d * go / time, time);
}
/** The dodge's heading from the step's world move (mx, mz): normalized, or straight back along `yaw` under 0.2 of a stick.
 *  Writes it to `out` and returns the move's length (under 0.2: a backstep). */
export function dodgeHeading(mx: number, mz: number, yaw: number, out: Vec2): number {
  const len = Math.hypot(mx, mz);
  if (len < 0.2) { out.x = Math.sin(yaw); out.z = Math.cos(yaw); } else { out.x = mx / len; out.z = mz / len; } // no input: straight back
  return len;
}
/** A dodge started: its cooldown (× `scale`, a perk) and its burst begin. */
export function startDodge(dodge: DodgeState, scale: number): void { dodge.cd = DODGE_COOLDOWN * scale; dodge.t = DODGE_TIME; }
/** Each step after the dodge press: the cooldown runs down; the burst's guard runs while a dash carries (a shove ends both). */
export function stepDodge(dodge: DodgeState, dashing: boolean, dt: number): void {
  dodge.cd = Math.max(0, dodge.cd - dt);
  dodge.t = dashing ? Math.max(0, dodge.t - dt) : 0;
}
/**
 * One dash step: the step's horizontal velocity into `v`. Deep water just ahead (`deep`, off a pier edge with no deck)
 * ends it on the spot; its last step brakes to a quarter, so a lunge stops where it aimed.
 */
export function stepDash(dash: DashState, dt: number, px: number, pz: number, deep: (x: number, z: number) => boolean, v: Vec2): void {
  dash.t -= dt;
  const dl = Math.hypot(dash.vx, dash.vz) || 1;
  if (deep(px + dash.vx / dl * DASH_PROBE, pz + dash.vz / dl * DASH_PROBE)) { dash.t = 0; v.x = v.z = 0; }
  else if (dash.t > 0) { v.x = dash.vx; v.z = dash.vz; }
  else { v.x = dash.vx * 0.25; v.z = dash.vz * 0.25; }
}
/** A dash that runs into a wall (the motor's horizontal freedom under 0.3) ends there, not grinding along it. */
export function dashBlocked(dash: DashState, horizontalFreedom: number, v: Vec2): void {
  if (dash.t > 0 && horizontalFreedom < 0.3) { dash.t = 0; v.x *= 0.25; v.z *= 0.25; }
}

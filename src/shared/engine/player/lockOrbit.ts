/**
 * The lock-on's motion law (E50 §2.4, P1-E5.3-A7, A8, J116): how a lock bends the move and the dodge, on both sides. Who is
 * locked is the page's (LockOnTarget); a command says so with `lockTarget`, and the server takes its word only for a real
 * living body in reach. Nothing here reads a device, a camera or a body: a step gets its target as a `MotionLock`.
 */

/** A dodge's arc is this far along the circle round the target … */
const HOP_MIN_RADIUS = 1.5;
/** … and a close-in stops this far off its body, over this long. */
const CLOSE_IN_GAP = 1.1; const CLOSE_IN_TIME = 0.2;
/** MOVE never takes the feet closer than this off its body. */
const ORBIT_GAP = 0.9;
/** The server's reach: past any lock the page holds (18 m, or 1.5 × a shard's own range), so a client near its limit is
 *  never refused and a client lying about a body across the map is. */
export const LOCK_REACH = 60;

/** What a step knows of its lock: the target's feet, its body, and the stick in the player's own axes. */
export interface MotionLock {
  readonly x: number; readonly z: number;
  /** the target's horizontal half-size (combat/lungeTarget.ts) */
  readonly radius: number;
  readonly fwd: number; readonly str: number;
}
/** A lock's own state: the orbit radius MOVE holds. */
export interface LockState { r0: number }
interface Vec2 { x: number; z: number }

/**
 * MOVE round a locked target: stick x goes round it, y in and out; a pure sideways push holds the radius you had (a straight
 * strafe under a tracking view spirals out), and never closer than its body. Writes the step's world move to `out`, or
 * leaves it when the feet are all but on the target.
 */
export function orbitMove(lock: LockState, target: MotionLock, px: number, pz: number, out: Vec2): void {
  const dx = target.x - px, dz = target.z - pz, r = Math.hypot(dx, dz), { str } = target;
  if (r <= 0.2) return;
  const ux = dx / r, uz = dz / r, minR = target.radius + ORBIT_GAP;
  let f = target.fwd;
  if (f > 0 && r <= minR) f = 0;
  if (Math.abs(f) > 0.15) lock.r0 = r;
  else if (Math.abs(str) > 0.1) f = Math.max(-0.6, Math.min(0.6, (r - lock.r0) * 0.8));
  out.x = ux * f - uz * str; out.z = uz * f + ux * str;
}

/** How a dodge bends round its lock: `hop` runs `vx`, `vz` for `time`, `close` lunges to `stopAt` over `time`, `straight` neither. */
export type LockedDodgeKind = 'straight' | 'hop' | 'close';
export interface LockedDodge { vx: number; vz: number; time: number; stopAt: number }

/**
 * A dodge relative to the target: sideways is a side-hop of `dist` m of ARC round it (the radius kept), forward a short
 * close-in that stops at lunge distance, back the plain backstep, straight away. `heading` is the input's unit world move;
 * a hop leaves it along the hop, which is the way the dodge's view leans.
 */
export function lockedDodge(target: MotionLock, px: number, pz: number, dist: number, time: number, heading: Vec2, out: LockedDodge): LockedDodgeKind {
  const dx = target.x - px, dz = target.z - pz, r = Math.hypot(dx, dz);
  if (r <= 0.3) return 'straight';
  const ux = dx / r, uz = dz / r, radial = heading.x * ux + heading.z * uz, tang = -heading.x * uz + heading.z * ux; // input split: toward / round (right = (−uz, ux))
  if (Math.abs(tang) < Math.abs(radial)) {
    if (radial <= 0) return 'straight';
    out.stopAt = target.radius + CLOSE_IN_GAP; out.time = CLOSE_IN_TIME;
    return 'close';
  }
  const th = dist / Math.max(r, HOP_MIN_RADIUS), ox = -ux * r, oz = -uz * r;
  let kind: LockedDodgeKind = 'straight';
  for (const a of [th, -th]) { // the rotation that moves along the pushed side
    const c = Math.cos(a), sn = Math.sin(a), tx = target.x + ox * c - oz * sn, tz = target.z + ox * sn + oz * c;
    if (((tx - px) * -uz + (tz - pz) * ux) * tang <= 0) continue;
    const mx = tx - px, mz = tz - pz, l = Math.hypot(mx, mz) || 1;
    kind = 'hop'; out.vx = mx / time; out.vz = mz / time; out.time = time;
    heading.x = mx / l; heading.z = mz / l;
  }
  return kind;
}

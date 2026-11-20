import type { VehicleHandling } from '@wildshard/format/vehicles';
import { VEHICLE_GRAVITY, type VehicleCommand, type VehicleState } from './vehicle';

/**
 * MIRROR-SALT-ZONE MSZ33: a rival's AI driver. Pure and deterministic, like `stepVehicle`, whose stick it drives: given where
 * the rival is, how far along his racing line he has come and how far he leads the player, it says how to steer and how hard
 * to drive. He steers at a point ahead on the line (farther the faster he goes), takes each stretch at the speed its bend
 * allows (his tyres' grip, braking in time for the next bend), and keeps within a catch-up band of the player: past it ahead
 * he eases off, past it behind he pushes, so a race stays close but a player who drives the line well still wins.
 */

/** A racing line, measured: its points, the distance along it to each, its length and the speed each point allows (m, m/s). */
export interface RivalCourse {
  readonly points: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly at: readonly number[];
  readonly length: number;
  /** A lap race's line runs on from its last point back to its first. */
  readonly closed: boolean;
  readonly caps: readonly number[];
}
/** Of its brake, the share a rival plans a bend's braking on (he arrives a little early rather than late). */
const BRAKE_PLAN = 0.5;
/** A bend's speed: its tyres' grip over its curvature, this much under the limit. */
const BEND_MARGIN = 0.85;
/** m a rival looks ahead along his line to steer, at least, and per m/s of speed. */
const LOOK_MIN = 6, LOOK_PER_SPEED = 0.6;
/** How hard a heading error (rad) turns the stick. */
const STEER_GAIN = 2.5;
/** A heading error (rad) past which he slows to `TURN_SPEED` (m/s) to come round. */
const TURN_ERROR = 0.7, TURN_SPEED = 6;
/** Past his band ahead he eases toward this share of his speed; past it behind he pushes by this share. */
export const RIVAL_EASE = 0.6, RIVAL_PUSH = 1.15;
/** m/s over his target past which he brakes rather than lifts. */
const BRAKE_OVER = 1.5;
/** m either side of his last place along the line a projection searches (so a line that passes near itself is never cut). */
const SEARCH = 60;

const tau = 2 * Math.PI;
const ORIGIN = { x: 0, y: 0, z: 0 } as const;
/** Point `i` of a line (its origin past either end, which a caller never asks). */
const pointOf = (points: RivalCourse['points'], i: number): RivalCourse['points'][number] => points[i] ?? ORIGIN;
const wrap = (angle: number): number => angle - Math.floor(angle / tau + 0.5) * tau;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Measure a line of `[x, y, z]` points for a vehicle of `handling` at `top` m/s on a straight. */
export function rivalCourse(line: readonly (readonly [number, number, number])[], closed: boolean, handling: Pick<VehicleHandling, 'grip' | 'brake'>, top: number): RivalCourse {
  if (line.length < 2) throw new Error('A rival line needs two points');
  const points = line.map(([x, y, z]) => ({ x, y, z })), n = points.length, at = [0];
  for (let i = 1; i < n; i++) at.push((at[i - 1] ?? 0) + Math.hypot(pointOf(points, i).x - pointOf(points, i - 1).x, pointOf(points, i).z - pointOf(points, i - 1).z));
  const length = (at[n - 1] ?? 0) + (closed ? Math.hypot(pointOf(points, 0).x - pointOf(points, n - 1).x, pointOf(points, 0).z - pointOf(points, n - 1).z) : 0);
  const point = (i: number): { x: number; z: number } => pointOf(points, ((i % n) + n) % n);
  // each point's bend: the turn between its two legs over their mean length; an open line's ends are straight
  const caps = points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return top;
    const a = point(i - 1), b = point(i + 1), inLeg = Math.hypot(p.x - a.x, p.z - a.z), outLeg = Math.hypot(b.x - p.x, b.z - p.z);
    const turn = Math.abs(wrap(Math.atan2(b.x - p.x, b.z - p.z) - Math.atan2(p.x - a.x, p.z - a.z))), curve = turn / Math.max(0.5, (inLeg + outLeg) / 2);
    return curve < 1e-6 ? top : Math.min(top, BEND_MARGIN * Math.sqrt(handling.grip * VEHICLE_GRAVITY / curve));
  });
  // brake in time: a point allows no more than reaches the next point's speed at the planned braking (twice round a lap)
  const brake = handling.brake * BRAKE_PLAN, rounds = closed ? 2 : 1;
  for (let round = 0; round < rounds; round++) for (let i = n - (closed ? 1 : 2); i >= 0; i--) {
    const j = (i + 1) % n, leg = j === 0 ? length - (at[i] ?? 0) : (at[j] ?? 0) - (at[i] ?? 0);
    caps[i] = Math.min(caps[i] ?? top, Math.sqrt((caps[j] ?? top) ** 2 + 2 * brake * leg));
  }
  return { points, at, length, closed, caps };
}

/** The segment from point `i` to the next, and where `d` (m along a lap) falls on it. */
function segmentAt(course: RivalCourse, d: number): { readonly i: number; readonly t: number } {
  const { at, points, length, closed } = course, n = points.length;
  const lap = closed ? ((d % length) + length) % length : clamp(d, 0, length);
  let i = 0; while (i < n - 1 && (at[i + 1] ?? Infinity) <= lap) i++;
  const end = i === n - 1 ? length : at[i + 1] ?? length, start = at[i] ?? 0;
  return { i, t: end - start < 1e-9 ? 0 : (lap - start) / (end - start) };
}
/** The point `d` m along the line (a lap race's, round its laps). */
export function rivalPoint(course: RivalCourse, d: number): { readonly x: number; readonly z: number } {
  const { i, t } = segmentAt(course, d), n = course.points.length, a = pointOf(course.points, i), b = pointOf(course.points, (i + 1) % n);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
/** The speed the line allows `d` m along it: the lower of the two points about it. */
export function rivalCap(course: RivalCourse, d: number): number {
  const { i } = segmentAt(course, d), n = course.points.length;
  return Math.min(course.caps[i] ?? 0, course.caps[(i + 1) % n] ?? 0);
}

/**
 * How far along the line (m, counted on round a lap race's laps) a body at (`x`, `z`) has come, from `travelled` last time: its
 * nearest point on the line within `SEARCH` m of where it was, so a lap counts only once it is driven.
 */
export function rivalAdvance(course: RivalCourse, travelled: number, x: number, z: number): number {
  const { points, at, length, closed } = course, n = points.length, legs = closed ? n : n - 1;
  let best = travelled, bestGap = Infinity;
  for (let i = 0; i < legs; i++) {
    const a = pointOf(points, i), b = pointOf(points, (i + 1) % n), start = at[i] ?? 0;
    const dx = b.x - a.x, dz = b.z - a.z, leg = Math.hypot(dx, dz), t = leg < 1e-9 ? 0 : clamp(((x - a.x) * dx + (z - a.z) * dz) / (leg * leg), 0, 1);
    // a lap race's same place on whichever lap is nearest where it was
    const along = closed ? start + leg * t + length * Math.round((travelled - start - leg * t) / length) : start + leg * t;
    if (Math.abs(along - travelled) > SEARCH) continue;
    const gap = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (gap < bestGap) { bestGap = gap; best = along; }
  }
  return Math.max(0, best);
}

/** What a rival's stick does this step: `state` where he is, `travelled` m along his line, `lead` m he is ahead of the player
 *  (negative behind), `band` his catch-up band, `top` his speed on a straight. */
export function rivalCommand(state: VehicleState, course: RivalCourse, travelled: number, lead: number, band: number, handling: Pick<VehicleHandling, 'speed' | 'boost'>, top: number): VehicleCommand {
  const speed = Math.max(0, state.forward), aim = rivalPoint(course, travelled + Math.max(LOOK_MIN, speed * LOOK_PER_SPEED));
  const want = Math.atan2(-(aim.x - state.x), -(aim.z - state.z)), error = wrap(want - state.yaw);
  // a right turn lowers yaw: a target to the right (a negative error) is a positive turn
  const turn = clamp(-error * STEER_GAIN, -1, 1);
  let target = Math.min(top, rivalCap(course, travelled), rivalCap(course, travelled + speed));
  if (lead > band) target *= Math.max(RIVAL_EASE, 1 - ((lead - band) / band) * (1 - RIVAL_EASE));
  else if (lead < -band) target *= RIVAL_PUSH;
  if (Math.abs(error) > TURN_ERROR) target = Math.min(target, TURN_SPEED);
  const boost = target > handling.speed && handling.boost > 1, most = handling.speed * (boost ? handling.boost : 1);
  const throttle = state.forward > target + BRAKE_OVER ? -clamp((state.forward - target) / (4 * BRAKE_OVER), 0, 1) : clamp(target / most, 0, 1);
  return { throttle, turn, boost };
}

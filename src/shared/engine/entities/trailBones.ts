/** Trail bones (ONE-FORMAT CC22): named bones follow the root's recent path at a fixed spacing.
 *
 * Page and server keep the same ring: each pushes the root only on sim ticks that are a multiple of
 * `TRAIL_SAMPLE_TICKS` (10 Hz), a cadence every wire band carries, so a page fed those samples holds the server's ring
 * point for point. Bone 0 is the live root; bone i sits i × spacing back along the path root → newest point → … →
 * oldest, so a leap's body rises and falls through the arc the head drew. Only + - * / and sqrt run per pose, so two
 * runs over the same samples are bit-identical. No scene objects, no clocks, no allocation per pose. */

export interface TrailPoint { readonly x: number; readonly y: number; readonly z: number }
/** `count` bones including bone 0 at the root, `spacing` metres apart along the path. */
export interface TrailSpec { readonly count: number; readonly spacing: number }

/** Sim ticks (60 Hz) between ring samples: both sides push the root when `trailSampleDue(tick)`. */
export const TRAIL_SAMPLE_TICKS = 6;
export const trailSampleDue = (tick: number): boolean => tick % TRAIL_SAMPLE_TICKS === 0;

/** The root path, newest point last. Mutable state owned by one creature; `trailPush` and `trailSeed` write it. */
export interface TrailRing {
  readonly capacity: number;
  /** capacity × xyz. */
  readonly points: Float64Array;
  /** Index of the newest point; the oldest is `(head - size + 1 + capacity) % capacity`. */
  head: number;
  size: number;
}

/** Samples closer than this to the newest kept point are the same point (a body at rest). Far below the wire's 8 mm
 * step, so a page and the server never disagree about a point that matters. */
const SAME_POINT = 1e-3;

/** A ring that keeps every 10 Hz sample of a body moving at `slowest` m/s for the whole body; a slower body's tail runs
 * straight off the oldest point. 14 bones at 1.6 m and 0.25 m/s: 834 points, 20 KB. */
export function trailRing(spec: TrailSpec, slowest = 0.25): TrailRing {
  if (!(spec.count >= 2) || !Number.isInteger(spec.count) || !(spec.spacing > 0) || !(slowest > 0) || !Number.isFinite(slowest)) {
    throw new Error('Trail needs at least 2 bones, a positive spacing and a positive slowest speed');
  }
  const capacity = Math.ceil(((spec.count - 1) * spec.spacing) / ((slowest * TRAIL_SAMPLE_TICKS) / 60)) + 2;
  return { capacity, points: new Float64Array(capacity * 3), head: -1, size: 0 };
}

/** Record a root sample (on `trailSampleDue` ticks). Every sample is kept, so no distance threshold can drop the apex of a
 * fold on one side and not the other; only a repeat of the newest point (a body at rest) is skipped. Non-finite samples
 * are refused. */
export function trailPush(ring: TrailRing, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('Nonfinite trail sample');
  if (ring.size > 0) {
    const i = ring.head * 3, dx = x - (ring.points[i] ?? 0), dy = y - (ring.points[i + 1] ?? 0), dz = z - (ring.points[i + 2] ?? 0);
    if (dx * dx + dy * dy + dz * dz < SAME_POINT * SAME_POINT) return;
  }
  ring.head = (ring.head + 1) % ring.capacity;
  const i = ring.head * 3;
  ring.points[i] = x; ring.points[i + 1] = y; ring.points[i + 2] = z;
  if (ring.size < ring.capacity) ring.size++;
}

/** A fresh joiner (or a fresh spawn) has no history: lay a rest trail straight back along yaw (forward is
 * `(sin yaw, 0, cos yaw)`, the engine's `atan2(dx, dz)` heading) for the whole body, ending one step behind the root. */
export function trailSeed(ring: TrailRing, spec: TrailSpec, root: TrailPoint, yaw: number): void {
  if (!Number.isFinite(yaw)) throw new Error('Nonfinite trail heading');
  ring.head = -1; ring.size = 0;
  const step = spec.spacing / 4, n = Math.ceil(((spec.count - 1) * spec.spacing) / step) + 1, bx = -Math.sin(yaw), bz = -Math.cos(yaw);
  for (let k = n; k >= 1; k--) trailPush(ring, root.x + bx * k * step, root.y, root.z + bz * k * step);
}

/** Pose the bones: `out` takes `count × 3` positions, bone 0 at `root`, bone i at path distance i × spacing back from
 * the root. Past the oldest point the chain carries on straight along the last segment. Pure over (ring, root, spec). */
export function trailPose(ring: TrailRing, root: TrailPoint, spec: TrailSpec, out: Float64Array): void {
  const s = spec.spacing, pts = ring.points;
  if (out.length < spec.count * 3) throw new Error('Trail output too short');
  out[0] = root.x; out[1] = root.y; out[2] = root.z;
  let ax = root.x, ay = root.y, az = root.z, walked = 0, bone = 1, dirX = 0, dirY = 0, dirZ = -1;
  for (let k = 0; bone < spec.count && k < ring.size; k++) {
    const j = ((ring.head - k + ring.capacity) % ring.capacity) * 3;
    const bx = pts[j] ?? 0, by = pts[j + 1] ?? 0, bz = pts[j + 2] ?? 0;
    const ex = bx - ax, ey = by - ay, ez = bz - az, len = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (len > 0) {
      dirX = ex / len; dirY = ey / len; dirZ = ez / len;
      while (bone < spec.count && walked + len >= bone * s) {
        const u = (bone * s - walked) / len;
        out[bone * 3] = ax + ex * u; out[bone * 3 + 1] = ay + ey * u; out[bone * 3 + 2] = az + ez * u;
        bone++;
      }
    }
    walked += len; ax = bx; ay = by; az = bz;
  }
  for (; bone < spec.count; bone++) {
    const back = bone * s - walked;
    out[bone * 3] = ax + dirX * back; out[bone * 3 + 1] = ay + dirY * back; out[bone * 3 + 2] = az + dirZ * back;
  }
}

/**
 * A ground frame turned about +Y, and plan-view tests in it (SHARD-PLATFORM W2, a shared world-building host). A frame is
 * an origin (x, z) and a yaw: local +Z is world +Z turned by `yaw` (the rotation a `ColliderDesc` or a `FloorRect` with
 * `rot` uses), so a site authored in its own frame (a cave's passage, a cove's floor, a deck) answers world questions:
 *
 *   const [lx, lz] = yawLocal(frame, x, z);          // world (x, z) → the frame's (lx, lz)
 *   const [x, z] = yawWorld(frame, lx, lz);           // and back
 *   insidePolygon(points, lx, lz);                    // even-odd test against a plan polygon ([x, z] corners)
 *
 * Nothing here knows a site; heights stay the caller's.
 */

/** A ground frame: its origin (world x, z) and its turn about +Y (radians). */
export interface YawFrame { readonly x: number; readonly z: number; readonly yaw: number }

/** world (x, z) → `frame`'s local (lx, lz) */
export function yawLocal(frame: YawFrame, x: number, z: number): [number, number] {
  const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw), dx = x - frame.x, dz = z - frame.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** `frame`'s local (lx, lz) → world (x, z) */
export function yawWorld(frame: YawFrame, lx: number, lz: number): [number, number] {
  const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
  return [frame.x + lx * c + lz * s, frame.z - lx * s + lz * c];
}

/** Whether (x, z) is inside the plan polygon `points` ([x, z] corners in order; even-odd rule, false under 3 corners). */
export function insidePolygon(points: readonly (readonly [number, number])[], x: number, z: number): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (a === undefined || b === undefined) continue;
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

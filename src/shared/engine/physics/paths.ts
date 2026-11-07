/**
 * The paths as walkways (PHYSICS.md P4, "anything steeper that a route needs gets a ramp collider"): the character
 * motor won't climb ground past 40°, and the sand paths cross ground that steep — sideways on a hillside, or up a
 * short crag lip. Each path is resampled every half metre; its height profile is the terrain under the centreline, lifted
 * (never lowered) so that no half-metre along it is steeper than `maxGradeDeg`. Wherever the ground is steep there
 * (terrain normal past `steepDeg`) or the profile had to be lifted, a thin board is laid along the path on that
 * profile, level across. So a path is walkable as a path while the slope beside it stays a slope. A lift of more than
 * `maxLift` is a cliff the path doesn't really climb (the trailside's steps do, or nothing): no board there.
 */
import type { ColliderDesc } from '../../../client/engine/world/registry';

type Vec2 = readonly [number, number];

/** how far to each side of a path's centreline its walkway must clear the terrain (the capsule’s 0.38 m radius + the slope it meets) */
const SIDE = 0.7;
/** the grade a chain's end tapers down at (tan 30°) */
const TAPER = Math.tan(30 * Math.PI / 180);

export interface PathRampOptions {
  /** terrain normal steeper than this under the centreline gets a board (degrees; default 30 — normalAt is smoothed) */
  steepDeg?: number;
  /** the steepest a board may climb (degrees; default 36, under the motor's 40°) */
  maxGradeDeg?: number;
  /** the most a board may float above the terrain (m): a board you could walk under is worse than none */
  maxLift?: number;
  /** resampling step along the path, board width across it (m) */
  step?: number; width?: number;
  /** how far to each side of the centreline the terrain is sampled for the board's height (m) */
  side?: number;
  /** taper a chain's ends down to the centreline ground */
  taper?: boolean;
  /** true where a deck already carries the path (the rope bridge, a pier): no board there — it would poke through */
  carried?: (x: number, z: number) => boolean;
}

export function pathRampDescs(
  paths: readonly (readonly Vec2[])[],
  heightAt: (x: number, z: number) => number,
  normalY: (x: number, z: number) => number,
  opts: PathRampOptions = {},
): ColliderDesc[] {
  const steepY = Math.cos((opts.steepDeg ?? 30) * Math.PI / 180);
  const G = Math.tan((opts.maxGradeDeg ?? 36) * Math.PI / 180);
  const maxLift = opts.maxLift ?? 1.0, step = opts.step ?? 0.5, width = opts.width ?? 2.2, half = 0.15;
  const side = opts.side ?? SIDE, tapering = opts.taper ?? true;
  const out: ColliderDesc[] = [];
  for (const path of paths) {
    // resample the polyline every `step` metres
    const xs: number[] = [], zs: number[] = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (!a || !b) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = k === 1 ? 0 : 1; j <= n; j++) { xs.push(a[0] + (b[0] - a[0]) * j / n); zs.push(a[1] + (b[1] - a[1]) * j / n); }
    }
    const n = xs.length;
    if (n < 2) continue;
    // the ground a walker's capsule meets: the highest terrain across ±SIDE of the centreline (on a hillside the uphill
    // side is what stops it), + 8 cm over the triangles' bulge between samples
    const ground = xs.map((x, i) => {
      const z = zs[i] ?? 0, j = Math.min(i, n - 2), tx = (xs[j + 1] ?? 0) - (xs[j] ?? 0), tz = (zs[j + 1] ?? 0) - (zs[j] ?? 0), tl = Math.hypot(tx, tz) || 1;
      const px = -tz / tl * side, pz = tx / tl * side;
      return Math.max(heightAt(x, z), heightAt(x + px, z + pz), heightAt(x - px, z - pz)) + 0.08;
    });
    const centre = xs.map((x, i) => heightAt(x, zs[i] ?? 0) + 0.02); // the path's own ground under its centreline
    const lifted = [...ground];
    const d = (i: number): number => Math.hypot((xs[i + 1] ?? 0) - (xs[i] ?? 0), (zs[i + 1] ?? 0) - (zs[i] ?? 0));
    // lift so that no step is steeper than G either way: a rise is approached by a ramp in front of it
    // — but a ramp that would stand more than maxLift over the ground is a cliff the path doesn't climb: the lift stops
    // there, rather than casting a ramp back over ground that never reaches the cliff (its end a wall on the way down)
    const raise = (i: number, want: number): void => {
      const g = ground[i] ?? 0;
      if (want > (lifted[i] ?? 0) && want - g <= maxLift) lifted[i] = want;
    };
    for (let i = n - 2; i >= 0; i--) raise(i, (lifted[i + 1] ?? 0) - G * d(i));
    for (let i = 1; i < n; i++) raise(i, (lifted[i - 1] ?? 0) - G * d(i - 1));
    const on: boolean[] = [];
    for (let i = 0; i + 1 < n; i++) {
      on[i] = false;
      const ax = xs[i] ?? 0, az = zs[i] ?? 0, bx = xs[i + 1] ?? 0, bz = zs[i + 1] ?? 0;
      const ha = lifted[i] ?? 0, hb = lifted[i + 1] ?? 0, ga = ground[i] ?? 0, gb = ground[i + 1] ?? 0;
      const lift = Math.max(ha - ga, hb - gb);
      if (lift > maxLift) continue;
      if (opts.carried?.(ax, az) === true || opts.carried?.(bx, bz) === true) continue;
      const steep = Math.min(normalY(ax, az), normalY((ax + bx) / 2, (az + bz) / 2), normalY(bx, bz)) < steepY;
      if (!steep && lift < 0.05) continue; // ground walkable as it is
      on[i] = true;
    }
    // a chain's ends taper to the path's own ground: its height is set by the uphill side, so where a chain stops its
    // end can stand proud of the centreline — a wall to walk into. Each end runs on outward, falling at ≤ TAPER, until
    // it meets the centreline ground. A node no board stands on starts on the path's ground (not on a ramp cast back
    // from a cliff, which a taper would otherwise build on — boards metres above flat sand).
    const top = lifted.map((h, i) => (on[i - 1] === true || on[i] === true ? h : centre[i] ?? 0));
    // A taper that would stand more than maxLift over the ground (the ground falls away faster than it does: a cliff
    // below a plateau's edge) is not built — the edge stays an edge.
    const taper = (from: number, dir: 1 | -1): void => {
      let h = top[from] ?? 0;
      const laid: [number, number][] = [];
      for (let k = from; dir > 0 ? k + 1 < n : k > 0; k += dir) {
        const seg = dir > 0 ? k : k - 1, next = k + dir;
        if ((on[seg] === true && k !== from) || opts.carried?.(xs[next] ?? 0, zs[next] ?? 0) === true) break;
        h -= TAPER * d(seg);
        const c = centre[next] ?? 0, landed = h <= c + 0.05;
        if (!landed && h - c > maxLift) return;
        laid.push([seg, landed ? c : Math.max(top[next] ?? 0, h)]); // the last board of the taper ends on the path's ground
        if (landed) break;
      }
      for (const [seg, h2] of laid) { on[seg] = true; top[dir > 0 ? seg + 1 : seg] = h2; }
    };
    // an end more than maxLift over the centreline is a crag's top the path runs beside, not a step to ramp down from
    const proud = (k: number): boolean => { const e = (top[k] ?? 0) - (centre[k] ?? 0); return e > 0.15 && e <= maxLift; };
    if (tapering) {
      for (let i = 0; i + 1 < n; i++) {
        if (on[i] !== true) continue;
        if (on[i - 1] !== true && proud(i)) taper(i, -1);
        if (on[i + 1] !== true && proud(i + 1)) taper(i + 1, 1);
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      if (on[i] !== true) continue;
      const ax = xs[i] ?? 0, az = zs[i] ?? 0, bx = xs[i + 1] ?? 0, bz = zs[i + 1] ?? 0;
      const ha = top[i] ?? 0, hb = top[i + 1] ?? 0;
      const run = Math.hypot(bx - ax, bz - az);
      if (run < 1e-3) continue;
      const yaw = Math.atan2(bx - ax, bz - az), th = Math.atan((hb - ha) / run);
      // local +z along the path, tilted up by th: q = qY(yaw) · qX(−th)
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(-th / 2), cx = Math.cos(-th / 2);
      const rot = { x: cy * sx, y: cx * sy, z: -sy * sx, w: cy * cx };
      // the board's up vector, so its top (not its middle) passes through the profile
      const ux = -Math.sin(th) * Math.sin(yaw), uy = Math.cos(th), uz = -Math.sin(th) * Math.cos(yaw);
      out.push({ kind: 'box', x: (ax + bx) / 2 - ux * half, y: (ha + hb) / 2 - uy * half, z: (az + bz) / 2 - uz * half, hx: width / 2, hy: half, hz: Math.hypot(run, hb - ha) / 2 + 0.05, rot });
    }
  }
  return out;
}

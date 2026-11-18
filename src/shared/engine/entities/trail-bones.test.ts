import { describe, expect, test } from 'vitest';
import { TRAIL_MAX_POINTS, TRAIL_SAMPLE_TICKS, trailPose, trailPush, trailRing, trailSampleDue, trailSeed, type TrailPoint, type TrailSpec } from './trailBones';

/** Checked index: a missing element is a test bug, not a pass. */
function el<T>(xs: ArrayLike<T>, i: number): T {
  const value = xs[i];
  if (value === undefined) throw new Error(`no element ${String(i)}`);
  return value;
}

/** Local seeded draw so the paths are fixed across machines (no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Root extends TrailPoint { readonly yaw: number }
/** A random creature path at 60 Hz: speed 0 to 12 m/s, turns up to 2 rad/s, and now and then a 9 m leap. */
function randomPath(seed: number, ticks: number): Root[] {
  const rand = mulberry32(seed), out: Root[] = [];
  let x = 0, z = 0, yaw = rand() * Math.PI * 2, speed = 4, turn = 0, leapT = -1;
  for (let tick = 0; tick < ticks; tick++) {
    if (tick % 30 === 0) { speed = rand() * 12; turn = (rand() * 2 - 1) * 2; if (leapT < 0 && rand() < 0.15) leapT = 0; }
    yaw += turn / 60;
    x += Math.sin(yaw) * speed / 60; z += Math.cos(yaw) * speed / 60;
    let y = 0;
    if (leapT >= 0) { leapT += 1 / 60; y = leapT < 1.5 ? 9 * Math.sin((leapT / 1.5) * Math.PI) : 0; if (leapT >= 1.5) leapT = -1; }
    out.push({ x, y, z, yaw });
  }
  return out;
}

const SERPENT: TrailSpec = { count: 14, spacing: 1.6 };
/** The wire's position step: cell-local ±260 m in 16 bits (animalNet.ts). */
const STEP = 520 / 65536;
const wire = (p: TrailPoint): TrailPoint => ({ x: Math.round(p.x / STEP) * STEP, y: Math.round(p.y / STEP) * STEP, z: Math.round(p.z / STEP) * STEP });

/** Server: every 60 Hz root, ring on the 10 Hz cadence. Page: only the wire's 10 Hz samples, quantized, for its ring.
 * Both pose from the same live root: where the root is drawn between rows is NET-LAG's interpolation, not this law. */
function run(path: Root[], at: readonly number[]): { server: Float64Array[]; page: Float64Array[] } {
  const server = trailRing(SERPENT), page = trailRing(SERPENT), first = el(path, 0), wanted = new Set(at);
  trailSeed(server, SERPENT, first, first.yaw); trailSeed(page, SERPENT, wire(first), first.yaw);
  const s: Float64Array[] = [], p: Float64Array[] = [];
  for (let tick = 0; tick < path.length; tick++) {
    const root = el(path, tick);
    if (trailSampleDue(tick)) { trailPush(server, root.x, root.y, root.z); const q = wire(root); trailPush(page, q.x, q.y, q.z); }
    if (!wanted.has(tick)) continue;
    const so = new Float64Array(SERPENT.count * 3), po = new Float64Array(SERPENT.count * 3);
    trailPose(server, root, SERPENT, so); trailPose(page, root, SERPENT, po);
    s.push(so); p.push(po);
  }
  return { server: s, page: p };
}

const dist = (a: Float64Array, i: number, b: Float64Array, j: number): number =>
  Math.hypot(el(a, i * 3) - el(b, j * 3), el(a, i * 3 + 1) - el(b, j * 3 + 1), el(a, i * 3 + 2) - el(b, j * 3 + 2));

/** Walk the pose's own polyline (root, ring newest → oldest) independently to read each bone's path distance. */
function pathSpacing(ring: ReturnType<typeof trailRing>, root: TrailPoint, out: Float64Array): number[] {
  const pts: TrailPoint[] = [root];
  for (let k = 0; k < ring.size; k++) { const j = ((ring.head - k + ring.capacity) % ring.capacity) * 3; pts.push({ x: el(ring.points, j), y: el(ring.points, j + 1), z: el(ring.points, j + 2) }); }
  const along: number[] = [];
  for (let bone = 0; bone < SERPENT.count; bone++) {
    let walked = 0, best = Infinity, at = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = el(pts, i), b = el(pts, i + 1), len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      for (let n = 0; n <= 400; n++) {
        const u = n / 400, d = Math.hypot(a.x + (b.x - a.x) * u - el(out, bone * 3), a.y + (b.y - a.y) * u - el(out, bone * 3 + 1), a.z + (b.z - a.z) * u - el(out, bone * 3 + 2));
        if (d < best - 1e-9) { best = d; at = walked + len * u; }
      }
      walked += len;
      if (walked > (bone + 1) * SERPENT.spacing + 2) break;
    }
    along.push(at);
  }
  return along.slice(1).map((a, i) => a - el(along, i));
}

describe('CC22 trail bones', () => {
  test('deterministic over 1,000 random paths; a page fed the wire 10 Hz samples is within 0.1 m of the server', () => {
    let worst = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const path = randomPath(seed, 480), at = [119, 200, 299, 361, 479];
      const a = run(path, at), b = run(path, at);
      for (let n = 0; n < at.length; n++) {
        expect(Array.from(el(b.server, n))).toEqual(Array.from(el(a.server, n)));
        expect(Array.from(el(b.page, n))).toEqual(Array.from(el(a.page, n)));
        for (let bone = 0; bone < SERPENT.count; bone++) worst = Math.max(worst, dist(el(a.server, n), bone, el(a.page, n), bone));
      }
    }
    expect(worst).toBeLessThan(0.1);
    // Measured: the page's trail is the server's to within the wire's 8 mm step.
    expect(worst).toBeLessThan(0.02);
  });

  test('spacing along the path is within 2% on 100 random paths, and no bone is further than the spacing from the next', () => {
    let worst = 0;
    for (let seed = 2001; seed <= 2100; seed++) {
      const path = randomPath(seed, 300), ring = trailRing(SERPENT), out = new Float64Array(SERPENT.count * 3);
      trailSeed(ring, SERPENT, el(path, 0), el(path, 0).yaw);
      for (let tick = 0; tick < path.length; tick++) if (trailSampleDue(tick)) trailPush(ring, el(path, tick).x, el(path, tick).y, el(path, tick).z);
      const root = el(path, path.length - 1);
      trailPose(ring, root, SERPENT, out);
      for (const gap of pathSpacing(ring, root, out)) worst = Math.max(worst, Math.abs(gap - SERPENT.spacing) / SERPENT.spacing);
      for (let bone = 1; bone < SERPENT.count; bone++) expect(dist(out, bone, out, bone - 1)).toBeLessThanOrEqual(SERPENT.spacing + 1e-9);
    }
    expect(worst).toBeLessThan(0.02);
  });

  test('a fresh joiner seeds a rest trail straight back along yaw', () => {
    const ring = trailRing(SERPENT), out = new Float64Array(SERPENT.count * 3), yaw = 0.7, root = { x: 3, y: 1, z: -2 };
    trailSeed(ring, SERPENT, root, yaw);
    trailPose(ring, root, SERPENT, out);
    for (let bone = 0; bone < SERPENT.count; bone++) {
      const back = bone * SERPENT.spacing;
      expect(el(out, bone * 3)).toBeCloseTo(root.x - Math.sin(yaw) * back, 6);
      expect(el(out, bone * 3 + 1)).toBeCloseTo(root.y, 9);
      expect(el(out, bone * 3 + 2)).toBeCloseTo(root.z - Math.cos(yaw) * back, 6);
    }
  });

  test('the body follows the head up a 9 m leap and back down: the tail bone passes the arc the head drew', () => {
    const ring = trailRing(SERPENT), out = new Float64Array(SERPENT.count * 3);
    trailSeed(ring, SERPENT, { x: 0, y: 0, z: 0 }, 0);
    let peakTail = 0;
    for (let tick = 0; tick <= 360; tick++) {
      const t = tick / 60, root = { x: 0, y: t < 1.5 ? 9 * Math.sin((t / 1.5) * Math.PI) : 0, z: t * 4 };
      if (trailSampleDue(tick)) trailPush(ring, root.x, root.y, root.z);
      trailPose(ring, root, SERPENT, out);
      peakTail = Math.max(peakTail, el(out, (SERPENT.count - 1) * 3 + 1));
    }
    expect(peakTail).toBeGreaterThan(8.5);
    expect(TRAIL_SAMPLE_TICKS).toBe(6);
  });

  test('a body that stands still keeps its trail; bad input is refused', () => {
    const ring = trailRing(SERPENT), before = new Float64Array(SERPENT.count * 3), after = new Float64Array(SERPENT.count * 3), root = { x: 1, y: 0, z: 1 };
    trailSeed(ring, SERPENT, root, 1.2);
    trailPose(ring, root, SERPENT, before);
    for (let tick = 0; tick < 600; tick++) if (trailSampleDue(tick)) trailPush(ring, root.x, root.y, root.z);
    trailPose(ring, root, SERPENT, after);
    expect(Array.from(after)).toEqual(Array.from(before));
    expect(() => trailPush(ring, Number.NaN, 0, 0)).toThrow('Nonfinite');
    expect(() => trailSeed(ring, SERPENT, root, Number.POSITIVE_INFINITY)).toThrow('Nonfinite');
    expect(() => trailRing({ count: 1, spacing: 1 })).toThrow();
    expect(() => trailPose(ring, root, SERPENT, new Float64Array(3))).toThrow('too short');
  });
});

test('a ring refuses an infinite spacing, never outgrows its cap, and holds a whole seed', () => {
  expect(() => trailRing({ count: 4, spacing: Number.POSITIVE_INFINITY })).toThrow('finite positive spacing');
  expect(trailRing({ count: 4, spacing: 1 }, 1e-9).capacity).toBe(TRAIL_MAX_POINTS);
  const spec = { count: 8, spacing: 0.05 }, ring = trailRing(spec);
  trailSeed(ring, spec, { x: 0, y: 0, z: 0 }, 0);
  expect(ring.size).toBe(4 * (spec.count - 1) + 1);
});

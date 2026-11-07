/**
 * buildTerrain(seed, spec) — compiles a `TerrainSpec` into the pure `TerrainField` functions.
 *
 * The def supplies the raw landscape, the trails, cabin sites, an optional pond and the ground
 * splat rule; this adds what every Wildshard shard must have on top of that:
 *   · the four entry roads at the edge midpoints, levelled to y = 0 at the boundary and ramping
 *     up into the chunk over ROAD_LENGTH (a fundamentals requirement, not tuneable per chunk)
 *   · flat cabin pads at the landscape height of each site
 *   · a shallow bed carved along every trail
 *   · the pond basin dished below its water line
 *   · an open-water shard's sea level (`oceanLevel`) as `waterLevel()`, no pond dish
 * All of it stays closure-based (no `this`), so the functions can be re-exported and called
 * millions of times from the terrain mesh / placement loops without indirection.
 */
import { Noise2D, smoothstep, clamp, lerp } from '../core/noise';
import { CHUNK_HALF, ROAD_WIDTH, ROAD_LENGTH } from '../core/config';
import type { TerrainField, TerrainSpec, TerrainNoise, Vec2, CabinSite } from '../level/data';

function distToSegmentSquared(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp((wx * vx + wz * vz) / l2, 0, 1) : 0;
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return dx * dx + dz * dz;
}

/** a graded path's cut / fill: full within GRADE_IN metres of its centreline, faded out by GRADE_OUT; sampled every GRADE_STEP */
const GRADE_IN = 3, GRADE_OUT = 7, GRADE_STEP = 0.5;
/** the shelf starts this far (m, along the path) before the first spot the grading moves, and runs on as far past the last */
const GRADE_LEAD = 5;

/**
 * A graded path (TerrainSpec.graded): the ground along the polyline every GRADE_STEP, and the shelf that climbs no
 * steeper than `maxGrade` — the mean of the profile's upper and lower `maxGrade` envelopes (the highest / lowest
 * profiles that slope that gently and never cross the ground). Both equal the ground wherever it is already that
 * gentle; at a crag step the shelf is half cut into the top, half filled below. `need` says where the shelf replaces
 * the ground (levelled across, so the crag's roughness beside the line doesn't come back between grid vertices): 1
 * within GRADE_LEAD of any sample the grading moved by 0.4 m or more, 0 where nothing within it moved 5 cm.
 */
function gradeProfile(poly: Vec2[], maxGrade: number, ground: (x: number, z: number) => number, bench = false) {
  const cum: number[] = [0];
  for (let k = 1; k < poly.length; k++) { const a = poly[k - 1], b = poly[k]; cum.push((cum[k - 1] ?? 0) + (a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0)); }
  const total = cum[cum.length - 1] ?? 0, n = Math.max(2, Math.ceil(total / GRADE_STEP) + 1);
  const g: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(total, i * GRADE_STEP);
    while (k < poly.length - 2 && s > (cum[k + 1] ?? 0)) k++;
    const a = poly[k], b = poly[k + 1], l = (cum[k + 1] ?? 0) - (cum[k] ?? 0), t = l > 0 ? (s - (cum[k] ?? 0)) / l : 0;
    g.push(a && b ? ground(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) : 0);
  }
  const up = [...g], dn = [...g], rise = maxGrade * GRADE_STEP;
  for (let i = 1; i < n; i++) { up[i] = Math.max(up[i] ?? 0, (up[i - 1] ?? 0) - rise); dn[i] = Math.min(dn[i] ?? 0, (dn[i - 1] ?? 0) + rise); }
  for (let i = n - 2; i >= 0; i--) { up[i] = Math.max(up[i] ?? 0, (up[i + 1] ?? 0) - rise); dn[i] = Math.min(dn[i] ?? 0, (dn[i + 1] ?? 0) + rise); }
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const shelf = g.map((_, i) => ((up[i] ?? 0) + (dn[i] ?? 0)) / 2), moved = shelf.map((v, i) => Math.abs(v - (g[i] ?? 0)));
  const lead = Math.round(GRADE_LEAD / GRADE_STEP);
  const need = moved.map((_, i) => {
    if (bench) return 1; // a bench the whole way (TerrainSpec.graded.bench)
    let m = 0;
    for (let j = Math.max(0, i - lead); j <= Math.min(n - 1, i + lead); j++) m = Math.max(m, moved[j] ?? 0);
    return smoothstep(0.05, 0.4, m);
  });
  return {
    poly, cum, shelf, need,
    x0: Math.min(...xs) - GRADE_OUT, x1: Math.max(...xs) + GRADE_OUT, z0: Math.min(...zs) - GRADE_OUT, z1: Math.max(...zs) + GRADE_OUT,
  };
}

/** 0..1: how much this point is inside the mandated flat entry road at an edge midpoint */
function entryRoadMask(x: number, z: number): number {
  const half = ROAD_WIDTH / 2 + 3;
  const along = (a: number, b: number) => smoothstep(half + 22, half, Math.abs(a)) * smoothstep(CHUNK_HALF - ROAD_LENGTH - 25, CHUNK_HALF - ROAD_LENGTH + 5, Math.abs(b));
  return Math.max(along(x, z), along(z, x));
}

/**
 * A 32-bit fingerprint of a height field: FNV-1a over `heightAt` sampled on a 16 × 16 grid across the
 * chunk, quantised to millimetres. scripts/bake-chunk.mjs stores it in the bake's header and
 * src/shared/engine/world/BakedTerrain.ts refuses a bake whose fingerprint differs from the live def's functions —
 * so a stale terrain.bin (an old build in the service worker, a def edited since the last vite start)
 * can never be installed over the analytic field.
 */
export function landscapeHash(t: Pick<TerrainField, 'heightAt'>, size: number = CHUNK_HALF * 2): number {
  let h = 0x811c9dc5;
  const n = 16, d = size / (n - 1);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const v = Math.round(t.heightAt(-size / 2 + ix * d, -size / 2 + iz * d) * 1000) | 0;
    for (let b = 0; b < 4; b++) { h ^= (v >>> (b * 8)) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h >>> 0;
}

/** Terrain metadata over authored trails, pads and pond; height/splat sampling stays with the admitted lattice. */
export function buildTerrainMetadata(seed: number, spec: Pick<TerrainSpec, 'trails' | 'cabinSites' | 'pond' | 'streamAt'>,
  waterLevel: TerrainField['waterLevel'], n: Noise2D = new Noise2D(seed)): Omit<TerrainField, 'heightAt' | 'normalAt' | 'splatAt'> {
  const trails = spec.trails, cabinSites = spec.cabinSites, pond = spec.pond ?? null;
  function trailDistance(x: number, z: number): number {
    let d = Infinity;
    for (const poly of trails) for (let i = 0; i < poly.length - 1; i++) { const a = poly[i], b = poly[i + 1]; if (a && b) d = Math.min(d, distToSegmentSquared(x, z, a[0], a[1], b[0], b[1])); }
    // sqrt is monotone: keep the same winning squared value and the exact final root, once per field query.
    return Math.sqrt(d);
  }

  function cabinMask(x: number, z: number): number {
    let m = 0;
    for (const c of cabinSites) {
      const d = Math.hypot(x - c.x, z - c.z);
      m = Math.max(m, smoothstep(22, 11, d));
    }
    return m;
  }

  const pondMask = pond
    ? (x: number, z: number): number => {
        const d = Math.hypot(x - pond.x, z - pond.z) + n.get(x * 0.05, z * 0.05) * 3;
        return smoothstep(pond.r + 10, pond.r * 0.3, d);
      }
    : () => 0;

  return { trailDistance, cabinMask, pondMask, waterLevel, ...(spec.streamAt ? { streamAt: spec.streamAt } : {}), trails, cabinSites, pond };
}

export function buildTerrain(seed: number, spec: TerrainSpec): TerrainField {
  const noise: TerrainNoise = { n: new Noise2D(seed), n2: new Noise2D(seed + 7) };
  const { n } = noise;
  const trails: Vec2[][] = spec.trails;
  const cabinSites: CabinSite[] = spec.cabinSites;
  const pond = spec.pond ?? null;
  const pondFill = spec.pondFill ?? 1.0;
  const oceanLevel = spec.oceanLevel ?? null;
  const landscape = (x: number, z: number) => spec.landscape(x, z, noise);
  const finish = spec.finish ?? null;
  const graded = (spec.graded?.paths ?? []).map((poly) => gradeProfile(poly, spec.graded?.maxGrade ?? 1, landscape, spec.graded?.bench === true));
  /** a graded path's pull on (x, z): the shelf height there, and how far toward it (1 within GRADE_IN of a stretch
   *  that needed grading, 0 past GRADE_OUT or where the ground was gentle anyway) */
  const _grade = { y: 0, w: 0 };
  function gradeAt(x: number, z: number): { y: number; w: number } {
    let best = GRADE_OUT, y = 0, need = 0;
    for (const g of graded) {
      if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
      for (let k = 0; k + 1 < g.poly.length; k++) {
        const a = g.poly[k], b = g.poly[k + 1];
        if (!a || !b) continue;
        const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
        const raw = l2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / l2 : 0, t = clamp(raw, 0, 1);
        // past the path's first or last point the shelf stops (square ends): the bridge the path meets there keeps
        // its gully
        const past = (k === 0 && raw < 0) || (k === g.poly.length - 2 && raw > 1);
        const d = past ? GRADE_OUT : Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
        if (d >= best) continue;
        best = d;
        const f = ((g.cum[k] ?? 0) + t * Math.sqrt(l2)) / GRADE_STEP, i = Math.min(g.shelf.length - 2, Math.floor(f)), u = f - i;
        y = (g.shelf[i] ?? 0) * (1 - u) + (g.shelf[i + 1] ?? 0) * u;
        need = (g.need[i] ?? 0) * (1 - u) + (g.need[i + 1] ?? 0) * u;
      }
    }
    _grade.y = y; _grade.w = need * smoothstep(GRADE_OUT, GRADE_IN, best);
    return _grade;
  }

  let _waterLevel: number | null = null;
  function waterLevel(): number {
    _waterLevel ??= oceanLevel ?? (pond ? landscape(pond.x, pond.z) + pondFill : -1e4); // ocean, or the pond fills the natural basin below its rim
    return _waterLevel;
  }

  const { trailDistance, cabinMask, pondMask } = buildTerrainMetadata(seed, spec, waterLevel, n);

  function heightAt(x: number, z: number): number {
    let h = landscape(x, z);
    if (graded.length > 0) { const g = gradeAt(x, z); if (g.w > 0) h = lerp(h, g.y, g.w); }
    // pond basin: dish down to ~3 m below the water line
    const pm = pondMask(x, z);
    if (pm > 0) h = lerp(h, Math.min(h, waterLevel() - 1.6 - pm * 1.6), smoothstep(0.0, 0.5, pm));
    // trails: flatten a little and carve a shallow bed
    const td = trailDistance(x, z);
    const trailW = smoothstep(9, 2.5, td);
    h -= trailW * 0.35;
    // cabin pads: flatten to the pad's height
    for (const c of cabinSites) {
      const d = Math.hypot(x - c.x, z - c.z);
      const m = smoothstep(20, 9, d);
      if (m > 0) h = lerp(h, landscape(c.x, c.z), m);
    }
    if (finish) h = finish(x, z, h);
    // entry roads: must be level with no-man's land (y = 0) at the chunk boundary
    const rm = entryRoadMask(x, z);
    if (rm > 0) {
      const inward = CHUNK_HALF - Math.max(Math.abs(x), Math.abs(z));
      const ramp = smoothstep(ROAD_LENGTH - 15, ROAD_LENGTH + 30, inward); // 0 at edge → 1 deep inside
      h = lerp(lerp(0, h, ramp), h, 1 - rm);
    }
    return h;
  }

  function normalAt(x: number, z: number, eps = 0.6): [number, number, number] {
    const hl = heightAt(x - eps, z), hr = heightAt(x + eps, z);
    const hd = heightAt(x, z - eps), hu = heightAt(x, z + eps);
    const nx = hl - hr, nz = hd - hu, ny = 2 * eps;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  const terrain: TerrainField = {
    heightAt, normalAt, trailDistance, cabinMask, pondMask, waterLevel, ...(spec.streamAt ? { streamAt: spec.streamAt } : {}),
    splatAt: (x, z) => {
      if (!spec.splat) return [1, 0, 0, 0]; // no splat ground (TerrainSpec.splat omitted)
      const [a, b, c, d] = spec.splat(x, z, terrain, noise);
      const s = a + b + c + d;
      return [a / s, b / s, c / s, d / s];
    },
    trails, cabinSites, pond,
  };
  return terrain;
}

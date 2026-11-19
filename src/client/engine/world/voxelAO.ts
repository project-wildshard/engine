import * as THREE from 'three';

/**
 * Runtime voxel shading (E357 X5, 10 §X5): the triangles are rasterised into an occupancy grid, each sample marches
 * hemisphere rays from just off the surface, and the occluded fraction (+ a little for facing down) is how dark that
 * vertex goes. The three bakes that used to carry their own copy (the low-poly kit's per-face bake, the painted kit's
 * smooth per-position bake, the GLB per-vertex bake) are parameter rows of this one; each keeps its colour mix.
 *
 *   const k = voxelAO(geo, { box, cell, pad: 2, ... });     // per vertex: 0..1 darkening, NaN = not sampled
 *   aoTint(geo.getAttribute('color'), k, tint);              // pull each sampled vertex's colour toward `tint`
 */

/** a ring of hemisphere directions: [cos of the angle from the normal, how many round it] */
export type HemiRing = readonly [number, number];
export type HemiDir = readonly [number, number, number];

/** fixed hemisphere directions in a +Z-up tangent frame, ring by ring, each ring turned by `cz × twist` (deterministic bakes) */
export function hemisphere(rings: readonly HemiRing[], twist: number): readonly HemiDir[] {
  const out: [number, number, number][] = [];
  for (const [cz, n] of rings) {
    const s = Math.sqrt(1 - cz * cz);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + cz * twist; out.push([Math.cos(a) * s, Math.sin(a) * s, cz]); }
  }
  return out;
}

export interface VoxelAOParams {
  /** the bounds the grid covers (the geometry's own bounding box) */
  readonly box: THREE.Box3;
  /** the voxel edge (m) */
  readonly cell: number;
  /** empty cells round the box on every side */
  readonly pad: number;
  /** the rasteriser's sample spacing along a triangle edge, in cells, and its cap on samples per edge */
  readonly spacing: number;
  readonly maxSamples: number;
  /** rasterise through the geometry's index (an indexed mesh); otherwise every 3 vertices are a triangle */
  readonly indexed: boolean;
  /** what counts as ground: terrain heights cached per grid column (`columns`, in the geometry's space), or every point
   *  below a plane (`below`, m). Omitted = no ground */
  readonly ground?: { readonly columns: (x: number, z: number) => number } | { readonly below: number };
  /** where a ray starts and what it is aimed by: `face` = each triangle's centroid along its first vertex's normal (as
   *  stored, not normalised; a face's 3 vertices share the value); `weld` = each distinct position (keyed at 5 mm) along
   *  its summed, normalised normal, the value kept as a float32; `vertex` = each vertex along its normalised normal */
  readonly sample: 'face' | 'weld' | 'vertex';
  /** the ray start's distance off the surface, in cells */
  readonly offset: number;
  readonly hemi: readonly HemiDir[];
  /** the steps a ray marches, each `stepLen` metres; a hit at step s weighs `1 - (s / steps) × falloff` */
  readonly steps: number;
  readonly stepLen: number;
  readonly falloff: number;
  /** 0..1 how dark a fully occluded sample goes */
  readonly strength: number;
  /** a downward-facing sample loses this much extra light (`face` / `vertex` only; 0 = none) */
  readonly downDark: number;
}

const _N = new THREE.Vector3(), _T = new THREE.Vector3(), _B = new THREE.Vector3();

/** each vertex's darkening (0..1; NaN where a sample was skipped: a degenerate normal) */
export function voxelAO(geo: THREE.BufferGeometry, p: VoxelAOParams): Float64Array {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const { box: bb, cell, pad } = p;
  const ext = new THREE.Vector3().subVectors(bb.max, bb.min);
  const ox = bb.min.x - pad * cell, oy = bb.min.y - pad * cell, oz = bb.min.z - pad * cell;
  const nx = Math.ceil(ext.x / cell) + pad * 2 + 1, ny = Math.ceil(ext.y / cell) + pad * 2 + 1, nz = Math.ceil(ext.z / cell) + pad * 2 + 1;
  // the ground: a column cache of the cell under the terrain (filled only when the call marches), or a plane
  const g = p.ground;
  const ground = g !== undefined && 'columns' in g ? g.columns : null;
  const below = g !== undefined && 'below' in g ? g.below : null;
  const column = (fn: (x: number, z: number) => number, ix: number, iz: number): number => Math.floor((fn(ox + (ix + 0.5) * cell, oz + (iz + 0.5) * cell) - oy) / cell);
  const index = p.indexed ? geo.getIndex() : null;
  let columns: Int32Array | null = null;
  if (ground !== null) {
    columns = new Int32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) columns[iz * nx + ix] = column(ground, ix, iz);
  }
  const grid = new Uint8Array(nx * ny * nz);

  // rasterise the triangles: barycentric samples at ≤ `spacing` cells
  const tri = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b) - ax, by = pos.getY(b) - ay, bz = pos.getZ(b) - az;
    const cx = pos.getX(c) - ax, cy = pos.getY(c) - ay, cz = pos.getZ(c) - az;
    const e = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(p.maxSamples, Math.max(1, Math.ceil(e / (cell * p.spacing))));
    for (let u = 0; u <= n; u++) for (let v = 0; u + v <= n; v++) {
      const s = u / n, w = v / n;
      const ix = Math.floor((ax + bx * s + cx * w - ox) / cell), iy = Math.floor((ay + by * s + cy * w - oy) / cell), iz = Math.floor((az + bz * s + cz * w - oz) / cell);
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) grid[(iz * ny + iy) * nx + ix] = 1;
    }
  }
  const solid = (x: number, y: number, z: number): boolean => {
    if (below !== null && y < below) return true;
    const ix = Math.floor((x - ox) / cell), iy = Math.floor((y - oy) / cell), iz = Math.floor((z - oz) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
    if (columns !== null && iy <= (columns[iz * nx + ix] ?? -1)) return true;
    if (iy < 0 || iy >= ny) return false;
    return grid[(iz * ny + iy) * nx + ix] === 1;
  };
  /** the occluded fraction from (px, py, pz) round _N */
  const march = (px: number, py: number, pz: number): number => {
    const N = _N, T = _T, B = _B;
    T.set(Math.abs(N.y) < 0.9 ? 0 : 1, Math.abs(N.y) < 0.9 ? 1 : 0, 0).cross(N).normalize(); B.crossVectors(N, T);
    let occ = 0, wsum = 0;
    for (const [hx, hy, hz] of p.hemi) {
      const dx = T.x * hx + B.x * hy + N.x * hz, dy = T.y * hx + B.y * hy + N.y * hz, dz = T.z * hx + B.z * hy + N.z * hz;
      wsum += hz;
      for (let s = 0; s < p.steps; s++) {
        const d = (s + 0.5) * p.stepLen;
        if (solid(px + dx * d, py + dy * d, pz + dz * d)) { occ += hz * (1 - (s / p.steps) * p.falloff); break; }
      }
    }
    return occ / wsum;
  };

  const out = new Float64Array(pos.count).fill(Number.NaN);
  const off = p.offset, N = _N;   // a start is `n × cell × offset` off the surface (that product order: the bakes' bytes)
  if (p.sample === 'face') {
    for (let f = 0; f < pos.count / 3; f++) {
      const i = f * 3;
      N.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (N.lengthSq() < 0.5) continue;
      const px = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 + N.x * cell * off;
      const py = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 + N.y * cell * off;
      const pz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 + N.z * cell * off;
      const a = Math.min(1, march(px, py, pz) * p.strength + Math.max(0, -N.y) * p.downDark);
      out[i] = a; out[i + 1] = a; out[i + 2] = a;
    }
  } else if (p.sample === 'vertex') {
    for (let i = 0; i < pos.count; i++) {
      N.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (N.lengthSq() < 0.5) continue;
      N.normalize();
      out[i] = Math.min(1, march(pos.getX(i) + N.x * cell * off, pos.getY(i) + N.y * cell * off, pos.getZ(i) + N.z * cell * off) * p.strength + Math.max(0, -N.y) * p.downDark);
    }
  } else {
    // distinct positions → summed normal → one value each
    const key = (i: number) => (Math.round(pos.getX(i) * 200) * 73856093) ^ (Math.round(pos.getY(i) * 200) * 19349663) ^ (Math.round(pos.getZ(i) * 200) * 83492791);
    const slot = new Map<number, number>();
    const which = new Int32Array(pos.count);
    const acc: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const k = key(i);
      let j = slot.get(k);
      if (j === undefined) { j = acc.length / 6; slot.set(k, j); acc.push(pos.getX(i), pos.getY(i), pos.getZ(i), 0, 0, 0); }
      which[i] = j;
      acc[j * 6 + 3] = (acc[j * 6 + 3] ?? 0) + nrm.getX(i); acc[j * 6 + 4] = (acc[j * 6 + 4] ?? 0) + nrm.getY(i); acc[j * 6 + 5] = (acc[j * 6 + 5] ?? 0) + nrm.getZ(i);
    }
    const nU = acc.length / 6, ao = new Float32Array(nU);
    for (let j = 0; j < nU; j++) {
      N.set(acc[j * 6 + 3] ?? 0, acc[j * 6 + 4] ?? 1, acc[j * 6 + 5] ?? 0);
      if (N.lengthSq() < 1e-6) continue;
      N.normalize();
      ao[j] = march((acc[j * 6] ?? 0) + N.x * cell * off, (acc[j * 6 + 1] ?? 0) + N.y * cell * off, (acc[j * 6 + 2] ?? 0) + N.z * cell * off);
    }
    for (let i = 0; i < pos.count; i++) out[i] = Math.min(1, (ao[which[i] ?? 0] ?? 0) * p.strength);
  }
  return out;
}

/** pull each sampled vertex's colour toward `tint × scale` by its darkening `k` (`c (1 - k) + c tint scale k`) */
export function aoTint(col: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, k: Float64Array, tint: THREE.Color, scale = 1): void {
  for (let v = 0; v < col.count; v++) {
    const a = k[v] ?? Number.NaN;
    if (Number.isNaN(a)) continue;
    const r = col.getX(v), g = col.getY(v), b = col.getZ(v);
    col.setXYZ(v, r * (1 - a) + r * tint.r * scale * a, g * (1 - a) + g * tint.g * scale * a, b * (1 - a) + b * tint.b * scale * a);
  }
  col.needsUpdate = true;
}

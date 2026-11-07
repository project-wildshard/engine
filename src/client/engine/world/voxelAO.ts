import * as THREE from 'three';

/**
 * One voxel AO baker (E357 X5, 10 §X5): the triangles are rasterised into an occupancy grid, each sample marches
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

// ── the build-time bake (SF67 fix 3, E461) ───────────────────────────────────────────────────────────────────────────
//
// The AO is a pure function of the geometry's positions, normals and index, the params and the ground under the grid, so
// a native bake (scripts/bake-voxel-ao.mjs) runs a shard's world build in Node, records every result keyed by a 64-bit
// hash of exactly those inputs, and writes the table; at load the shard adds the table (`addVoxelAOBake`) before it
// builds, and `voxelAO` returns the recorded values for a geometry whose inputs hash the same, marching only on a miss.
// A miss is always safe (the code path runs); a stale table is caught by the bake's `--check` (bake-check.mjs).
//
// The key is built to be the same in Node and in every browser, and cheap (SF67 part 3): the hemisphere directions enter
// quantised to 1e-9 and the normals to 2^-16 (both come from Math.cos / Math.sin, whose last bit differs between Node's V8,
// Chromium's and Safari's: one direction's last bit made every Driftwood kit miss in the page), and the ground enters as a coarse probe (at most
// 33 × 33 of the grid's columns, the same values the march reads there) instead of every column. The full column cache
// (1.07 M terrain lookups for Driftwood's ground cover) is computed only when the call marches. A hit returns the Node
// bake's values: bit-identical to what Chromium marches with the same directions; on an engine whose Math differs in the
// last bit, the bake's (Node's) values, which is the one answer every platform now shows.
//
// Format (little-endian): 'WSAO' · u32 version · u32 entries · per entry: u32 hashA · u32 hashB · u32 count ·
// u32 palette · u8 width (1 | 2) · f64[palette] (the distinct values, NaN included) · u8|u16[count] (each vertex's palette index).

const BAKE_MAGIC = 0x4f415357, BAKE_VERSION = 2;
const baked = new Map<string, Float64Array>();
const bakeStats = { hits: 0, misses: 0 };
let recording: Map<string, Float64Array> | null = null;
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);

/** two FNV-1a lanes over 32-bit words */
class InputHash {
  a = 0x811c9dc5; b = 0x01000193 ^ 0x9e3779b9;
  word(w: number): void { this.a = Math.imul(this.a ^ w, 0x01000193); this.b = Math.imul(this.b ^ w, 0x5bd1e995) ^ (this.b >>> 15); }
  num(v: number): void { _f64[0] = v; this.word(_u32[0] ?? 0); this.word(_u32[1] ?? 0); }
  key(): string { return `${(this.a >>> 0).toString(16)}:${(this.b >>> 0).toString(16)}`; }
}

/** an xyz attribute's values into the hash: a plain float32 attribute's bits word by word (the common, fast case), any
 *  other (interleaved, other array types) value by value as float64 bits */
function hashVec3(h: InputHash, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  if (a instanceof THREE.BufferAttribute && a.array instanceof Float32Array && a.itemSize === 3 && !a.normalized) {
    const w = new Uint32Array(a.array.buffer, a.array.byteOffset, a.count * 3);
    h.word(0x46333200);
    for (let i = 0; i < w.length; i++) h.word(w[i] ?? 0);
    return;
  }
  for (let i = 0; i < a.count; i++) { h.num(a.getX(i)); h.num(a.getY(i)); h.num(a.getZ(i)); }
}

/** the normals into the hash quantised to 2^-16: a normal built through Math.cos / Math.sin can carry a different trig
 *  residual (≈ 1e-16 in place of 0) in Node and in a browser (3 of Nalati's 61 geometries did), which moves no ray */
function hashNormals(h: InputHash, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  h.word(0x4e513136);
  if (a instanceof THREE.BufferAttribute && a.array instanceof Float32Array && a.itemSize === 3 && !a.normalized) {
    const v = a.array;
    for (let i = 0, n = a.count * 3; i < n; i++) h.word(Math.round((v[i] ?? 0) * 65536));
    return;
  }
  for (let i = 0; i < a.count; i++) { h.word(Math.round(a.getX(i) * 65536)); h.word(Math.round(a.getY(i) * 65536)); h.word(Math.round(a.getZ(i) * 65536)); }
}

/** Add a baked table (scripts/bake-voxel-ao.mjs's bytes) for the builds that follow; the returned function drops it again.
 *  Bytes that do not parse add nothing (every geometry then marches, as it would with no bake). One table serves every
 *  tier: the keys are the inputs, so the phone's and the desktop's geometries sit side by side. */
export function addVoxelAOBake(bytes: ArrayBuffer | null): () => void {
  const table = bytes === null ? null : decodeVoxelAOBake(bytes);
  if (table === null) return () => undefined;
  const added: string[] = [];
  for (const [key, k] of table) if (!baked.has(key)) { baked.set(key, k); added.push(key); }
  return () => { for (const key of added) baked.delete(key); };
}

/** Run a world build with the baked table at `url` added (fetched first; a missing or unreadable file adds nothing, so every
 *  geometry marches as before), and drop the table once the build is done. */
export async function withVoxelAOBake<T>(url: string, build: () => Promise<T>): Promise<T> {
  const bytes = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
  const drop = addVoxelAOBake(bytes);
  try { return await build(); } finally { drop(); }
}

/** A baked table's entries, or null when the bytes are not one (the bake's tier merge reads it too). */
export function decodeVoxelAOBake(bytes: ArrayBuffer): Map<string, Float64Array> | null {
  if (bytes.byteLength < 12) return null;
  const v = new DataView(bytes);
  if (v.getUint32(0, true) !== BAKE_MAGIC || v.getUint32(4, true) !== BAKE_VERSION) return null;
  const table = new Map<string, Float64Array>();
  let o = 12;
  try {
    for (let e = v.getUint32(8, true); e > 0; e--) {
      const key = `${v.getUint32(o, true).toString(16)}:${v.getUint32(o + 4, true).toString(16)}`;
      const count = v.getUint32(o + 8, true), palette = v.getUint32(o + 12, true), width = v.getUint8(o + 16);
      o += 17;
      const values = new Float64Array(palette);
      for (let i = 0; i < palette; i++, o += 8) values[i] = v.getFloat64(o, true);
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++, o += width) out[i] = values[width === 1 ? v.getUint8(o) : v.getUint16(o, true)] ?? Number.NaN;
      table.set(key, out);
    }
  } catch {
    return null;
  }
  return table;
}

/** The native bake's recorder: every `voxelAO` result from now until `stop()`, keyed by its inputs' hash. */
export function recordVoxelAO(): { readonly entries: ReadonlyMap<string, Float64Array>; stop: () => void } {
  const entries = new Map<string, Float64Array>();
  recording = entries;
  return { entries, stop: () => { if (recording === entries) recording = null; } };
}

/** The table's bytes, entries in key order (a byte-stable bake). */
export function encodeVoxelAOBake(entries: ReadonlyMap<string, Float64Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  const keys = [...entries.keys()].sort();
  for (const key of keys) {
    const k = entries.get(key);
    if (k === undefined) continue;
    const slot = new Map<string, number>(), values: number[] = [];
    const index = new Uint32Array(k.length);
    k.forEach((x, i) => { _f64[0] = x; const id = `${String(_u32[0])}.${String(_u32[1])}`; let j = slot.get(id); if (j === undefined) { j = values.length; slot.set(id, j); values.push(x); } index[i] = j; });
    if (values.length > 65536) continue; // never in practice; such a geometry just marches
    const width = values.length > 256 ? 2 : 1;
    const b = new Uint8Array(17 + values.length * 8 + k.length * width), v = new DataView(b.buffer);
    const [ha = '0', hb = '0'] = key.split(':');
    v.setUint32(0, Number.parseInt(ha, 16), true); v.setUint32(4, Number.parseInt(hb, 16), true);
    v.setUint32(8, k.length, true); v.setUint32(12, values.length, true); v.setUint8(16, width);
    values.forEach((x, i) => { v.setFloat64(17 + i * 8, x, true); });
    const at = 17 + values.length * 8;
    index.forEach((j, i) => { if (width === 1) v.setUint8(at + i, j); else v.setUint16(at + i * 2, j, true); });
    parts.push(b);
  }
  const head = new Uint8Array(12), hv = new DataView(head.buffer);
  hv.setUint32(0, BAKE_MAGIC, true); hv.setUint32(4, BAKE_VERSION, true); hv.setUint32(8, parts.length, true);
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 12));
  out.set(head, 0);
  let o = 12;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/** how many `voxelAO` calls the bake answered and how many marched since the page loaded (the load benchmark reads it) */
export function voxelAOBakeStats(): { readonly hits: number; readonly misses: number; readonly entries: number } {
  return { hits: bakeStats.hits, misses: bakeStats.misses, entries: baked.size };
}

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
  let bakeKey: string | null = null;
  if (baked.size > 0 || recording !== null) {
    const h = new InputHash();
    h.word(pos.count); h.word(index ? index.count : 0);
    hashVec3(h, pos); hashNormals(h, nrm);
    if (index) { const ix = index.array; for (let i = 0; i < index.count; i++) h.word(ix[i] ?? 0); }
    for (const x of [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z, cell, pad, p.spacing, p.maxSamples, p.indexed ? 1 : 0, p.sample === 'face' ? 0 : p.sample === 'weld' ? 1 : 2,
      p.offset, p.steps, p.stepLen, p.falloff, p.strength, p.downDark, below ?? Number.NaN, p.hemi.length]) h.num(x);
    for (const [hx, hy, hz] of p.hemi) { h.word(Math.round(hx * 1e9)); h.word(Math.round(hy * 1e9)); h.word(Math.round(hz * 1e9)); }
    if (ground !== null) {
      // the coarse ground probe: every `sx`-th / `sz`-th column and the last row and column
      const sx = Math.max(1, Math.ceil((nx - 1) / 32)), sz = Math.max(1, Math.ceil((nz - 1) / 32));
      h.word(nx); h.word(nz);
      for (let iz = 0; iz < nz; iz = iz === nz - 1 ? nz : Math.min(nz - 1, iz + sz)) for (let ix = 0; ix < nx; ix = ix === nx - 1 ? nx : Math.min(nx - 1, ix + sx)) h.word(column(ground, ix, iz));
    }
    bakeKey = h.key();
    // the recorder always marches (the bake is the code's own output, never a copy of an older table)
    const hit = recording === null ? baked.get(bakeKey) : undefined;
    if (hit !== undefined && hit.length === pos.count) { bakeStats.hits++; return hit.slice(); }
    if (recording === null) bakeStats.misses++;
  }
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
  if (recording !== null && bakeKey !== null) recording.set(bakeKey, out.slice());
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

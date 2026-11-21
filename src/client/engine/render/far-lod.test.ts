// meta DRIFTWOOD-FPS DF9 (mini-df9): far copies of wide static meshes at phone Low, behind `debug.farLod`.
import { expect, test } from 'vitest';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { FAR_LEVELS, FAR_LOD_DEFAULT, FAR_LOD_PHONE_LOW, farLod, squareCopy } from './farLod';

const LOOK_WEIGHT = 10;

test('the slot: a boolean wins; unset, the phone-Low default at phone Low, else the default', () => {
  expect(farLod(true)).toBe(true);
  expect(farLod(false, true)).toBe(false);
  expect(farLod(null, true)).toBe(FAR_LOD_PHONE_LOW);
  expect(farLod('yes', false)).toBe(FAR_LOD_DEFAULT);
});

test('levels grow coarser with distance at a fixed angle', () => {
  for (let i = 1; i < FAR_LEVELS.length; i++) {
    const a = FAR_LEVELS[i - 1], b = FAR_LEVELS[i];
    expect(b?.at).toBeGreaterThan(a?.at ?? 0);
    expect((b?.error ?? 0) / (b?.at ?? 1)).toBeCloseTo((a?.error ?? 0) / (a?.at ?? 1), 5);
  }
});

/** an n by n grid of 1 m quads on a gentle slope; `soup`: each face its own three vertices */
function grid(n: number, soup: boolean): { positions: Float32Array; full: Uint32Array; border: Set<string> } {
  const at = (x: number, z: number): [number, number, number] => [x, 0.001 * x * z, z];
  const verts: number[] = [], tris: number[] = [], border = new Set<string>();
  const id = new Map<string, number>();
  const vertex = (x: number, z: number): number => {
    if (x === 0 || z === 0 || x === n || z === n) border.add(`${String(x)},${String(z)}`);
    const key = `${String(x)},${String(z)}`, known = soup ? undefined : id.get(key);
    if (known !== undefined) return known;
    const v = verts.length / 3; verts.push(...at(x, z)); id.set(key, v); return v;
  };
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    tris.push(vertex(x, z), vertex(x, z + 1), vertex(x + 1, z), vertex(x + 1, z), vertex(x, z + 1), vertex(x + 1, z + 1));
  }
  return { positions: new Float32Array(verts), full: new Uint32Array(tris), border };
}

test.each([false, true])('a square copy is coarser, keeps its border and names only its own vertices (soup %s)', async soup => {
  await MeshoptSimplifier.ready;
  const { positions, full, border } = grid(16, soup);
  const copy = squareCopy(MeshoptSimplifier.simplify, positions, full, 0.05);
  expect(copy.length % 3).toBe(0);
  expect(copy.length).toBeLessThan(full.length / 4);
  const used = new Set(full);
  const corners = new Set<string>();
  for (const v of copy) {
    expect(used.has(v)).toBe(true);
    corners.add(`${String(Math.round(positions[v * 3] ?? 0))},${String(Math.round(positions[v * 3 + 2] ?? 0))}`);
  }
  // the border is locked: every border point is still a corner, so a finer neighbour meets it with no crack
  for (const b of border) expect(corners.has(b)).toBe(true);
  // no face flips over
  for (let t = 0; t < copy.length; t += 3) {
    const p = (k: number): number[] => [0, 1, 2].map(j => positions[(copy[t + k] ?? 0) * 3 + j] ?? 0);
    const [a, b, c] = [p(0), p(1), p(2)];
    const ny = ((c[0] ?? 0) - (a[0] ?? 0)) * ((b[2] ?? 0) - (a[2] ?? 0)) - ((b[0] ?? 0) - (a[0] ?? 0)) * ((c[2] ?? 0) - (a[2] ?? 0));
    expect(ny).toBeGreaterThan(0);
  }
});

test('given colours, each new face takes one side\'s colour, the side it lies on', async () => {
  await MeshoptSimplifier.ready;
  const { positions, full } = grid(16, true);
  // sand west of x = 7, grass east of it: per-face colour, as a faceted ground has
  const colours = new Float32Array(positions.length), side = new Uint8Array(positions.length / 3);
  for (let t = 0; t < full.length; t += 3) {
    const cx = [0, 1, 2].reduce((sum, k) => sum + (positions[(full[t + k] ?? 0) * 3] ?? 0), 0) / 3;
    for (let k = 0; k < 3; k++) { const v = full[t + k] ?? 0; side[v] = cx < 7 ? 1 : 2; colours.set(cx < 7 ? [0.9, 0.8, 0.6] : [0.4, 0.7, 0.3], v * 3); }
  }
  const copy = squareCopy(MeshoptSimplifier.simplify, positions, full, 0.05, { values: colours, size: 3 });
  expect(copy.length).toBeLessThan(full.length / 4);
  let mixed = 0, wrong = 0;
  for (let t = 0; t < copy.length; t += 3) {
    const sides = new Set([0, 1, 2].map(k => side[copy[t + k] ?? 0]));
    if (sides.size > 1) mixed++;
    const cx = [0, 1, 2].reduce((sum, k) => sum + (positions[(copy[t + k] ?? 0) * 3] ?? 0), 0) / 3;
    if (!sides.has(cx < 7 ? 1 : 2)) wrong++;
  }
  // a face takes one side's colour at all three corners, the side most of it lies on
  expect(mixed).toBe(0);
  expect(wrong).toBe(0);
});

/** DF9b (mini-df9b): the first build's squareCopy, kept as the reference: the reused working arrays must give the same copy */
function referenceCopy(simplify: typeof MeshoptSimplifier.simplify, positions: Float32Array, full: Uint32Array, error: number, looks: { values: Float32Array; size: number } | null = null): Uint32Array {
  const weldOf = new Map<number, number>(), byKey = new Map<number | string, number>(), welded: number[] = [], originals: number[][] = [];
  const at = (v: number, j: number): number => positions[v * 3 + j] ?? 0;
  const widx = new Uint32Array(full.length);
  // a position's key: millimetres from the square's first corner, packed exactly in a double (x and z within 65 m, y
  // within 262 m of it), else as text
  const first = full[0] ?? 0, ox = at(first, 0), oy = at(first, 1), oz = at(first, 2);
  const keyOf = (v: number): number | string => {
    const x = Math.round((at(v, 0) - ox) * 1000) + 65536, y = Math.round((at(v, 1) - oy) * 1000) + 262144, z = Math.round((at(v, 2) - oz) * 1000) + 65536;
    if (x >= 0 && x < 131072 && z >= 0 && z < 131072 && y >= 0 && y < 524288) return x + 131072 * (z + 131072 * y);
    return `${String(x)},${String(y)},${String(z)}`;
  };
  for (let i = 0; i < full.length; i++) {
    const v = full[i] ?? 0;
    let w = weldOf.get(v);
    if (w === undefined) {
      const key = keyOf(v);
      w = byKey.get(key);
      if (w === undefined) { w = welded.length / 3; byKey.set(key, w); welded.push(at(v, 0), at(v, 1), at(v, 2)); originals.push([]); }
      weldOf.set(v, w); originals[w]?.push(v);
    }
    widx[i] = w;
  }
  // each original vertex's face direction (its first face in this square)
  const faceOf = new Map<number, [number, number, number]>();
  const normal = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): [number, number, number] => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  for (let t = 0; t < full.length; t += 3) {
    const a = full[t] ?? 0, b = full[t + 1] ?? 0, c = full[t + 2] ?? 0;
    const f = normal(at(a, 0), at(a, 1), at(a, 2), at(b, 0), at(b, 1), at(b, 2), at(c, 0), at(c, 1), at(c, 2));
    for (const v of [a, b, c]) if (!faceOf.has(v)) faceOf.set(v, f);
  }
  const wpos = new Float32Array(welded.length); wpos.set(welded);
  const [out] = simplify(widx, wpos, 3, 0, error, ['LockBorder', 'ErrorAbsolute', 'Prune']);
  const copy = new Uint32Array(out.length);
  const w3 = (w: number, j: number): number => wpos[w * 3 + j] ?? 0;
  const size = looks?.size ?? 0, hue = new Float64Array(size);
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t] ?? 0, b = out[t + 1] ?? 0, c = out[t + 2] ?? 0;
    const f = normal(w3(a, 0), w3(a, 1), w3(a, 2), w3(b, 0), w3(b, 1), w3(b, 2), w3(c, 0), w3(c, 1), w3(c, 2));
    if (looks !== null) {
      // the new face's look: the mean over its corners' originals
      hue.fill(0); let n = 0;
      for (const w of [a, b, c]) for (const v of originals[w] ?? []) { for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) + (looks.values[v * size + j] ?? 0); n++; }
      for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) / Math.max(1, n);
    }
    for (let k = 0; k < 3; k++) {
      const list = originals[out[t + k] ?? 0] ?? [];
      let best = list[0] ?? 0, score = -Infinity;
      if (list.length > 1) for (const v of list) {
        const g = faceOf.get(v); let s = g === undefined ? -2 : g[0] * f[0] + g[1] * f[1] + g[2] * f[2];
        if (looks !== null) {
          let d = 0;
          for (let j = 0; j < size; j++) { const e = (looks.values[v * size + j] ?? 0) - (hue[j] ?? 0); d += e * e; }
          s -= LOOK_WEIGHT * d;
        }
        if (s > score) { score = s; best = v; }
      }
      copy[t + k] = best;
    }
  }
  return copy;
}

/** a rolling, faceted patch of `n` by `n` quads with per-face colour, offset by `shift` (several meshes through one build) */
function terrain(n: number, soup: boolean, shift: number): { positions: Float32Array; full: Uint32Array; looks: { values: Float32Array; size: number } } {
  const height = (x: number, z: number): number => Math.sin(x * 0.7 + shift) * 0.4 + Math.cos(z * 0.5) * 0.3 + ((x * 7 + z * 13) % 5) * 0.01;
  const verts: number[] = [], tris: number[] = [], colour: number[] = [], id = new Map<string, number>();
  const vertex = (x: number, z: number, c: number): number => {
    const key = `${String(x)},${String(z)}`, known = soup ? undefined : id.get(key);
    if (known !== undefined) return known;
    const v = verts.length / 3; verts.push(x + shift * 100, height(x, z), z - shift * 50); colour.push(c, 1 - c, 0.5); id.set(key, v); return v;
  };
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const c = (x + z) % 3 === 0 ? 0.9 : 0.2;
    tris.push(vertex(x, z, c), vertex(x, z + 1, c), vertex(x + 1, z, c), vertex(x + 1, z, c), vertex(x, z + 1, c), vertex(x + 1, z + 1, c));
  }
  return { positions: new Float32Array(verts), full: new Uint32Array(tris), looks: { values: new Float32Array(colour), size: 3 } };
}

test('the reused working arrays give the first build\'s copy exactly, mesh after mesh and level after level', async () => {
  await MeshoptSimplifier.ready;
  const meshes = [terrain(24, true, 0), terrain(9, false, 1), terrain(40, true, 2), terrain(16, false, 3), terrain(5, true, 4)];
  let compared = 0;
  for (const level of FAR_LEVELS) for (const { positions, full, looks } of meshes) for (const withLooks of [true, false]) {
    const given = withLooks ? looks : null;
    const now = squareCopy(MeshoptSimplifier.simplify, positions, full, level.error, given);
    const before = referenceCopy(MeshoptSimplifier.simplify, positions, full, level.error, given);
    expect(Array.from(now)).toEqual(Array.from(before));
    compared += now.length;
  }
  expect(compared).toBeGreaterThan(1000);
});

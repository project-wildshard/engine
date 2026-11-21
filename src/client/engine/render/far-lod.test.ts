// meta DRIFTWOOD-FPS DF9 (mini-df9): far copies of wide static meshes at phone Low, behind `debug.farLod`.
import { expect, test } from 'vitest';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { FAR_LEVELS, FAR_LOD_DEFAULT, FAR_LOD_PHONE_LOW, farLod, squareCopy } from './farLod';

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

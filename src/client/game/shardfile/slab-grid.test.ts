import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { gridSlabPositions, markSlabGrid, placeSlabPart, SLAB_GRID_STEP, slabFarCells, slabGrid, slabGridFor, slabXyz } from './slabGrid';
import { mergeSlabChunks } from './slabMerge';
import { slabFarLevels, spatialSlabRanges, visibleSlabDraws, SLAB_LEAF_TRIANGLES, type SlabDraws } from './slabRanges';

// ONE-FORMAT OF-EM28b3: a slab chunk's positions stay Int16 grid words on the GPU, decoded by its part's own matrix.
// A made-up chunk shaped like Nine's: a street of wall quads 190 m long (the longest kit chunks), lit windows on them.
function street(x0 = -95, y0 = 120.3, z0 = 41.7): BufferGeometry {
  const positions: number[] = [], corners: number[] = [];
  for (let i = 0; i < 380; i++) for (let j = 0; j < 12; j++) {
    const x = x0 + i * 0.5, y = y0 + j * 0.75, z = z0 + (i % 7) * 0.013, at = positions.length / 3;
    positions.push(x, y, z, x + 0.5, y, z, x + 0.5, y + 0.75, z, x, y + 0.75, z);
    corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(Uint16Array.from(corners), 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
const decode = (geometry: BufferGeometry, matrix: Matrix4): Float32Array => {
  const position = geometry.getAttribute('position'), out = new Float32Array(position.count * 3), at = new Vector3();
  for (let v = 0; v < position.count; v++) at.set(position.getX(v), position.getY(v), position.getZ(v)).applyMatrix4(matrix).toArray(out, v * 3);
  return out;
};
const blankDraws = (): SlabDraws => ({ starts: new Int32Array(8), counts: new Int32Array(8), n: 0, total: 0 });
const drawn = (draws: SlabDraws): number[] => Array.from({ length: draws.n }, (_, i) => [draws.starts[i] ?? 0, draws.counts[i] ?? 0]).flat();

test('a gridded chunk keeps 4-word Int16 positions: 8 bytes a vertex instead of 12, 4-byte aligned, unnormalized', () => {
  const geometry = street(), vertices = geometry.getAttribute('position').count, floatBytes = geometry.getAttribute('position').array.byteLength;
  const grid = gridSlabPositions(geometry);
  if (grid === null) throw new Error('expected a grid');
  const position = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute)) throw new Error('expected a plain channel');
  expect(position.array).toBeInstanceOf(Int16Array); expect(position.itemSize).toBe(4); expect(position.normalized).toBe(false);
  expect(position.count).toBe(vertices);
  expect(floatBytes).toBe(vertices * 12); expect(position.array.byteLength).toBe(vertices * 8);
  expect(position.array.byteLength / floatBytes).toBeCloseTo(2 / 3, 6);
  // the fourth word is zero padding; the grid is a power of two at least the finest step, its origin on its lattice
  for (let v = 0; v < vertices; v++) expect(position.array[v * 4 + 3]).toBe(0);
  expect(grid.step).toBe(SLAB_GRID_STEP); expect(Number.isInteger(Math.log2(grid.step))).toBe(true);
  for (const value of grid.origin) expect(Number.isInteger(value / grid.step)).toBe(true);
  expect(slabGrid(geometry)).toBe(grid);
  // a second call is a no-op on a chunk already gridded
  expect(gridSlabPositions(geometry)).toBe(grid); expect(geometry.getAttribute('position')).toBe(position);
});

test('positions decode within half a step (2 mm), under 1 cm; a chunk past 256 m doubles its step', () => {
  const source = street(), metres = Float32Array.from(source.getAttribute('position').array), part = new InstancedMesh(source, new MeshBasicMaterial(), 1);
  gridSlabPositions(source); placeSlabPart(part, source);
  const decoded = decode(source, part.matrix);
  let worst = 0;
  for (let at = 0; at < metres.length; at++) worst = Math.max(worst, Math.abs((decoded[at] ?? 0) - (metres[at] ?? 0)));
  expect(worst).toBeLessThanOrEqual(SLAB_GRID_STEP / 2 + 1e-5); expect(worst).toBeLessThan(0.01);
  const wide = slabGridFor([-150, 0, 0], [150, 10, 10]);
  expect(wide.step).toBe(SLAB_GRID_STEP * 2);
  expect(slabGridFor([-400, 0, 0], [400, 0, 0]).step).toBe(SLAB_GRID_STEP * 4);
});

test('two chunks on one step share a lattice: a vertex on their seam decodes to one point in both', () => {
  const a = slabGridFor([-95, 120, 40], [95, 130, 42]), b = slabGridFor([60, 118, 41], [250, 129, 45]);
  expect(a.step).toBe(b.step); expect(a.origin).not.toEqual(b.origin);
  const on = (grid: typeof a, value: number, axis: number): number => Math.round((value - (grid.origin[axis] ?? 0)) / grid.step) * grid.step + (grid.origin[axis] ?? 0);
  for (const point of [[60.123456, 121.987654, 41.333333], [94.99, 129.01, 41.9], [77.7, 125.25, 41.0001]]) {
    expect(point.map((value, axis) => on(a, value, axis))).toEqual(point.map((value, axis) => on(b, value, axis)));
  }
});

test('the leaf cut, back-face leaves and far levels draw the same ranges on the grid as in metres', () => {
  const float = street(), gridded = street(), part = new InstancedMesh(gridded, new MeshBasicMaterial(), 1);
  gridSlabPositions(gridded); placeSlabPart(part, gridded);
  const xyz = slabXyz(gridded);
  if (xyz === null) throw new Error('expected grid xyz');
  // the worker's input: the grid words widened, in grid units
  expect(xyz.length).toBe(gridded.getAttribute('position').count * 3); expect(Number.isInteger(xyz[5])).toBe(true);
  const metresTree = spatialSlabRanges(float, SLAB_LEAF_TRIANGLES, true), gridTree = spatialSlabRanges(gridded, SLAB_LEAF_TRIANGLES, true);
  if (metresTree === null || gridTree === null) throw new Error('expected trees');
  expect(Array.from(gridTree.nodes)).toEqual(Array.from(metresTree.nodes));
  expect(Array.from(gridded.index?.array ?? [])).toEqual(Array.from(float.index?.array ?? []));
  const farMetres = slabFarLevels(float.index?.array ?? [], float.getAttribute('position').array, metresTree, [0.3, 0.8]);
  const farGrid = slabFarLevels(gridded.index?.array ?? [], xyz, gridTree, slabFarCells(gridded, [0.3, 0.8]));
  expect(Array.from(farGrid.far.cells)).toEqual([0.3 / SLAB_GRID_STEP, 0.8 / SLAB_GRID_STEP]);
  // the levels cluster on the grid's lattice rather than the world's: the same reduction, give or take a few triangles
  expect(Math.abs(farGrid.corners.length - farMetres.corners.length)).toBeLessThan(farMetres.corners.length * 0.05);
  const metres = { ...metresTree, far: farMetres.far }, grid = { ...gridTree, far: farGrid.far };
  for (const [x, z, lookX, lookZ] of [[-120, 60, -60, 41], [0, 70, 0, 41], [140, 45, 90, 41.5], [0, 400, 0, 41]] as const) {
    const view = new PerspectiveCamera(70, 402 / 874, 0.1, 2000); view.position.set(x, 125, z); view.lookAt(lookX, 125, lookZ); view.updateMatrixWorld(true);
    for (const [angle, facing, farAngle] of [[0, false, 0], [0.001, true, 0], [0.001, true, 0.02]] as const) {
      const a = drawn(visibleSlabDraws(metres, new Matrix4(), view, angle, blankDraws(), facing, farAngle));
      const b = drawn(visibleSlabDraws(grid, part.matrix, view, angle, blankDraws(), facing, farAngle));
      if (farAngle === 0) expect(b).toEqual(a);
      else expect(b.length > 0).toBe(a.length > 0);
    }
  }
});

test('a ray picks the gridded chunk where it picks the float one, within 1 cm', () => {
  const float = street(), gridded = street(), material = new MeshBasicMaterial();
  const plain = new InstancedMesh(float, material, 1), part = new InstancedMesh(gridded, material, 1);
  gridSlabPositions(gridded); placeSlabPart(part, gridded);
  for (const mesh of [plain, part]) { mesh.instanceMatrix.needsUpdate = true; mesh.updateMatrixWorld(true); }
  for (const [x, y] of [[-80.2, 122.1], [3.3, 125.4], [94.1, 128.6]] as const) {
    const ray = new Raycaster(new Vector3(x, y, 60), new Vector3(0, 0, -1));
    const [a] = ray.intersectObject(plain), [b] = ray.intersectObject(part);
    if (a === undefined || b === undefined) throw new Error('expected a hit');
    expect(b.point.distanceTo(a.point)).toBeLessThan(0.01); expect(b.faceIndex).toBe(a.faceIndex);
  }
});

test('a chunk baked on a grid (OF-EM28b4) keeps its Int16 words; chunks merge only on one grid', () => {
  const words = Int16Array.of(-3, 0, 7, 100, -100, 32767, 5, 5, 5), baked = new BufferGeometry(), grid = { origin: [10, 20, 30] as const, step: 2 ** -7 };
  baked.setAttribute('position', new BufferAttribute(words, 3)); baked.setIndex([0, 1, 2]);
  markSlabGrid(baked, grid);
  expect(gridSlabPositions(baked)).toBe(grid);
  const position = baked.getAttribute('position');
  expect(position.itemSize).toBe(4); expect(Array.from(position.array)).toEqual([-3, 0, 7, 0, 100, -100, 32767, 0, 5, 5, 5, 0]);
  const other = (step: number): BufferGeometry => {
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(Int16Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9), 3)); g.setIndex([0, 1, 2]);
    markSlabGrid(g, { origin: [10, 20, 30], step }); return g;
  };
  const same = [other(2 ** -7), other(2 ** -7)], merged = mergeSlabChunks(same);
  expect(merged).not.toBeNull(); if (merged === null) return;
  expect(slabGrid(merged)).toEqual({ origin: [10, 20, 30], step: 2 ** -7 });
  expect(mergeSlabChunks([other(2 ** -7), other(2 ** -6)])).toBeNull();
});

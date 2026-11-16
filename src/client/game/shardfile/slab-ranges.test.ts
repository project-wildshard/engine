import { expect, test } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Frustum, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, WebGLCoordinateSystem } from 'three';
import { cullSlabRanges, spatialSlabRanges, visibleSlabRun, SLAB_LEAF_TRIANGLES } from './slabRanges';

// NINE-DRAGON-BENCHMAX NB8: a made-up resident slab chunk, a 400 m street of small wall quads whose index is in a
// scrambled source order (as a resident cell's packing leaves it), drawn from a camera that sees one end of it.
function street(wide: boolean): BufferGeometry {
  const positions: number[] = [], corners: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const x = -200 + (i * 7919 % 1500) * 400 / 1500, z = (i % 3) * 6 - 6, y = (i % 5) * 4, at = positions.length / 3;
    positions.push(x, y, z, x + 0.25, y, z, x + 0.25, y + 3, z, x, y + 3, z);
    corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(wide ? Uint32Array.from(corners) : Uint16Array.from(corners), 1));
  return geometry;
}
const triangleKeys = (geometry: BufferGeometry): string[] => {
  const index = geometry.index; if (index === null) throw new Error('no index');
  const out: string[] = [];
  for (let t = 0; t < index.count / 3; t++) out.push([index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)].join(','));
  return out;
};
function camera(x: number, yaw: number): PerspectiveCamera {
  const view = new PerspectiveCamera(70, 402 / 874, 0.1, 2000);
  view.position.set(x, 1.7, 20); view.rotation.set(0, yaw, 0); view.updateMatrixWorld(true);
  return view;
}

test.each([false, true])('the k-d order keeps every triangle, each leaf box holds its own (wide index=%s)', wide => {
  const geometry = street(wide), before = triangleKeys(geometry).sort();
  const ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  expect(triangleKeys(geometry).sort()).toEqual(before);
  expect(ranges.triangles).toBe(3000);
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null) throw new Error('no index');
  const point = new Vector3();
  for (let node = 0; node < ranges.nodes.length / 4; node++) {
    const box = new Box3().setFromArray(ranges.boxes.slice(node * 6, node * 6 + 6)), from = ranges.nodes[node * 4 + 2] ?? 0, to = ranges.nodes[node * 4 + 3] ?? 0;
    if ((ranges.nodes[node * 4] ?? -1) < 0) expect(to - from).toBeLessThanOrEqual(SLAB_LEAF_TRIANGLES);
    for (let t = from; t < to; t++) for (let k = 0; k < 3; k++) expect(box.containsPoint(point.fromBufferAttribute(position, index.getX(t * 3 + k)))).toBe(true);
  }
});

test('the visible run holds every triangle in view and leaves out the far end of the street', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const view = camera(-190, 0.1), world = new Matrix4().makeTranslation(3, 0, 0);
  const [start, end] = visibleSlabRun(ranges, world, view);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), WebGLCoordinateSystem);
  const index = geometry.index, position = geometry.getAttribute('position'); if (index === null) throw new Error('no index');
  let inView = 0;
  for (let t = 0; t < ranges.triangles; t++) {
    const box = new Box3(); for (let k = 0; k < 3; k++) box.expandByPoint(new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)).applyMatrix4(world));
    if (frustum.intersectsBox(box)) { inView++; expect(t >= start && t < end).toBe(true); }
  }
  expect(inView).toBeGreaterThan(0);
  expect(end - start).toBeLessThan(ranges.triangles / 2);
});

test('a chunk out of view still draws one leaf, so a warm builds its pipeline', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const [start, end] = visibleSlabRun(ranges, new Matrix4(), camera(0, Math.PI / 2 + Math.PI / 4));
  expect(end - start).toBeGreaterThan(0);
  expect(end - start).toBeLessThanOrEqual(SLAB_LEAF_TRIANGLES);
});

test('a draw takes the run and every other reader gets the whole chunk back', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), view = camera(-190, 0.1);
  cullSlabRanges(part, ranges);
  part.updateMatrixWorld(true);
  const scene = new Scene();
  part.onBeforeRender(undefined as never, scene, view, geometry, part.material, undefined as never);
  expect(geometry.drawRange.count).toBeLessThan(ranges.triangles * 3);
  expect(geometry.drawRange.count % 3).toBe(0);
  part.onAfterRender(undefined as never, scene, view, geometry, part.material, undefined as never);
  expect(geometry.drawRange.start).toBe(0);
  expect(geometry.drawRange.count).toBe(Infinity);
});

test('a chunk of one leaf keeps its order and no ranges', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3)); geometry.setIndex([0, 1, 2]);
  expect(spatialSlabRanges(geometry)).toBeNull();
});

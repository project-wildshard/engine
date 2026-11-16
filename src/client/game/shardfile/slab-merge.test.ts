import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Float16BufferAttribute, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { mergedSlabBounds, mergeSlabChunks } from './slabMerge';
import { slabRangesJob, spatialSlabRanges, visibleSlabDraws } from './slabRanges';

// NINE-DRAGON-BENCHMAX NB8 (mini-nb8e): a key's chunks as one geometry on the phone. Made-up chunks of a wall kit:
// quads along a street, each chunk a stretch of it, with a position, a half-float face channel and a 16-bit index.
function chunk(from: number, quads: number, face = true): BufferGeometry {
  const positions: number[] = [], faces: number[] = [], corners: number[] = [];
  for (let i = 0; i < quads; i++) {
    const x = from + i * 0.5, at = positions.length / 3;
    positions.push(x, 0, 0, x + 0.25, 0, 0, x + 0.25, 3, 0, x, 3, 0);
    for (let k = 0; k < 4; k++) faces.push(i, k, 1, 1);
    corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  if (face) geometry.setAttribute('aFace', new Float16BufferAttribute(Uint16Array.from(faces), 4));
  geometry.setIndex(new BufferAttribute(Uint16Array.from(corners), 1));
  return geometry;
}
const triangles = (geometry: BufferGeometry): string[] => {
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null) throw new Error('no index');
  const out: string[] = [];
  for (let t = 0; t < index.count / 3; t++) {
    const corner = (k: number): string => { const v = index.getX(t * 3 + k); return `${position.getX(v)},${position.getY(v)},${position.getZ(v)}`; };
    out.push([corner(0), corner(1), corner(2)].join('|'));
  }
  return out;
};

test('a key\'s chunks merge end to end: every triangle and channel kept, the index offset, its classes kept', () => {
  const parts = [chunk(0, 10), chunk(100, 7), chunk(-50, 3)];
  const merged = mergeSlabChunks(parts);
  if (merged === null) throw new Error('expected a merge');
  expect(triangles(merged)).toEqual(parts.flatMap(triangles));
  expect(merged.getAttribute('aFace')).toBeInstanceOf(Float16BufferAttribute);
  expect(merged.getAttribute('aFace').count).toBe(80);
  const second = parts[1]?.getAttribute('aFace');
  if (second === undefined) throw new Error('expected a face channel');
  expect(Array.from((merged.getAttribute('aFace') as BufferAttribute).array.slice(40 * 4, 41 * 4))).toEqual(Array.from((second as BufferAttribute).array.slice(0, 4)));
  expect(merged.index?.array).toBeInstanceOf(Uint16Array);
});

test('a merge past 65,535 vertices takes a 32-bit index', () => {
  const merged = mergeSlabChunks([chunk(0, 10_000), chunk(6000, 10_000)]);
  expect(merged?.index?.array).toBeInstanceOf(Uint32Array);
  expect(merged?.index?.getX(merged.index.count - 1)).toBe(79_999);
});

test('chunks whose channels differ, or one chunk, are not merged', () => {
  expect(mergeSlabChunks([chunk(0, 4), chunk(10, 4, false)])).toBeNull();
  expect(mergeSlabChunks([chunk(0, 4)])).toBeNull();
  const grouped = chunk(10, 4); grouped.addGroup(0, 6, 0);
  expect(mergeSlabChunks([chunk(0, 4), grouped])).toBeNull();
});

test('the merged bounds hold every row\'s box and sphere', () => {
  const { box, sphere } = mergedSlabBounds([{ box: [0, 0, 0, 10, 3, 1], sphere: [5, 1.5, 0.5, 6] }, { box: [100, 0, 0, 110, 3, 1], sphere: [105, 1.5, 0.5, 6] }]);
  expect(box.min.toArray()).toEqual([0, 0, 0]);
  expect(box.max.toArray()).toEqual([110, 3, 1]);
  expect(sphere.center.distanceTo(box.getCenter(sphere.center.clone()))).toBe(0);
  expect(sphere.radius).toBeGreaterThanOrEqual(56);
});

test('the sliced job yields and builds exactly the tree and order of the one-go build', () => {
  const merged = mergeSlabChunks([chunk(0, 20_000), chunk(9000, 20_000)]), again = mergeSlabChunks([chunk(0, 20_000), chunk(9000, 20_000)]);
  if (merged === null || again === null) throw new Error('expected a merge');
  const whole = spatialSlabRanges(merged);
  const job = slabRangesJob(again);
  let step = job.next(), yields = 0;
  while (step.done !== true) { yields++; step = job.next(); }
  expect(yields).toBeGreaterThan(2);
  expect(step.value?.nodes).toEqual(whole?.nodes);
  expect(step.value?.boxes).toEqual(whole?.boxes);
  expect(Array.from(again.index?.array ?? [])).toEqual(Array.from(merged.index?.array ?? []));
});

test('with the leaf cut, a merged key draws every triangle in view at least angle × distance thick, in one call', () => {
  const view = new PerspectiveCamera(70, 402 / 874, 0.1, 2000);
  view.position.set(20, 1.7, 15); view.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse));
  const merged = mergeSlabChunks([chunk(0, 600), chunk(300, 600), chunk(600, 600)]);
  if (merged === null) throw new Error('expected a merge');
  const ranges = spatialSlabRanges(merged), index = merged.index, position = merged.getAttribute('position');
  if (ranges === null || index === null) throw new Error('expected ranges');
  const out = visibleSlabDraws(ranges, new Matrix4(), view, 0.001, { starts: new Int32Array(8), counts: new Int32Array(8), n: 0, total: 0 });
  const kept = new Set<number>();
  for (let i = 0; i < out.n; i++) for (let t = out.starts[i] ?? 0; t < (out.starts[i] ?? 0) + (out.counts[i] ?? 0); t++) kept.add(t);
  const point = new Vector3();
  let inView = 0;
  for (let t = 0; t < ranges.triangles; t++) {
    let seen = false, near = Infinity;
    for (let k = 0; k < 3; k++) { point.fromBufferAttribute(position, index.getX(t * 3 + k)); seen ||= frustum.containsPoint(point); near = Math.min(near, point.distanceTo(view.position)); }
    if (!seen || (ranges.thickness[t] ?? 0) < 0.001 * near) continue;
    inView++;
    expect(kept.has(t)).toBe(true);
  }
  expect(inView).toBeGreaterThan(20);
  expect(out.total).toBeLessThan(ranges.triangles / 2);
});

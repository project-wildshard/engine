import { BoxGeometry, Mesh } from 'three';
import { expect, test } from 'vitest';
import { bakePose } from './shardfileFar';

test('GC6: a near part bakes its pose without recomputing the loader bounds, and an identity pose is untouched', () => {
  const still = new Mesh(new BoxGeometry(2, 2, 2));
  still.geometry.computeBoundingSphere(); still.updateMatrixWorld(true);
  const before = [...still.geometry.getAttribute('position').array];
  const baked = bakePose(still);
  expect(baked).toBe(still.geometry);
  expect(baked.boundingSphere).toBeNull(); expect(baked.boundingBox).toBeNull();
  expect([...baked.getAttribute('position').array]).toEqual(before);
  const moved = new Mesh(new BoxGeometry(2, 2, 2)); moved.position.set(10, 0, 0);
  moved.geometry.computeBoundingBox(); moved.updateMatrixWorld(true);
  const posed = bakePose(moved);
  expect(posed.boundingBox).toBeNull();
  posed.computeBoundingBox();
  expect(posed.boundingBox?.min.x).toBeCloseTo(9); expect(posed.boundingBox?.max.x).toBeCloseTo(11);
});

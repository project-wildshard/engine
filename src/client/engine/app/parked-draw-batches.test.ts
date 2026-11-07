import { expect, test } from 'vitest';
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { parkedDrawSlices, type ParkedDrawBudget } from '../render/parkedDraws';
import { markArrayReleased } from '../render/releasedArrays';

/** The slicing rules at one native unit a slice (the WebKit live budget before G782 raised it to two, D152). */
const ONE_UNIT: ParkedDrawBudget = { drawables: 8, newMaterials: 1, newBindings: 1, bufferBytes: 256 * 1024 };

test('matching instances retain every draw without paying one frame per copy', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const objects = Array.from({ length: 19 }, () => new InstancedMesh(geometry, material, 1));
  const slices = parkedDrawSlices(objects, ONE_UNIT);
  expect(slices.map(slice => slice.length)).toEqual([8, 8, 3]);
  expect(slices.flat()).toEqual(objects);
  geometry.dispose(); material.dispose();
});

test('exact copies (no new material, binding or buffer) take no drawables place (G808)', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), copies = Array.from({ length: 12 }, () => new Mesh(geometry, material));
  const fresh = Array.from({ length: 9 }, () => new InstancedMesh(geometry, material, 1));
  const slices = parkedDrawSlices([...copies, ...fresh], ONE_UNIT);
  // the copies after the first upload nothing; the instanced binding is a new first use, and each instanced mesh brings
  // its own instance buffer, so those still count
  expect(slices.map(slice => slice.length)).toEqual([12, 8, 1]);
  expect(slices.flat()).toEqual([...copies, ...fresh]);
  geometry.dispose(); material.dispose();
});

test('a new geometry, material or instance layout retains its first-use boundary', () => {
  const geometry = new BoxGeometry(), other = new BoxGeometry(), material = new MeshBasicMaterial(), second = new MeshBasicMaterial();
  const objects = [new InstancedMesh(geometry, material, 1), new InstancedMesh(geometry, material, 1),
    new InstancedMesh(other, material, 1), new InstancedMesh(other, second, 1), new Mesh(other, second)];
  expect(parkedDrawSlices(objects, ONE_UNIT)).toEqual([[objects[0], objects[1]], [objects[2]], [objects[3]], [objects[4]]]);
  geometry.dispose(); other.dispose(); material.dispose(); second.dispose();
});

test('per-object render callbacks keep independent first uses', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const objects = [new InstancedMesh(geometry, material, 1), new InstancedMesh(geometry, material, 1)];
  for (const object of objects) object.onBeforeRender = () => undefined;
  expect(parkedDrawSlices(objects, ONE_UNIT)).toEqual(objects.map(object => [object]));
  geometry.dispose(); material.dispose();
});

test('fresh instance buffers obey the smaller byte limit even with a shared binding', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const objects = Array.from({ length: 3 }, () => new InstancedMesh(geometry, material, 2100));
  expect(parkedDrawSlices(objects, ONE_UNIT)).toEqual(objects.map(object => [object]));
  geometry.dispose(); material.dispose();
});

test('an oversized first buffer goes alone and all following copies remain bounded', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const first = new InstancedMesh(geometry, material, 5000), rest = Array.from({ length: 9 }, () => new InstancedMesh(geometry, material, 1));
  const slices: Object3D[][] = parkedDrawSlices([first, ...rest], ONE_UNIT);
  expect(slices.map(slice => slice.length)).toEqual([1, 8, 1]);
  expect(slices.flat()).toEqual([first, ...rest]);
  geometry.dispose(); material.dispose();
});

// T10: an attribute the memory saver released is on the GPU already; reading its array reads it back from the GPU
test('a released attribute is never read and uploads nothing', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), normal = geometry.getAttribute('normal');
  markArrayReleased(normal);
  Object.defineProperty(normal, 'array', { configurable: true, get: () => { throw new Error('read back a released array'); } });
  const objects = Array.from({ length: 3 }, () => new Mesh(geometry, material));
  expect(parkedDrawSlices(objects, ONE_UNIT).flat()).toEqual(objects);
  material.dispose();
});

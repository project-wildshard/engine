import { expect, test } from 'vitest';
import * as THREE from 'three';
import { installDoubleElements } from './doubleElements';

// plain arrays reach three's fromArray through a double scratch: every value, offset and short array reads as before
test('fromArray reads plain and typed arrays unchanged after the double-elements guard', () => {
  const values = Array.from({ length: 20 }, (_, i) => i * 1.25 - 3);
  const before = { m4: new THREE.Matrix4().fromArray(values, 2).toArray(), m3: new THREE.Matrix3().fromArray(values).toArray(), v3: new THREE.Vector3().fromArray(values, 17).toArray(), typed: new THREE.Matrix4().fromArray(Float32Array.from(values), 4).toArray() };
  installDoubleElements();
  expect(new THREE.Matrix4().fromArray(values, 2).toArray()).toEqual(before.m4);
  expect(new THREE.Matrix3().fromArray(values).toArray()).toEqual(before.m3);
  expect(new THREE.Vector3().fromArray(values, 17).toArray()).toEqual(before.v3);
  expect(new THREE.Matrix4().fromArray(Float32Array.from(values), 4).toArray()).toEqual(before.typed);
  const exact = values.slice(0, 16), matrix = new THREE.Matrix4().fromArray(exact);
  expect(matrix.toArray()).toEqual(exact);
  expect(matrix.clone().elements).toEqual(matrix.elements);
  expect(new THREE.Vector3().fromArray([1, 2]).toArray()).toEqual([1, 2, undefined]);
});

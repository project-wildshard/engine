import { expect, test } from 'vitest';
import * as THREE from 'three';
import { captureScatterSource, instanceBoxes, scatterLayer, type ScatterPose } from './scatterInstances';

const pose = (i: number, extra: Partial<ScatterPose> = {}): ScatterPose => ({ x: i * 7.5 - 40, y: 0.5 * i, z: 30 - i * 11, yaw: i * 0.3, sx: 1 + i * 0.1, sy: 1.2, sz: 0.9,
  far: 40 + i, r: 0.5, g: 0.6 + i * 0.01, b: 0.7, ...(i % 2 === 0 ? { tiltX: 0.1, tiltZ: -0.05 } : {}), ...extra });

// T10: the build writes each instance's matrix, colour, sphere and range directly; the result is the per-row formula's
test('a scatter layer records exactly each row\'s matrix, colour, sphere and range', () => {
  const geometry = new THREE.BoxGeometry(1, 2, 1), material = new THREE.MeshBasicMaterial(), rows = Array.from({ length: 40 }, (_, i) => pose(i));
  const layer = scatterLayer('test', geometry, material, rows, 1.5), source = captureScatterSource(layer.mesh);
  if (source === undefined) throw new Error('Missing scatter source');
  const radius = geometry.boundingSphere?.radius ?? 1, m = new THREE.Matrix4(), expected = new Float32Array(16);
  for (const [i, it] of rows.entries()) {
    m.compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tiltX ?? 0, it.yaw, it.tiltZ ?? 0, 'YXZ')), new THREE.Vector3(it.sx, it.sy, it.sz)).toArray(expected);
    expect([...source.matrices.subarray(i * 16, i * 16 + 16)]).toEqual([...expected]);
    expect([...source.colours.subarray(i * 3, i * 3 + 3)]).toEqual([...Float32Array.of(it.r, it.g, it.b)]);
    expect([...source.spheres.subarray(i * 4, i * 4 + 4)]).toEqual([...Float32Array.of(it.x, it.y, it.z, radius * Math.max(it.sx, it.sy, it.sz))]);
    expect(source.ranges[i]).toBe(Math.fround(it.far * 1.5));
  }
  const boxes = instanceBoxes(geometry, rows), box = new THREE.Box3();
  geometry.computeBoundingBox();
  for (const [i, it] of rows.entries()) {
    box.copy(geometry.boundingBox ?? box).applyMatrix4(m.compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tiltX ?? 0, it.yaw, it.tiltZ ?? 0, 'YXZ')), new THREE.Vector3(it.sx, it.sy, it.sz)));
    expect([...boxes.subarray(i * 6, i * 6 + 6)]).toEqual([...Float32Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)]);
  }
  const empty = new THREE.BufferGeometry(); empty.boundingBox = new THREE.Box3();
  expect([...instanceBoxes(empty, rows.slice(0, 2))]).toEqual([...Float32Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity)]);
  geometry.dispose(); material.dispose();
});

test('a scatter layer refuses the same rows, and culls far-out cells too', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  for (const bad of [{ x: Number.NaN }, { tiltZ: Infinity }, { far: -1 }, { far: 2000 }, { r: Number.NaN }]) expect(() => scatterLayer('bad', geometry, material, [pose(1), pose(2, bad)], 1.5)).toThrow('Invalid scatter rows');
  const far = [pose(1, { x: 1e8, z: 1e8 }), pose(2, { x: 1e8 + 1, z: 1e8 }), pose(3, { x: 0, z: 0 })];
  const layer = scatterLayer('far', geometry, material, far, 1);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(1e8, 0, 1e8 + 5); camera.lookAt(1e8, 0, 1e8); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  layer.cull(frustum, camera.position); expect(layer.visible).toBe(2);
  geometry.dispose(); material.dispose();
});

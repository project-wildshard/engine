import { expect, test } from 'vitest';
import * as THREE from 'three';
import { InstancedCull } from './cull';
import { Forest } from '../world/forest/Forest';
import type { TreeFactory } from '../world/TreeFactory';
import type { SkyRig } from '../world/skyRig';
import { legacyDouble } from '../../../test/engine/FakeGame';

// Independent true-camera frustum coverage: a retained padded choice may draw extra copies, but never omit one
// touching the current frame's edge. This covers an entire pan, not frozen membership at four historical angles.
test.each(['camera', 'forest'] as const)('a full portrait pan retains every visible edge copy (%s view)', driver => {
  const count = 720, matrices = new Float32Array(count * 16), bounds = new Float32Array(count * 4);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count, point = new THREE.Vector3(Math.fround(Math.sin(angle) * 95), 5, Math.fround(Math.cos(angle) * 95));
    points.push(point); new THREE.Matrix4().makeTranslation(point.x, point.y, point.z).toArray(matrices, i * 16);
    bounds.set([point.x, point.y, point.z, 3], i * 4);
  }
  const matrix = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
  const geometry = new THREE.BufferGeometry(), material = new THREE.MeshBasicMaterial(), mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix = matrix;
  const camera = new THREE.PerspectiveCamera(93, 402 / 874, .08, 650); camera.position.set(0, 5, 0);
  const forest = new Forest(legacyDouble<TreeFactory>({ multiDraw: false }), legacyDouble<SkyRig>({ viewCamera: camera, sunDir: new THREE.Vector3(0, 1, 0) }));
  forest.group.updateMatrixWorld(true);
  forest.trees = points.map(point => ({ x: point.x, y: 0, z: point.z, height: 10, r: 1, rot: 0, tint: new THREE.Color(1, 1, 1), scale: 1, variant: 0 }));
  const cull = new InstancedCull([[{ matrix, color: null, meshes: [mesh] }]], 1, new Uint16Array(count), matrices, null, bounds, [0],
    driver === 'forest' ? { view: forest, test: forest.keeps } : {});
  if (driver === 'forest') forest.onViewChange((frustum, eye) => cull.updateWith(frustum, eye));
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(), viewer = new THREE.Vector3();
  let observations = 0;
  try {
    for (let degree = 0; degree <= 360; degree++) {
      camera.rotation.set(0, degree * Math.PI / 180, 0, 'YXZ');
      // Standing drift and a genuine threshold-crossing translation are both covered during the turn.
      camera.position.x = degree < 180 ? .8 * Math.sin(degree / 20) : 1.6;
      camera.updateMatrixWorld(true); viewer.copy(camera.position);
      if (driver === 'forest') forest.update(0, viewer); else cull.update(camera);
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const drawn = new Set<string>();
      for (let at = 0; at < mesh.count; at++) drawn.add(`${String(matrix.array[at * 16 + 12])}:${String(matrix.array[at * 16 + 14])}`);
      let missing = 0;
      for (const point of points) {
        sphere.center.copy(point); sphere.radius = 3;
        if (frustum.intersectsSphere(sphere)) { observations++; if (!drawn.has(`${String(point.x)}:${String(point.z)}`)) missing++; }
      }
      expect(missing).toBe(0);
    }
    expect(observations).toBeGreaterThan(count);
  } finally { geometry.dispose(); material.dispose(); }
});

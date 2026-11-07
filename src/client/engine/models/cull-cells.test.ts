import { expect, test } from 'vitest';
import * as THREE from 'three';
import { InstancedCull, type InstancedSink } from './cull';

// G639: an instanced culler buckets its copies into squares and rejects a square wholly out of range, or past keepNear
// and out of view, before testing its copies. The copies drawn, their levels and their order are exactly the per-copy
// choice's (a copy's sphere lies inside its square's box).
test('square pre-rejection draws exactly the per-copy choice, in copy order', () => {
  let seed = 7;
  const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const n = 2000, far = 120, keepNear = 10, lod = 40;
  const matrices = new Float32Array(n * 16), bounds = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = (random() - 0.5) * 400, y = random() * 60, z = (random() - 0.5) * 400, r = 0.5 + random() * 4;
    new THREE.Matrix4().makeTranslation(x, y, z).toArray(matrices, i * 16);
    bounds.set([x, y, z, r], i * 4);
  }
  const sink = (): InstancedSink => {
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), n); mesh.instanceMatrix = matrix;
    return { matrix, color: null, meshes: [mesh] };
  };
  const levels = [sink(), sink()], copyAt = new Map(Array.from({ length: n }, (_, i) => [`${String(bounds[i * 4])},${String(bounds[i * 4 + 2])}`, i]));
  const cull = new InstancedCull(levels.map(level => [level]), 2, new Uint16Array(n), matrices, null, bounds, [0, lod], { far, keepNear, view: { onViewChange: () => undefined } });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000), frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  for (let pose = 0; pose < 60; pose++) {
    camera.position.set((random() - 0.5) * 300, random() * 70, (random() - 0.5) * 300);
    camera.rotation.set((random() - 0.5) * 1.2, random() * Math.PI * 2, 0, 'YXZ'); camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    cull.updateWith(frustum, camera.position);
    const expected: number[][] = [[], []];
    for (let i = 0; i < n; i++) {
      const x = bounds[i * 4] ?? 0, y = bounds[i * 4 + 1] ?? 0, z = bounds[i * 4 + 2] ?? 0, d2 = camera.position.distanceToSquared(new THREE.Vector3(x, y, z));
      if (d2 > far * far) continue;
      sphere.center.set(x, y, z); sphere.radius = bounds[i * 4 + 3] ?? 0;
      if (d2 > keepNear * keepNear && !frustum.intersectsSphere(sphere)) continue;
      expected[d2 >= lod * lod ? 1 : 0]?.push(i);
    }
    const drawn = levels.map(level => {
      const count = level.meshes[0]?.count ?? 0, out: number[] = [];
      for (let k = 0; k < count; k++) {
        const x = level.matrix.array[k * 16 + 12] ?? 0, z = level.matrix.array[k * 16 + 14] ?? 0;
        out.push(copyAt.get(`${String(x)},${String(z)}`) ?? -1);
      }
      return out;
    });
    expect(drawn).toEqual(expected);
  }
});

import { expect, test } from 'vitest';
import * as THREE from 'three';
import { CelledCopiesCull } from './cull';

// Tile streaming P4: a forest floor's celled cull keeps only the copies its `test` keeps (a tile ring), after its own cell
// and range tests.
test('a celled cull draws only the copies its test keeps', () => {
  const n = 40, mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), n);
  const origins = new Float32Array(n * 3), matrices = new Float32Array(n * 16), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const x = -100 + i * 5; origins.set([x, 0, 0], i * 3); m.makeTranslation(x, 0, 0).toArray(matrices, i * 16); }
  const run = (keep?: (i: number, d2: number) => boolean): number => {
    const cull = new CelledCopiesCull([[{ matrix: mesh.instanceMatrix, color: null, meshes: [mesh] }]], 1, new Uint16Array(n), matrices, null, origins, [0],
      { cells: { size: 20, pad: 1 }, far: 1000, ...(keep === undefined ? {} : { test: keep }) });
    const camera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, -1000, 1000); camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    cull.updateWith(frustum, new THREE.Vector3(0, 0, 0));
    return mesh.count;
  };
  expect(run()).toBe(n);
  expect(run((i) => (origins[i * 3] ?? 0) < 0)).toBe(20);   // the copies at x < 0
});

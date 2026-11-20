import { expect, test } from 'vitest';
import * as THREE from 'three';
import { CelledBatchCull, CelledCopiesCull, type BatchedSlot } from './cull';

// DF10 (mini-df10c): the cove's cover drawn as one batch keeps the instanced draw's cells. A celled batch cull shows the
// same copies the celled instanced cull writes, and touches only the instances whose choice changed.
test('a celled batch cull shows the copies the instanced celled cull draws, touching only changes', () => {
  const n = 60, origins = new Float32Array(n * 3), matrices = new Float32Array(n * 16), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const x = -150 + i * 5, z = (i % 7) * 9 - 30; origins.set([x, 0, z], i * 3); m.makeTranslation(x, 0, z).toArray(matrices, i * 16); }
  const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), n);
  const o = { cells: { size: 20, pad: 1 }, far: 60 };
  const instanced = new CelledCopiesCull([[{ matrix: mesh.instanceMatrix, color: null, meshes: [mesh] }]], 1, new Uint16Array(n), matrices, null, origins, [0], o);
  const visible = Array.from({ length: n }, () => true), writes: number[] = [];
  const sink = { setGeometryIdAt: () => undefined, setVisibleAt: (i: number, shown: boolean) => { visible[i] = shown; writes.push(i); } };
  const slots: BatchedSlot[] = Array.from({ length: n }, (_, i) => ({ mesh: sink, instance: i, geometry: Int32Array.of(0), until2: null }));
  const batched = new CelledBatchCull(slots, Uint32Array.from({ length: n + 1 }, (_, i) => i), origins, [0], o);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  const look = (eye: THREE.Vector3, at: THREE.Vector3): { drawn: number; shown: number } => {
    camera.position.copy(eye); camera.lookAt(at); camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    instanced.updateWith(frustum, eye); batched.updateWith(frustum, eye);
    return { drawn: mesh.count, shown: visible.filter(Boolean).length };
  };
  const first = look(new THREE.Vector3(0, 5, 0), new THREE.Vector3(100, 0, 0));
  expect(first.shown).toBe(first.drawn);
  expect(first.drawn).toBeGreaterThan(0); expect(first.drawn).toBeLessThan(n);
  writes.length = 0;
  const again = look(new THREE.Vector3(0, 5, 0), new THREE.Vector3(100, 0, 0));
  expect(again.shown).toBe(first.shown); expect(writes).toHaveLength(0);   // the same view touches nothing
  const turned = look(new THREE.Vector3(0, 5, 0), new THREE.Vector3(-100, 0, 0));
  expect(turned.shown).toBe(turned.drawn);
  expect(writes.length).toBeGreaterThan(0);
});

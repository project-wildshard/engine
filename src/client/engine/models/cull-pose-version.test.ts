import { expect, test } from 'vitest';
import * as THREE from 'three';
import { UntilCull, cullFresh } from './cull';

// Inside a cullFresh pass a view that already decided for the camera at the same pose keeps its choice without comparing the
// matrices again: the same decisions as outside a pass, through holds, real moves, turns and a second camera.
test('a pass keeps a view\'s choice while the camera is unchanged and re-chooses on any change', () => {
  const part = new THREE.Object3D(), other = new THREE.Object3D();
  const cull = new UntilCull([part], new Float32Array([10]), new Uint32Array([0]), new Float32Array([0, 0, 0]));
  const plain = new UntilCull([other], new Float32Array([10]), new Uint32Array([0]), new Float32Array([0, 0, 0]));
  const camera = new THREE.PerspectiveCamera(), second = new THREE.PerspectiveCamera();
  const at = (z: number, view: THREE.Camera = camera): void => {
    view.position.z = z; view.updateMatrixWorld();
    cullFresh(view, () => { cull.update(view); }); plain.update(view);
    expect(part.visible).toBe(other.visible);
  };
  at(9.995); expect(part.visible).toBe(true);
  at(9.995); at(9.995); expect(part.visible).toBe(true);
  at(10.005); expect(part.visible).toBe(true);
  camera.rotation.y = 0.001; at(10.005); expect(part.visible).toBe(false);
  at(10.005); expect(part.visible).toBe(false);
  at(9.98); expect(part.visible).toBe(true);
  // another camera at the same pose is a different view input
  second.rotation.y = 0.001; at(30, second); expect(part.visible).toBe(false);
  at(9.98); expect(part.visible).toBe(true);
  // a projection change re-chooses too
  camera.fov = 20; camera.updateProjectionMatrix(); at(9.98); expect(part.visible).toBe(true);
});

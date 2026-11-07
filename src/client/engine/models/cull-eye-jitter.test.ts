import { expect, test } from 'vitest';
import * as THREE from 'three';
import { UntilCull } from './cull';

// A standing player's camera settles by tenths of a millimetre every frame; the cullers keep the copies chosen for the
// last view through any shift under 2 cm (no turn, no zoom), and re-choose on a real move or a turn.
test('a sub-2 cm eye shift keeps the last choice; a real move or a turn re-chooses', () => {
  const part = new THREE.Object3D();
  // the part shows while the eye is within 10 m of the origin at (0, 0, 0)
  const cull = new UntilCull([part], new Float32Array([10]), new Uint32Array([0]), new Float32Array([0, 0, 0]));
  const camera = new THREE.PerspectiveCamera();
  const at = (z: number): void => { camera.position.z = z; camera.updateMatrixWorld(); cull.update(camera); };
  at(9.995);
  expect(part.visible).toBe(true);
  // 1 cm from the chosen view and past the 10 m band: the view it was chosen for holds
  at(10.005);
  expect(part.visible).toBe(true);
  // a turn re-chooses at once, from where the eye now is
  camera.rotation.y = 0.001; at(10.005);
  expect(part.visible).toBe(false);
  // back inside by 1.5 cm: held; 2.5 cm from the chosen view: re-chosen
  at(9.99);
  expect(part.visible).toBe(false);
  at(9.98);
  expect(part.visible).toBe(true);
});

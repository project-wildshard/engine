import { expect, test } from 'vitest';
import { BoxGeometry, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { cullCopiesPerCascade, duringShadowPass, installCascadeCull } from '../src/client/engine/world/cascadeCull';

/** D12: an instanced caster draws into a cascade only when one of its copies is in that cascade's slice footprint */
function rig(): { csm: CSM; near: () => Frustum } {
  const camera = new PerspectiveCamera(62, 402 / 681, .1, 400), csm = new CSM({ camera, parent: new Group(), cascades: 3,
    maxFar: 180, mode: 'practical', lightDirection: new Vector3(-.3, -1, -.2), shadowMapSize: 1024 });
  installCascadeCull(csm, camera);
  camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10); camera.updateMatrixWorld(true);
  csm.updateFrustums(); csm.update();
  const light = csm.lights[0];
  if (light === undefined) throw new Error('Missing near cascade');
  light.updateMatrixWorld(true); light.target.updateMatrixWorld(true); light.shadow.updateMatrices(light);
  return { csm, near: () => light.shadow.getFrustum() };
}
function copies(at: readonly (readonly [number, number, number])[]): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial(), Math.max(1, at.length));
  at.forEach(([x, y, z], i) => { mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, y, z)); });
  mesh.count = at.length; mesh.updateMatrixWorld(true);
  return mesh;
}

test('copies far to both sides leave the near cascade although their sphere spans it', () => {
  const { near } = rig(), mesh = copies([[-120, 0, -120], [120, 0, -120], [-120, 0, 120], [120, 0, 120]]);
  const frustum = near(), box = Frustum.prototype.intersectsObject.call(frustum, mesh);
  expect(box).toBe(true); // three's own test: one sphere round every copy
  expect(frustum.intersectsObject(mesh)).toBe(false);
  Reflect.set(frustum, 'off', true);
  expect(frustum.intersectsObject(mesh)).toBe(true); // the A/B switch keeps three's verdict
});

test('one copy in the slice draws them all, a moved copy is seen and an empty mesh never draws', () => {
  const { near } = rig(), mesh = copies([[-120, 0, -120], [0, 1, -3], [120, 0, 120]]);
  expect(near().intersectsObject(mesh)).toBe(true);
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(140, 0, 0)); mesh.instanceMatrix.needsUpdate = true;
  expect(near().intersectsObject(mesh)).toBe(false);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, -4)); mesh.instanceMatrix.needsUpdate = true;
  expect(near().intersectsObject(mesh)).toBe(true);
  mesh.count = 0;
  expect(near().intersectsObject(mesh)).toBe(false);
});

test('a copy-culled caster reports frustum culling only inside a shadow pass, and only a cascade culls it', () => {
  const { near } = rig(), mesh = copies([[-120, 0, -120], [120, 0, 120]]);
  mesh.frustumCulled = false; cullCopiesPerCascade(mesh);
  expect(mesh.frustumCulled).toBe(false);
  const seen: boolean[] = [];
  duringShadowPass(() => { seen.push(mesh.frustumCulled, mesh.intersectsFrustum(near()), mesh.intersectsFrustum(new Frustum())); });
  expect(seen).toEqual([true, false, true]); // culled by the cascade; any other light's frustum draws it as before
  expect(mesh.frustumCulled).toBe(false);
  mesh.frustumCulled = true;
  expect(mesh.frustumCulled).toBe(true);
});

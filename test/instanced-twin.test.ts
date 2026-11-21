import { expect, test } from 'vitest';
import * as THREE from 'three';
import { instancedMaterial } from '../src/client/engine/render/instancedTwin';
import { LIGHT_UNIFORMS } from '../src/client/engine/render/lightUniforms';

test('a classic material\'s instanced twin reads the material live, files its own program state and goes with it', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.4 });
  const twin = instancedMaterial(material);
  expect(twin).not.toBe(material);
  expect(instancedMaterial(material)).toBe(twin); // one twin a material
  expect(instancedMaterial(twin)).toBe(twin); // a twin has no twin of its own
  expect(Object.getPrototypeOf(twin)).toBe(material);
  expect(twin).toBeInstanceOf(THREE.MeshStandardMaterial);
  // every field is the material's, live
  material.roughness = 0.9; material.emissiveIntensity = 3; material.color.setHex(0xff0000);
  expect(twin instanceof THREE.MeshStandardMaterial ? [twin.roughness, twin.emissiveIntensity, twin.color.getHex()] : []).toEqual([0.9, 3, 0xff0000]);
  // a version bump on either reaches both
  const before = material.version; twin.needsUpdate = true;
  expect([material.version, twin.version]).toEqual([before + 1, before + 1]);
  material.needsUpdate = true; expect(twin.version).toBe(before + 2);
  // its own events: disposing the twin alone leaves the material's listeners untouched
  let materialDisposed = 0; material.addEventListener('dispose', () => { materialDisposed++; });
  let twinDisposed = 0; twin.addEventListener('dispose', () => { twinDisposed++; });
  material.dispose();
  expect([materialDisposed, twinDisposed]).toEqual([1, 1]); // the twin goes with its material
  expect(instancedMaterial(material)).not.toBe(twin); // a disposed twin is forgotten
});

// DF10 (mini-df10d): a shader material's twin shares every uniform but the light holders. three points those at the arrays
// of the render state that last selected a program; shared, a precompile of the material left the twin's draws unlit.
test('a shader twin reads the material uniforms and holds its own light uniforms', () => {
  const material = new THREE.ShaderMaterial({ lights: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, { tint: { value: 1 } }]) });
  const twin = instancedMaterial(material);
  if (!(twin instanceof THREE.ShaderMaterial)) throw new Error('the twin of a shader material is one');
  expect(twin.uniforms['tint']).toBe(material.uniforms['tint']);
  for (const name of LIGHT_UNIFORMS) {
    expect(twin.uniforms[name]).toBeDefined();
    expect(twin.uniforms[name]).not.toBe(material.uniforms[name]);
  }
  // three's program bind repoints the holders at a render state's arrays: the material's precompile leaves the twin's be
  const live = [{ direction: new THREE.Vector3(0, 1, 0) }], stale = [{ direction: new THREE.Vector3() }];
  const twinLights = twin.uniforms['directionalLights'], materialLights = material.uniforms['directionalLights'];
  if (twinLights === undefined || materialLights === undefined) throw new Error('lit uniforms');
  twinLights.value = live; materialLights.value = stale;
  expect(twin.uniforms['directionalLights']?.value).toBe(live);
  // a uniform the material gains later reads through, and a replaced uniform map is followed
  material.uniforms['late'] = { value: 2 };
  expect(twin.uniforms['late']).toBe(material.uniforms['late']);
  material.uniforms = { other: { value: 3 }, directionalLights: { value: stale } };
  expect(twin.uniforms['other']).toBe(material.uniforms['other']);
  expect(twin.uniforms['directionalLights']).not.toBe(material.uniforms['directionalLights']);
  material.dispose();
});

test('a classic twin of a non-shader material has no uniforms of its own', () => {
  const material = new THREE.MeshStandardMaterial();
  const twin = instancedMaterial(material);
  expect(Object.hasOwn(twin, 'uniforms')).toBe(false);
  material.dispose();
});

import { expect, test } from 'vitest';
import * as THREE from 'three';
import { instancedMaterial } from '../src/client/engine/render/instancedTwin';

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

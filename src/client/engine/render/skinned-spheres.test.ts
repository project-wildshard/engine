import { expect, test } from 'vitest';
import * as THREE from 'three';
import { installSkinnedSortSpheres } from './skinnedSpheres';

// an unculled skinned mesh's sphere is its bones' centroid with no bound (no CPU skinning); a culled one keeps three's
test('unculled skinned meshes sort by their bones without skinning, culled ones keep the exact sphere', () => {
  installSkinnedSortSpheres();
  const geometry = new THREE.BoxGeometry(1, 1, 1), count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => i % 4 === 0 ? 1 : 0), 4));
  const make = (culled: boolean): THREE.SkinnedMesh => {
    const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); mesh.frustumCulled = culled;
    bone.position.set(10, 0, 0); mesh.updateMatrixWorld(true);
    return mesh;
  };
  const free = make(false);
  free.computeBoundingSphere();
  expect(free.boundingSphere?.center.toArray()).toEqual([10, 0, 0]);
  expect(free.boundingSphere?.radius).toBe(Infinity);
  const culled = make(true);
  culled.computeBoundingSphere();
  expect(Math.abs((culled.boundingSphere?.center.x ?? 0) - 10)).toBeLessThan(0.5); // three's sphere grows point by point, not minimal
  expect(culled.boundingSphere?.radius).toBeLessThan(2);
  geometry.dispose();
});

import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Terrain } from './Terrain';

// Tile streaming P2: once its tiles draw the ground, the whole terrain mesh is disposed (the slab, which no tile carries,
// stays) and an empty invisible mesh stands in, so the canopy, punch and wear calls still find a mesh. Once.
test('the whole ground retires to an empty invisible mesh, disposing what it drew', () => {
  const terrain = new Terrain(), disposed: string[] = [];
  const mesh = (name: string): THREE.Mesh => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
    const material = new THREE.MeshStandardMaterial();
    geometry.addEventListener('dispose', () => { disposed.push(`${name}.geometry`); });
    material.addEventListener('dispose', () => { disposed.push(`${name}.material`); });
    const made = new THREE.Mesh(geometry, material); made.name = name; return made;
  };
  const ground = mesh('ground'), slab = mesh('slab');
  terrain.mesh = ground; terrain.group.add(ground, slab);
  terrain.retireMesh();
  expect(disposed.sort()).toEqual(['ground.geometry', 'ground.material']);
  expect(terrain.group.children).toEqual([slab, terrain.mesh]);
  expect(terrain.mesh.visible).toBe(false);
  expect(terrain.mesh.geometry.getAttribute('position').count).toBe(0);
  const stand = terrain.mesh; terrain.retireMesh();
  expect(terrain.mesh).toBe(stand); // once
});

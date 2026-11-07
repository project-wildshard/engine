import { expect, test } from 'vitest';
import * as THREE from 'three';
import { admitObjectDraw } from './drawGuards';

// an instanced draw of no instances puts no pixel: refused before three switches programs and uploads uniforms; its fields
// stay its owners'
test('an instanced mesh with no instances is not drawn, with one it is', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const instances = new THREE.InstancedMesh(geometry, material, 4), plain = new THREE.Mesh(geometry, material), group = { start: 0, count: 0, materialIndex: 0 };
  try {
    instances.count = 0;
    expect(admitObjectDraw(camera, scene, geometry, material, instances, group)).toBe(false);
    expect(instances.visible).toBe(true); expect(instances.count).toBe(0);
    instances.count = 1;
    expect(admitObjectDraw(camera, scene, geometry, material, instances, group)).toBe(true);
    expect(admitObjectDraw(camera, scene, geometry, material, plain, group)).toBe(true);
  } finally { instances.dispose(); geometry.dispose(); material.dispose(); }
});

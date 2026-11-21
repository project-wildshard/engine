import { expect, test } from 'vitest';
import * as THREE from 'three';
import { admitObjectDraw, skipEmptyBatches } from './drawGuards';

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

// DF8 (`debug.programFold`): a batch whose culling left no copy draws nothing, so it is refused before its program is looked up
test('a batched mesh with no copy to draw is refused only with the fold on', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const batch = new THREE.BatchedMesh(2, 64, 64, material), group = { start: 0, count: 0, materialIndex: 0 };
  try {
    batch.addInstance(batch.addGeometry(geometry));
    Reflect.set(batch, '_multiDrawCount', 0);
    expect(admitObjectDraw(camera, scene, geometry, material, batch, group)).toBe(true);
    skipEmptyBatches(true);
    expect(admitObjectDraw(camera, scene, geometry, material, batch, group)).toBe(false);
    Reflect.set(batch, '_multiDrawCount', 1);
    expect(admitObjectDraw(camera, scene, geometry, material, batch, group)).toBe(true);
  } finally { skipEmptyBatches(false); batch.dispose(); geometry.dispose(); material.dispose(); }
});

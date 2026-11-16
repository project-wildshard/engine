// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { BoxGeometry, InstancedMesh, MeshStandardMaterial, PerspectiveCamera, Vector3, type Object3D } from 'three';
import { defineModel, modelContext } from './model';
import { place } from './place';
import { withTier } from '../explore/tiers';
import { TIER_TABLE } from '../render/tiers';

/** NINE-DRAGON-BENCHMAX NB5: the phone's placed LODs start at `placedLodScale` of the authored distance; the desktop keeps them. */
function placedAt(tier: 'phone' | 'desktop', tierScaled?: false) {
  const material = new MeshStandardMaterial(), near = new BoxGeometry(1, 1, 1), far = new BoxGeometry(1, 2, 1);
  const def = defineModel<{ v: number }>({ id: 'test/tier-lods', name: 'Tier LODs', file: 'src/client/engine/models/place-tier-lods.test.ts', category: 'props', pipeline: 'code',
    defaults: { v: 0 }, variants: [], build: () => [{ geometry: near, material }], lods: [{ from: 20, ...(tierScaled === false ? { tierScaled } : {}), build: () => [{ geometry: far, material }] }] });
  // one copy 15 m ahead: inside the authored 20 m, past the phone's 12 m
  const placed = withTier(tier, () => place(def, [{ x: 0, y: 0, z: -15 }], { ctx: modelContext(null), draw: 'instanced', registry: null, cull: {} }));
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000); camera.lookAt(new Vector3(0, 0, -1)); camera.updateMatrixWorld(true);
  placed.cull(camera);
  const drawn: string[] = [];
  placed.object.traverse((o: Object3D) => { if (o instanceof InstancedMesh && o.count > 0) drawn.push(o.name.slice(-2)); });
  material.dispose();
  return drawn;
}

test('the phone tier switches a placed copy to its LOD nearer; the desktop draws it at the authored distance', () => {
  expect(TIER_TABLE.desktop.placedLodScale).toBe(1);
  expect(TIER_TABLE.phone.placedLodScale).toBeLessThan(1);
  expect(placedAt('desktop')).toEqual([':0']);
  expect(placedAt('phone')).toEqual([':1']);
});

test('a level that keeps its authored distances (the forest tree set: its shaders fade on them) switches there on the phone too', () => {
  expect(placedAt('phone', false)).toEqual([':0']);
  expect(placedAt('desktop', false)).toEqual([':0']);
});

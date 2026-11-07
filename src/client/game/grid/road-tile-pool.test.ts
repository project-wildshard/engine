import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshBasicMaterial, Sphere } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { RingTile } from '@wildshard/engine/world/tileStreamer';
import { finishRoadSteps, type RoadCuller } from './roadCull';
import type { RoadTileGeometry } from './roadTileGeometry';
import { mergeRoadTileSteps, RoadTilePool, roadTileWorkingBytes } from './roadTilePool';

function fixture(x: number): RoadTileGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([x, 0, 0, x + 1, 0, 0, x, 0, 1]), 3));
  const source = Uint32Array.from([0, 1, 2]); geometry.setIndex(new BufferAttribute(source, 1));
  return { geometry, plan: { source, lod: [], bins: [{ sphere: new Sphere(undefined, 1), start: 0, count: 3, levels: [], tile: { x, z: 0 } }] },
    bytes: { jsBytes: 60, gpuBytes: 48 } };
}
const descriptor = (instance: string): RingTile => ({ key: `${instance}:l0:0,0`, instance, level: 'l0', x: 0, z: 0, type: 'road' });

test('resident road geometry merges and rebases without retaining source arrays', () => {
  const a = fixture(0), b = fixture(10), merged = finishRoadSteps(mergeRoadTileSteps([a, b]));
  expect(Array.from(merged.plan.source)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(merged.plan.bins.map(bin => bin.start)).toEqual([0, 3]);
  a.geometry.getAttribute('position').setX(0, 500);
  expect(merged.geometry.getAttribute('position').getX(0)).toBe(0);
  expect(merged.geometry.getAttribute('position').getX(3)).toBe(10);
  a.geometry.dispose(); b.geometry.dispose(); merged.geometry.dispose();
});

test('pool keeps one material draw and retirement removes only the owned generation', () => {
  const owner = new Scope('road pool'), material = new MeshBasicMaterial(), culler: RoadCuller = { pitch: 562.5, tileSize: 62.5, plans: new Map() };
  const pool = new RoadTilePool(owner, material, culler, 'road'), a = fixture(0), b = fixture(10);
  const one = owner.child('one'), two = owner.child('two'); one.own(a.geometry); two.own(b.geometry);
  const first = pool.publish(descriptor('a'), a, one), second = pool.publish(descriptor('b'), b, two);
  expect(pool.root.children).toHaveLength(1); expect(culler.plans.size).toBe(1);
  expect(pool.mesh().geometry.getAttribute('position').count).toBe(6);
  first.dispose();
  expect(pool.mesh().geometry.getAttribute('position').count).toBe(3);
  expect(pool.mesh().geometry.getAttribute('position').getX(0)).toBe(10);
  first.dispose(); expect(culler.plans.size).toBe(1);
  second.dispose(); expect(culler.plans.get(pool.mesh())?.bins).toHaveLength(0);
  expect(() => pool.publish(descriptor('dead'), a, one)).toThrow('owner retired');
  owner.dispose(); expect(culler.plans.size).toBe(0); material.dispose();
});

test('replacement working bytes are explicitly budgeted and incompatible layouts refuse', () => {
  const a = fixture(0), b = fixture(10);
  expect(roadTileWorkingBytes(a.bytes)).toBe(360);
  expect(() => roadTileWorkingBytes({ jsBytes: -1, gpuBytes: 0 })).toThrow('working bytes');
  b.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  expect(() => finishRoadSteps(mergeRoadTileSteps([a, b]))).toThrow('Incompatible resident');
  a.geometry.dispose(); b.geometry.dispose();
});

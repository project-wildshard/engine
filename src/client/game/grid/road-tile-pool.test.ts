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

test('a merge keeps normalized bytes across copy chunks and rejects a released channel', () => {
  const a = fixture(0), b = fixture(10), vertices = 11_000;
  for (const [tile, fill] of [[a, 13], [b, 241]] as const) {
    tile.geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
    tile.geometry.setAttribute('color', new BufferAttribute(new Uint8Array(vertices * 3).fill(fill), 3, true));
  }
  const merged = finishRoadSteps(mergeRoadTileSteps([a, b]));
  const color = merged.geometry.getAttribute('color');
  expect(color.normalized).toBe(true);
  expect(color.array).toBeInstanceOf(Uint8Array);
  expect(color.array).toEqual(Uint8Array.from({ length: vertices * 6 }, (_, i) => i < vertices * 3 ? 13 : 241));
  const released = b.geometry.getAttribute('color');
  if (!(released instanceof BufferAttribute)) throw new Error('Expected packed color');
  released.array = released.array.slice(0, 0);
  expect(() => finishRoadSteps(mergeRoadTileSteps([a, b]))).toThrow('Missing road tile attribute values');
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

// ZE2d: three links a program in `setProgram` before it reads the draw count, so an empty pool (none of its tiles resident:
// at boot, or once the camera leaves every tile of it on the road) linked a position-less, flat-shaded variant of its
// material, once per lighting state, 133 to 167 ms each walking back into Nalati
test('a pool with no resident tile draws nothing', () => {
  const owner = new Scope('road pool'), material = new MeshBasicMaterial(), culler: RoadCuller = { pitch: 562.5, tileSize: 62.5, plans: new Map() };
  const pool = new RoadTilePool(owner, material, culler, 'road'), a = fixture(0), one = owner.child('one'); one.own(a.geometry);
  expect(pool.mesh().visible).toBe(false);
  const view = pool.publish(descriptor('a'), a, one);
  expect(pool.mesh().visible).toBe(true);
  view.dispose();
  expect(pool.mesh().geometry.getAttribute('position')).toBeUndefined();
  expect(pool.mesh().visible).toBe(false);
  owner.dispose(); material.dispose();
});

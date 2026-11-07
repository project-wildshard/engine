import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Sphere } from 'three';
import { finishRoadSteps, type CullPlan } from './roadCull';
import { compactRoadTileSteps } from './roadTileGeometry';

function fixture(): { source: BufferGeometry; plan: CullPlan } {
  const source = new BufferGeometry();
  source.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 900, 0, 900]), 3));
  source.setAttribute('uv', new BufferAttribute(Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1, 900, 900]), 2));
  source.setAttribute('color', new BufferAttribute(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0]), 4, true));
  return { source, plan: { source: Uint32Array.from([0, 1, 2, 2, 1, 3, 0, 2, 3]), lod: [150], bins: [
    { sphere: new Sphere(undefined, 1), start: 0, count: 6, levels: [{ start: 6, count: 3 }], tile: { x: -1, z: 2 } },
  ] } };
}

test('a compact road tile owns only referenced vertices and every LOD run', () => {
  const { source, plan } = fixture();
  const tile = finishRoadSteps(compactRoadTileSteps(source, plan, -1, 2));
  const position = tile.geometry.getAttribute('position'), colour = tile.geometry.getAttribute('color');
  expect(position.count).toBe(4);
  expect(Array.from(tile.plan.source)).toEqual(Array.from(plan.source));
  expect(tile.plan.bins[0]?.levels).toEqual([{ start: 6, count: 3 }]);
  expect(tile.geometry.drawRange).toEqual({ start: 0, count: 6 });
  expect(colour.normalized).toBe(true); expect(colour.array).toBeInstanceOf(Uint8Array);
  expect(tile.bytes).toEqual({ jsBytes: 168, gpuBytes: 132 });
  source.getAttribute('position').setX(0, 100);
  plan.source.fill(4);
  expect(position.getX(0)).toBe(0); expect(tile.plan.source[0]).toBe(0);
  position.setX(1, 50);
  expect(source.getAttribute('position').getX(1)).toBe(1);
  tile.geometry.dispose(); source.dispose();
});

test('missing tiles and invalid index runs refuse without changing source arrays', () => {
  const { source, plan } = fixture(), before = Array.from(source.getAttribute('position').array);
  expect(() => finishRoadSteps(compactRoadTileSteps(source, plan, 8, 2))).toThrow('Missing road tile');
  const invalid: CullPlan = { ...plan, bins: [{ sphere: new Sphere(undefined, 1), start: 0, count: 12, levels: [], tile: { x: -1, z: 2 } }] };
  expect(() => finishRoadSteps(compactRoadTileSteps(source, invalid, -1, 2))).toThrow('Invalid road tile index range');
  const cancelled = compactRoadTileSteps(source, plan, -1, 2);
  expect(cancelled.next().done).toBe(false);
  expect(() => cancelled.throw(new Error('Tile cancelled'))).toThrow('Tile cancelled');
  expect(Array.from(source.getAttribute('position').array)).toEqual(before);
  source.dispose();
});

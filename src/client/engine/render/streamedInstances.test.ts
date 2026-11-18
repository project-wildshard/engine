import { BufferGeometry, Group, InstancedBufferAttribute, MeshBasicMaterial } from 'three';
import { expect, it } from 'vitest';
import { instanceTier } from './streamedInstances';

it('uploads normalized instance bytes and float channels under one byte budget', () => {
  const geometry = new BufferGeometry(), material = new MeshBasicMaterial();
  const tier = instanceTier(new Group(), 'fixture', geometry, material, 4, [
    { name: 'rgb', size: 3, normalizedBytes: true }, { name: 'normal', size: 4 },
  ], { coloured: true });
  tier.begin();
  const [rgb, normal] = tier.arrays().attrs;
  if (!(rgb instanceof Uint8Array) || !(normal instanceof Float32Array)) throw new Error('Wrong channel storage');
  rgb.set([0, 127, 255, 18, 124, 186]);
  normal.set([0, 1, 0, 0.5]);
  const channel = tier.back.geometry.getAttribute('rgb');
  if (!(channel instanceof InstancedBufferAttribute)) throw new Error('Missing native instance attribute');
  expect(channel.getX(0)).toBe(0);
  expect(channel.getY(0)).toBe(127 / 255);
  expect(channel.getZ(0)).toBe(1);
  tier.n = 2;
  expect(tier.bytesPer).toBe(95);
  expect(tier.upload(94)).toBe(0);
  expect(tier.upload(95)).toBe(95);
  expect(tier.uploaded).toBe(false);
  expect(tier.upload(95)).toBe(95);
  expect(channel.updateRanges).toEqual([{ start: 0, count: 3 }, { start: 3, count: 3 }]);
  tier.swap();
  expect(tier.shown.count).toBe(2);
  for (const mesh of tier.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
  material.dispose();
});

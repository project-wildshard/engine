import { BufferGeometry, Group, InstancedBufferAttribute, Matrix4, MeshBasicMaterial } from 'three';
import { expect, it } from 'vitest';
import { instanceTier } from './streamedInstances';
import { Scope } from '../../../shared/engine/app/scope';
import { GraphShaderMaterial } from './graph/glslMaterial';

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

it('keeps exact yaw-scale transforms for native reads and stand-ins', () => {
  const owner = new Scope('cover fixture'), geometry = new BufferGeometry(), material = new GraphShaderMaterial();
  const tier = instanceTier(new Group(), 'fixture', geometry, material, 2, [], { yawScaleOwner: owner });
  tier.begin();
  const packed = tier.arrays().yawScale;
  if (packed === null) throw new Error('Missing packed streams');
  packed[0].set([25.125, 1.25, -107.1875, 30, 0, 5]);
  packed[1].set([0.75, 1.25, 1, -0.75, 1.25, -1]);
  tier.n = 2;
  expect(tier.bytesPer).toBe(24);
  expect(tier.upload(48)).toBe(48);
  tier.swap();
  expect(tier.shown.instanceMatrix.array.byteLength).toBe(0);
  const poses = new Matrix4();
  for (const mesh of [tier.shown, tier.shown.clone(false)]) {
    mesh.getMatrixAt(0, poses);
    expect(poses.elements).toEqual([0.75, 0, -1, 0, 0, 1.25, 0, 0, 1, 0, 0.75, 0, 25.125, 1.25, -107.1875, 1]);
    mesh.getMatrixAt(1, poses);
    expect(poses.elements).toEqual([-0.75, 0, 1, 0, 0, 1.25, 0, 0, -1, 0, -0.75, 0, 30, 0, 5, 1]);
  }
  for (const mesh of tier.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
  material.dispose(); owner.dispose();
});

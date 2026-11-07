import { expect, test } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, InterleavedBufferAttribute, Matrix4, MeshBasicMaterial } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { PosedBufferPool } from '../src/client/game/looks/posedBufferPool';
import { PosedInstances } from '../src/client/game/looks/posedInstances';

test('separate draws share uploads while every CPU and GPU matrix and lane remains exact', () => {
  const scope = new Scope('posed-pool'), pool = new PosedBufferPool(scope, 5);
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const material = new MeshBasicMaterial(), channels = ['aAnim', 'aAnim2'] as const;
  const wildlife = new PosedInstances(3, 'wildlife', material, () => geometry, channels, pool);
  const guide = new PosedInstances(2, 'guide', material, () => geometry, channels, pool);
  const controls = [3, 2].map(capacity => new PosedInstances(capacity, 'control', material, () => geometry, channels));
  guide.mesh.receiveShadow = false;
  try {
    const cpuVersions = [wildlife, guide].map(draw => draw.mesh.instanceMatrix.version);
    for (let frame = 0; frame < 30; frame++) {
      for (const [owner, draw] of [wildlife, guide].entries()) {
        const control = controls[owner]; if (control === undefined) throw new Error('Missing control');
        draw.begin(); control.begin();
        for (let i = 0; i < draw.capacity; i++) {
          const args = [frame + owner + i, i, -frame, frame / 20, -frame / 30, i / 5, 1.1, frame / 60, .5, .2, 0, 0, .7, .3, 1] as const;
          draw.add(...args); control.add(...args);
        }
        draw.commit(); control.commit();
        expect(draw.mesh.instanceMatrix.array).toEqual(control.mesh.instanceMatrix.array);
        for (const name of channels) {
          const gpu = draw.mesh.geometry.getAttribute(name), expected = control.mesh.geometry.getAttribute(name);
          for (let i = 0; i < draw.capacity; i++) expect([gpu.getX(i), gpu.getY(i), gpu.getZ(i), gpu.getW(i)])
            .toEqual([expected.getX(i), expected.getY(i), expected.getZ(i), expected.getW(i)]);
        }
        const gpu = draw.mesh.geometry.getAttribute('instanceMatrix');
        expect(gpu).toBeInstanceOf(InterleavedBufferAttribute);
        if (!(gpu instanceof InterleavedBufferAttribute)) throw new Error('Expected shared matrix');
        for (let i = 0; i < draw.capacity; i++) {
          const matrix = new Matrix4(); draw.mesh.getMatrixAt(i, matrix);
          expect(Array.from(gpu.data.array.slice(gpu.offset + i * gpu.data.stride, gpu.offset + i * gpu.data.stride + 16))).toEqual(matrix.elements);
        }
      }
      for (const name of ['instanceMatrix', ...channels]) {
        const a = wildlife.mesh.geometry.getAttribute(name), b = guide.mesh.geometry.getAttribute(name);
        if (!(a instanceof InterleavedBufferAttribute) || !(b instanceof InterleavedBufferAttribute)) throw new Error('Missing shared attribute');
        expect(a.data).toBe(b.data); expect(a.data.version).toBe(2 * (frame + 1));
      }
    }
    expect([wildlife, guide].map(draw => draw.mesh.instanceMatrix.version)).toEqual(cpuVersions);
    expect(wildlife.mesh.receiveShadow).toBe(true); expect(guide.mesh.receiveShadow).toBe(false);
    wildlife.begin(); guide.begin(); wildlife.commit(); guide.commit();
    expect(wildlife.mesh.count).toBe(0); expect(guide.mesh.count).toBe(0);
    scope.dispose(); expect(() => guide.commit()).not.toThrow();
    guide.begin(); guide.add(0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0);
    expect(() => guide.commit()).toThrow('owner has ended');
  } finally {
    scope.dispose();
    for (const draw of [wildlife, guide, ...controls]) { draw.mesh.geometry.dispose(); draw.mesh.dispose(); }
    geometry.dispose(); material.dispose();
  }
});

test('sharing refuses mismatched channels, over-allocation and retired owners', () => {
  const scope = new Scope('posed-refusals'), pool = new PosedBufferPool(scope, 3);
  const first = pool.reserve(2, ['pose']);
  expect(first.second).toBeNull(); expect(pool.supports(['other'])).toBe(false);
  expect(() => pool.reserve(1, ['pose', 'extra'])).toThrow('Incompatible');
  expect(() => pool.reserve(2, ['pose'])).toThrow('range');
  const last = pool.reserve(1, ['pose']);
  expect(first.firstAttribute.data).toBe(last.firstAttribute.data);
  scope.dispose(); expect(pool.supports(['pose'])).toBe(false);
  expect(() => last.publish()).toThrow('owner has ended');
  expect(() => pool.reserve(1, ['pose'])).toThrow('live owner');
});

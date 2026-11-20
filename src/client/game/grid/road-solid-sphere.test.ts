import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { boundingSphereOf } from './roadSolid';

// DF11 (mini-df11): the merged deck's bounding sphere is three's computeBoundingSphere, read from the array in place.
test('the solid bounding sphere is three’s, bit for bit', () => {
  let seed = 7;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cases = [new Float32Array(0), Float32Array.from([-0, 0, -0]), Float32Array.from([1, 2, 3, 1, 2, 3])];
  for (let n = 1; n < 60; n += 7) cases.push(Float32Array.from({ length: n * 3 }, () => (random() - 0.5) * 1300.37));
  for (const positions of cases) {
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const ours = boundingSphereOf(positions), theirs = geometry.boundingSphere;
    expect([ours.center.x, ours.center.y, ours.center.z, ours.radius]).toEqual([theirs?.center.x, theirs?.center.y, theirs?.center.z, theirs?.radius]);
    expect(Object.is(ours.center.x, theirs?.center.x)).toBe(true);
    geometry.dispose();
  }
});

import { expect, it } from 'vitest';
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { poseInPlace } from '../src/client/game/grid/shardfileFar';
import { SpeciesService } from '../src/client/engine/entities/species/look';
import { Scope } from '../src/shared/engine/app/scope';
import type { SpeciesRow } from '../src/server/engine/ai/species';

// DF11 (mini-df11c): the far proxy's pose reads its arrays directly; three's applyMatrix4 is the reference, bit for bit.
function geometry(seed: number, bounds: boolean): BufferGeometry {
  let s = seed;
  const next = (): number => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 * 200 - 100; };
  const positions = Array.from({ length: 3000 }, next), normals = Array.from({ length: 3000 }, next);
  normals[0] = 0; normals[1] = 0; normals[2] = 0; // a zero normal stays zero (three's `length() || 1`)
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (bounds) { g.computeBoundingBox(); g.computeBoundingSphere(); }
  return g;
}

it('poses a far geometry to the same bits and bounds as three', () => {
  const matrices = [
    new Matrix4().compose(new Vector3(812.25, -3.5, -1940.125), new Quaternion().setFromEuler(new Euler(0.1, 1.234, -0.05)), new Vector3(1.5, 1.5, 1.5)),
    new Matrix4().compose(new Vector3(-7, 2, 3), new Quaternion().setFromEuler(new Euler(0, -2.5, 0)), new Vector3(0.25, 3, 1)),
    new Matrix4().makePerspective(-1, 1, 1, -1, 0.5, 100),
  ];
  for (const [k, matrix] of matrices.entries()) for (const bounds of [true, false]) {
    const ours = geometry(k + 1, bounds), theirs = geometry(k + 1, bounds);
    poseInPlace(ours, matrix); theirs.applyMatrix4(matrix);
    for (const name of ['position', 'normal']) {
      const ourAttribute = ours.getAttribute(name) as Float32BufferAttribute, theirAttribute = theirs.getAttribute(name) as Float32BufferAttribute;
      expect(Buffer.from(ourAttribute.array.buffer).equals(Buffer.from(theirAttribute.array.buffer))).toBe(true);
      expect(ourAttribute.version).toBe(theirAttribute.version);
    }
    expect(ours.boundingBox).toEqual(theirs.boundingBox);
    expect(ours.boundingSphere).toEqual(theirs.boundingSphere);
  }
});

it('remembers a missing species per level until a registration or the scope changes', () => {
  const page = new Scope('page'), level = page.child('level');
  const species = new SpeciesService(() => level);
  expect(species.get('stormRoc')).toBeUndefined();
  expect(species.get('stormRoc')).toBeUndefined();
  const scope = level.child('row');
  species.registerRow({ id: 'row.stormRoc', kind: 'stormRoc' } as unknown as SpeciesRow, scope);
  // a row with no look of its own resolves against the legacy registry, which this test does not seed
  expect(() => species.get('stormRoc')).toThrow(/unknown animal kind/u);
  scope.dispose();
  expect(species.get('stormRoc')).toBeUndefined();
});

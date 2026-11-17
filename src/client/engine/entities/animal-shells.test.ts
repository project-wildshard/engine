import { expect, test } from 'vitest';
import { publishShellLevels } from './animalShells';

test('shell publication clears every owner in order and retains distance tiers', () => {
  const calls: [number, number][] = [];
  const animals = Array.from({ length: 5 }, (_, id) => ({ setShellLevel: (level: number) => { calls.push([id, level]); } }));
  const indices = new Int32Array([3, 0, 1, -1]), distances = new Float64Array([1, 36, 121, Infinity]);
  publishShellLevels(animals, indices, distances, animals.length);
  expect(calls).toEqual([[0, 6], [1, 4], [2, 0], [3, 8], [4, 0]]);
  calls.length = 0; indices.fill(-1);
  publishShellLevels(animals, indices, distances, animals.length);
  expect(calls).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  // A sparse selection is still a real selection, even when its first index is absent.
  calls.length = 0; indices[1] = 4;
  publishShellLevels(animals, indices, distances, animals.length);
  expect(calls).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 6]]);
});

test('publication retains the frame roster bound while an owner changes the roster', () => {
  const calls: number[] = [];
  const animals = Array.from({ length: 4 }, (_, id) => ({ setShellLevel: () => { calls.push(id); if (id === 1) animals.pop(); } }));
  publishShellLevels(animals, new Int32Array(4).fill(-1), new Float64Array(4), 4);
  expect(calls).toEqual([0, 1, 2]);
});

test('a fur shell is bound before it joins a rig already in the scene', async () => {
  const { AnimalFactory } = await import('./AnimalFactory');
  const { Bone, BufferGeometry, MeshPhysicalMaterial, Skeleton, SkinnedMesh } = await import('three');
  const geometry = new BufferGeometry(), body = new SkinnedMesh(geometry);
  body.bind(new Skeleton([new Bone()]));
  const seen: number[] = [];
  body.addEventListener('childadded', ({ child }) => { if (child instanceof SkinnedMesh) seen.push(child.skeleton.bones.length); });
  const factory: unknown = Object.create(AnimalFactory.prototype);
  if (!(factory instanceof AnimalFactory)) throw new Error('Missing factory');
  const shells = factory.createShells({ mesh: body }, { geometry, shells: [new MeshPhysicalMaterial(), new MeshPhysicalMaterial()] });
  expect(seen).toEqual([1, 1]);
  expect(shells.every((shell) => shell.skeleton === body.skeleton && shell.parent === body)).toBe(true);
});

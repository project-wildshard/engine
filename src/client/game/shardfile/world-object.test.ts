import { expect, it } from 'vitest';
import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { bakedMeshWorld, type LoadedMeshBake } from './bakedKinds';

it('draws declared selected kinds from an explicit snapshot and refuses unknown resources', () => {
  const geometry = new PlaneGeometry(), material = new MeshStandardMaterial(), node = new Mesh(geometry, material);
  const matrix: readonly number[] = node.matrix.toArray(); node.userData['matrix64'] = matrix;
  const common = { count: 1, mesh: true, color: 0xffffff, roughness: 1, metalness: 0, flat: false,
    emissive: 0, emissiveIntensity: 0, vertexColors: false, doubleSided: false,
    colorR: 1, colorG: 1, colorB: 1, emissiveR: 0, emissiveG: 0, emissiveB: 0 };
  const world = bakedMeshWorld({ camp: { colliders: [], kinds: [
    { ...common, name: 'lamp', brazier: 0 }, { ...common, name: 'wall', brazier: 1 },
  ] } }, { camp: '/camp.glb' }, 'test');
  const snapshot: LoadedMeshBake<'camp'> = new Map([['camp', new Map([['lamp', node], ['wall', node]])]]);
  const collected: MeshStandardMaterial[] = [];
  const made = world.object('camp', { brazier: 0 }, value => { collected.push(value); }, snapshot);
  expect([...made.kinds.keys()]).toEqual(['lamp']); expect(collected).toHaveLength(1);
  expect(world.object('camp', undefined, undefined, new Map()).root.children).toHaveLength(0);
  expect(() => world.object('unknown')).toThrow('Unknown declared baked piece');
  expect(() => world.object('camp', { brazier: Number.NaN })).toThrow('Invalid baked kind selector');
  geometry.dispose(); material.dispose(); collected.forEach(value => { value.dispose(); });
});

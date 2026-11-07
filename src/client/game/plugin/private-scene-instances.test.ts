import { expect, it } from 'vitest';
import { InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createClientScene } from './scene';

it('draws authored instance poses and rejects crossed matrix counts before allocation', () => {
  const geometry = new PlaneGeometry(), material = new MeshStandardMaterial();
  const poses = [new Matrix4().makeTranslation(2, 3, 4), new Matrix4().makeTranslation(-2, 5, 7)];
  const mesh = { kind: 'mesh', id: 'cards', name: 'authored.cards', geometry: 'quad', material: 'paint',
    instances: 2, matrices: poses.flatMap(pose => pose.toArray()), missing: 'omit', children: [] };
  const recipe = { version: 1, root: 'root', textures: [],
    materials: [{ kind: 'port', id: 'paint', source: 'paint' }],
    nodes: [{ kind: 'group', id: 'root', children: ['cards'] }, mesh] };
  const ports = { geometry: new Map([['quad', geometry]]), materials: new Map([['paint', material]]) };
  const made = createClientScene(recipe, ports), cards = made.parts.get('cards');
  if (!(cards instanceof InstancedMesh)) throw new Error('Missing authored instances');
  const matrix = new Matrix4(); cards.getMatrixAt(1, matrix);
  expect(matrix.elements).toEqual(poses[1]?.elements); expect(cards.name).toBe('authored.cards');
  expect(() => createClientScene({ ...recipe, nodes: [recipe.nodes[0], { ...mesh, instances: 3 }] }, ports)).toThrow();
  expect(() => createClientScene(recipe, { ...ports, geometry: new Map() })).toThrow('geometry');
  made.dispose(); geometry.dispose(); material.dispose();
});

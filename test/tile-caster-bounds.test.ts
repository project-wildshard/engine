// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { staticGlb } from '../src/sharddev/bake/glb';
import { emptyShardfile } from '../src/shared/host/author';
import { clientTileViews } from '../src/client/game/shardfile/clientViews';

const isMesh = (value: unknown): value is Mesh => value instanceof Mesh;

test('sliced tile bounds retain native boxes and the original floor/caster decisions', async () => {
  const scope = new Scope('tile-caster-bounds'), root = new Group(), family = new MeshStandardMaterial();
  const words = new Float32Array(65538 * 3);
  for (let i = 0; i < words.length; i += 3) { words[i] = (i / 3) % 3; words[i + 2] = (i / 3) % 7; }
  const floor = new BufferGeometry().setAttribute('position', new BufferAttribute(words, 3)), raised = floor.clone().translate(0, 10, 0);
  const bytes = staticGlb([{ geometry: floor, material: family, castShadow: true }, { geometry: raised, material: family, castShadow: true }], 'casters');
  const source = emptyShardfile({ slug: 'tile-caster-bounds', name: 'Bounds', author: 'Fixture', seed: 1, revision: 1 });
  const file = '1'.repeat(64);
  source.props = { version: 1, family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file }], wholeLibrary: [], models: [], panels: [], far: null, colliders: [], textures: [] };
  let clock = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => { clock += 9; return clock; });
  try {
    const views = clientTileViews({ terrain: null, materials: new Map([['pbr', family]]), textures: new Map() });
    const resident = await views.props(source.props, '0/0/0', bytes, root, scope);
    if (resident === null) throw new Error('Missing caster tile');
    const meshes: Mesh[] = []; root.traverse(object => { if (isMesh(object)) meshes.push(object); });
    expect(meshes).toHaveLength(2);
    const decisions: [number, boolean][] = [];
    for (const mesh of meshes) {
      const geometry: unknown = mesh.geometry;
      if (!(geometry instanceof BufferGeometry)) throw new Error('Missing caster geometry');
      const expected = geometry.clone(); expected.boundingBox = null; expected.computeBoundingBox();
      try { expect(geometry.boundingBox).toEqual(expected.boundingBox); }
      finally { expected.dispose(); }
      decisions.push([new Box3().setFromObject(mesh).min.y, mesh.castShadow]);
    }
    expect(decisions.sort(([a], [b]) => a - b)).toEqual([[0, false], [10, true]]);
    resident.shadow(false); expect(meshes.every(mesh => !mesh.castShadow)).toBe(true);
    resident.shadow(true); expect(meshes.filter(mesh => mesh.castShadow)).toHaveLength(1);
  } finally { time.mockRestore(); scope.dispose(); floor.dispose(); raised.dispose(); family.dispose(); }
});

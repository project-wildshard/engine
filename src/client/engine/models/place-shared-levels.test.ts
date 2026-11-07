// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, PerspectiveCamera, Vector3, type Object3D } from 'three';
import { defineModel, modelContext, type ModelPart } from './model';
import { place } from './place';

/** Two variants, their own near shapes, one shared far shape; variant b draws it at half size (G639 distant trees). */
function fixture(scaleB?: number) {
  const material = new MeshStandardMaterial(), far = new BoxGeometry(1, 2, 1);
  const near = [new BoxGeometry(1, 1, 1), new BoxGeometry(2, 2, 2)];
  const def = defineModel<{ v: number }>({ id: 'test/shared-levels', name: 'Shared levels', file: 'src/client/engine/models/place-shared-levels.test.ts', category: 'nature', pipeline: 'code',
    defaults: { v: 0 }, variants: [{ id: 'a', label: 'A', params: { v: 0 } }, { id: 'b', label: 'B', params: { v: 1 } }],
    build: (_ctx, p) => [{ geometry: near[p.v] ?? far, material }],
    lods: [{ from: 10, build: (_ctx, p): ModelPart[] => [{ geometry: far, material, ...(p.v === 1 && scaleB !== undefined ? { scale: scaleB } : {}) }] }] });
  const at = (variant: string, x: number) => ({ x, y: 0, z: -50, variant });
  return { def, material, placements: [at('a', 0), at('b', 3), at('a', 6), at('b', 9)] };
}
const isInstanced = (o: Object3D): o is InstancedMesh => o instanceof InstancedMesh;
const meshes = (root: Object3D): InstancedMesh[] => { const out: InstancedMesh[] = []; root.traverse(o => { if (isInstanced(o)) out.push(o); }); return out; };
const view = () => { const camera = new PerspectiveCamera(60, 1, 0.1, 1000); camera.lookAt(new Vector3(0, 0, -1)); camera.updateMatrixWorld(true); return camera; };

test('variants drawing one far shape share one draw, each copy at its variant scale', () => {
  const { def, material, placements } = fixture(0.5);
  const placed = place(def, placements, { ctx: modelContext(null), draw: 'instanced', registry: null, cull: {} });
  const all = meshes(placed.object), level1 = all.filter(mesh => mesh.name.endsWith(':1'));
  expect(level1).toHaveLength(1); // one draw for both variants' far level
  expect(all.filter(mesh => mesh.name.endsWith(':0'))).toHaveLength(2); // the near shapes stay per variant
  placed.cull(view());
  const [shared] = level1;
  if (shared === undefined) throw new Error('Missing shared level');
  expect(shared.count).toBe(4); expect(shared.instanceMatrix.count).toBeGreaterThanOrEqual(4);
  const scales = Array.from({ length: 4 }, (_, i) => new Vector3().setFromMatrixScale(shared.getMatrixAt(i, new Matrix4())).x).sort((p, q) => p - q);
  expect(scales).toEqual([0.5, 0.5, 1, 1]);
  const xs = Array.from({ length: 4 }, (_, i) => new Vector3().setFromMatrixPosition(shared.getMatrixAt(i, new Matrix4())).x).sort((p, q) => p - q);
  expect(xs).toEqual([0, 3, 6, 9]); // scaled about each copy's own origin
  material.dispose();
});

test('without a shared shape every variant keeps its own draws (unchanged), and a scale outside per-copy culling refuses', () => {
  const { def, material, placements } = fixture();
  const distinct = defineModel({ ...def, lods: [{ from: 10, build: (_ctx, p: { v: number }): ModelPart[] => [{ geometry: new BoxGeometry(1, p.v + 1, 1), material }] }] });
  const placed = place(distinct, placements, { ctx: modelContext(null), draw: 'instanced', registry: null, cull: {} });
  expect(meshes(placed.object).filter(mesh => mesh.name.endsWith(':1'))).toHaveLength(2);
  const scaled = fixture(0.5);
  expect(() => place(scaled.def, scaled.placements, { ctx: modelContext(null), draw: 'instanced', registry: null, cull: { lodBy: 'set' } })).toThrow('per-copy culled');
  material.dispose(); scaled.material.dispose();
});

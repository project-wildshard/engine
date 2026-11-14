// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial, PerspectiveCamera, BatchedMesh, InstancedMesh, type Object3D } from 'three';
import { parseWorldScenePlacement } from '@wildshard/format/worldScenePlacement';
import { Scope } from '../src/shared/engine/app/scope';
import { AssetService } from '../src/client/engine/app/assets';
import { WorldSceneBatchSchema } from '@wildshard/format/worldSceneBatch';
import { WorldSceneBatch } from '../src/client/game/shardfile/worldSceneBatch';
import { installWorldRegistry, WorldRegistry } from '../src/client/engine/world/registry';
import type { ShardContext } from '../src/client/game/plugin/context';

installWorldRegistry();

const triangle = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
};
const batchRows = () => v.parse(WorldSceneBatchSchema, { id: 'harbour', material: 'stone',
  capacity: { instances: 3, vertices: 9, indices: 9 }, cull: { frustum: false, radiusBias: 0, step: 0 },
  geometry: [{ library: 'walls', model: 'near' }, { library: 'walls', model: 'far' }],
  fixed: [{ lod0: 0, lod1: 1, near: 2, far: 10, sphere: [0, 0, -5, 1], matrix: new Matrix4().makeTranslation(0, 0, -5).elements }],
});

const drawn = (root: Object3D) => { const meshes: (InstancedMesh | BatchedMesh)[] = []; root.traverse(o => { if (o instanceof InstancedMesh || o instanceof BatchedMesh) meshes.push(o); }); return meshes; };
const counts = (root: Object3D) => drawn(root).map(mesh => mesh instanceof InstancedMesh ? mesh.count : -1);

test('without multi-draw fixed instances draw instanced, one InstancedMesh per geometry slot (E271 / E272)', () => {
  const owner = new Scope('harbour'), material = new MeshBasicMaterial(), geometry = triangle();
  const batch = new WorldSceneBatch(batchRows(), material, [geometry, geometry], owner, new WorldRegistry()), group = batch.finish();
  expect(batch.finish()).toBe(group); expect(batch.object()).toBe(group);
  const meshes = drawn(group);
  expect(meshes).toHaveLength(2); expect(meshes.every(mesh => mesh instanceof InstancedMesh)).toBe(true);
  expect(counts(group)).toEqual([0, 0]); // nothing drawn before the first view chooses
  owner.dispose(); material.dispose(); geometry.dispose();
});

test('PF2: supported multi-draw batches fixed copies; unsupported renderers keep the instanced path', () => {
  const owner = new Scope('harbour batched'), material = new MeshBasicMaterial(), geometry = triangle();
  try {
    const batched = new WorldSceneBatch(batchRows(), material, [geometry, geometry], owner, new WorldRegistry(), true).finish();
    expect(batched).toBeInstanceOf(BatchedMesh); expect(drawn(batched)).toHaveLength(1);
  } finally { owner.dispose(); material.dispose(); geometry.dispose(); }
});

test('fixed instances keep authored range and LOD boundaries, moving between their geometry meshes', () => {
  const owner = new Scope('harbour'), material = new MeshBasicMaterial(), geometry = triangle();
  const batch = new WorldSceneBatch(batchRows(), material, [geometry, geometry], owner, new WorldRegistry()), group = batch.finish();
  const camera = new PerspectiveCamera(); camera.updateMatrixWorld(true); batch.update(camera);
  expect(counts(group)).toEqual([0, 1]);
  const [near, far] = drawn(group), matrix = new Matrix4();
  if (!(far instanceof InstancedMesh) || !(near instanceof InstancedMesh)) throw new Error('Missing instanced slots');
  far.getMatrixAt(0, matrix); expect(matrix.elements).toEqual(new Matrix4().makeTranslation(0, 0, -5).elements);
  camera.position.z = -4; camera.updateMatrixWorld(true); batch.update(camera);
  expect(counts(group)).toEqual([1, 0]);
  near.getMatrixAt(0, matrix); expect(matrix.elements).toEqual(new Matrix4().makeTranslation(0, 0, -5).elements);
  camera.position.z = -30; camera.updateMatrixWorld(true); batch.update(camera);
  expect(counts(group)).toEqual([0, 0]);
  owner.dispose(); material.dispose(); geometry.dispose();
});

test('merge copies draw as one static copy of their near geometries, the rest keep their LOD (G639)', () => {
  const owner = new Scope('harbour'), material = new MeshBasicMaterial(), geometry = triangle();
  const row = batchRows(), [culled] = row.fixed;
  if (culled === undefined) throw new Error('Missing fixed row');
  const at = (x: number) => ({ ...culled, merge: true as const, matrix: new Matrix4().makeTranslation(x, 0, 0).elements });
  const batch = new WorldSceneBatch(v.parse(WorldSceneBatchSchema, { ...row, fixed: [at(10), culled, at(20)] }), material, [geometry, geometry], owner, new WorldRegistry());
  const group = batch.finish(), meshes = drawn(group);
  expect(counts(group)).toEqual([0, 0, 1]); // the merged copy draws before any view, and at every distance
  const camera = new PerspectiveCamera(); camera.position.z = -1000; camera.updateMatrixWorld(true); batch.update(camera);
  expect(counts(group)).toEqual([0, 0, 1]);
  const merged = meshes[2]?.geometry, position = merged?.getAttribute('position');
  expect(position?.count).toBe(6); expect(merged?.getIndex()?.count).toBe(6);
  expect([position?.getX(0), position?.getX(3)]).toEqual([10, 20]);
  expect(geometry.getAttribute('position').getX(0)).toBe(0); // the shared source geometry is never moved
  const dispose = vi.spyOn(merged ?? geometry, 'dispose');
  owner.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
  material.dispose(); geometry.dispose();
});

test('a batch owns only its instance buffers and refuses use after its lifetime ends', () => {
  const owner = new Scope('harbour'), material = new MeshBasicMaterial(), geometry = triangle();
  const materialDispose = vi.spyOn(material, 'dispose'), geometryDispose = vi.spyOn(geometry, 'dispose');
  const batch = new WorldSceneBatch(batchRows(), material, [geometry, geometry], owner, new WorldRegistry()), group = batch.finish();
  const disposals = drawn(group).map(mesh => vi.spyOn(mesh, 'dispose'));
  owner.dispose(); owner.dispose();
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  expect(materialDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
  expect(group.parent).toBe(null); expect(() => batch.object()).toThrow('disposed');
  material.dispose(); geometry.dispose();
});

test('batch rows reject executable values, missing fixed geometry and unbounded capacity', () => {
  expect(() => v.parse(WorldSceneBatchSchema, { ...batchRows(), callback: () => undefined })).toThrow();
  expect(() => v.parse(WorldSceneBatchSchema, { ...batchRows(), capacity: { instances: 9000, vertices: 9, indices: 9 } })).toThrow();
  expect(() => v.parse(WorldSceneBatchSchema, { ...batchRows(), geometry: [] })).toThrow();
  const outsideRange = batchRows();
  for (const part of outsideRange.fixed) part.far = -1;
  expect(() => v.parse(WorldSceneBatchSchema, outsideRange)).toThrow();
  const nearBeyondRange = batchRows();
  for (const part of nearBeyondRange.fixed) part.near = 100;
  expect(v.parse(WorldSceneBatchSchema, nearBeyondRange)).toEqual(nearBeyondRange);
});

test('resident rows share one native batch across a named model and fixed tail', async () => {
  const [{ installWorldScenes }, { parseWorldScenes }, { emptyShardfile }, { staticGlb }, { SkyRig }] = await Promise.all([
    import('../src/client/game/shardfile/worldScenes'), import('@wildshard/format/worldScenes'), import('../src/shared/host/author'),
    import('../src/sharddev/bake/glb'), import('../src/client/engine/world/skyRig'),
  ]);
  const owner = new Scope('harbour-resident'), registry = new WorldRegistry(), geometry = triangle(), material = new MeshBasicMaterial();
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
  Object.defineProperty(sky, 'viewCamera', { value: new PerspectiveCamera() });
  const draw = { id: 'stone', library: 'walls', model: 'stone', material: 'paint' };
  const catalogue = { product: 'fixture-harbour', models: [{ key: 'marker', id: 'fixture-harbour/marker', name: 'Marker', file: 'markers.json', category: 'props', pipeline: 'blender', defaults: {}, assembly: 'parts',
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], draws: [draw], lods: [{ from: { phone: 2, desktop: 4 }, draws: [draw] }], colliders: [] }] }] };
  const files = new Map([['models/stone.glb', staticGlb([{ geometry, material }])], ['models/catalogue.json', new TextEncoder().encode(JSON.stringify(catalogue))]]);
  const game = { renderer: null, onUpdate: vi.fn() };
  const context = { scope: owner, app: { registry, assets: new AssetService() }, game: {}, cube: null,
    product: { shardfile: emptyShardfile({ slug: 'fixture-harbour', name: 'Harbour', author: 'Fixture', revision: 1, seed: 3 }),
      hasFile: (id: string) => files.has(id), url: (id: string) => id,
      file: (id: string) => { const bytes = files.get(id); return bytes === undefined ? Promise.reject(new Error('Missing fixture blob')) : Promise.resolve(bytes); } } } as ShardContext;
  Object.assign(context.game, { runtime: { world: { sky, game } } });
  const rows = parseWorldScenes({ version: 1, catalogue: 'models/catalogue.json', steps: [],
    libraries: [{ id: 'walls', kind: 'owned', models: [{ id: 'stone', file: 'models/stone.glb' }] }], materials: [{ id: 'paint', kind: 'basic', properties: {} }],
    batches: [{ ...rowsForFixture(), id: 'shared', material: 'paint', geometry: [{ library: 'walls', model: 'stone' }],
      fixed: [{ near: 2, far: 10, lod0: 0, lod1: 0, sphere: [0, 0, -5, 1], matrix: new Matrix4().makeTranslation(0, 0, -5).elements }] }],
    placements: [{ id: 'marker', model: 'marker', draw: 'batched', batch: 'shared', poses: [{ x: 0, y: 0, z: 0, yxz: { yaw: 1.2, scale: 0.8, pitch: 0.2, roll: -0.1 } }] }],
  });
  try {
    const anotherFolder = () => ({ ...context, product: { ...context.product } }) as ShardContext;
    const tooSmall = structuredClone(rows), incompatible = structuredClone(rows);
    const capacityBatch = tooSmall.batches[0], incompatibleBatch = incompatible.batches[0];
    if (capacityBatch === undefined || incompatibleBatch === undefined) throw new Error('Missing fixture batches');
    capacityBatch.capacity.instances = 1;
    incompatible.materials.push({ id: 'other', kind: 'basic', properties: {} }); incompatibleBatch.material = 'other';
    await expect(installWorldScenes(anotherFolder(), tooSmall)).rejects.toThrow('instance capacity');
    await expect(installWorldScenes(anotherFolder(), incompatible)).rejects.toThrow('cannot share');
    const handles = await installWorldScenes(context, rows);
    const [{ defineWorldSceneCatalogue }, { TIER }] = await Promise.all([import('../src/client/game/models/worldSceneCatalogue'), import('../src/client/engine/core/tier')]);
    expect(defineWorldSceneCatalogue(catalogue).model('marker').lods?.[0]?.from).toBe(TIER === 'phone' ? 2 : 4);
    const placed = await handles.place('marker'), batch = handles.object('shared');
    expect(await handles.place('marker')).toBe(placed);
    // a 'batched' row draws instanced on its own; the batch holds only its fixed tail (E271 / E272: no multi-draw)
    expect(batch).not.toBe(placed.object); expect(() => handles.mesh('shared')).toThrow('Expected scene mesh');
    expect([...drawn(placed.object), ...drawn(batch)].some(mesh => mesh instanceof BatchedMesh)).toBe(false);
    expect(drawn(placed.object).length).toBeGreaterThan(0); expect(drawn(batch)).toHaveLength(1);
    expect(() => parseWorldScenePlacement({ id: 'bad', model: 'marker', draw: 'batched',
      poses: [{ x: 0, y: 0, z: 0, matrix: new Matrix4().elements, yxz: { yaw: 0, scale: 1 } }] })).toThrow();
    expect(game.onUpdate).toHaveBeenCalledOnce();
    expect(await installWorldScenes(context, rows)).toBe(handles);
  } finally { owner.dispose(); registry.retire(); geometry.dispose(); material.dispose(); }
});

function rowsForFixture() {
  return { capacity: { instances: 2, vertices: 9, indices: 9 }, cull: { frustum: false, radiusBias: 0, step: 0 } };
}

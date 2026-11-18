import { expect, test } from 'vitest';
import { BatchedMesh, BoxGeometry, Color, InstancedMesh, Mesh, MeshBasicMaterial, Scene } from 'three';
import { sceneJobs } from './precompile';

/** every mesh the jobs compile */
function standIns(jobs: ReturnType<typeof sceneJobs>['jobs']): Mesh[] {
  const out: Mesh[] = [];
  for (const job of jobs) job.root.traverse(object => { if (object instanceof Mesh) out.push(object as Mesh); });
  return out;
}

// MEMORY-GATES MG9: three's BatchedMesh.copy clones the whole batch geometry; a stand-in is only compiled, so it shares it
test('a batched stand-in compiles the same program on its source geometry, with no copy of the batch', () => {
  const scene = new Scene(), material = new MeshBasicMaterial();
  const batch = new BatchedMesh(4, 2048, 4096, material);
  const box = batch.addGeometry(new BoxGeometry());
  batch.setColorAt(batch.addInstance(box), new Color(1, 0, 0));
  scene.add(batch);
  const plain = new Mesh(new BoxGeometry(), new MeshBasicMaterial()), field = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
  scene.add(plain, field);
  scene.updateMatrixWorld(true);
  const copies = standIns(sceneJobs(scene, null, 1).jobs);
  const batched = copies.find((mesh): mesh is BatchedMesh => mesh instanceof BatchedMesh);
  expect(batched).toBeDefined();
  expect(batched).not.toBe(batch);
  expect(batched?.geometry).toBe(batch.geometry);
  expect(Object.hasOwn(batch.geometry, 'clone')).toBe(false);
  expect(batched?.geometry.clone()).not.toBe(batch.geometry);
  // the program's batching-colour bit still comes over (r186's copy drops it)
  expect(Reflect.get(batched ?? {}, '_colorsTexture')).toBe(Reflect.get(batch, '_colorsTexture'));
  // other meshes keep three's own clone: a plain mesh shares its geometry anyway, an instanced one keeps its copy
  expect(copies.find(mesh => mesh.material === plain.material)?.geometry).toBe(plain.geometry);
  expect(copies.find((mesh): mesh is InstancedMesh => mesh instanceof InstancedMesh)?.instanceMatrix).not.toBe(field.instanceMatrix);
});

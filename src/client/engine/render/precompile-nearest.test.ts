import { expect, test } from 'vitest';
import { BoxGeometry, InstancedMesh, Material, Mesh, MeshBasicMaterial, Scene, Sphere, Vector3 } from 'three';
import { sceneJobs } from './precompile';

/** the materials the jobs compile, in order */
function order(jobs: ReturnType<typeof sceneJobs>['jobs']): unknown[] {
  const out: unknown[] = [];
  for (const job of jobs) job.root.traverse(object => { const material: unknown = object instanceof Mesh ? object.material : null; if (material instanceof Material) out.push(material as unknown); });
  return out;
}

test('the after-control warm-up links what is nearest first, by drawn bounds; without an origin it keeps scene order', () => {
  const geometry = new BoxGeometry(), scene = new Scene();
  const far = new MeshBasicMaterial(), near = new MeshBasicMaterial(), middle = new MeshBasicMaterial(), spread = new MeshBasicMaterial();
  const at = (material: Material, x: number): Mesh => { const mesh = new Mesh(geometry, material); mesh.position.x = x; scene.add(mesh); return mesh; };
  at(far, 300); at(near, 4); at(middle, 60);
  // an instanced field whose origin is far but whose instances reach the camera: its own bounds decide
  const field = new InstancedMesh(geometry, spread, 2);
  field.position.x = 500; field.boundingSphere = new Sphere(new Vector3(-480, 0, 0), 30);
  scene.add(field);
  scene.updateMatrixWorld(true);
  expect(order(sceneJobs(scene, null, 1).jobs)).toEqual([far, near, middle, spread]);
  // the field's bounds (centre 20 from the camera, radius 30) reach it: nearer than the box at 4
  expect(order(sceneJobs(scene, null, 1, [scene], undefined, new Vector3()).jobs)).toEqual([spread, near, middle, far]);
  // batches keep the order across a job boundary
  expect(order(sceneJobs(scene, null, 2, [scene], undefined, new Vector3()).jobs)).toEqual([spread, near, middle, far]);
});

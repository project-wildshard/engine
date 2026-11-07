import { expect, test } from 'vitest';
import { BoxGeometry, BufferGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';
import { sceneJobs, shadowJobs } from './precompile';

/** NR4: a refining mesh's channel-less placeholder cannot draw; a program built against it reads every attribute as a
 *  constant (three's AttributeNode warnings), so neither the view nor the shadow pass compiles it */
test('an empty placeholder geometry waits for its first real draw', () => {
  const scene = new Scene(), placeholder = new Mesh(new BufferGeometry(), new MeshBasicMaterial()), box = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  placeholder.castShadow = true; box.castShadow = true; scene.add(placeholder, box);
  const drawn = (jobs: ReturnType<typeof shadowJobs>): unknown[] => jobs.flatMap(job => job.root.children.map(child => 'geometry' in child ? child.geometry : undefined));
  const view = sceneJobs(scene, null);
  expect(drawn(view.jobs)).toEqual([box.geometry]);
  const shadow = drawn(shadowJobs(scene, null));
  expect(shadow).toContain(box.geometry); expect(shadow).not.toContain(placeholder.geometry);
});

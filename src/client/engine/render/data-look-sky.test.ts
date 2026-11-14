import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { GraphIr, GraphNode } from '@wildshard/format/materialGraph';
import { paintDome } from './dataLook';
import { compileClassicGraph } from './graph/glslMaterial';
import { environmentScene } from './lookLight';

/** SHARD-SOURCE AP14: a sky over the dome's direction, with `chain` more nodes than it needs (a cloud layer's weight). */
function sky(chain = 0): GraphIr {
  const nodes: Record<string, GraphNode> = {
    pos: { op: 'positionLocal' }, dir: { op: 'normalize', in: ['pos'] }, up: { op: 'swizzle', in: ['dir'], mask: 'y' },
  };
  let last = 'up';
  for (let step = 0; step < chain; step += 1) { nodes[`s${step}`] = { op: 'sin', in: [last] }; last = `s${step}`; }
  nodes['out'] = { op: 'mix', in: [[1, 0.6, 0.4], [0.1, 0.1, 0.4], last] };
  return { version: 1, kind: 'material', model: 'unlit', nodes, stages: { surface: { colour: 'out' } } };
}

const dome = (): THREE.Mesh<THREE.SphereGeometry, THREE.Material> =>
  new THREE.Mesh<THREE.SphereGeometry, THREE.Material>(new THREE.SphereGeometry(600, 24, 12), new THREE.MeshBasicMaterial());

test('a look sky paints the dome: back faces, no depth, no fog, and the environment filters the same material', () => {
  const mesh = dome(), gradient = mesh.material;
  let freed = 0;
  gradient.addEventListener('dispose', () => { freed += 1; });
  paintDome(mesh, sky(), compileClassicGraph);
  const painted = mesh.material as THREE.ShaderMaterial;
  expect(freed).toBe(1);
  expect([painted.name, painted.side, painted.depthWrite, painted.fog]).toEqual(['engine.look.sky', THREE.BackSide, false, false]);
  expect(painted.fragmentShader.length).toBeGreaterThan(0);
  const made = environmentScene(mesh, { intensity: 0.4, ground: [0.2, 0.2, 0.1] });
  try {
    const drawn = made.scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh).map((child) => child.material);
    expect(drawn).toContain(painted);
  } finally { made.dispose(); painted.dispose(); }
});

test('a sky compiles under its own budget, past a material default', () => {
  const mesh = dome();
  // 200 more nodes than a material's default 160: the sky budget (format look-sky) admits it
  paintDome(mesh, sky(200), compileClassicGraph);
  expect(mesh.material.name).toBe('engine.look.sky');
  mesh.material.dispose();
});

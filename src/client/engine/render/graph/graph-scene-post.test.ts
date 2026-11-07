// NF18: a shard's own post stack draws its graphs as classic GLSL passes (the retired TSL `GraphPostPass`): each fades over
// the scene by its owner weight, reads the composer's input and depth buffers and the scene camera's clip range, and a
// normal pre-pass lends `sceneNormal` its target.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import type { GraphIr } from '@wildshard/format/materialGraph';
import { compileClassicGraph } from './glslMaterial';
import { ClassicPostPass, GraphNormalPrepass } from './glslPost';

const GRAPH: GraphIr = { version: 1, kind: 'post', params: { gain: { type: 'float', value: 0.5, min: 0, max: 2 } },
  nodes: { s: { op: 'sceneColour' }, rgb: { op: 'swizzle', in: ['s'], mask: 'xyz' }, d: { op: 'sceneDepth' }, n: { op: 'sceneNormal' },
    g: { op: 'param', param: 'gain' }, k: { op: 'mul', in: ['rgb', 'g'] }, dn: { op: 'mul', in: ['n', 'd'] }, o: { op: 'add', in: ['k', 'dn'] } },
  stages: { post: { colour: 'o' } } };

/** a renderer double that records where each draw went */
function recorder(): { readonly renderer: THREE.WebGLRenderer; readonly draws: (THREE.WebGLRenderTarget | null)[] } {
  const draws: (THREE.WebGLRenderTarget | null)[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer: unknown = Object.create(THREE.WebGLRenderer.prototype);
  if (!(renderer instanceof THREE.WebGLRenderer)) throw new Error('Missing renderer');
  Reflect.set(renderer, 'setRenderTarget', (next: THREE.WebGLRenderTarget | null) => { target = next; });
  Reflect.set(renderer, 'render', () => { draws.push(target); });
  return { renderer, draws };
}

test('a weighted post graph mixes its colour over the scene input; an unweighted one is its own colour', () => {
  const weighted = compileClassicGraph(GRAPH, { weighted: true }), plain = compileClassicGraph(GRAPH);
  expect(weighted.material.fragmentShader).toContain('mix( texture( wsScene, wsVUv ).rgb, ');
  expect(weighted.material.fragmentShader).toContain(', wsWeight )');
  expect(weighted.material.uniforms['wsWeight']?.value).toBe(1);
  expect(plain.material.fragmentShader).not.toContain('wsWeight');
  expect(plain.material.uniforms['wsWeight']).toBeUndefined();
  // a weighted graph that never reads the scene still declares and binds its input
  const own = compileClassicGraph({ version: 1, kind: 'post', nodes: {}, stages: { post: { colour: [1, 0, 0] } } }, { weighted: true });
  expect(own.material.fragmentShader).toContain('uniform sampler2D wsScene;');
  expect(own.material.uniforms['wsScene']?.value).toBe(null);
  weighted.material.dispose(); plain.material.dispose(); own.material.dispose();
});

test('the pass binds the composer buffers, the clip range and the normal target, and fades by its owner weight', () => {
  const normals = new GraphNormalPrepass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 750), graph = compileClassicGraph(GRAPH, { weighted: true });
  const pass = new ClassicPostPass(graph.material, camera, true, normals.texture), uniforms = graph.material.uniforms;
  expect(pass.needsDepthTexture).toBe(true);
  expect(uniforms['wsNormal']?.value).toBe(normals.texture);
  const depth = new THREE.DepthTexture(4, 4);
  pass.setDepthTexture(depth);
  expect(uniforms['wsDepth']?.value).toBe(depth);
  const input = new THREE.WebGLRenderTarget(4, 4), output = new THREE.WebGLRenderTarget(4, 4), { renderer, draws } = recorder();
  pass.render(renderer, input, output);
  expect(uniforms['wsScene']?.value).toBe(input.texture);
  expect([uniforms['wsDepthNear']?.value, uniforms['wsDepthFar']?.value]).toEqual([0.5, 750]);
  expect(draws).toEqual([output]);
  pass.renderToScreen = true; pass.render(renderer, input, output);
  expect(draws[1]).toBe(null);
  pass.setWeight(1.5); expect(uniforms['wsWeight']?.value).toBe(1); expect(pass.enabled).toBe(true);
  pass.setWeight(0.25); expect(uniforms['wsWeight']?.value).toBe(0.25);
  pass.setWeight(0); expect(uniforms['wsWeight']?.value).toBe(0); expect(pass.enabled).toBe(false);
  graph.setParam('gain', 1.5); expect(uniforms['wsP_gain']?.value).toBe(1.5);
  expect(() => new ClassicPostPass(compileClassicGraph(GRAPH).material, camera, false)).toThrow(/weighted post graph/);
  pass.dispose(); normals.dispose(); input.dispose(); output.dispose(); depth.dispose();
});

test('the normal pre-pass draws packed normals into its own target, restoring the scene and the shadow update', () => {
  const scene = new THREE.Scene(), background = new THREE.Color(0x123456), prepass = new GraphNormalPrepass(scene, new THREE.PerspectiveCamera());
  scene.background = background;
  const { renderer, draws } = recorder();
  Reflect.set(renderer, 'shadowMap', { autoUpdate: true });
  Reflect.set(renderer, 'clear', () => undefined);
  let drawn: THREE.Material | null = null;
  Reflect.set(renderer, 'render', (drawnScene: THREE.Scene) => { drawn = drawnScene.overrideMaterial; draws.push(prepass.target); });
  prepass.render(renderer);
  expect(drawn).toBeInstanceOf(THREE.MeshNormalMaterial);
  expect(scene.overrideMaterial).toBe(null); expect(scene.background).toBe(background);
  expect(renderer.shadowMap.autoUpdate).toBe(true);
  expect(prepass.needsSwap).toBe(false);
  prepass.setSize(8, 4); expect([prepass.target.width, prepass.target.height]).toEqual([8, 4]);
  prepass.dispose();
});

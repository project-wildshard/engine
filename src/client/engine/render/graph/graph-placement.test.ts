import { expect, it } from 'vitest';
import * as THREE from 'three';
import { GRAPH_ARRAY_MAX, validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { compileClassicGraph } from './glslMaterial';

it('replaces the whole vertex with indexed uniform rows and keeps updates bounded', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    arrays: { islands: { type: 'vec3', value: [[1, 2, 3], [4, 5, 6]] } },
    nodes: { seed: { op: 'attribute', name: 'aSeed', type: 'float' }, row: { op: 'arrayElement', param: 'islands', in: ['seed'] } },
    stages: { 'vertex.position': { position: 'row' }, surface: { colour: [0.2, 0.5, 0.2] } },
  };
  const admitted = validateGraph(graph);
  if (!admitted.ok) throw new Error(admitted.errors.join('\n'));
  expect(admitted.graph.arrays?.['islands']?.value).toEqual(graph.arrays?.['islands']?.value);
  const compiled = compileClassicGraph(graph);
  try {
    const vertex = compiled.material.vertexShader;
    expect(vertex).toContain('floor(');
    expect(vertex).toContain('clamp(');
    // the whole position is the indexed row of the program's own uniform list
    expect(vertex).toMatch(/uniform vec3 wsA_islands\[ ?2 ?\];/u);
    expect(vertex).toMatch(/transformed = t\d+_row;/u);
    const list = compiled.material.uniforms['wsA_islands'];
    const storage: unknown = list?.value;
    if (!(storage instanceof Float32Array)) throw new Error('Placement did not read its uniform list');
    expect([...storage]).toEqual([1, 2, 3, 4, 5, 6]);
    const values = [[7, 8, 9], [10, 11, 12]];
    compiled.setArrayParam('islands', values); values[0]?.fill(99);
    expect([...storage]).toEqual([7, 8, 9, 10, 11, 12]);
    expect(() => { compiled.setArrayParam('islands', [[1, 2, 3]]); }).toThrow('fixed capacity');
    expect(() => { compiled.setArrayParam('islands', [[1, 2], [3, 4]]); }).toThrow('finite vec3');
    expect(() => { compiled.setArrayParam('islands', [[Number.NaN, 0, 0], [0, 0, 0]]); }).toThrow('finite vec3');
    expect(list?.value).toBe(storage);
    expect([...storage]).toEqual([7, 8, 9, 10, 11, 12]);
    expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.offset': { offset: [1, 0, 0] } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, kind: 'post', stages: { 'vertex.position': { position: 'row' }, post: { colour: [1, 1, 1] } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, arrays: { islands: { type: 'vec3', value: Array.from({ length: GRAPH_ARRAY_MAX + 1 }, () => [0, 0, 0]) } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, arrays: { islands: { type: 'vec3', value: [[0, Infinity, 0]] } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, arrays: { a: { type: 'float', value: Array.from({ length: 64 }, () => 0) }, b: { type: 'float', value: Array.from({ length: 64 }, () => 0) }, islands: { type: 'vec3', value: [[0, 0, 0]] } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); }
});

it('places independently sized camera-relative cards through the actual vertex compiler', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { distance: { type: 'float', value: 100 }, size: { type: 'vec2', value: [3, 8] } },
    nodes: { direction: { op: 'attribute', name: 'aDirection', type: 'vec3' }, distance: { op: 'param', param: 'distance' },
      vertex: { op: 'positionGeometry' }, xy: { op: 'swizzle', in: ['vertex'], mask: 'xy' },
      size: { op: 'param', param: 'size' }, local: { op: 'mul', in: ['xy', 'size'] },
      card: { op: 'cameraRelativeBillboard', in: ['direction', 'distance', 'local'] } },
    stages: { 'vertex.position': { position: 'card' }, surface: { colour: [1, 0.8, 0.5] } },
  };
  const compiled = compileClassicGraph(graph);
  const vertexOf = (g: GraphIr): string => {
    const material = compileClassicGraph(g).material, vertex = material.vertexShader;
    material.dispose();
    return vertex.slice(vertex.indexOf('void main()'));
  };
  try {
    compiled.setParam('distance', 250); compiled.setParam('size', [5, 12]);
    expect(compiled.material.uniforms['wsP_distance']?.value).toBe(250);
    const size: unknown = compiled.material.uniforms['wsP_size']?.value;
    if (!(size instanceof THREE.Vector2)) throw new Error('Missing card size uniform');
    expect(size.toArray()).toEqual([5, 12]);
    const vertex = vertexOf(graph);
    // the card sits at the frame camera plus its direction × distance, back in model space
    expect(vertex).toMatch(/inverse\(modelMatrix\) \* vec4\(wsFrameCamera \+ /u);
    expect(vertex).toContain('cross(');
    expect(vertex).toContain('aDirection');
    // the pole and a zero direction take a fallback basis rather than a degenerate cross product
    expect(vertex).toMatch(/abs\(t\d+_card\.y\) > 0\.999 \?/u);
    expect(vertex).toMatch(/dot\(t\d+_card, t\d+_card\) > 1e-8 \?/u);
    const pole = { ...graph, nodes: { ...graph.nodes, direction: { op: 'const', value: [0, 1, 0] } } };
    expect(vertexOf(pole)).toContain('cross(');
    expect(vertexOf({ ...pole, nodes: { ...pole.nodes, direction: { op: 'const', value: [0, 0, 0] } } })).toContain('cross(');
    expect(validateGraph({ ...graph, stages: { surface: { colour: 'card' } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, nodes: { ...graph.nodes, distance: { op: 'const', value: [1, 2] } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); }
});

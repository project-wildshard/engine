import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('vertex normal output reaches the ordinary transformed lighting normal', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'standard', nodes: {
    normal: { op: 'normalWorld' }, dx: { op: 'dFdx', in: ['normal'] },
  }, stages: { 'vertex.normal': { normal: [0, 0, 1] }, surface: { colour: 'normal' } } };
  const material = compileClassicGraph(graph).material;
  try {
    const vertex = material.vertexShader, main = vertex.slice(vertex.indexOf('void main()'));
    const assigned = main.search(/wsNormalLocal = wsInstanceTransform\( vec4\( vec3\(0\.0, 0\.0, 1\.0\), 0\.0 \) \)\.xyz;/u);
    expect(assigned).toBeGreaterThanOrEqual(0);
    // three's stock chunks transform it into the view normal the lighting reads
    expect(main.indexOf('objectNormal = wsNormalLocal;')).toBeGreaterThan(assigned);
    expect(main.indexOf('#include <defaultnormal_vertex>')).toBeGreaterThan(main.indexOf('objectNormal = wsNormalLocal;'));
  } finally { material.dispose(); }
  expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.normal': { normal: 'dx' } } }).ok).toBe(false);
  expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.normal': { normal: [1, 2] } } }).ok).toBe(false);
});

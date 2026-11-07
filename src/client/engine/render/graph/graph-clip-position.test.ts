import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('clip-space output bypasses projection and refuses conflicting stages', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    dx: { op: 'dFdx', in: [[1, 2, 3, 4]] },
  }, stages: { 'vertex.clip': { position: [0.25, 0.5, 0, 1] }, surface: { colour: [1, 1, 1] } } };
  const compiled = compileClassicGraph(graph), vertex = compiled.material.vertexShader;
  try {
    const main = vertex.slice(vertex.indexOf('void main()'));
    const clip = main.search(/gl_Position = vec4\(0\.25, 0\.5, 0\.0, 1\.0\)/u);
    expect(clip).toBeGreaterThan(-1);
    // the clip position is the draw's last word: no stock projection after it
    expect(main.slice(clip)).not.toMatch(/#include <project_vertex>/u);
  } finally { compiled.material.dispose(); }
  expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.offset': { offset: [0, 0, 0] } } }).ok).toBe(false);
  expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.clip': { position: [1, 2, 3] } } }).ok).toBe(false);
  expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.clip': { position: 'dx' } } }).ok).toBe(false);
});

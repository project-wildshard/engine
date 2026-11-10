// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import { expect, test } from 'vitest';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** a graph's classic program sources (a clone's, as a drawn variant's) */
function program(graph: GraphIr): { vertexShader: string; fragmentShader: string } {
  const compiled = compileClassicGraph(graph), material = compiled.material.clone(); compiled.material.dispose();
  try { return { vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }; } finally { material.dispose(); }
}

test('flat varyings preserve the provoking-vertex qualifier through validation, SDK authoring and both shaders', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    tint: { op: 'attribute', name: 'aDirection', type: 'vec3' },
    facet: { op: 'varying', in: ['tint'], interpolation: 'flat' },
  }, stages: { surface: { colour: 'facet' } } };
  const checked = validateGraph(graph);
  expect(checked.ok).toBe(true);
  expect(checked.ok ? checked.graph.nodes['facet']?.interpolation : null).toBe('flat');
  // three turns a classic `varying` into the vertex `out` and the fragment `in`, keeping its qualifier
  const shader = program(graph);
  const name = /flat\s+varying\s+vec3\s+(\w+)/u.exec(shader.vertexShader)?.[1];
  expect(name).toBeDefined();
  expect(shader.fragmentShader).toMatch(new RegExp(`flat\\s+varying\\s+vec3\\s+${String(name)}`, 'u'));
  const smooth = program({ ...graph, nodes: { ...graph.nodes, facet: { op: 'varying', in: ['tint'] } } });
  expect(smooth.vertexShader).not.toContain('flat ');
  expect(smooth.fragmentShader).not.toContain('flat ');
  expect(validateGraph({ ...graph, nodes: { ...graph.nodes, facet: { ...graph.nodes['facet'], interpolation: 'linear' } } }).ok).toBe(false);
  expect(validateGraph({ ...graph, nodes: { ...graph.nodes, tint: { ...graph.nodes['tint'], interpolation: 'flat' } } }).ok).toBe(false);
});

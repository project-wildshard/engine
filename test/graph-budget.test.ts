// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { MAX_GRAPH_BUDGET, validateGraph, type GraphIr, type GraphNode } from '@wildshard/format/materialGraph';
import { MaterialsSchema } from '@wildshard/format/materials';
import * as v from 'valibot';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { classicLookCompiler } from './fixtures/classicLookCompiler';
import { clientGraphs } from '../src/client/game/shardfile/clientGraphs';
import { emptyShardfile } from '../src/shared/host/author';

it('compiles a declared larger graph only with trusted authority and never substitutes a family', () => {
  const nodes: Record<string, GraphNode> = { colour: { op: 'const', value: [0.3, 0.6, 0.2] } };
  for (let index = 0; index < 200; index++) nodes[`row${index}`] = { op: 'add', in: [index === 0 ? 'colour' : `row${index - 1}`, 0.001] };
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', budget: { nodes: 256, samplers: 4, instructions: 1024 }, nodes, stages: { surface: { colour: 'row199' } } };
  expect(v.safeParse(MaterialsSchema, { meadow: { family: 'graph', graph } }).success).toBe(true);
  expect(validateGraph(graph).ok).toBe(false);
  const admitted = validateGraph(graph, { trustedBudget: true });
  if (!admitted.ok) throw new Error(admitted.errors.join('; '));
  expect(admitted.graph.budget).toEqual(graph.budget);
  expect(() => compileClassicGraph(graph)).toThrow();
  const source = emptyShardfile({ slug: 'graph-proof', name: 'Graph', author: 'Wildshard', seed: 1, revision: 1 });
  let fallbacks = 0;
  const options = { compiler: classicLookCompiler(), fallback: () => { fallbacks++; return new THREE.MeshBasicMaterial(); }, textures: () => { throw new Error('No texture expected'); } };
  const trusted = clientGraphs(source, { ...options, trustedGraphs: true });
  const material = trusted.compile({ family: 'graph', graph });
  material.dispose();
  expect(trusted.readout.compiled).toBeGreaterThan(0);
  expect(fallbacks).toBe(0);
  expect(() => clientGraphs(source, options).compile({ family: 'graph', graph })).toThrow();
  for (const key of ['nodes', 'samplers', 'instructions'] as const) {
    const over = { ...graph, budget: { ...graph.budget, ...MAX_GRAPH_BUDGET, [key]: MAX_GRAPH_BUDGET[key] + 1 } };
    expect(() => trusted.compile({ family: 'graph', graph: over })).toThrow('declared budget');
  }
  const tooSmall = { ...graph, budget: { nodes: 1, samplers: 1, instructions: 1 } };
  expect(() => trusted.compile({ family: 'graph', graph: tooSmall })).toThrow();
  expect(fallbacks).toBe(0);
});

// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { clientPostStack } from '../src/client/game/shardfile/clientPost';
import { MAX_GRAPH_BUDGET, validateGraph, type GraphIr, type GraphNode } from '@wildshard/format/materialGraph';
import { MaterialsSchema } from '@wildshard/format/materials';
import * as v from 'valibot';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { classicLookCompiler } from './fixtures/classicLookCompiler';
import { clientGraphs } from '../src/client/game/shardfile/clientGraphs';
import { emptyShardfile } from '../src/shared/host/author';

it('compiles a declared larger graph at its tier and refuses it at a smaller tier', () => {
  const nodes: Record<string, GraphNode> = { colour: { op: 'const', value: [0.3, 0.6, 0.2] } };
  for (let index = 0; index < 520; index++) nodes[`row${index}`] = { op: 'add', in: [index === 0 ? 'colour' : `row${index - 1}`, 0.001] };
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', budget: { nodes: 768, samplers: 4, instructions: 2048 }, nodes, stages: { surface: { colour: 'row519' } } };
  expect(v.safeParse(MaterialsSchema, { meadow: { family: 'graph', graph } }).success).toBe(true);
  expect(validateGraph(graph).ok).toBe(false);
  const admitted = validateGraph(graph, { declaredBudget: true });
  if (!admitted.ok) throw new Error(admitted.errors.join('; '));
  expect(admitted.graph.budget).toEqual(graph.budget);
  expect(() => compileClassicGraph(graph)).toThrow();
  const source = emptyShardfile({ slug: 'graph-proof', name: 'Graph', author: 'Wildshard', seed: 1, revision: 1 });
  let fallbacks = 0;
  const options = { compiler: classicLookCompiler(), fallback: () => { fallbacks++; return new THREE.MeshBasicMaterial(); }, textures: () => { throw new Error('No texture expected'); } };
  const large = clientGraphs({ ...source, budgets: { ...source.budgets, tier: 'large' } }, options);
  const material = large.compile({ family: 'graph', graph });
  material.dispose();
  expect(large.readout.compiled).toBeGreaterThan(0);
  expect(fallbacks).toBe(0);
  expect(() => clientGraphs(source, options).compile({ family: 'graph', graph })).toThrow('512');
  for (const key of ['nodes', 'samplers', 'instructions'] as const) {
    const over = { ...graph, budget: { ...graph.budget, ...MAX_GRAPH_BUDGET, [key]: MAX_GRAPH_BUDGET[key] + 1 } };
    expect(() => large.compile({ family: 'graph', graph: over })).toThrow('declared budget');
  }
  const tooSmall = { ...graph, budget: { nodes: 1, samplers: 1, instructions: 1 } };
  expect(() => large.compile({ family: 'graph', graph: tooSmall })).toThrow();
  expect(fallbacks).toBe(0);
});

it('refuses a post stack over the tier before creating a compiler', async () => {
  const source = emptyShardfile({ slug: 'post-budget', name: 'Post budget', author: 'Test', seed: 1, revision: 1 });
  const graph: GraphIr = { version: 1, kind: 'post', nodes: { colour: { op: 'const', value: [0.3, 0.6, 0.2] } },
    stages: { post: { colour: 'colour' } } };
  source.look = { ...source.look, post: [{ graph }, { graph }, { graph }] };
  const scope = new Scope('post-budget'), compiler = vi.fn(() => Promise.reject(new Error('Unexpected compiler')));
  try {
    await expect(clientPostStack(source, new Map(), { compiler, composer: () => { throw new Error('Unexpected composer'); },
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() }, scope, { enabled: true })).rejects.toThrow('3 passes (at most 2)');
    expect(compiler).not.toHaveBeenCalled();
  } finally { scope.dispose(); }
});

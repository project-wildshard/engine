import { expect, test } from 'vitest';
import { Material, ShaderMaterial, Vector3 } from 'three';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { classicLookCompiler } from './fixtures/classicLookCompiler';
import { clientGraphs } from '../src/client/game/shardfile/clientGraphs';
import { emptyShardfile } from '../src/shared/host/author';
import { validateGraph } from '@wildshard/format/materialGraph';

test('runtime graph uniforms move in place and refuse invalid writes atomically', () => {
  const source = emptyShardfile({ slug: 'param-fixture', name: 'Param', author: 'Test', seed: 1, revision: 1 });
  const graphs = clientGraphs(source, { compiler: classicLookCompiler(),
    fallback: () => { throw new Error('Unexpected fallback'); }, textures: () => { throw new Error('Unexpected texture'); } });
  const material = graphs.compile({ family: 'graph', graph: { version: 1, kind: 'material', model: 'unlit',
    params: { tint: { type: 'vec3', value: [0.2, 0.3, 0.4], min: 0, max: 1 } },
    nodes: { tint: { op: 'param', param: 'tint' } }, stages: { surface: { colour: 'tint' } } } });
  const foreign = new Material();
  try {
    if (!(material instanceof ShaderMaterial)) throw new Error('Missing graph material');
    // the surface colour reads the param's own uniform
    expect(material.fragmentShader).toContain('wsP_tint');
    const uniform = material.uniforms['wsP_tint'];
    if (uniform === undefined || !(uniform.value instanceof Vector3)) throw new Error('Missing live uniform');
    const before = material.version, value = [0.6, 0.7, 0.8];
    graphs.setParam(material, 'tint', value); value.fill(9);
    expect(uniform.value.toArray()).toEqual([0.6, 0.7, 0.8]);
    expect(material.version).toBe(before);
    const sparse: number[] = []; sparse.length = 3;
    for (const invalid of [0.5, [1, 2], [0, Number.NaN, 0], [-1, 0, 0], [0, 0, 2], sparse]) {
      expect(() => graphs.setParam(material, 'tint', invalid)).toThrow();
      expect(uniform.value.toArray()).toEqual([0.6, 0.7, 0.8]);
    }
    expect(() => graphs.setParam(material, 'absent', 1)).toThrow('no param');
    expect(() => graphs.setParam(foreign, 'tint', [0, 0, 0])).toThrow('no compiled graph');
  } finally { material.dispose(); foreign.dispose(); }
});


test('scalar uniforms preserve signed zero and refuse invalid writes before changing the value', () => {
  const checked = validateGraph({ version: 1, kind: 'material', model: 'unlit',
    params: { amount: { type: 'float', value: 0.5, min: 0, max: 1 } },
    nodes: { amount: { op: 'param', param: 'amount' } },
    stages: { surface: { colour: [1, 1, 1], alpha: 'amount' } } });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const compiled = compileClassicGraph(checked.graph, { validated: checked });
  try {
    const material = compiled.material;
    expect(material.fragmentShader).toContain('wsP_amount');
    const uniform = material.uniforms['wsP_amount'];
    if (uniform === undefined) throw new Error('Missing scalar uniform');
    const version = material.version;
    for (const value of [-0, 1, 0.5]) {
      compiled.setParam('amount', value);
      expect(Object.is(uniform.value, value)).toBe(true);
    }
    for (const [value, message] of [[Number.NaN, 'must be finite'], [Infinity, 'must be finite'],
      [-Infinity, 'must be finite'], [-1, 'outside declared range'], [2, 'outside declared range']] as const) {
      expect(() => compiled.setParam('amount', value)).toThrow(message);
      expect(uniform.value).toBe(0.5);
    }
    for (const value of [[], [0.5]]) {
      expect(() => compiled.setParam('amount', value)).toThrow('type mismatch');
      expect(uniform.value).toBe(0.5);
    }
    // A caller-supplied validation still exposes its graph: constraints are read live.
    const param = checked.graph.params?.['amount'];
    if (param === undefined) throw new Error('Missing scalar definition');
    Reflect.set(param, 'max', 0.25);
    // (a write of the value the uniform already holds returns before the check: NF15's held-value fast path)
    expect(() => compiled.setParam('amount', 0.3)).toThrow('outside declared range');
    expect(uniform.value).toBe(0.5);
    compiled.setParam('amount', 0.25);
    expect(uniform.value).toBe(0.25);
    expect(material.version).toBe(version);
  } finally { compiled.material.dispose(); }
});

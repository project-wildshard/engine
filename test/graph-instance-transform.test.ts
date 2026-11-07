import { expect, test } from 'vitest';
import { vec4 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { graph as authorGraph, instanceTransform } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('full instance placement reads the existing matrix and ordinary meshes use identity', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    raw: { op: 'positionGeometry' }, point: { op: 'combine', in: ['raw', 1] }, placed: { op: 'instanceTransform', in: ['point'] }, xyz: { op: 'swizzle', mask: 'xyz', in: ['placed'] },
  }, stages: { 'vertex.position': { position: 'xyz' }, surface: { colour: [0.2, 0.5, 0.1] } } };
  const compiled = compileClassicGraph(ir);
  try {
    const text = compiled.material.vertexShader, program = compiled.glsl.program;
    if (program === null) throw new Error('Missing program');
    // the graph's placement goes through the one instance helper
    expect(`${program.vertex.body}\n${program.outputs.position ?? ''}`).toContain('wsInstanceTransform(');
    const start = text.indexOf('vec4 wsInstanceTransform( vec4 v ) {'), helper = text.slice(start, text.indexOf('return v;', start));
    expect(start).toBeGreaterThanOrEqual(0);
    // an instanced draw (three's USE_INSTANCING) multiplies by the existing instanceMatrix; an ordinary mesh is identity
    expect(helper).toContain('#ifdef USE_INSTANCING\n  v = instanceMatrix * v;\n#endif');
    expect(helper.replaceAll(/#ifdef USE_(INSTANCING|BATCHING)\n[\s\S]*?#endif\n/g, '').trim()).toBe('vec4 wsInstanceTransform( vec4 v ) {');
    expect(authorGraph({ model: 'unlit', vertex: { offset: instanceTransform(vec4(0, 1, 0, 0)).xyz }, surface: { colour: [1, 1, 1] } }).nodes).toMatchObject({ n0: { op: 'instanceTransform' } });
    expect(validateGraph({ ...ir, stages: { surface: { colour: 'xyz' } } }).ok).toBe(false);
    expect(validateGraph({ ...ir, nodes: { ...ir.nodes, point: { op: 'const', value: [1, 2, 3] } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); }
});

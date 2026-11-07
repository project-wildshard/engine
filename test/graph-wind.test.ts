import { expect, test } from 'vitest';
import { vec2 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { windGustAt, windUniforms } from '../src/client/engine/world/wind';
import { graph, windGustAt as windOp } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { evalGlsl } from './fixtures/glslEval';

test('graph wind samples the CPU gust front and reads the existing live clock', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { point: { type: 'vec2', value: [0, 0] } }, nodes: {
      point: { op: 'param', param: 'point' }, at: { op: 'windGustAt', in: ['point'] },
      clock: { op: 'windTime' }, gust: { op: 'windGust' }, colour: { op: 'combine', in: ['at', 'clock', 'gust'] },
    }, stages: { surface: { colour: 'colour' } } };
  const compiled = compileClassicGraph(ir), time = windUniforms.uWindTime.value, gust = windUniforms.uGust.value;
  try {
    const material = compiled.material, program = compiled.glsl.program;
    if (program === null || program.outputs.colour === null) throw new Error('Missing graph wind colour');
    // the program reads the engine's own live wind clock and gust objects, not copies of them
    expect(material.uniforms['wsWindTime']).toBe(windUniforms.uWindTime);
    expect(material.uniforms['wsWindGust']).toBe(windUniforms.uGust);
    let step = 0;
    for (const [x, z] of [[0, 0], [-31, 16], [244, -183]]) {
      if (x === undefined || z === undefined) throw new Error('Missing sample');
      windUniforms.uWindTime.value = 4 + step * 23; windUniforms.uGust.value = 0.2 + step * 0.3; step++;
      compiled.setParam('point', [x, z]);
      const actual = evalGlsl(program.fragment.body, program.outputs.colour, material.uniforms);
      expect(actual[0]).toBeCloseTo(windGustAt(x, z), 5);
      expect(actual[1]).toBeCloseTo(windUniforms.uWindTime.value, 5);
      expect(actual[2]).toBeCloseTo(windUniforms.uGust.value, 5);
    }
    expect(validateGraph({ ...ir, nodes: { ...ir.nodes, point: { op: 'const', value: [1, 2, 3] } } }).ok).toBe(false);
    expect(validateGraph(graph({ model: 'unlit', surface: { colour: [1, 1, 1], alpha: windOp(vec2(1, 2)) } })).ok).toBe(true);
  } finally { compiled.material.dispose(); windUniforms.uWindTime.value = time; windUniforms.uGust.value = gust; }
});

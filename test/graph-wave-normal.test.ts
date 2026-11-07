import { expect, test } from 'vitest';
import * as THREE from 'three';
import { vec2 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { waveDisplace } from '../src/shared/engine/world/waves';
import { graph, gerstnerNormal } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { evalGlsl } from './fixtures/glslEval';

test('the analytic graph normal follows the shared CPU wave surface at rest points', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { at: { type: 'vec2', value: [0, 0] }, clock: { type: 'float', value: 0 }, damp: { type: 'float', value: 1 } },
    nodes: { at: { op: 'param', param: 'at' }, clock: { op: 'param', param: 'clock' }, damp: { op: 'param', param: 'damp' }, normal: { op: 'gerstnerNormal', in: ['at', 'clock', 'damp'] } },
    stages: { surface: { colour: 'normal' } } };
  const compiled = compileClassicGraph(ir), program = compiled.glsl.program;
  try {
    if (program === null || program.outputs.colour === null) throw new Error('Missing wave normal colour');
    const colour = program.outputs.colour;
    for (const [x, z, t, damp] of [[0, 0, 0, 0], [-13, 27, 9, 0.4], [144, -38, 57, 1]]) {
      if (x === undefined || z === undefined || t === undefined || damp === undefined) throw new Error('Missing wave sample');
      compiled.setParam('at', [x, z]); compiled.setParam('clock', t); compiled.setParam('damp', damp);
      const surface = (px: number, pz: number): THREE.Vector3 => {
        const d = waveDisplace(px, pz, t, damp, { x: 0, y: 0, z: 0 }); return new THREE.Vector3(px + d.x, d.y, pz + d.z);
      };
      const h = 0.001, tx = surface(x + h, z).sub(surface(x - h, z)), tz = surface(x, z + h).sub(surface(x, z - h));
      const expected = tz.cross(tx).normalize().toArray(), actual = evalGlsl(program.fragment.body, colour, compiled.material.uniforms);
      for (const [i, v] of expected.entries()) expect(actual[i]).toBeCloseTo(v, 5);
    }
    expect(validateGraph(graph({ model: 'unlit', surface: { colour: gerstnerNormal(vec2(0), 1, 1) } })).ok).toBe(true);
    expect(validateGraph({ ...ir, nodes: { ...ir.nodes, at: { op: 'const', value: [1, 2, 3] } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); }
});

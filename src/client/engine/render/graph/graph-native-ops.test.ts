import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { GERSTNER_TERMS, WAVES, waveDisplace } from '../../../../shared/engine/world/waves';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** the classic program's stage source, as the shipped GLSL back-end compiles it */
function program(graph: GraphIr): { vertexShader: string; fragmentShader: string } {
  const material = compileClassicGraph(graph).material;
  try { return { vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }; } finally { material.dispose(); }
}

test('fragment derivatives build a faceted normal and refuse vertex use', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    point: { op: 'positionWorld' }, dx: { op: 'dFdx', in: ['point'] }, dy: { op: 'dFdy', in: ['point'] },
    face: { op: 'cross', in: ['dx', 'dy'] }, normal: { op: 'normalize', in: ['face'] },
  }, stages: { surface: { colour: 'normal' } } };
  const shader = program(graph);
  expect(shader.fragmentShader).toContain('dFdx(');
  expect(shader.fragmentShader).toContain('dFdy(');
  expect(shader.fragmentShader).toContain('cross(');
  expect(validateGraph({ ...graph, stages: { 'vertex.offset': { offset: 'normal' } } }).ok).toBe(false);
  expect(validateGraph({ ...graph, nodes: { ...graph.nodes, face: { op: 'cross', in: [[1, 2], [3, 4]] } } }).ok).toBe(false);
});

test('Gerstner graph displacement shares the CPU wave model and builds real vertex GLSL', () => {
  for (const [x, z, time, damp] of [[0, 0, 0, 1], [12, -9, 3.2, 0.6], [-40, 51, 19, 0]]) {
    if (x === undefined || z === undefined || time === undefined || damp === undefined) throw new Error('Missing sample');
    const expected = { x: 0, y: 0, z: 0 };
    for (const [wx, wz, amplitude, length, speed, q] of WAVES) {
      const k = Math.PI * 2 / length, phase = k * (wx * x + wz * z - speed * time);
      const qa = (q / (k * amplitude * WAVES.length)) * amplitude;
      expected.x += wx * qa * Math.cos(phase); expected.y += amplitude * Math.sin(phase); expected.z += wz * qa * Math.cos(phase);
    }
    expected.x *= damp; expected.y *= damp; expected.z *= damp;
    expect(waveDisplace(x, z, time, damp, { x: 0, y: 0, z: 0 })).toEqual(expected);
  }
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    rest: { op: 'swizzle', in: ['point'], mask: 'xz' }, point: { op: 'positionLocal' },
    waves: { op: 'gerstner', in: ['rest', 3.2, 0.6] },
  }, stages: { 'vertex.offset': { offset: 'waves' }, surface: { colour: [0.1, 0.2, 0.3] } } };
  const shader = program(graph);
  expect(shader.vertexShader).toContain('sin('); expect(shader.vertexShader).toContain('cos(');
  expect(GERSTNER_TERMS).toHaveLength(WAVES.length);
  const valid = validateGraph(graph);
  if (!valid.ok) throw new Error(valid.errors.join('; '));
  expect(valid.cost.instructions).toBeGreaterThanOrEqual(120);
  expect(validateGraph({ ...graph, nodes: { ...graph.nodes, waves: { op: 'gerstner', in: ['point', 3.2, 0.6] } } }).ok).toBe(false);
});

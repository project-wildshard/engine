import { expect, test } from 'vitest';
import { validateGraph, type GraphIr, type GraphRef } from '@wildshard/format/materialGraph';
import { emitGraphGlsl } from './glsl';
import { compileClassicGraph } from './glslMaterial';

function rounded(value: GraphRef): GraphIr {
  const width = typeof value === 'number' ? 1 : Array.isArray(value) ? value.length : 1;
  return { version: 1, kind: 'post', nodes: { rounded: { op: 'float16', in: [value] },
    rgb: width === 2 ? { op: 'combine', in: ['rounded', 0] } : { op: 'swizzle', in: ['rounded'], mask: width === 1 ? 'xxx' : 'xyz' } }, stages: { post: { colour: 'rgb' } } };
}

test('native half packing keeps each numeric width and spends every component under the existing budget', () => {
  for (const value of [0.1234567, [0.1, -0.2], [0.1, 0.2, 0.3], [0.1, 0.2, 0.3, 0.4]]) {
    const graph = rounded(value), checked = validateGraph(graph);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const width = typeof value === 'number' ? 1 : value.length;
    const control = validateGraph({ ...graph, nodes: { ...graph.nodes, rounded: { op: 'abs', in: [value] } } });
    if (!control.ok) throw new Error(control.errors.join('; '));
    expect(checked.cost.instructions - control.cost.instructions).toBe(3 * width);
    expect(validateGraph({ ...graph, budget: { instructions: checked.cost.instructions - 1 } }).ok).toBe(false);
    const body = emitGraphGlsl(graph).program?.fragment.body;
    expect(body).toContain('unpackHalf2x16(packHalf2x16(');
    compileClassicGraph(graph).material.dispose();
  }
});

test('half packing refuses booleans and every non-post stage', () => {
  expect(validateGraph({ ...rounded(0), nodes: { truth: { op: 'gt', in: [1, 0] }, rounded: { op: 'float16', in: ['truth'] } } }).ok).toBe(false);
  expect(validateGraph({ ...rounded([0.1, 0.2, 0.3]), kind: 'material', model: 'unlit', stages: { surface: { colour: 'rounded' } } }).ok).toBe(false);
  expect(validateGraph({ ...rounded([0.1, 0.2, 0.3]), kind: 'fog', stages: { fog: { colour: 'rounded' } } }).ok).toBe(false);
});

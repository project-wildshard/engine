import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

const glow = (): GraphIr => ({ version: 1, kind: 'material', model: 'unlit', nodes: {}, stages: { surface: { colour: [1, 0.5, 0] } } });

test('compile takes the caller\'s validation of the same graph instead of repeating it (O14)', () => {
  const checked = validateGraph(glow());
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const compiled = compileClassicGraph(checked.graph, { validated: checked });
  expect(compiled.cost).toBe(checked.cost);
  compiled.material.dispose();
});

test('a validation of another graph is refused', () => {
  const checked = validateGraph(glow());
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  expect(() => compileClassicGraph(glow(), { validated: checked })).toThrow(/another graph/);
});

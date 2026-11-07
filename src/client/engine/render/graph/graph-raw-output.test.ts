import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** the classic program's fragment main: the output steps three runs for the draw are its chunks */
function onScreen(graph: GraphIr): { fragment: string; toneMapped: boolean } {
  const material = compileClassicGraph(graph).material, fragment = material.fragmentShader;
  try { return { fragment: fragment.slice(fragment.indexOf('void main()')), toneMapped: material.toneMapped }; } finally { material.dispose(); }
}
const colour = (model: 'unlit' | 'standard'): GraphIr => ({ version: 1, kind: 'material', model, nodes: {}, stages: { surface: { colour: [0.6, 0.05, 0.04] } }, effectState: { fog: false } });
const ENCODE = /#include <colorspace_fragment>/u, TONE = /#include <tonemapping_fragment>/u;

// G477 OE: an unlit graph stands for a raw GLSL program (a ShaderMaterial without colorspace_fragment). Drawn to the
// screen (a plain capture, the map bake) it wrote sRGB-encoded colour, paler than the program it replaced: Nine's lantern
test('an unlit graph has no output transform on screen; a lit graph keeps the classic sRGB encode', () => {
  const unlit = onScreen(colour('unlit')), lit = onScreen(colour('standard'));
  expect(unlit.fragment).not.toMatch(ENCODE);
  expect(unlit.fragment).not.toMatch(TONE);
  expect(unlit.toneMapped).toBe(false);
  expect(lit.fragment).toMatch(ENCODE);
});

test('a clone of an unlit graph keeps its raw output', () => {
  const material = compileClassicGraph(colour('unlit')).material;
  try { expect(material.clone().userData['graphRawOutput']).toBe(true); } finally { material.dispose(); }
});

test('explicit linear colour output encodes the display without tone mapping', () => {
  const graph: GraphIr = { ...colour('unlit'), effectState: { fog: false, output: 'colour' } };
  const checked = validateGraph(graph); expect(checked.ok).toBe(true);
  if (!checked.ok) throw new Error('Invalid colour output');
  expect(checked.graph.effectState?.output).toBe('colour');
  const shader = onScreen(checked.graph), material = compileClassicGraph(checked.graph).material;
  try {
    expect(shader.fragment).toMatch(ENCODE); expect(shader.fragment).not.toMatch(TONE);
    expect(material.userData['graphRawOutput']).toBeUndefined();
  } finally { material.dispose(); }
  expect(validateGraph({ ...graph, model: 'standard' }).ok).toBe(false);
  expect(validateGraph({ ...graph, effectState: { output: 'unknown' } }).ok).toBe(false);
  expect(validateGraph({ ...graph, effectState: { output: 'colour', blend: 'alpha' } }).ok).toBe(false);
  expect(validateGraph({ ...graph, stages: { surface: { colour: [1, 1, 1], targetAlpha: 0.5 } } }).ok).toBe(false);
});

// G478 OE2: three forces an opaque draw's alpha to 1, where the GLSL programs Nine's graphs replaced wrote near / viewZ
// (its post blends by it), so the graph lanterns took the post's full grade. `surface.targetAlpha` writes it again.
test('an opaque graph writes its surface.targetAlpha; without one the alpha stays three\'s', () => {
  const plain = onScreen(colour('unlit'));
  const targeted = onScreen({ ...colour('unlit'), nodes: { k: { op: 'const', value: 0.375 } }, stages: { surface: { colour: [0.6, 0.05, 0.04], targetAlpha: 'k' } } });
  expect(targeted.fragment).toMatch(/0\.375/u);
  expect(plain.fragment).not.toMatch(/0\.375/u);
});

test('surface.targetAlpha takes cameraNear over the view depth, and is refused on a blended graph', () => {
  const graph = (blend: boolean): unknown => ({
    version: 1, kind: 'material', model: 'unlit',
    nodes: { n: { op: 'cameraNear' }, v: { op: 'positionView' }, z: { op: 'swizzle', in: ['v'], mask: 'z' }, d: { op: 'negate', in: ['z'] }, m: { op: 'max', in: ['d', 'n'] }, a: { op: 'div', in: ['n', 'm'] } },
    stages: { surface: { colour: [1, 0, 0], targetAlpha: 'a' } },
    effectState: blend ? { fog: false, blend: 'additive' } : { fog: false },
  });
  expect(validateGraph(graph(false)).ok).toBe(true);
  const refused = validateGraph(graph(true));
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.errors.join('\n')).toMatch(/targetAlpha: an opaque draw only/u);
});

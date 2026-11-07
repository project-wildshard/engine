// NF13: every op of the graph vocabulary lowers to classic GLSL in a stage it may run in, a toon graph lowers through the
// family's preset, the lowering is byte-stable, and its selects branch only where compile.ts branches.
import { expect, test } from 'vitest';
import { GRAPH_OPS, validateGraph, type GraphNode, type GraphRef } from '@wildshard/format/materialGraph';
import { emitGraphGlsl, type GraphGlsl } from './glsl';
import { emitClassicGraph, graphShaders } from './glslProgram';
import { ToonLook } from '../families/toon';

/** literal inputs of the types each rule reads (`b` is a bool node every graph carries) */
function inputsOf(op: string): readonly GraphRef[] {
  const rule = GRAPH_OPS[op]?.rule;
  const [min] = GRAPH_OPS[op]?.arity ?? [0];
  switch (rule) {
    case 'same': return min === 3 ? [0.5, 0, 1] : [0.5, 0.25];
    case 'unary': return [0.5];
    case 'fogSample': return [[0.2, 0.3, 0.4], [0.1, 0.2, 0.3], [1, 2, 3], [0, 0, 0], 1];
    case 'vecUnary': case 'length': case 'point3': case 'dir3': return [[0.2, 0.9, 0.1]];
    case 'dot': case 'cross': case 'pointPair': return [[1, 0, 0], [0, 1, 0]];
    case 'mix': return [0, 1, 0.5];
    case 'compare': return [0.1, 0.2];
    case 'logic': return ['b', 'b'];
    case 'not': return ['b'];
    case 'select': return ['b', 1, 0];
    case 'gerstner': return [[1, 2], 0.5, 1];
    case 'swizzle': case 'noise': case 'windField': return op === 'swizzle' ? [[1, 2, 3]] : [[1, 2]];
    case 'combine': return [1, 2];
    case 'instanceTransform': return [[0, 0, 0, 1]];
    case 'varying': case 'arrayElement': case 'loop': return [0.5];
    case 'cameraBillboard': return [[0, 0, -1], 5, [0.5, 0.5]];
    case 'sceneTap': return op === 'sceneColourAt' ? [[0.5, 0.5]] : [];
    case 'texture': return op === 'textureArray' ? [[0.5, 0.5], 1] : op === 'texture3D' ? [[0.5, 0.5, 0.5]] : op === 'textureLod' ? [[0.5, 0.5], 0]
      : op === 'textureGrad' ? [[0.5, 0.5], [0.01, 0], [0, 0.01]] : [[0.5, 0.5]];
    case 'acc': case 'attribute': case 'const': case 'index': case 'input': case 'param': case undefined: return [];
    default: throw new Error(`no probe inputs for ${op}`);
  }
}
/** one node using `op`, with the fields its rule needs */
function nodeOf(op: string): GraphNode {
  const node: GraphNode = { op, in: inputsOf(op) };
  if (op === 'acc' || op === 'index') return { op: 'loop', in: [0], count: 3, body: { nodes: { s: { op: 'add', in: [op === 'acc' ? 'a' : 'i', 1] }, a: { op: 'acc' }, i: { op: 'index' } }, out: 's' } };
  if (op === 'loop') return { ...node, count: 3, body: { nodes: { s: { op: 'add', in: ['a', 'i'] }, a: { op: 'acc' }, i: { op: 'index' } }, out: 's' } };
  if (op === 'fogSample') return { ...node, name: 'fixture.haze' };
  if (op === 'swizzle') return { ...node, mask: 'xz' };
  if (op === 'const') return { op, value: [1, 0, 0] };
  if (op === 'param') return { op, param: 'p' };
  if (op === 'arrayElement') return { ...node, param: 'list' };
  if (op === 'attribute') return { op, name: 'aSeed', type: 'float' };
  if (GRAPH_OPS[op]?.rule === 'texture') return { ...node, param: op === 'textureArray' ? 'layers' : op === 'texture3D' ? 'volume' : 'map' };
  return node;
}
/** a whole graph reading `op` (adapted to a vec3 by `adapt`) in the first stage its places allow */
function graphOf(op: string, adapt: 'vec3' | 'float' | 'vec2' | 'vec4' | 'bool'): unknown {
  const places = GRAPH_OPS[op]?.places;
  const out = adapt === 'vec3' ? 'x' : 'y';
  const adapter: Record<string, GraphNode> = adapt === 'vec3' ? {} : {
    y: adapt === 'bool' ? { op: 'select', in: ['x', [1, 1, 1], [0, 0, 0]] } : adapt === 'float' ? { op: 'mul', in: [[1, 1, 1], 'x'] }
      : adapt === 'vec2' ? { op: 'combine', in: ['x', 0] } : { op: 'swizzle', in: ['x'], mask: 'xyz' },
  };
  const nodes = { b: { op: 'lt', in: [0.1, 0.2] }, x: nodeOf(op), ...adapter };
  const params = { p: { type: 'float', value: 1 }, map: { type: 'texture', value: 'map', role: 'lent' }, layers: { type: 'texture', value: 'layers', role: 'lent' },
    volume: { type: 'texture', value: 'volume', role: 'lent' } };
  const postFog = op === 'fogSample' ? { name: 'fixture.haze', graph: { version: 1, kind: 'fog',
    nodes: { input: { op: 'fogInput' }, colour: { op: 'mul', in: ['input', 0.5] } }, stages: { fog: { colour: 'colour', transmission: 0.5 } } } } : undefined;
  const base = { version: 1, params, arrays: { list: { type: 'float', value: [1, 2, 3] } }, nodes, ...(postFog === undefined ? {} : { postFog }) };
  const at = (place: string): boolean => places === undefined || places.some(p => p === place);
  if (op === 'pointCoord') return { ...base, kind: 'material', model: 'unlit', primitive: 'points', stages: { points: { size: 4 }, surface: { colour: out } } };
  if (at('fragment')) return { ...base, kind: 'material', model: 'unlit', stages: { surface: { colour: out } } };
  if (at('vertex')) return { ...base, kind: 'material', model: 'unlit', stages: { 'vertex.offset': { offset: out }, surface: { colour: [1, 1, 1] } } };
  if (at('sun')) return { ...base, kind: 'material', model: 'standard', stages: { surface: { colour: [1, 1, 1] }, lighting: { sun: out } } };
  if (at('ambient')) return { ...base, kind: 'material', model: 'standard', stages: { surface: { colour: [1, 1, 1] }, lighting: { sun: [0, 0, 0], ambient: out } } };
  if (at('grade')) return { ...base, kind: 'material', model: 'standard', stages: { surface: { colour: [1, 1, 1] }, lighting: { sun: [0, 0, 0], grade: out } } };
  if (at('post')) return { ...base, kind: 'post', stages: { post: { colour: out } } };
  return { version: 1, kind: 'fog', nodes, stages: { fog: { colour: out } } };
}
const ADAPTS = ['vec3', 'float', 'vec2', 'vec4', 'bool'] as const;
/** the op's graph, adapted to whichever output type validation accepts */
function validGraphOf(op: string): unknown {
  for (const adapt of ADAPTS) { const graph = graphOf(op, adapt); if (validateGraph(graph).ok) return graph; }
  const errors = validateGraph(graphOf(op, 'vec3'));
  throw new Error(`${op}: no valid probe graph (${errors.ok ? '' : errors.errors.join('; ')})`);
}

test('every op of the vocabulary lowers to GLSL in a stage it may run in', () => {
  const lowered: string[] = [];
  for (const op of Object.keys(GRAPH_OPS)) {
    const glsl = emitGraphGlsl(validGraphOf(op));
    const code = [glsl.program?.vertex.body, glsl.program?.fragment.body, glsl.program?.fragment.head, glsl.fog].join('\n');
    expect(code.length, op).toBeGreaterThan(0);
    if (op === 'fogSample') {
      expect(glsl.postFog?.fogSample).toContain('vec4 wsGraphFogSample(');
      expect(glsl.program?.fragment.body).toContain('wsGraphFogSample(');
    }
    lowered.push(op);
  }
  expect(lowered).toEqual(Object.keys(GRAPH_OPS));
});

/** Reports are optional at both the caller and its named dependency; all executable output remains identical. */
function withoutReports(graph: GraphGlsl): unknown {
  const { executionCost, postFog, ...rest } = graph; void executionCost;
  return { ...rest, ...(postFog === undefined ? {} : { postFog: withoutReports(postFog) }) };
}

test('lowering is byte-stable, and every op wraps into a classic program', () => {
  const look = new ToonLook();
  const toon = { version: 1, kind: 'material', model: 'toon', nodes: {}, stages: { surface: { colour: [0.4, 0.6, 0.2] } } };
  for (const graph of [...Object.keys(GRAPH_OPS).map(validGraphOf), toon]) {
    const once = emitClassicGraph(graph, { toonLook: look }), twice = emitClassicGraph(structuredClone(graph), { toonLook: look });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const { executionCost, ...census } = emitClassicGraph(graph, { toonLook: look, reportExecutionCost: true });
    expect(executionCost).toBeDefined();
    expect(withoutReports(census)).toEqual(once);
    if (census.postFog !== undefined) expect(census.postFog.executionCost).toBeDefined();
    if (once.program === null) continue;
    const shaders = graphShaders(once, { toonLook: look }), again = graphShaders(twice, { toonLook: look });
    expect(again.vertexShader).toBe(shaders.vertexShader);
    expect(again.fragmentShader).toBe(shaders.fragmentShader);
    expect(Object.keys(again.uniforms)).toEqual(Object.keys(shaders.uniforms));
  }
});

test('a toon graph lights through the family preset, reading its uniforms by reference', () => {
  const look = new ToonLook();
  const glsl = emitClassicGraph({ version: 1, kind: 'material', model: 'toon', nodes: {}, stages: { surface: { colour: [0.4, 0.6, 0.2] } } }, { toonLook: look });
  expect(glsl.program?.lighting?.sun).toBe(true);
  expect(glsl.program?.fragment.head).toContain('vec4 wsGraphSun(');
  const shaders = graphShaders(glsl, { toonLook: look });
  expect(shaders.lights).toBe(true);
  expect(shaders.uniforms['famToonFace']).toBe(look.uniforms.famToonFace);
});

test('a select branches only on an expensive side, and the operands both sides share are built before it', () => {
  const graph = { version: 1, kind: 'material', model: 'unlit', nodes: {
    b: { op: 'lt', in: [0.1, 0.2] }, own: { op: 'noise', in: [[1, 2]] }, shared: { op: 'noise', in: [[5, 6]] },
    n1: { op: 'add', in: ['own', 'shared'] }, n2: { op: 'mul', in: ['shared', 2] },
    far: { op: 'select', in: ['b', 'n1', 'n2'] }, near: { op: 'select', in: ['b', 0.25, 0.75] }, c: { op: 'combine', in: ['far', 'near', 0] },
  }, stages: { surface: { colour: 'c' } } };
  const program = emitGraphGlsl(graph).program;
  const body = program?.fragment.body ?? '', branch = body.indexOf('if (');
  expect(program?.selects).toEqual({ light: 1, branch: 1 });
  expect(body.indexOf('vec2(5.0, 6.0)')).toBeLessThan(branch);
  expect(body.indexOf('vec2(1.0, 2.0)')).toBeGreaterThan(branch);
  expect(body.match(/mx_perlin_noise_float/g)).toHaveLength(2);
});

test('selects on one condition that share an operand branch together, so the operand runs only in their branch', () => {
  // G5: a kit kind's cell read by its colour and its emit select hoisted over every pixel when each select branched alone
  const graph = { version: 1, kind: 'material', model: 'unlit', nodes: {
    b: { op: 'lt', in: [0.1, 0.2] }, cell: { op: 'noise', in: [[5, 6]] }, col: { op: 'mul', in: ['cell', 3] }, glow: { op: 'add', in: ['cell', 1] },
    colour: { op: 'select', in: ['b', 'col', 0.5] }, emit: { op: 'select', in: ['b', 'glow', 0] }, other: { op: 'noise', in: [[7, 8]] },
    alone: { op: 'select', in: ['b', 'other', 0.25] }, c: { op: 'combine', in: ['colour', 'emit', 'alone'] },
  }, stages: { surface: { colour: 'c' } } };
  const body = emitGraphGlsl(graph).program?.fragment.body ?? '';
  const first = body.indexOf('if (');
  // the shared cell is built once, inside the first branch, with both selects' values assigned there
  expect(body.match(/vec2\(5\.0, 6\.0\)/g)).toHaveLength(1);
  expect(body.indexOf('vec2(5.0, 6.0)')).toBeGreaterThan(first);
  expect(body.slice(first, body.indexOf('} else {')).match(/t\d+_(colour|emit) =/g)).toHaveLength(2);
  // a select sharing nothing with them keeps its own branch
  expect(body.match(/if \(/g)).toHaveLength(2);
});

test('a select on the same condition that reads another one is not pulled into its branch', () => {
  const graph = { version: 1, kind: 'material', model: 'unlit', nodes: {
    b: { op: 'lt', in: [0.1, 0.2] }, cell: { op: 'noise', in: [[5, 6]] }, own: { op: 'noise', in: [[7, 8]] }, first: { op: 'select', in: ['b', 'cell', 0] },
    after: { op: 'mul', in: ['first', 'own'] }, second: { op: 'select', in: ['b', 'after', 1] }, c: { op: 'combine', in: ['first', 'second', 0] },
  }, stages: { surface: { colour: 'c' } } };
  const body = emitGraphGlsl(graph).program?.fragment.body ?? '';
  expect(body.match(/if \(/g)).toHaveLength(2);
});

test('a value first built inside one arm is built again where the other arm reads it, never read out of its block', () => {
  const graph = { version: 1, kind: 'material', model: 'unlit', nodes: {
    b: { op: 'lt', in: [0.1, 0.2] }, heavy: { op: 'noise', in: [[3, 4]] }, x: { op: 'mul', in: ['heavy', 3] },
    s: { op: 'select', in: ['b', 'x', 0] }, c: { op: 'combine', in: ['s', 'heavy', 0] },
  }, stages: { surface: { colour: 'c' } } };
  const body = emitGraphGlsl(graph).program?.fragment.body ?? '';
  const declared = [...body.matchAll(/^(\s*)float (t\d+_heavy) =/gm)];
  // heavy is the arm's own and a later read's: each block that reads it declares it
  expect(declared.length).toBeGreaterThan(0);
  for (const [, indent = '', name = ''] of declared) {
    const uses = [...body.matchAll(new RegExp(`^(\\s*).*\\b${name}\\b`, 'gm'))];
    for (const [, useIndent = ''] of uses) expect(useIndent.length).toBeGreaterThanOrEqual(indent.length);
  }
});

test('a fogged graph reads its fog zenith from the level\'s colour-ramp fog, else the fog colour', () => {
  const material = graphShaders(emitClassicGraph({ version: 1, kind: 'material', model: 'unlit', nodes: { z: { op: 'fogZenithColour' } }, stages: { surface: { colour: 'z' } } }));
  expect(material.fragmentShader).toContain('#define wsFogZenithColour fogRampZenith');
  expect(material.fragmentShader).toContain('#define wsFogZenithColour fogColor');
  expect(material.fragmentShader.indexOf('#include <fog_pars_fragment>')).toBeLessThan(material.fragmentShader.indexOf('WS_FOG_RAMP_ZENITH'));
});

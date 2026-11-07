import { expect, it } from 'vitest';
import * as THREE from 'three';
import type { GraphIr } from '@wildshard/format/materialGraph';
import { compileClassicGraph } from './glslMaterial';

const sampled = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
/** the classic program's fragment main */
function fragment(graph: GraphIr): string {
  const material = compileClassicGraph(graph, { textures: () => sampled }).material, shader = material.fragmentShader;
  try { return shader.slice(shader.indexOf('void main()')); } finally { material.dispose(); }
}

it('keeps costly texture arms outside divergent shader branches', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { mapA: { type: 'texture', value: 'a'.repeat(64) }, mapB: { type: 'texture', value: 'b'.repeat(64) } },
    nodes: { uv: { op: 'uv' }, condition: { op: 'lt', in: [0.2, 0.5] },
      a: { op: 'texture', param: 'mapA', in: ['uv'] }, b: { op: 'texture', param: 'mapB', in: ['uv'] },
      rgbA: { op: 'swizzle', in: ['a'], mask: 'xyz' }, rgbB: { op: 'swizzle', in: ['b'], mask: 'xyz' },
      costlyA: { op: 'pow', in: ['rgbA', 2] }, costlyB: { op: 'pow', in: ['rgbB', 3] },
      colour: { op: 'select', in: ['condition', 'costlyA', 'costlyB'] } },
    stages: { surface: { colour: 'colour' } },
  };
  const compiled = compileClassicGraph(graph, { textures: () => sampled });
  try {
    expect(compiled.selects.branch).toBe(0);
    expect(compiled.selects.light).toBeGreaterThan(0);
    const shader = fragment(graph);
    expect(shader).toContain('mix(');
    expect(shader).toContain('texture(');
    expect(shader).not.toMatch(/\bif \(/u);
    // both sampled arms are built before the select mixes them
    expect(shader.lastIndexOf('pow(')).toBeLessThan(shader.indexOf('mix('));
    const booleanArms: GraphIr = { ...graph, nodes: { ...graph.nodes,
      scalarA: { op: 'swizzle', in: ['costlyA'], mask: 'x' }, scalarB: { op: 'swizzle', in: ['costlyB'], mask: 'x' },
      testA: { op: 'lt', in: ['scalarA', 0.5] }, testB: { op: 'lt', in: ['scalarB', 0.5] },
      chosen: { op: 'select', in: ['condition', 'testA', 'testB'] },
      colour: { op: 'select', in: ['chosen', [0.2, 0.5, 0.2], [0.5, 0.2, 0.2]] } } };
    const booleanCompiled = compileClassicGraph(booleanArms, { textures: () => sampled });
    try { expect(booleanCompiled.selects.branch).toBe(0); expect(fragment(booleanArms)).not.toMatch(/\bif \(/u); }
    finally { booleanCompiled.material.dispose(); }
  } finally { compiled.material.dispose(); }
});

it('branches around rejected arithmetic inside a bounded loop', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { limit: { type: 'float', value: 2 } },
    nodes: { limit: { op: 'param', param: 'limit' },
      fog: { op: 'loop', count: 8, in: [[0, 0, 0]], body: { nodes: {
        i: { op: 'index' }, acc: { op: 'acc' }, condition: { op: 'lt', in: ['i', 'limit'] },
        p: { op: 'combine', in: ['i', 'i'] }, noise: { op: 'noise', in: ['p'] },
        colour: { op: 'mul', in: ['noise', [1, 1, 1]] },
        contribution: { op: 'add', in: ['acc', 'colour'] },
        chosen: { op: 'select', in: ['condition', 'contribution', 'acc'] },
      }, out: 'chosen' } } }, stages: { surface: { colour: 'fog' } } };
  const shader = fragment(graph);
  expect(shader).toMatch(/for\s*\([^]*if\s*\(/u);
  expect(shader).toMatch(/if\s*\([^]*noise_float/u);
});

it('computes a reused branch result before its separate consumers', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { a: { type: 'float', value: 0.4 }, b: { type: 'float', value: 0.6 } },
    nodes: { a: { op: 'param', param: 'a' }, b: { op: 'param', param: 'b' },
      ca: { op: 'lt', in: ['a', 0.5] }, cb: { op: 'lt', in: ['b', 0.5] },
      uv: { op: 'uv' }, seed: { op: 'noise', in: ['uv'] },
      shared: { op: 'select', in: ['ca', 'seed', 0] },
      uvA: { op: 'add', in: ['uv', [0.2, 0.3]] }, uvB: { op: 'add', in: ['uv', [0.7, 0.8]] },
      na: { op: 'noise', in: ['uvA'] }, nb: { op: 'noise', in: ['uvB'] },
      va: { op: 'add', in: ['shared', 'na'] }, vb: { op: 'add', in: ['shared', 'nb'] },
      first: { op: 'select', in: ['ca', 'va', 0] }, second: { op: 'select', in: ['cb', 'vb', 0] },
      sum: { op: 'add', in: ['first', 'second'] }, colour: { op: 'mul', in: ['sum', [1, 1, 1]] },
    }, stages: { surface: { colour: 'colour' } } };
  const shader = fragment(graph);
  expect(shader.match(/mx_perlin_noise_float\(/gu)).toHaveLength(3);
  // the shared result is built once, before both consumers' branches
  const shared = shader.search(/t\d+_shared = t\d+_seed;/u);
  expect(shared).toBeGreaterThan(-1);
  expect(shader.indexOf('_na = ')).toBeGreaterThan(shared);
  expect(shader.indexOf('_nb = ')).toBeGreaterThan(shared);
});

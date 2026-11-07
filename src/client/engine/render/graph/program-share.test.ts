import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import type { GraphIr } from '@wildshard/format/materialGraph';

const GRAPH = (k: number, op: 'mul' | 'add' = 'mul'): GraphIr => ({ version: 1, kind: 'material', model: 'unlit', effectState: { fog: false },
  params: { k: { type: 'float', value: k }, painting: { type: 'texture', value: 'painting', role: 'lent' } },
  nodes: { uv: { op: 'uv' }, tap: { op: 'texture', param: 'painting', in: ['uv'] }, rgb: { op: 'swizzle', in: ['tap'], mask: 'xyz' },
    k: { op: 'param', param: 'k' }, out: { op, in: ['rgb', 'k'] } },
  stages: { surface: { colour: 'out' } } });

test('equal graphs key one program; another shape keys its own', () => {
  // three keys a classic program by its stage source, defines and cache key: equal graphs whose params differ only by
  // value share one program, their values in their own uniforms
  const a = compileClassicGraph(GRAPH(0.25)), b = compileClassicGraph(GRAPH(0.75)), c = compileClassicGraph(GRAPH(0.25, 'add'));
  try {
    expect(b.material.vertexShader).toBe(a.material.vertexShader);
    expect(b.material.fragmentShader).toBe(a.material.fragmentShader);
    expect(b.material.defines).toEqual(a.material.defines);
    expect(b.material.customProgramCacheKey()).toBe(a.material.customProgramCacheKey());
    expect(c.material.fragmentShader).not.toBe(a.material.fragmentShader);
    expect(a.material.uniforms['wsP_k']?.value).toBe(0.25);
    expect(b.material.uniforms['wsP_k']?.value).toBe(0.75);
    expect(b.material.uniforms['wsP_k']).not.toBe(a.material.uniforms['wsP_k']);
  } finally { a.material.dispose(); b.material.dispose(); c.material.dispose(); }
});

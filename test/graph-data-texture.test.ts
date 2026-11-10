// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import { expect, it, vi } from 'vitest';
import { DataTexture, NoColorSpace } from 'three';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';

it('samples numerical library channels at computed UVs without colour conversion', () => {
  const raster = { width: 2, height: 1, pixels: new Uint8ClampedArray([32, 88, 0, 255, 210, 19, 0, 255]) };
  // The lossless linear bake of these channels is proved in sharddev; here the decoded bytes are the raster itself.
  const map = new DataTexture(Uint8Array.from(raster.pixels), raster.width, raster.height);
  const texture = vi.fn((_ref: string, role?: 'colour' | 'data') => {
    if (role !== 'data') throw new Error('Numerical sampler lost its data role');
    map.colorSpace = NoColorSpace; return map;
  });
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { noise: { type: 'texture', value: 'noise.ktx2', role: 'data' } },
    nodes: { uv: { op: 'uv' }, scroll: { op: 'add', in: ['uv', [0.1, 0.2]] },
      sample: { op: 'texture', param: 'noise', in: ['scroll'] }, density: { op: 'swizzle', in: ['sample'], mask: 'x' } },
    stages: { surface: { colour: 'density' } },
  };
  const compiled = compileClassicGraph(graph, { textures: texture });
  try {
    expect(texture).toHaveBeenCalledWith('noise.ktx2', 'data');
    expect(map.colorSpace).toBe(NoColorSpace);
    expect(validateGraph({ ...graph, params: { noise: { type: 'float', value: 1, role: 'data' } } }).ok).toBe(false);
    expect(validateGraph({ ...graph, params: { noise: { type: 'texture', value: 'noise.ktx2', role: 'unsafe' } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); map.dispose(); }
});

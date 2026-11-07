// oxlint-disable-next-line import/no-nodejs-modules -- Read the authored lossless texture's numerical channels.
import { zstdDecompressSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { DataTexture, NoColorSpace } from 'three';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { parseKtx2 } from '@wildshard/format/ktx2Cost';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { bakeRawColourTexture } from '../src/sharddev/bake/texture';
import { writeImagePixels } from '../src/sharddev/bake/image';

it('samples numerical library channels at computed UVs without colour conversion', async () => {
  const raster = { width: 2, height: 1, pixels: new Uint8ClampedArray([32, 88, 0, 255, 210, 19, 0, 255]) };
  const wire = await bakeRawColourTexture(await writeImagePixels(raster), { colourSpace: 'linear' });
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  expect(view.getUint32(12, true)).toBe(37); expect(wire[118]).toBe(1);
  expect(parseKtx2(wire).gpu).toBeLessThan(100);
  const offset = Number(view.getBigUint64(80, true)), length = Number(view.getBigUint64(88, true));
  const decoded = zstdDecompressSync(wire.subarray(offset, offset + length));
  expect((decoded[0] ?? -1) / 255).toBeCloseTo((raster.pixels[0] ?? 0) / 255);
  expect((decoded[5] ?? -1) / 255).toBeCloseTo((raster.pixels[5] ?? 0) / 255);
  const map = new DataTexture(Uint8Array.from(decoded), raster.width, raster.height);
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

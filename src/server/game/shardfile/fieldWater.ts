import * as v from 'valibot';
import { unzlibSync } from 'fflate';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { WaterFieldSchema } from '@wildshard/format/waterField';

/** Four bytes per f32 sample. */
const F32 = 4;

/**
 * ONE-FORMAT OF40b: the `water.field` primitive from a plain upload. A `world/field` section's pond raster (a zlib f32
 * block, `res` samples a side over `size` metres) stands water at its level wherever the pond samples above zero, as
 * Nalati's native population field does (`pond(x,z) > 0 ? world.water : null`). The sampling is the baked-terrain law.
 */
export function fieldWater(input: unknown, assets: ReadonlyMap<string, Uint8Array>): { surfaceAt: (x: number, z: number) => number | null } {
  const row = v.parse(WaterFieldSchema, input), packed = assets.get(row.pond);
  if (packed === undefined) throw new Error('Field water requires its admitted pond raster');
  const bytes = unzlibSync(packed);
  if (bytes.byteLength !== row.res * row.res * F32) throw new Error('Field water requires one f32 per pond sample');
  const heights = new Float32Array(bytes.buffer, bytes.byteOffset, row.res * row.res);
  if (!heights.every(Number.isFinite)) throw new Error('Field water requires finite pond samples');
  const pond = bakedSamplers({ res: row.res, size: row.size, heights, seed: 0, landscapeHash: 0, splat: new Uint8Array(0), undergrowth: null }).heightAt;
  return { surfaceAt: (x, z) => pond(x, z) > 0 ? row.level : null };
}

/** Fetch after level selection; the public data API must not load the content registry. */
import { Color, DataUtils, type DataTexture } from 'three';
import type { LookupTexture } from 'postprocessing';

/**
 * The engine's tileable cloud fbm baked at build (world/cloudField.ts, scripts/bake-cloud-field.mjs): raw grey bytes. A level
 * that lists it among its boot's `baked` files gets the sky's cloud texture without marching it (boot/bakedTextures.ts bakedBytes).
 */
export const CLOUD_FIELD_URL = '/assets/baked/common/cloud-field.bin';
/** The pond's tiling ripple normal + foam map baked at build (world/water/ripplePixels.ts, scripts/bake-water-ripples.mjs): raw RGBA bytes. */
export const WATER_RIPPLES_URL = '/assets/baked/common/water-ripples.bin';

export async function preloadBakedTextures(): Promise<number> {
  return (await import('./bakedTextures')).preloadBakedTextures();
}
export async function loadBakedSky(urls: { color: string; gain: string }): Promise<DataTexture> {
  return (await import('../world/BakedSky')).loadBakedSky(urls);
}
/**
 * The mean colour of the row just above an equirect sky's horizon (every fourth texel at 47 % of its height, as a fog
 * colour reads it) from its RGBA half-float or float data; black when the data is gone. `clamp`: the brightest channel
 * held to 1.1, so a fog never blows out. The engine's HDR sky and a shard's keyed sky keys read their horizons by it.
 */
export function skyHorizonColor(tex: DataTexture, clamp = false): Color {
  const { width, height, data } = tex.image, out = new Color(0, 0, 0);
  if (!(data instanceof Uint16Array) && !(data instanceof Float32Array)) return out;
  const half = data instanceof Uint16Array, px = (i: number): number => (half ? DataUtils.fromHalfFloat(data[i] ?? 0) : data[i] ?? 0);
  const y = Math.floor(height * 0.47);
  let n = 0;
  for (let x = 0; x < width; x += 4) { const i = (y * width + x) * 4; out.r += px(i); out.g += px(i + 1); out.b += px(i + 2); n++; }
  out.multiplyScalar(1 / Math.max(1, n));
  const m = Math.max(out.r, out.g, out.b, 1e-3);
  if (clamp && m > 1.1) out.multiplyScalar(1.1 / m);
  return out;
}
export async function loadLUT(id: string): Promise<LookupTexture | null> {
  return (await import('../world/lut')).loadLUT(id);
}
/**
 * A look's declared LUT file (`ExtendLook.lut`) for an engine chain that carries the look without running its compose, as
 * `loadLUT`'s texture named `name` (op-lut20; Jake G322: always carried); without a declared or readable file, null.
 */
export async function loadCarriedLUT(url: string | undefined, name: string): Promise<LookupTexture | null> {
  if (url === undefined) return null;
  return (await import('../world/lut')).loadLUTFile(url, name);
}

/**
 * A shard's learned colour LUT (DRIFTWOOD-REMASTER X1; per shard since PINE-HOLLOW-REMASTER PH-0.3): a 33³ RGB lookup
 * fitted by `scripts/fit-lut.py --shard <slug>` from the shard's mockup loop's capture ↔ mockup pairs, so the game's
 * palette lands on the mockups' (Driftwood: turquoise shallows, cobalt deep water, golden sand, saturated foliage)
 * without hand-tuning every def colour.
 *
 *   const lut = await loadLUT(slug);   // Sky: null when the shard has no readable LUT file
 *   new LUT3DEffect(lut, { inputColorSpace: SRGBColorSpace })   // Game.buildComposer: the last grade step
 *
 * File: public/assets/lut/<slug>.bin — 33³ × RGBA8, index (b · 33 + g) · 33 + r, display sRGB in → display sRGB out.
 * Kept as raw bytes in a linear-colour-space texture so the sampler passes them through untouched. A shard without a
 * file (the build's byte table, bytes.generated.ts, does not list one) gets no LUT pass and no fetch. Pine Hollow's is PH-L4's
 * (art/pine-hollow/round-14-look-loop/, fitted over the three zones' 27 frames).
 */
import { publicBytes } from '../../../shared/engine/boot/tables';
import * as THREE from 'three';
import { LookupTexture } from 'postprocessing';
import { LUT_SIZE, fetchLut } from '../render/lut';

/** the shard's LUT file when the build has one, else null */
export function lutUrl(slug: string): string | null {
  const url = `/assets/lut/${slug}.bin`;
  return url in publicBytes() ? url : null;
}

/** the shard's learned LUT (`lutUrl`) as a LookupTexture; null without a file */
export function loadLUT(slug: string): Promise<LookupTexture | null> {
  const url = lutUrl(slug);
  return url === null ? Promise.resolve(null) : loadLUTFile(url, `${slug}-lut`);
}

/**
 * Any LUT file in the format above (a look's declared `ExtendLook.lut`, op-lut20) as the same LookupTexture `loadLUT`
 * makes; null (and the loader's warning) when it is missing or the wrong size.
 */
export async function loadLUTFile(url: string, name: string): Promise<LookupTexture | null> {
  const data = await fetchLut(url); // the one loader (render/lut.ts)
  if (data === null) return null;
  const lut = new LookupTexture(data, LUT_SIZE);
  lut.type = THREE.UnsignedByteType;
  lut.colorSpace = THREE.NoColorSpace;
  lut.name = name;
  lut.needsUpdate = true;
  return lut;
}

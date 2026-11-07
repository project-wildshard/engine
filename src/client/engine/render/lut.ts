import { COLOUR_LUT_EDGE, COLOUR_LUT_CHANNELS } from '@wildshard/format/colourLut';

/**
 * The one colour-LUT loader (10 §X5): a fitted 33³ RGB lookup, `scripts/fit-lut.py`'s format — 33³ × RGBA8, index
 * (b · 33 + g) · 33 + r, display sRGB in → display sRGB out. It fetches and checks the bytes; the caller wraps them in
 * the texture its pass samples (world/lut.ts: postprocessing's LookupTexture for the engine grade; a level's own
 * composite: its Data3DTexture).
 */
export const LUT_SIZE: typeof COLOUR_LUT_EDGE = COLOUR_LUT_EDGE;

/** the LUT file's bytes; null (and a warning) when it is missing, unreadable or the wrong size */
export async function fetchLut(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length !== LUT_SIZE ** 3 * COLOUR_LUT_CHANNELS) { console.warn(`[lut] ${url}: ${data.length} bytes, expected ${LUT_SIZE ** 3 * COLOUR_LUT_CHANNELS}`); return null; }
    return data;
  } catch (e: unknown) {
    console.warn(`[lut] ${url} not loaded:`, e);
    return null;
  }
}

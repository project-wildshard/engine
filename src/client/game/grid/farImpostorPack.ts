/**
 * G539: a baked far impostor image to RGBA 5551 texels (the bake's own 5-bit quantisation and 1-bit coverage, so the pack
 * is lossless), rows flipped so the image's top row is the texture's last (texture v runs up). Worker-side and DOM-free:
 * the decode worker (`farImpostorDecodeWorker.ts`) runs it, the main thread only uploads. No three.js.
 */
export function packFarImpostor(rgba: Uint8ClampedArray, width: number, height: number): Uint16Array {
  const texels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = ((height - 1 - y) * width + x) * 4, five = (k: number): number => Math.round((rgba[i + k] ?? 0) * 31 / 255);
    texels[y * width + x] = (five(0) << 11) | (five(1) << 6) | (five(2) << 1) | ((rgba[i + 3] ?? 0) >= 128 ? 1 : 0);
  }
  return texels;
}

/** A decode request: the PNG bytes (transferred) and the size the far row declares. */
export interface FarImpostorDecodeRequest { readonly id: number; readonly bytes: ArrayBuffer; readonly width: number; readonly height: number }
/** The worker's reply: the packed texels (transferred), or why it could not decode. */
export type FarImpostorDecodeReply = { readonly id: number; readonly texels: Uint16Array } | { readonly id: number; readonly error: string };

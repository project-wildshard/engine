/**
 * Draws the viewmodels' procedural texture sets off the main thread (viewmodelTextures.ts; started by
 * Crossbow.ts `startViewmodelTextures`). In: `{ sets: SetName[] }`. Out, one message per set as it finishes:
 * `{ name, px }` with the planes' buffers transferred, or `{ name, error }` (e.g. no OffscreenCanvas for the steel's
 * scratches) — the main thread then draws that set itself.
 */
import { makePixels, type Ctx2D, type SetName } from './viewmodelTextures';

const canvas2d = (w: number, h: number): Ctx2D => {
  const ctx = new OffscreenCanvas(w, h).getContext('2d'); // as the main thread's canvas (no willReadFrequently): the same rasteriser for the scratches
  if (ctx === null) throw new Error('no OffscreenCanvas 2d context');
  return ctx;
};

self.onmessage = (e: MessageEvent<{ sets: SetName[] }>) => {
  for (const name of e.data.sets) {
    try {
      const px = makePixels(name, canvas2d);
      const transfer = [px.col.buffer, px.nrm.buffer, ...(px.arm ? [px.arm.buffer] : [])];
      self.postMessage({ name, px }, { transfer });
    } catch (err) {
      self.postMessage({ name, error: String(err) }, { transfer: [] });
    }
  }
};

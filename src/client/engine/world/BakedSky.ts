/**
 * The sky HDRI as a gain-mapped pair (scripts/bake-sky.mjs `encodeSky`; LOAD-PERF.md §P1.4, ask P5): a 2048×1024
 * sRGB JPEG of the colour plus an 8-bit PNG gain plane, ~0.3 MB instead of the 4–5 MB uncompressed RGBE `.hdr`.
 * Rebuilt here into the same half-float RGBA DataTexture HDRLoader returns (row 0 = the top of the image, flipY,
 * linear, no mips), so Sky.build's PMREM, background and fallbacks cannot tell the difference.
 *
 *   value = srgbToLinear(colour) × 2^(gain / 255 × GAIN_MAX)
 *
 * Both planes are decoded and recombined in a Worker (createImageBitmap + OffscreenCanvas, no colour conversion): one
 * lookup per channel in a 256 × 256 half-float table (gain × colour byte). The main thread only builds the texture.
 */
import { publicBytes } from '../../../shared/engine/boot/tables';
import * as THREE from 'three';
import { nextDrawnFrame, presenting } from '../../../shared/engine/core/framePacing';

/** log2 of the brightest value the pair holds — keep in step with scripts/bake-sky.mjs */
const GAIN_MAX = 16;

/** The pair's URLs for this HDRI when the build has them and nothing asks for the raw file (`?nobake`), else null. */
export function bakedSkyUrls(hdri: string): { color: string; gain: string } | null {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobake')) return null;
  const color = `/assets/hdri/${hdri}_2k.sky.jpg`, gain = `/assets/hdri/${hdri}_2k.gain.png`;
  return color in publicBytes() && gain in publicBytes() ? { color, gain } : null;
}

let table: Uint16Array | null = null;
/** half-float of srgbToLinear(c / 255) × 2^(g / 255 × GAIN_MAX) at [g × 256 + c] */
function lut(): Uint16Array {
  if (table) return table;
  const t = new Uint16Array(65536);
  const lin = new Float32Array(256);
  for (let c = 0; c < 256; c++) { const s = c / 255; lin[c] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
  for (let g = 0; g < 256; g++) {
    const k = 2 ** ((g / 255) * GAIN_MAX);
    for (let c = 0; c < 256; c++) t[g * 256 + c] = THREE.DataUtils.toHalfFloat(Math.min(65504, (lin[c] ?? 0) * k));
  }
  table = t;
  return t;
}

async function pixels(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('BakedSky: no 2d canvas context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * The decode, off the main thread: createImageBitmap + canvas readback + the per-pixel lookup ran as one 120 ms task
 * at 4x CPU in the sky step (drawImage + getImageData of two 2048x1024 planes, then 2 M lookups). The worker builds
 * its own half-float table and hands back the RGBA half buffer (transferred, not copied). Kept as a source string so
 * the build emits no extra file (Driftwood's boot is budgeted by request count).
 */
const WORKER_SRC = `
const GAIN_MAX = ${GAIN_MAX};
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) { // float -> half, round to nearest (the carry into the exponent is an add, not an or)
  f32[0] = v; const x = u32[0]; const sign = (x >>> 16) & 0x8000; const e = ((x >>> 23) & 0xff) - 112; const m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7bff;
  if (e <= 0) { if (e < -10) return sign; return sign | ((((m | 0x800000) >>> (1 - e)) + 0x1000) >>> 13); }
  return sign | ((e << 10) + ((m + 0x1000) >>> 13));
}
async function pixels(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
  c.drawImage(bmp, 0, 0); bmp.close();
  return c.getImageData(0, 0, c.canvas.width, c.canvas.height);
}
onmessage = async (e) => {
  try {
    const [color, gain] = await Promise.all([pixels(e.data.color), pixels(e.data.gain)]);
    if (gain.width !== color.width || gain.height !== color.height) throw new Error('plane sizes differ');
    const lin = new Float32Array(256);
    for (let c = 0; c < 256; c++) { const s = c / 255; lin[c] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
    const t = new Uint16Array(65536);
    for (let g = 0; g < 256; g++) { const k = 2 ** ((g / 255) * GAIN_MAX); for (let c = 0; c < 256; c++) t[g * 256 + c] = toHalf(Math.min(65504, lin[c] * k)); }
    const c = color.data, g = gain.data, out = new Uint16Array(c.length), one = toHalf(1);
    for (let i = 0; i < out.length; i += 4) { const row = g[i] * 256; out[i] = t[row + c[i]]; out[i + 1] = t[row + c[i + 1]]; out[i + 2] = t[row + c[i + 2]]; out[i + 3] = one; }
    postMessage({ width: color.width, height: color.height, data: out }, [out.buffer]);
  } catch (err) { postMessage({ error: String(err) }); }
};`;

interface Decoded { width: number; height: number; data: Uint16Array }
type WorkerReply = Partial<Decoded> & { error?: string };

function decodeInWorker(color: Blob, gain: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const worker = new Worker(url);
  return new Promise<Decoded>((resolve, reject) => {
    const done = (): void => { worker.terminate(); URL.revokeObjectURL(url); };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      done();
      const { width, height, data, error } = e.data;
      if (error !== undefined || width === undefined || height === undefined || data === undefined) reject(new Error(`BakedSky worker: ${error ?? 'empty reply'}`));
      else resolve({ width, height, data });
    };
    worker.onerror = (e) => { done(); reject(new Error(`BakedSky worker: ${e.message}`)); };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin (that is Window.postMessage)
    worker.postMessage({ color, gain });
  });
}

/** The same decode on the main thread: only where workers have no OffscreenCanvas (Safari < 16.4). */
async function decodeHere(colorBlob: Blob, gainBlob: Blob): Promise<Decoded> {
  const [color, gain] = await Promise.all([pixels(colorBlob), pixels(gainBlob)]);
  const { width, height } = color;
  if (gain.width !== width || gain.height !== height) throw new Error(`BakedSky: plane sizes differ (${width}x${height} vs ${gain.width}x${gain.height})`);
  const t = lut();
  const c = color.data, g = gain.data;
  const out = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < out.length; i += 4) {
    const row = (g[i] ?? 0) * 256; // the PNG is grey: its R is the gain
    out[i] = t[row + (c[i] ?? 0)] ?? 0; out[i + 1] = t[row + (c[i + 1] ?? 0)] ?? 0; out[i + 2] = t[row + (c[i + 2] ?? 0)] ?? 0; out[i + 3] = one;
  }
  return { width, height, data: out };
}

async function blobOf(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.blob();
}

/** The last caller's drawn-frame turn (`drawnFrameTurn`). */
let turn: Promise<void> = Promise.resolve();
/** The next drawn frame after every earlier caller's: one decoded key a frame. */
function drawnFrameTurn(): Promise<void> {
  const mine = turn.then(() => nextDrawnFrame());
  turn = mine;
  return mine;
}

/** The HDRI as HDRLoader would have returned it, from the gain-mapped pair. */
export async function loadBakedSky(urls: { color: string; gain: string }): Promise<THREE.DataTexture> {
  const [color, gain] = await Promise.all([blobOf(urls.color), blobOf(urls.gain)]);
  const offthread = typeof Worker === 'function' && typeof OffscreenCanvas === 'function';
  const { width, height, data } = offthread
    ? await decodeInWorker(color, gain).catch((e: unknown) => { console.warn(`[sky] ${String(e)}; decoding on the main thread`); return decodeHere(color, gain); })
    : await decodeHere(color, gain);
  // op-hitch47: in play, each decoded key resolves on a drawn frame of its own, so the caller's upload of it
  // starts a frame: two keys decoded together were uploaded back to back, 35 ms of the frame a grid cell's sky attached in
  if (presenting()) await drawnFrameTurn();
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

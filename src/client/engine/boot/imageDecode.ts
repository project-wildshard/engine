import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';

interface Pending { scope: Scope; resolve: (reply: ImageBitmap | Uint8ClampedArray) => void; reject: (error: Error) => void; layer: boolean }
let worker: Worker | null = null, scope: Scope | null = null, idle: Scope | null = null;
let failed = false, layersFailed = false, sequence = 0;
const pending = new Map<number, Pending>();
let fallbackTail: Promise<void> = Promise.resolve();
function fallbackDecode(blob: Blob, options: ImageBitmapOptions): Promise<ImageBitmap> {
  const image = fallbackTail.then(() => createImageBitmap(blob, options));
  fallbackTail = image.then(() => undefined, () => undefined);
  return image;
}

function stop(reason: Error, permanent: boolean): void {
  const active = worker, owner = scope;
  worker = null; scope = null; idle = null; failed ||= permanent;
  const requests = [...pending.values()]; pending.clear();
  for (const request of requests) { request.scope.dispose(); request.reject(reason); }
  active?.terminate(); owner?.dispose();
}
function receive(event: MessageEvent<unknown>): void {
  const reply = event.data;
  if (typeof reply !== 'object' || reply === null) { stop(new Error('Invalid image decode reply'), true); return; }
  const id: unknown = Reflect.get(reply, 'id'), image: unknown = Reflect.get(reply, 'image'), texels: unknown = Reflect.get(reply, 'texels');
  const bitmap = typeof ImageBitmap === 'function' && image instanceof ImageBitmap ? image : null;
  if (typeof id !== 'number') { bitmap?.close(); stop(new Error('Invalid image decode identity'), true); return; }
  const request = pending.get(id);
  if (request === undefined) { bitmap?.close(); return; }
  pending.delete(id); request.scope.dispose();
  const layer = request.layer && texels instanceof Uint8ClampedArray ? texels : null;
  if (bitmap !== null && !request.layer) request.resolve(bitmap);
  else if (layer !== null) request.resolve(layer);
  else {
    bitmap?.close();
    const message: unknown = Reflect.get(reply, 'error');
    request.reject(new Error(typeof message === 'string' ? message : 'Image decode failed'));
    // a worker without OffscreenCanvas still decodes bitmaps: only layer jobs return to the page
    if (Reflect.get(reply, 'unsupported') === true) { if (request.layer) layersFailed = true; else stop(new Error('Worker image decode unavailable'), true); }
  }
  if (pending.size === 0 && scope !== null) {
    idle?.dispose(); const owner = scope.child('idle'); idle = owner;
    owner.timeout(30_000, () => { if (pending.size === 0) stop(new Error('Image decoder idle'), false); });
  }
}
function start(): Worker {
  if (worker !== null) return worker;
  const owner = pageScope.child('image-decoder');
  try {
    const made = new Worker(new URL('imageDecode.worker.ts', import.meta.url), { type: 'module', name: 'image-decode' });
    worker = made; scope = owner;
    owner.listen(made, 'message', receive);
    owner.listen(made, 'error', event => { event.preventDefault(); stop(new Error('Image decode worker failed'), true); });
    owner.listen(made, 'messageerror', () => { stop(new Error('Image decode transfer failed'), true); });
    owner.onDispose(() => { if (scope === owner) stop(new Error('Image decoder disposed'), false); });
    return made;
  } catch (error) { owner.dispose(); failed = true; throw error; }
}

/** Decode counted bytes with unchanged bitmap options in one page-owned worker.
 * WebKit may finish a main-page createImageBitmap on its main thread. Transfer the
 * worker's identical bitmap instead; unsupported/failed workers use the original
 * page API through one fallback slot; failed images release that slot too.
 * No texture, canvas, sampler, colour conversion or resampling is added. */
export async function decodeImageBitmap(blob: Blob, options: ImageBitmapOptions): Promise<ImageBitmap> {
  if (failed || typeof Worker !== 'function') return fallbackDecode(blob, options);
  try {
    const decoded = await post({ blob, options }, false);
    if (decoded instanceof Uint8ClampedArray) throw new Error('Image decode returned texels');
    return decoded;
  } catch { return fallbackDecode(blob, options); }
}
function post(message: Readonly<Record<string, unknown>>, layer: boolean): Promise<ImageBitmap | Uint8ClampedArray> {
  const decoder = start(), owner = scope;
  if (owner === null) throw new Error('Image decoder missing');
  idle?.dispose(); idle = null;
  return new Promise<ImageBitmap | Uint8ClampedArray>((resolve, reject) => {
    const id = ++sequence, request = owner.child('decode');
    pending.set(id, { scope: request, resolve, reject, layer });
    try { decoder.postMessage({ ...message, id }, { transfer: [] }); }
    catch (error) { stop(error instanceof Error ? error : new Error(String(error)), true); }
  });
}

/** NINE-DRAGON-BENCHMAX NB2: one texture-array layer's texels, `size`² RGBA with rows flipped (its top is v = 1) and its
 *  alpha from `alpha`'s red channel (128 without one), decoded and read back in the page's image worker. Nine's paint
 *  array decoded and read back its 12 WebPs on the main thread inside props. Null when the worker cannot (no Worker, no
 *  OffscreenCanvas in it, a failed worker): the caller reads the layer back itself, as before. */
export async function decodeLayerTexels(rgb: Blob, alpha: Blob | null, size: number): Promise<Uint8ClampedArray | null> {
  if (failed || layersFailed || typeof Worker !== 'function') return null;
  try {
    const texels = await post({ layer: { rgb, alpha, size } }, true);
    return texels instanceof Uint8ClampedArray && texels.length === size * size * 4 ? texels : null;
  } catch { return null; }
}

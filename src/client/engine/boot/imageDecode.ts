import { pageScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';

interface Pending { scope: Scope; resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }
let worker: Worker | null = null, scope: Scope | null = null, idle: Scope | null = null;
let failed = false, sequence = 0;
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
  const id: unknown = Reflect.get(reply, 'id'), image: unknown = Reflect.get(reply, 'image');
  const bitmap = typeof ImageBitmap === 'function' && image instanceof ImageBitmap ? image : null;
  if (typeof id !== 'number') { bitmap?.close(); stop(new Error('Invalid image decode identity'), true); return; }
  const request = pending.get(id);
  if (request === undefined) { bitmap?.close(); return; }
  pending.delete(id); request.scope.dispose();
  if (bitmap !== null) request.resolve(bitmap);
  else {
    const message: unknown = Reflect.get(reply, 'error');
    request.reject(new Error(typeof message === 'string' ? message : 'Image decode failed'));
    if (Reflect.get(reply, 'unsupported') === true) stop(new Error('Worker image decode unavailable'), true);
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
    const decoder = start(), owner = scope;
    if (owner === null) throw new Error('Image decoder missing');
    idle?.dispose(); idle = null;
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const id = ++sequence, request = owner.child('decode');
      pending.set(id, { scope: request, resolve, reject });
      try { decoder.postMessage({ id, blob, options }, { transfer: [] }); }
      catch (error) { stop(error instanceof Error ? error : new Error(String(error)), true); }
    });
  } catch { return fallbackDecode(blob, options); }
}

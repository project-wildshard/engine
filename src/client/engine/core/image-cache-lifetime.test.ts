import { afterEach, expect, test, vi } from 'vitest';
import * as bytes from '../boot/bytes';
import { decodedImageCount, loadImage } from './assets';

const globals = ['WeakRef', 'Worker', 'ImageBitmap', 'createImageBitmap'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const { key, descriptor } of globals) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
});

test('image loads share pending and live decodes, retry failures and release completed cache ownership', async () => {
  const refs: { clear: () => void }[] = [];
  class CollectableRef<T extends object> {
    private value: T | undefined;
    constructor(value: T) { this.value = value; refs.push({ clear: () => { this.value = undefined; } }); }
    deref(): T | undefined { return this.value; }
  }
  vi.stubGlobal('WeakRef', CollectableRef);
  const first = { width: 16, height: 16 } as HTMLImageElement;
  const next = { width: 16, height: 16 } as HTMLImageElement;
  let finish: ((image: HTMLImageElement) => void) | undefined;
  const fetch = vi.spyOn(bytes, 'fetchImage').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = loadImage('/image-cache/lifetime.png');
  expect(loadImage('/image-cache/lifetime.png')).toBe(pending);
  if (finish === undefined) throw new Error('Image decode did not start');
  finish(first);
  expect(await pending).toBe(first);
  expect(await loadImage('/image-cache/lifetime.png')).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
  // Simulate collection deterministically rather than depending on a GC deadline.
  for (const ref of refs) ref.clear();
  decodedImageCount();
  fetch.mockResolvedValueOnce(next);
  expect(await loadImage('/image-cache/lifetime.png')).toBe(next);
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockRejectedValueOnce(new Error('Interrupted image')).mockResolvedValueOnce(first);
  await expect(loadImage('/image-cache/retry.png')).rejects.toThrow('Interrupted image');
  expect(await loadImage('/image-cache/retry.png')).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(4);
});

class DecodedBitmap {
  readonly width = 2;
  readonly height = 2;
  readonly close = vi.fn();
}
class DecoderWorker extends EventTarget {
  static readonly instances: DecoderWorker[] = [];
  readonly messages: { id: number; blob: Blob; options: ImageBitmapOptions }[] = [];
  readonly terminate = vi.fn();
  constructor() { super(); DecoderWorker.instances.push(this); }
  postMessage(message: { id: number; blob: Blob; options: ImageBitmapOptions }): void { this.messages.push(message); }
  reply(id: number, image: DecodedBitmap): void { this.dispatchEvent(new MessageEvent('message', { data: { id, image } })); }
}

test('transfers bitmap ownership, preserves options and releases pending requests on worker failure', async () => {
  vi.useFakeTimers();
  DecoderWorker.instances.length = 0;
  vi.stubGlobal('Worker', DecoderWorker); vi.stubGlobal('ImageBitmap', DecodedBitmap);
  const fallbackImage = new DecodedBitmap(), fallback = vi.fn((_blob: Blob, _options: ImageBitmapOptions) => Promise.resolve(fallbackImage));
  vi.stubGlobal('createImageBitmap', fallback);
  const { decodeImageBitmap } = await import('../boot/imageDecode');
  const blob = new Blob(['pixels']), options: ImageBitmapOptions = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: 2, resizeHeight: 2, resizeQuality: 'medium' };
  const first = decodeImageBitmap(blob, options), second = decodeImageBitmap(blob, options);
  const worker = DecoderWorker.instances[0]; if (worker === undefined) throw new Error('Decoder did not start');
  expect(worker.messages).toEqual([{ id: 1, blob, options }, { id: 2, blob, options }]);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(fallback).not.toHaveBeenCalled(); expect(worker.terminate).not.toHaveBeenCalled();
  const a = new DecodedBitmap(), b = new DecodedBitmap(), stale = new DecodedBitmap();
  worker.reply(2, b); worker.reply(1, a); worker.reply(999, stale);
  expect(await first).toBe(a); expect(await second).toBe(b);
  expect(stale.close).toHaveBeenCalledOnce(); expect(a.close).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
  const interrupted = [decodeImageBitmap(blob, options), decodeImageBitmap(blob, options)];
  const failure = new Event('error', { cancelable: true }); worker.dispatchEvent(failure);
  expect(await Promise.all(interrupted)).toEqual([fallbackImage, fallbackImage]); expect(failure.defaultPrevented).toBe(true);
  expect(fallback.mock.calls).toEqual([[blob, options], [blob, options]]);
  expect(await decodeImageBitmap(blob, options)).toBe(fallbackImage);
  expect(DecoderWorker.instances).toHaveLength(1); expect(worker.terminate).toHaveBeenCalledOnce();
});


test('bounds page fallback decodes and releases the slot after a failure', async () => {
  vi.stubGlobal('Worker', undefined);
  const jobs: { resolve: (bitmap: DecodedBitmap) => void; reject: (error: Error) => void }[] = [];
  const fallback = vi.fn((_blob: Blob, _options: ImageBitmapOptions) => new Promise<DecodedBitmap>((resolve, reject) => { jobs.push({ resolve, reject }); }));
  vi.stubGlobal('createImageBitmap', fallback);
  const { decodeImageBitmap } = await import('../boot/imageDecode');
  const blob = new Blob(['pixels']), options: ImageBitmapOptions = { imageOrientation: 'flipY', resizeWidth: 2, resizeHeight: 3 };
  const first = decodeImageBitmap(blob, options), failed = expect(first).rejects.toThrow('decode refused');
  const second = decodeImageBitmap(blob, options);
  try {
    await expect.poll(() => fallback.mock.calls.length).toBe(1);
    jobs[0]?.reject(new Error('decode refused')); await failed;
    await expect.poll(() => fallback.mock.calls.length).toBe(2);
    const bitmap = new DecodedBitmap(); jobs[1]?.resolve(bitmap);
    expect(await second).toBe(bitmap);
    expect(fallback.mock.calls).toEqual([[blob, options], [blob, options]]);
  } finally { for (const job of jobs) job.resolve(new DecodedBitmap()); await Promise.allSettled([first, second]); }
});

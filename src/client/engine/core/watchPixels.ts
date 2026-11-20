import type { Scope } from '../../../shared/engine/app/scope';

/** The thumbnail is already copied from the current draw. Transfer it before
 * reading pixels, since an accelerated Canvas2D read can block the frame thread. */
export function readWatchPixels(copy: HTMLCanvasElement, owner: Scope, deadlineMs: number): Promise<Uint8ClampedArray | null> {
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || owner.disposed || owner.disposing) return Promise.resolve(null);
  const job = owner.child('world-watch.pixels');
  return new Promise(resolve => {
    const finish = (pixels: Uint8ClampedArray | null): void => { resolve(pixels); job.dispose(); };
    job.onDispose(() => { resolve(null); });
    job.timeout(deadlineMs, () => { finish(null); });
    void (async (): Promise<void> => {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(copy);
        if (job.disposed || job.disposing) return;
        const reader = new Worker(new URL('watchPixels.worker.ts', import.meta.url), { type: 'module', name: 'world-watch-pixels' });
        job.onDispose(() => { reader.terminate(); });
        job.listen(reader, 'message', (event: MessageEvent<unknown>) => {
          const pixels = event.data;
          finish(pixels instanceof Uint8ClampedArray && pixels.length === copy.width * copy.height * 4 ? pixels : null);
        });
        job.listen(reader, 'error', event => { event.preventDefault(); finish(null); });
        job.listen(reader, 'messageerror', () => { finish(null); });
        reader.postMessage(bitmap, [bitmap]);
        bitmap = null; // the worker closes the transferred image
      } catch { finish(null); }
      finally { bitmap?.close(); }
    })();
  });
}

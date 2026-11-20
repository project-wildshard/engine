import type { Scope } from '../../../shared/engine/app/scope';

type PixelReader = (copy: HTMLCanvasElement, deadlineMs: number) => Promise<Uint8ClampedArray | null>;

/** Keep one worker for the watch. Chromium can wait for GPU commands on the
 * renderer thread when a worker with a canvas retires. */
export function watchPixelReader(owner: Scope): PixelReader {
  let worker: Worker | undefined;
  let pending = false;
  const stop = (): void => { worker?.terminate(); worker = undefined; };
  owner.onDispose(stop);
  return (copy, deadlineMs) => {
    if (pending || typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || owner.disposed || owner.disposing) return Promise.resolve(null);
    const job = owner.child('world-watch.pixels');
    pending = true;
    return new Promise(resolve => {
      const finish = (pixels: Uint8ClampedArray | null): void => { resolve(pixels); job.dispose(); };
      const fail = (): void => {
        if (job.disposed || job.disposing) return;
        stop();
        finish(null);
      };
      job.onDispose(() => { pending = false; resolve(null); });
      job.timeout(deadlineMs, fail);
      void (async (): Promise<void> => {
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await createImageBitmap(copy);
          if (job.disposed || job.disposing) return;
          const reader = worker ??= new Worker(new URL('watchPixels.worker.ts', import.meta.url), { type: 'module', name: 'world-watch-pixels' });
          job.listen(reader, 'message', (event: MessageEvent<unknown>) => {
            const pixels = event.data;
            finish(pixels instanceof Uint8ClampedArray && pixels.length === copy.width * copy.height * 4 ? pixels : null);
          });
          job.listen(reader, 'error', event => { event.preventDefault(); fail(); });
          job.listen(reader, 'messageerror', fail);
          reader.postMessage(bitmap, [bitmap]);
          bitmap = null; // the worker closes the transferred image
        } catch { fail(); }
        finally { bitmap?.close(); }
      })();
    });
  };
}

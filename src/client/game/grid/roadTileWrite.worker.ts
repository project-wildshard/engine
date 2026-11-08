import { ASSET_CACHE_NAME } from '@wildshard/engine/pwa/cacheNames';
import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';

installWorkerBootTiming('road-tile-write');

/** DL11: the road archive's Cache Storage writes, off the page thread. Same URL, body and headers as cacheAsset.
 * The page transfers bodies only after this module has said it is running; a refused write hands its body back so
 * the page can retry it with its own put. */
self.onmessage = (event: MessageEvent<unknown>): void => {
  const message: unknown = event.data;
  if (typeof message !== 'object' || message === null) return;
  const id: unknown = Reflect.get(message, 'id'), url: unknown = Reflect.get(message, 'url'), bytes: unknown = Reflect.get(message, 'bytes');
  if (typeof id !== 'number' || typeof url !== 'string' || !(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer)) return;
  const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  void (async (): Promise<void> => {
    try {
      await (await caches.open(ASSET_CACHE_NAME)).put(url, new Response(body, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
      }));
      self.postMessage({ id, ok: true }, { transfer: [] });
    } catch { self.postMessage({ id, ok: false, bytes: body }, { transfer: [body.buffer] }); }
  })();
};
self.postMessage({ ready: true }, { transfer: [] });

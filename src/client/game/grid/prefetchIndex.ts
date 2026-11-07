import type { Scope } from '@wildshard/engine/app/scope';
import { pageScope } from '@wildshard/engine/app/resources';
import type { OutputDownloadIndex } from '@wildshard/format/outputDownload';
import type { PrefetchIndexRequest } from './prefetchIndexCore';
import { readAsset } from '../shardfile/readAsset';
import { legacyAsset } from '../shardfile/legacyAsset';

/** Native URL reads share the service worker's store. No cache RPC or separate
 * persistence worker participates in offline download scheduling. */
export async function readPrefetchIndex(request: PrefetchIndexRequest, owner: Scope = pageScope): Promise<OutputDownloadIndex | null> {
  const live = (): void => { if (owner.disposed || owner.disposing) throw new DOMException('Prefetch index owner ended', 'AbortError'); };
  live();
  const scope = owner.child('prefetch-index'), controller = new AbortController();
  const stopped = new Promise<never>((_resolve, reject) => {
    scope.onDispose(() => { const error = new DOMException('Prefetch index owner ended', 'AbortError'); controller.abort(error); reject(error); });
  });
  if (typeof window !== 'undefined') scope.listen(window, 'pagehide', () => { scope.dispose(); });
  try {
    const index = await Promise.race([stopped, (async () => {
      const core = await import('./prefetchIndexCore'); live();
      return core.preparePrefetchIndex(request, undefined, (url, bytes, hash) => readAsset(url, bytes, {
        fetch: (path, init) => fetch(path, init), signal: controller.signal,
        ...(typeof caches === 'undefined' || hash === undefined ? {} : { legacy: { read: () => legacyAsset(caches, url, hash), store: caches } }),
      }, typeof caches === 'undefined' || navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined ? undefined : caches));
    })()]);
    live(); return index;
  } finally { scope.dispose(); }
}

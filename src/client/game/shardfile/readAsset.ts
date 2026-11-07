import { readContent, type ContentReadOptions } from '@wildshard/engine/boot/contentRead';
import { ASSET_CACHE_NAME } from '@wildshard/engine/pwa/cacheNames';
import { SHARDFILE_ADMISSION_LIMITS as limits } from '@wildshard/format/admissionLimits';

interface AssetStorePort { open: (name: string) => Promise<Pick<Cache, 'put'>> }
export interface AssetReadOptions extends ContentReadOptions {
  /** Read-only old-key migration, attempted only after native transport fails. */
  legacy?: { read: () => Promise<Response | undefined>; store: AssetStorePort };
}

/** No page cache owner: ordinary fetch reaches the service worker's exact URL
 * store. Before its first controller, publish the same complete response there. */
export async function readAsset(url: string, bytes: number | undefined, options: AssetReadOptions,
  controllerlessStore?: AssetStorePort): Promise<Uint8Array> {
  let copy: Response | undefined, publication: AssetStorePort | undefined, migrated = false;
  try {
    const result = await readContent(url, bytes ?? limits.sourceBytes, { ...options,
      fetch: async (path, init) => {
        migrated = false;
        let response: Response | undefined, failure: unknown;
        try { response = await options.fetch(path, init); } catch (error) { failure = error; }
        if (response?.ok === true) return response;
        options.signal?.throwIfAborted();
        const old = await options.legacy?.read().catch(() => undefined);
        if (old !== undefined) {
          void response?.body?.cancel().catch(() => undefined); migrated = true; return old;
        }
        if (response !== undefined) return response;
        throw failure;
      },
      ...(bytes === undefined ? {} : { expectedBytes: bytes }), response: response => {
      options.response?.(response);
      void copy?.body?.cancel().catch(() => undefined); copy = undefined;
      publication = migrated ? options.legacy?.store : controllerlessStore;
      if (publication !== undefined && response.ok) copy = response.clone();
    } });
    options.signal?.throwIfAborted();
    if (copy !== undefined && publication !== undefined) {
      try { await (await publication.open(ASSET_CACHE_NAME)).put(url, copy); }
      catch { /* Disk denial never rejects complete online bytes. */ }
    }
    return result;
  } finally { void copy?.body?.cancel().catch(() => undefined); }
}

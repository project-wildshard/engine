import { assetCacheName } from '@wildshard/engine/pwa/cacheNames';
import { readContentResponse } from '@wildshard/engine/boot/readContentResponse';

type ReadStorage = Pick<CacheStorage, 'open'> & Partial<Pick<CacheStorage, 'match'>>;
/** Query exactly the original cache in one native operation. Older/injected
 * hosts and a refused direct query retain the original open/match path. */
async function matchAsset(storage: ReadStorage, url: string): Promise<Response | undefined> {
  try {
    const match = storage.match;
    if (match !== undefined) return await match.call(storage, url, { cacheName: assetCacheName(), ignoreVary: true });
  } catch { /* The existing read port may still be available. */ }
  return (await storage.open(assetCacheName())).match(url, { ignoreVary: true });
}

/** Shared service-worker URL storage, without a page index, queue or leases. */
export async function cachedAsset(storage: ReadStorage, url: string, bytes: number): Promise<Uint8Array | null> {
  try {
    const response = await matchAsset(storage, url);
    if (response?.status !== 200) { void response?.body?.cancel().catch(() => undefined); return null; }
    const result = await readContentResponse(response, bytes);
    return result.length === bytes ? result : null;
  } catch { return null; }
}

/** Presence is native complete-response metadata; actual reads compare length. */
export async function hasCachedAsset(storage: ReadStorage, url: string): Promise<boolean> {
  try {
    const response = await matchAsset(storage, url);
    const present = response?.status === 200; void response?.body?.cancel().catch(() => undefined); return present;
  }
  catch { return false; }
}

/** Pack members keep their canonical fetch URL, so later demand uses the same
 * service-worker entry instead of a second hash-keyed body. */
export async function cacheAsset(storage: Pick<CacheStorage, 'open'>, url: string, bytes: Uint8Array): Promise<boolean> {
  const path = new URL(url).pathname;
  const type = path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.json') ? 'application/json'
    : path.endsWith('.glb') ? 'model/gltf-binary' : path.endsWith('.ktx2') ? 'image/ktx2' : 'application/octet-stream';
  try {
    await (await storage.open(assetCacheName())).put(url, new Response(Uint8Array.from(bytes), {
      headers: { 'content-type': type, 'content-length': String(bytes.length) },
    }));
    return true;
  } catch { return false; }
}

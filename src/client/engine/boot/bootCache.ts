import { ASSET_CACHE_NAME } from '../pwa/cacheNames';

/** Publish a complete immutable native response after an uncontrolled read.
 * No metadata owner or protocol: the next worker reads the same absolute URL.
 * Disk denial never rejects the already complete bytes. This owns `response`. */
export async function publishBootResponse(path: string, response: Response): Promise<void> {
  try {
    if (typeof caches === 'undefined' || response.status !== 200 || response.headers.has('content-range')
      || /\btext\/html\b/iu.test(response.headers.get('content-type') ?? '')) return;
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || url.searchParams.has('sw')
      || !(/-[a-f0-9]{8,64}\.[a-z0-9]+$/u.test(url.pathname) || /^[a-f0-9]{8,64}$/u.test(url.searchParams.get('v') ?? ''))) return;
    await (await caches.open(ASSET_CACHE_NAME)).put(url.href, response);
  } catch { /* Quota, disabled storage and publication failure keep the native read usable. */ }
  finally { void response.body?.cancel().catch(() => undefined); }
}

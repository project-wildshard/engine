import {record} from './model.ts';

type Send = (method: string, params: object, session: string) => Promise<unknown>;
/** Read the original body without Network.loadNetworkResource/refetch. If its
 * network target has retired, an exact URL + validator match in CacheStorage
 * retains the same decoded Fetch Response body, independent of wire encoding. */
export async function nativeBodyBytes(send: Send, session: string, id: string, url: string,
  fingerprint: Readonly<Record<string, string>>, cacheSession = session): Promise<number> {
  try {
    const response = record(await send('Network.getResponseBody', {requestId: id}, session));
    if (typeof response['body'] !== 'string') throw new Error('Missing native body');
    return Buffer.byteLength(response['body'], response['base64Encoded'] === true ? 'base64' : 'utf8');
  } catch (original) {
    // No validator means another cache/version cannot stand in for this read.
    if (fingerprint['etag'] === undefined && fingerprint['last-modified'] === undefined) throw original;
    const address = new URL(url);
    const inventory = record(await send('CacheStorage.requestCacheNames', {securityOrigin: address.origin}, cacheSession));
    if (!Array.isArray(inventory['caches'])) throw original;
    for (const value of inventory['caches']) {
      const cacheId = record(value)['cacheId']; if (typeof cacheId !== 'string') continue;
      const listed = record(await send('CacheStorage.requestEntries', {cacheId, skipCount: 0, pageSize: 100, pathFilter: address.pathname}, cacheSession));
      if (!Array.isArray(listed['cacheDataEntries'])) continue;
      for (const item of listed['cacheDataEntries']) {
        const entry = record(item);
        if (entry['requestURL'] !== url || !Array.isArray(entry['responseHeaders'])) continue;
        const headers: Record<string, string> = {};
        for (const header of entry['responseHeaders']) {
          const pair = record(header), name = pair['name'], content = pair['value'];
          if (typeof name === 'string' && typeof content === 'string') headers[name.toLowerCase()] = content;
        }
        if (!Object.entries(fingerprint).every(([name, content]) => headers[name] === content)) continue;
        const response = record(await send('CacheStorage.requestCachedResponse', {cacheId, requestURL: url,
          requestHeaders: Array.isArray(entry['requestHeaders']) ? entry['requestHeaders'] : []}, cacheSession));
        const body = record(response['response'])['body'];
        if (typeof body === 'string') return Buffer.byteLength(body, 'base64');
      }
    }
    throw original;
  }
}

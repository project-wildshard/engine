import {expect, test} from 'vitest';
import {nativeBodyBytes} from '../scripts/phone-loading/native-body';

test('an available native body never consults cache metadata or re-fetches', async () => {
  const calls: string[] = [];
  const bytes = await nativeBodyBytes(method => {calls.push(method); return Promise.resolve({body: '森林', base64Encoded: false});},
    'request-session', 'id', 'https://game.test/index.html', {});
  expect(bytes).toBe(6); expect(calls).toEqual(['Network.getResponseBody']);
});
test('a retired response recovers only the exact cached URL and original validators', async () => {
  const calls: string[] = [], url = 'https://game.test/index.html';
  const send: Parameters<typeof nativeBodyBytes>[0] = (method, _params, session) => {
    calls.push(method);
    if (method === 'Network.getResponseBody') return Promise.reject(new Error('Original body retired'));
    expect(session).toBe('matching-context-page');
    if (method === 'CacheStorage.requestCacheNames') return Promise.resolve({caches: [{cacheId: 'cache'}]});
    if (method === 'CacheStorage.requestEntries') return Promise.resolve({cacheDataEntries: [
      {requestURL: url, responseHeaders: [{name: 'etag', value: 'old'}]},
      {requestURL: url, responseHeaders: [{name: 'etag', value: 'exact'}], requestHeaders: []},
    ]});
    if (method === 'CacheStorage.requestCachedResponse') return Promise.resolve({response: {body: Buffer.from('exact body').toString('base64')}});
    throw new Error('Unexpected network request');
  };
  expect(await nativeBodyBytes(send, 'retired-worker', 'id', url, {etag: 'exact'}, 'matching-context-page')).toBe(10);
  expect(calls).toEqual(['Network.getResponseBody', 'CacheStorage.requestCacheNames', 'CacheStorage.requestEntries', 'CacheStorage.requestCachedResponse']);
});
test('a missing or crossed cached validator retains the real body refusal', async () => {
  for (const fingerprint of [{}, {etag: 'exact'}]) {
    const send: Parameters<typeof nativeBodyBytes>[0] = method => {
      if (method === 'Network.getResponseBody') return Promise.reject(new Error('Original body retired'));
      if (method === 'CacheStorage.requestCacheNames') return Promise.resolve({caches: [{cacheId: 'cache'}]});
      if (method === 'CacheStorage.requestEntries') return Promise.resolve({cacheDataEntries: [{requestURL: 'https://game.test/index.html', responseHeaders: [{name: 'etag', value: 'other'}]}]});
      throw new Error('Crossed body must not be read');
    };
    await expect(nativeBodyBytes(send, 'session', 'id', 'https://game.test/index.html', fingerprint)).rejects.toThrow('Original body retired');
  }
});

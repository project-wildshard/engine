import {afterEach, expect, test, vi} from 'vitest';
import {setSpawnPacks, startSpawnDownload} from '../src/client/game/boot/spawnDownload';

const initialStorage = globalThis.localStorage;
afterEach(() => { setSpawnPacks(false); vi.unstubAllGlobals(); vi.stubGlobal('localStorage', initialStorage); });

const BOOK = /\/assets\/spawn\/packs-[^/]+\.json$/u;
const body = new Uint8Array([1, 2, 3]), file = {url: '/shardfiles/fixture/blobs/bin/a.bin', bytes: 3, hash: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'};
const manifestOf = (slug: string, parts: boolean): string => JSON.stringify({version: 1, shard: slug, tier: 'phone', flow: 'client', files: [file], totalBytes: 3, ...(parts ? {parts: []} : {})});
interface Address {url: string; bytes: number; totalBytes: number; files: number}
const addressOf = (url: string, text: string): Address => ({url, bytes: text.length, totalBytes: 3, files: 1});

/** One Runtime packs download of `slug` against a served packs book; returns the download and every URL read. The
 * build id is the slug's own: the reader keeps one good book per build URL. */
function run(slug: string, book: (whole: Address, fallback: Address, init?: RequestInit) => Response | Promise<Response>, wholeParts = true) {
  const fallbackText = manifestOf(slug, false), wholeText = manifestOf(slug, wholeParts);
  const fallback = addressOf(`/assets/spawn/${slug}-client-phone-0123456789abcdef.json`, fallbackText);
  const whole = addressOf(`/assets/spawn/${slug}-client-phone-fedcba9876543210.json`, wholeText);
  vi.stubGlobal('document', {baseURI: 'http://localhost/', getElementById: () => ({textContent: JSON.stringify({spawnManifests: {
    cacheName: 'ws-assets-v1', client: {[slug]: {phone: fallback}}}})})});
  vi.stubGlobal('caches', undefined); vi.stubGlobal('__BUILD_ID__', `build-${slug}`);
  const reads: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input); reads.push(url);
    const path = new URL(url).pathname;
    return Promise.resolve(BOOK.test(path) ? book(whole, fallback, init) : path === whole.url ? new Response(wholeText)
      : path === fallback.url ? new Response(fallbackText) : path === file.url ? new Response(body) : new Response(null, {status: 404}));
  });
  setSpawnPacks(true);
  const download = startSpawnDownload(slug, 'client', 'phone');
  if (download === null) throw new Error('Missing spawn download');
  return {download, reads};
}
const entry = (slug: string, address: Address) => ({client: {[slug]: {phone: address}}});

// sp-x9's reviews of 40bc516d5c and bbceabe137: with Runtime packs on, any book that is not this build's whole-level
// book fails the download (admission refuses control with the reason); the default set never runs as complete.
test.each([
  ['a missing book', 'book-missing', () => new Response(null, {status: 404}), 'Packs book unavailable (404)'],
  ['an unreadable book', 'book-broken', () => new Response('{not json'), 'JSON'],
  ['the default book in its place', 'book-default', (_whole: Address, fallback: Address) => Response.json({cacheName: 'ws-assets-v1', ...entry('book-default', fallback)}),
    'not this build\'s whole-level book'],
  ['another build\'s book', 'book-stale', (whole: Address) => Response.json({book: 'packs', build: 'old-build', ...entry('book-stale', whole)}),
    'not this build\'s whole-level book'],
  ['a book without the entry', 'book-entryless', () => Response.json({book: 'packs', build: 'build-book-entryless', client: {}}),
    'Packs book has no client entry for book-entryless (phone, 000)'],
  ['a book naming the default manifest', 'book-subset', (_whole: Address, fallback: Address) => Response.json({book: 'packs', build: 'build-book-subset', ...entry('book-subset', fallback)}),
    'Packs book names the default manifest'],
] as const)('%s fails the Runtime packs download before any level file', async (_name, slug, book, reason) => {
  const {download, reads} = run(slug, book);
  await expect(download.ready).rejects.toThrow(reason);
  expect(download.snapshot()).toMatchObject({complete: false, error: expect.stringContaining(reason)});
  // Only the book was read: no manifest and no level file started.
  expect(reads).toHaveLength(1); expect(new URL(reads[0] ?? '').pathname).toMatch(BOOK);
});

test('a whole-level address whose manifest has no part table is refused', async () => {
  const {download, reads} = run('book-partless', whole => Response.json({book: 'packs', build: 'build-book-partless', ...entry('book-partless', whole)}), false);
  await expect(download.ready).rejects.toThrow('Packs manifest has no part table');
  expect(reads.map(url => new URL(url).pathname)).not.toContain(file.url);
});

test('this build\'s packs book runs the whole-level manifest to completion', async () => {
  const {download, reads} = run('book-good', whole => Response.json({book: 'packs', build: 'build-book-good', ...entry('book-good', whole)}));
  await download.ready;
  expect(download.snapshot()).toMatchObject({complete: true, error: null, filesDone: 1});
  expect(reads.map(url => new URL(url).pathname)).toEqual([expect.stringMatching(BOOK), '/assets/spawn/book-good-client-phone-fedcba9876543210.json', file.url]);
});

test('a packs book that stalls is refused by name instead of an endless wait (DL21)', async () => {
  // The 20 s limit has passed: the signal the reader made is already aborted, and the stalled fetch rejects with it.
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')));
  const {download} = run('book-stalled', (_whole, _fallback, init) =>
    init?.signal?.aborted === true ? Promise.reject(new Error('aborted')) : new Promise<Response>(() => { /* never answers */ }));
  await expect(download.ready).rejects.toThrow('Packs book did not arrive in 20 s');
  expect(download.snapshot()).toMatchObject({complete: false, error: 'Packs book did not arrive in 20 s'});
});

test('a packs book whose body stalls past the limit is the same named refusal (DL21, sp-x9)', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')));
  // The headers arrived; the body never finishes and rejects when the (already passed) limit aborts it.
  const {download} = run('book-slow-body', () => new Response(new ReadableStream({pull: controller => { controller.error(new DOMException('aborted', 'AbortError')); }})));
  await expect(download.ready).rejects.toThrow('Packs book did not arrive in 20 s');
});

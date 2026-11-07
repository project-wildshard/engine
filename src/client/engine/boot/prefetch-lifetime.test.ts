// @vitest-environment happy-dom
import {afterAll, afterEach, beforeEach, expect, test, vi} from 'vitest';

const nativeFetch = window.fetch;
beforeEach(() => {window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));});
afterAll(async () => {
  const {pageScope} = await import('../../../shared/engine/app/resources');
  pageScope.dispose();
});
afterEach(() => {
  window.dispatchEvent(new Event('beforeunload')); window.fetch = nativeFetch; vi.restoreAllMocks();
});
const response = (): Response => new Response(new Uint8Array([1, 2, 3]));
const pathOf = (input: RequestInfo | URL): string => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

test('a live queue keeps original order, bounded parallel reads and exact borrowed bytes', async () => {
  let release: (body: Response) => void = () => {throw new Error('Missing first read');};
  const first = new Promise<Response>(resolve => {release = resolve;});
  const read = vi.fn<typeof fetch>(url => pathOf(url) === '/one' ? first : Promise.resolve(response()));
  window.fetch = read;
  const {prefetch, whenPrefetched} = await import('./prefetch');
  expect(prefetch(['/one', '/two', '/three'], 2)).toBe(3);
  const borrowed = window.fetch('/one');
  await whenPrefetched('/three');
  expect(read.mock.calls.map(([url]) => url)).toEqual(['/one', '/two', '/three']);
  release(response());
  expect([...new Uint8Array(await (await borrowed).arrayBuffer())]).toEqual([1, 2, 3]);
  expect(read).toHaveBeenCalledTimes(3);
});

test('native navigation cancellation neither pumps queued files nor retries a borrowed read', async () => {
  let cancel: (error: Error) => void = () => {throw new Error('Missing native cancellation');};
  const first = new Promise<Response>((_resolve, reject) => {cancel = reject;});
  const read = vi.fn<typeof fetch>(url => pathOf(url) === '/one' ? first : Promise.resolve(response()));
  window.fetch = read;
  const {prefetch, whenPrefetched} = await import('./prefetch');
  prefetch(['/one', '/two', '/three'], 1);
  const borrowed = expect(window.fetch('/one')).rejects.toMatchObject({name: 'AbortError'});
  const waiting = expect(whenPrefetched('/two')).rejects.toMatchObject({name: 'AbortError'});
  window.dispatchEvent(new Event('beforeunload'));
  cancel(new TypeError('Native navigation cancelled this read'));
  await Promise.all([borrowed, waiting]);
  await expect(window.fetch('/late-cache-hint-pack')).rejects.toMatchObject({name: 'AbortError'});
  expect(read.mock.calls.map(([url]) => url)).toEqual(['/one']);
  // Teardown diagnostics keep their existing non-GET transport/keepalive.
  await window.fetch('/diagnostic', {method: 'POST', keepalive: true});
  expect(read.mock.calls.at(-1)).toEqual(['/diagnostic', {method: 'POST', keepalive: true}]);
  // BFCache return uses ordinary demand; no stale speculative body survives.
  window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
  expect([...new Uint8Array(await (await window.fetch('/two')).arrayBuffer())]).toEqual([1, 2, 3]);
  expect(read.mock.calls.map(([url]) => url)).toEqual(['/one', '/diagnostic', '/two']);
});

test('a late world barrier cannot install an extras queue in the ending document', async () => {
  let release: () => void = () => {throw new Error('Missing world barrier');};
  const barrier = new Promise<void>(resolve => {release = resolve;});
  const read = vi.fn<typeof fetch>(() => Promise.resolve(response())); window.fetch = read;
  const {prefetchAfter, whenPrefetched} = await import('./prefetch');
  prefetchAfter(['/late-audio'], barrier);
  const waiting = expect(whenPrefetched('/late-audio')).rejects.toMatchObject({name: 'AbortError'});
  window.dispatchEvent(new Event('beforeunload')); release();
  await waiting; expect(read).not.toHaveBeenCalled();
});

test('persisted pagehide alone keeps an admitted live queue resumable', async () => {
  let release: (body: Response) => void = () => {throw new Error('Missing suspended read');};
  const first = new Promise<Response>(resolve => {release = resolve;});
  const read = vi.fn<typeof fetch>(url => pathOf(url) === '/suspended-one' ? first : Promise.resolve(response())); window.fetch = read;
  const {prefetch, whenPrefetched} = await import('./prefetch'); prefetch(['/suspended-one', '/suspended-two'], 1);
  const hidden = new PageTransitionEvent('pagehide', {persisted: true});
  // happy-dom omits PageTransitionEvent.persisted; supply the actual native
  // event field rather than weakening the production lifecycle check.
  Object.defineProperty(hidden, 'persisted', {value: true});
  expect(hidden.persisted).toBe(true);
  window.dispatchEvent(hidden);
  release(response()); await whenPrefetched('/suspended-two');
  expect(read.mock.calls.map(([url]) => url)).toEqual(['/suspended-one', '/suspended-two']);
});

test('live read failures retain ordinary demand fallback and its exact bytes', async () => {
  let cancel: (error: Error) => void = () => {throw new Error('Missing failed read');};
  const first = new Promise<Response>((_resolve, reject) => {cancel = reject;});
  const read = vi.fn<typeof fetch>().mockImplementationOnce(() => first).mockImplementation(() => Promise.resolve(response())); window.fetch = read;
  const {prefetch} = await import('./prefetch'); prefetch(['/one'], 1);
  const borrowed = window.fetch('/one'); cancel(new TypeError('Ordinary transient failure'));
  expect([...new Uint8Array(await (await borrowed).arrayBuffer())]).toEqual([1, 2, 3]);
  expect(read.mock.calls.map(([url]) => url)).toEqual(['/one', '/one']);
});

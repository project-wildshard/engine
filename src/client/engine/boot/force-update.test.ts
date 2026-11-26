// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { ClientUpdater, olderClient } from './forceUpdate';

const books = new Map<string, Map<string, Response>>();
const deletedDatabases: string[] = [];
const owners: Scope[] = [];
let minimum = '0.1.24';
const reload = vi.fn();
beforeEach(() => {
  books.clear(); deletedDatabases.length = 0; minimum = '0.1.24'; reload.mockClear(); sessionStorage.clear();
  document.documentElement.innerHTML = '<head></head><body></body>';
  localStorage.clear(); localStorage.setItem('account-sentinel', 'keep'); localStorage.setItem('settings-sentinel', 'keep');
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('caches', {
    has: (name: string) => Promise.resolve(books.has(name)), keys: () => Promise.resolve([...books.keys()]),
    delete: (name: string) => Promise.resolve(books.delete(name)),
    open: (name: string) => {
      const entries = books.get(name) ?? new Map<string, Response>(); books.set(name, entries);
      return Promise.resolve({ match: (path: string) => Promise.resolve(entries.get(path)?.clone()), put: (path: string, response: Response) => { entries.set(path, response); return Promise.resolve(); } });
    },
  });
  vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => {
    deletedDatabases.push(name);
    const request: { onsuccess: (() => void) | null; onerror: (() => void) | null } = { onsuccess: null, onerror: null };
    queueMicrotask(() => { request.onsuccess?.(); }); return request;
  } });
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(input => Promise.resolve(Response.json(input === '/version.json' ? { minClient: minimum } : {}))));
  const unregister = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const getRegistrations = vi.fn<() => Promise<{ unregister: () => Promise<boolean> }[]>>().mockResolvedValue([{ unregister }]);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistrations } });
});
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
const owner = (): Scope => { const scope = new Scope('test.force-update'); owners.push(scope); return scope; };

test('server minimum compares versions numerically and ignores malformed or absent policy', () => {
  expect(olderClient('0.1.9', '0.1.24')).toBe(true);
  expect(olderClient('0.1.30', '0.1.24')).toBe(false);
  expect(olderClient('0.1.24', '0.1.24')).toBe(false);
  for (const value of [undefined, null, 'bad', 'https://invalid', '0.1.24.1']) expect(olderClient('0.1.23', value)).toBe(false);
});

test('a retired boot unregisters, wipes every download and only the pack database, then reloads once', async () => {
  books.set('old-shell', new Map()); books.set('old-packs', new Map());
  const client = new ClientUpdater(sessionStorage);
  await client.install('0.1.23', owner());
  await vi.waitFor(() => { expect(document.querySelector('#ws-old-tab[data-card="old-tab-updated"]')?.textContent).toBe('Wildshard was updated. Reload to keep playing. Your progress is safe.'); });
  expect(reload).not.toHaveBeenCalled();
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
  await client.force();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(books.has('old-shell')).toBe(false); expect(books.has('old-packs')).toBe(false);
  expect(deletedDatabases).toEqual(['ws-built-home-v1']);
  expect(localStorage.getItem('account-sentinel')).toBe('keep'); expect(localStorage.getItem('settings-sentinel')).toBe('keep');
  expect(document.getElementById('ws-old-tab')?.dataset['card']).toBe('old-tab-updated');
});

test('foreground rechecks a raised floor; the accepted next client does not enter a reset loop', async () => {
  const client = new ClientUpdater(sessionStorage), first = owner();
  await client.install('0.1.29', first);
  await vi.waitFor(() => { expect(fetch).toHaveBeenCalled(); });
  expect(reload).not.toHaveBeenCalled();
  minimum = '0.1.30'; window.dispatchEvent(new Event('pageshow'));
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
  first.dispose();
  const next = new ClientUpdater(sessionStorage); await next.install('0.1.30', owner());
  window.dispatchEvent(new Event('pageshow'));
  await Promise.resolve(); await Promise.resolve();
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a pending blocked worker wipe completes before app entry', async () => {
  books.set('ws-force-update-j383-v1', new Map([['/__force-update-state__', new Response('pending')]]));
  books.set('stale-code', new Map());
  const client = new ClientUpdater(sessionStorage);
  expect(await client.install('0.1.31', owner())).toBe(false);
  expect(books.has('stale-code')).toBe(false); expect(reload).toHaveBeenCalledTimes(1);
});

test('native cleanup refusal still reloads rather than leaving Updating forever', async () => {
  vi.stubGlobal('caches', { keys: () => Promise.reject(new Error('Native cache refused')) });
  await new ClientUpdater(sessionStorage).force();
  expect(reload).toHaveBeenCalledTimes(1); expect(document.documentElement.dataset['forceUpdateIncomplete']).toBe('true');
});

test('a permanently refused cache database gets one retry per tab session, then enters without a reload loop', async () => {
  books.set('ws-force-update-j383-v1', new Map([['/__force-update-state__', new Response('pending')]]));
  vi.stubGlobal('indexedDB', { deleteDatabase: () => {
    const request: { onsuccess: (() => void) | null; onerror: (() => void) | null } = { onsuccess: null, onerror: null };
    queueMicrotask(() => { request.onerror?.(); }); return request;
  } });
  expect(await new ClientUpdater(sessionStorage).install('0.1.31', owner())).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(await new ClientUpdater(sessionStorage).install('0.1.31', owner())).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(await books.get('ws-force-update-j383-v1')?.get('/__force-update-state__')?.clone().text()).toBe('complete');
});

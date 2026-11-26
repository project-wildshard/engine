// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { clientFloor } from '../src/scripts/app-build/clientFloor';
import { ClientUpdater, olderClient } from '../src/client/engine/boot/forceUpdate';
import { Scope } from '../src/shared/engine/app/scope';

const mainVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
test.each([mainVersion, '0.1.30', '0.1.31', '0.1.32', '0.2.0'])('a %s build enters boot under its own emitted client floor', async version => {
  const scope = new Scope('test.main-client-floor');
  try {
    const document = { clientVersion: version, minClient: clientFloor(version) };
    expect(olderClient(document.clientVersion, document.minClient)).toBe(false);
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    vi.stubGlobal('caches', { has: () => Promise.resolve(false) });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(document))));
    sessionStorage.clear();
    expect(await new ClientUpdater(sessionStorage).install(document.clientVersion, scope)).toBe(true);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalled(); });
    window.dispatchEvent(new Event('pageshow'));
    await Promise.resolve(); await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
  } finally { scope.dispose(); vi.unstubAllGlobals(); }
});

// J492: the previous release yields to the new floor once. The new page stays and J383 keeps the durable save.
test('the wire release requires an upgrade once, then admits the new page', async () => {
  const document = { clientVersion: '0.1.73', minClient: clientFloor('0.1.73') };
  const dropped: string[] = [];
  const boot = async (version: string): Promise<number> => {
    const scope = new Scope('test.epoch-cut-floor');
    const reload = vi.fn();
    try {
      vi.stubGlobal('location', { reload });
      vi.stubGlobal('caches', { has: () => Promise.resolve(false), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true),
        open: () => Promise.resolve({ put: () => Promise.resolve(), match: () => Promise.resolve(undefined) }) });
      vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => { dropped.push(name); const request = { onsuccess: null as (() => void) | null }; queueMicrotask(() => { request.onsuccess?.(); }); return request; } });
      vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url === '/version.json' ? Response.json(document) : new Response('{}'))));
      sessionStorage.clear();
      await new ClientUpdater(sessionStorage).install(version, scope);
      await vi.waitFor(() => { expect(fetch).toHaveBeenCalled(); });
      if (olderClient(version, document.minClient)) {
        await vi.waitFor(() => { expect(window.document.querySelector('#ws-old-tab[data-card="old-tab-updated"]')?.textContent).toBe('Wildshard was updated. Reload to keep playing. Your progress is safe.'); });
        expect(reload).not.toHaveBeenCalled();
        await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); });
      }
      return reload.mock.calls.length;
    } finally { scope.dispose(); vi.unstubAllGlobals(); }
  };
  expect(await boot('0.1.67')).toBe(1);
  expect(dropped).toEqual(['ws-built-home-v1']);
  expect(await boot('0.1.73')).toBe(0);
});

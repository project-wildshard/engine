// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { clientFloor } from '../scripts/app-build/clientFloor';
import { ClientUpdater, olderClient } from '../src/client/engine/boot/forceUpdate';
import { Scope } from '../src/shared/engine/app/scope';

const mainVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
test.each([mainVersion, '0.1.30', '0.1.31', '0.1.32', '0.2.0'])('a %s build enters boot under its own emitted client floor', async version => {
  const scope = new Scope('test.main-client-floor');
  try {
    const document = { clientVersion: version, minClient: clientFloor(version) };
    expect(olderClient(document.clientVersion, document.minClient)).toBe(false);
    // WR8b: the epoch-2 cut raised the floor to 0.1.36; an older build clamps to itself.
    expect(document.minClient).toBe(olderClient(version, '0.1.36') ? version : '0.1.36');
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

// WR8b: the epoch-2 cut. A 0.1.35 page (epoch 1) that reads the 0.1.36 version.json is forced over exactly once; the
// 0.1.36 page it reloads into meets its own floor and stays. J383 drops caches and the compiled-home cache only.
test('a 0.1.35 page is forced over once by the epoch-2 release, and the 0.1.36 page stays', async () => {
  const document = { clientVersion: '0.1.36', minClient: clientFloor('0.1.36') };
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
      await new Promise(resolve => { setTimeout(resolve, 50); });
      return reload.mock.calls.length;
    } finally { scope.dispose(); vi.unstubAllGlobals(); }
  };
  expect(await boot('0.1.35')).toBe(1);
  expect(dropped).not.toContain('wildshard-saves@1');
  expect(await boot('0.1.36')).toBe(0);
});

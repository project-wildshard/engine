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

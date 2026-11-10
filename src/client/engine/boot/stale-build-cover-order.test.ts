// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

// This file never imports the cover first: an unbundled dev page can reach the stale-build reload before any module that
// imports src/client/engine/ui/reloadCover.ts has run, so nobody answers `ws:reloading` (J206 review, opus-reload2).
afterEach(() => { document.body.replaceChildren(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('RL8: a stale-build reload puts the RELOADING cover up even when the cover module had not loaded, before the page leaves', async () => {
  vi.stubGlobal('__BUILD_ID__', '40e08ff-old');
  const coverAtReload: boolean[] = [];
  const reload = vi.fn(() => { coverAtReload.push(document.getElementById('ws-reloading') !== null); });
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?chunk=driftwood-isle'), { reload, replace: vi.fn() }));
  vi.stubGlobal('fetch', () => Promise.resolve(Object.defineProperty(Response.json({ build: 'd91507e-live' }), 'url', { value: '' })));
  const { reloadIfStaleBuild } = await import('./browserChunkRecovery');
  await expect(reloadIfStaleBuild()).resolves.toBe(true);
  await vi.waitFor(() => { expect(document.getElementById('ws-reloading')?.textContent).toContain('out of date'); });
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); }, { timeout: 5000 });
  expect(coverAtReload).toEqual([true]);
  expect(document.querySelectorAll('#ws-reloading')).toHaveLength(1);
});

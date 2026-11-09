// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(async () => {
  (await import('../ui/reloadCover')).hideReloading();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); sessionStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

/** the old cached build on Jake's phone: its hashed spawn manifest is gone from the live deploy */
type Files = (url: string, init: RequestInit) => Promise<Response>;
function oldBuildPage(live: string): { reload: () => void; files: Files & { mock: { calls: unknown[] } } } {
  vi.stubGlobal('__BUILD_ID__', '40e08ff-old');
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?chunk=driftwood-isle'), { reload, replace: vi.fn() }));
  // a same-origin answer reports url '' as a browser's does (happy-dom leaves it undefined)
  const answer = (response: Response): Response => Object.defineProperty(response, 'url', { value: '' });
  vi.stubGlobal('fetch', (url: URL | string) => Promise.resolve(answer(String(url).includes('/version.json') ? Response.json({ build: live }) : new Response('Not found', { status: 404 }))));
  const files = vi.fn<Files>(() => Promise.resolve(new Response('Not found', { status: 404 })));
  return { reload, files };
}

test('RL8: a file 404 on a build the server no longer serves reloads into the live build, with the Reloading cover, once', async () => {
  const { reload, files } = oldBuildPage('d91507e-live');
  await import('../ui/reloadCover');
  const { readContent } = await import('./contentRead');
  void readContent('https://example.com/assets/spawn/driftwood-isle-client-phone-old.json', 1000, { fetch: files });
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); }, { timeout: 5000 }); // past a worker unregister that never answers (3 s cap)
  expect(files).toHaveBeenCalledTimes(2); // the one immediate retry, then the stale check: no RETRY wait
  expect(document.getElementById('ws-reloading')?.textContent).toContain('out of date');
  // the same build in the same tab never reloads twice (a broken deploy can't loop), even after an online server took
  // the build (settleRefusedBuild clears the shared self-reload claim, not this one): it falls back to the card's RETRY
  const recovery = await import('./browserChunkRecovery');
  recovery.settleRefusedBuild();
  await expect(recovery.reloadIfStaleBuild()).resolves.toBe(false);
});

test('RL8: an HTML fallback with no HTML content type (sniffed from the body) counts as missing too', async () => {
  const { reload } = oldBuildPage('d91507e-live');
  const page = vi.fn<Files>(() => Promise.resolve(Object.defineProperty(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'application/json' } }), 'url', { value: '' })));
  const { readContent } = await import('./contentRead');
  void readContent('https://example.com/assets/spawn/driftwood-isle-client-phone-old.json', 1000, { fetch: page });
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); }, { timeout: 5000 });
});

test('RL8: a 404 while this build is still the live one keeps the default RETRY wait (no reload)', async () => {
  const { reload, files } = oldBuildPage('40e08ff-old');
  const { readContent } = await import('./contentRead');
  const { loadingWaitState } = await import('../../../shared/engine/boot/loadingWaits');
  const stop = new AbortController();
  const read = readContent('https://example.com/assets/spawn/x.json', 1000, { fetch: files, signal: stop.signal });
  // the default path (no `retry` option): the stale check runs, finds this build live, and the card's RETRY wait opens
  await vi.waitFor(() => { expect([...loadingWaitState().pending.values()].some(wait => wait.label.includes('HTTP 404'))).toBe(true); });
  expect(reload).not.toHaveBeenCalled(); expect(document.getElementById('ws-reloading')).toBeNull();
  stop.abort(new Error('left the page'));
  await expect(read).rejects.toThrow('left the page');
});

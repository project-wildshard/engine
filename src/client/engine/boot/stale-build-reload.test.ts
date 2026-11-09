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
  // the same build in the same tab never reloads twice (a broken deploy can't loop): it falls back to the card's RETRY
  await expect((await import('./browserChunkRecovery')).reloadIfStaleBuild()).resolves.toBe(false);
});

test('RL8: a 404 while this build is still the live one keeps the ordinary RETRY (no reload)', async () => {
  const { reload, files } = oldBuildPage('40e08ff-old');
  const { readContent } = await import('./contentRead');
  const retry = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('stop')));
  await expect(readContent('https://example.com/assets/spawn/x.json', 1000, { fetch: files, retry })).rejects.toThrow('stop');
  await expect((await import('./browserChunkRecovery')).reloadIfStaleBuild()).resolves.toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

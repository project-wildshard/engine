// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(async () => {
  const pill = document.querySelector('.ws-update');
  if (pill !== null) (await import('./hudSlots')).hudSlots.ownerOf(pill)?.dispose();
  (await import('./reloadCover')).hideReloading();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw');
  Reflect.deleteProperty(navigator, 'onLine'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('RL2 / RL3: off the title one tap reloads in place; the pill and the cover say Reloading in the tap\'s own turn', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture-before' })));
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn(), adopt = vi.fn((_to?: string) => Promise.resolve(false));
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?chunk=canal-reserve&v=old'), { replace, reload }));
  Object.defineProperty(window, '__ws_sw', { configurable: true, value: { waiting: { state: 'installed' }, adopt } });
  document.body.innerHTML = '<div id="hud"></div><div class="ws-gmenu show pause"></div>';
  await import('./Update');
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  pill.dispatchEvent(new Event('pointerup')); pill.click();
  // synchronous: no timer, no microtask has run since the tap
  expect(pill.textContent).toBe('Reloading'); expect(pill.disabled).toBe(true); expect(pill.getAttribute('aria-busy')).toBe('true');
  expect(document.getElementById('ws-reloading')?.textContent).toContain('Reloading');
  expect(document.body.textContent).not.toContain('Confirm reload');
  // QC3: the waiting worker is adopted in place, with RL3's 3 s; one that cannot be is a plain reload, once
  expect(adopt).toHaveBeenCalledExactlyOnceWith(undefined, 'update tapped', 3000); await vi.advanceTimersByTimeAsync(0);
  expect(reload).toHaveBeenCalledOnce(); expect(replace).not.toHaveBeenCalled();
  pill.dispatchEvent(new Event('pointerup')); pill.click(); await vi.advanceTimersByTimeAsync(0);
  expect(adopt).toHaveBeenCalledOnce(); expect(reload).toHaveBeenCalledOnce();
  // the cover is never taken down by time: only the page leaving (or a bfcache return) ends it
  await vi.advanceTimersByTimeAsync(60_000);
  expect(document.getElementById('ws-reloading')?.isConnected).toBe(true);
});

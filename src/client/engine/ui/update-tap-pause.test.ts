// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(async () => {
  const pill = document.querySelector('.ws-update');
  if (pill !== null) (await import('./hudSlots')).hudSlots.ownerOf(pill)?.dispose();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('RL2 / G877: off the title, a tap arms Confirm reload, which lapses in 4 s; a second tap reloads in place', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture-before' })));
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn(), adopt = vi.fn((_to?: string) => Promise.resolve(false));
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?chunk=canal-reserve&v=old'), { replace, reload }));
  Object.defineProperty(window, '__ws_sw', { configurable: true, value: { waiting: { state: 'installed' }, adopt } });
  document.body.innerHTML = '<div id="hud"></div><div class="ws-gmenu show pause"></div>';
  await import('./Update');
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  pill.dispatchEvent(new Event('pointerup')); pill.click(); await vi.advanceTimersByTimeAsync(100);
  expect(pill.textContent).toContain('Confirm reload'); expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4000);
  expect(pill.textContent).not.toContain('Confirm reload'); expect(reload).not.toHaveBeenCalled();
  pill.dispatchEvent(new Event('pointerup')); pill.click(); await vi.advanceTimersByTimeAsync(600);
  expect(reload).not.toHaveBeenCalled();
  pill.dispatchEvent(new Event('pointerup')); pill.click();
  // QC3: the waiting worker is adopted in place; one that cannot be is a plain reload
  expect(adopt).toHaveBeenCalledExactlyOnceWith(undefined, 'update tapped'); await vi.advanceTimersByTimeAsync(0);
  expect(reload).toHaveBeenCalledOnce(); expect(replace).not.toHaveBeenCalled();
});

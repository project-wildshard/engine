// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';

test('PV11: a newer build in /version.json lights the "Update available" pill, which never sits over play', async () => {
  vi.stubGlobal('__BUILD_ID__', 'old-build');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ build: 'new-build' }))));
  await import('./Update');
  window.dispatchEvent(new CustomEvent('ws-live-build', { detail: { build: 'new-build' } }));
  const pill = document.querySelector<HTMLButtonElement>('button.ws-update');
  expect(pill?.classList.contains('newer')).toBe(true);
  expect(pill?.querySelector('[data-el="text"]')?.textContent).toBe('Update available');
  // the pill shows on the title and pause menus only: with neither up it stays hidden, so play is never blocked
  expect(pill?.classList.contains('visible')).toBe(false);
  vi.unstubAllGlobals();
});

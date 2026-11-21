// @vitest-environment happy-dom
// Meta STAGING-BUGBASH SB53: offline in the loading card's first second, the boot's one recovery reload ran while still
// offline, the reloaded page's entry modules failed too, and the card sat at START 0 % after the network came back.
import { afterEach, expect, test, vi } from 'vitest';
import { guardBoot } from './stuck';
import { saveStorage } from '../saves/slots';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); saveStorage('session')?.removeItem('boot.selfReload'); });

test('SB53: a boot that fails offline waits for the network before its one reload', async () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/?chunk=driftwood-isle', origin: 'https://boot.test', pathname: '/', search: '?chunk=driftwood-isle', reload });
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  guardBoot(Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
  await new Promise(resolve => { setTimeout(resolve, 50); });
  expect(reload).not.toHaveBeenCalled();
  expect(saveStorage('session')?.getItem('boot.selfReload') ?? null).toBeNull(); // the one retry is not spent offline
  onLine.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
  window.dispatchEvent(new Event('online'));
  await new Promise(resolve => { setTimeout(resolve, 20); });
  expect(reload).toHaveBeenCalledTimes(1);
});

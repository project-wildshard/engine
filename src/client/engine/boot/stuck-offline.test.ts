// @vitest-environment happy-dom
// Meta STAGING-BUGBASH SB53: offline in the loading card's first second, the boot's one recovery reload ran while still
// offline, the reloaded page's entry modules failed too, and the card sat at START 0 % after the network came back.
import { afterEach, expect, test, vi } from 'vitest';
import { guardBoot, OFFLINE_START_LINE } from './stuck';
import { saveStorage } from '../saves/slots';
import { LeavingPlayError } from './endPlay';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); saveStorage('session')?.removeItem('boot.selfReload'); });

test('SB53: a boot that fails offline waits for the network before its one reload', async () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload });
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

// QA 11-24 row 25: offline on a first visit (no service worker control yet), the start's chunks fail and the card stood at
// START 84 % with its clock running and no word; the wait now says why on the card, and its line goes when the network is back.
test('a boot that fails offline says so on the loading card until the network is back', async () => {
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload: vi.fn<() => void>() });
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const card = document.createElement('div'); card.className = 'ws-load'; document.body.append(card);
  guardBoot(Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
  await vi.waitFor(() => { expect(card.querySelector('.ws-load-offline')?.textContent).toBe(OFFLINE_START_LINE); });
  expect(card.querySelector('.ws-load-offline')?.getAttribute('role')).toBe('alert');
  onLine.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  // the wait ends (its recovery is the SB53 test's): the line goes with it
  await vi.waitFor(() => { expect(card.querySelector('.ws-load-offline')).toBeNull(); });
});

// QA 11-25 row 35: a boot that stopped through the J501 funnel (the zone-updating card stays on the page) is no failure; the
// boot's recovery reloaded it onto the title, and the card was gone a tenth of a second after it showed.
test('a boot that left through the funnel is not recovered: no reload, no retry spent', async () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload });
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  guardBoot(Promise.reject(new LeavingPlayError('brasscap-mesa: the world runs a newer revision than this page has; waiting for it')));
  await new Promise(resolve => { setTimeout(resolve, 50); });
  expect(reload).not.toHaveBeenCalled();
  expect(saveStorage('session')?.getItem('boot.selfReload') ?? null).toBeNull();
});

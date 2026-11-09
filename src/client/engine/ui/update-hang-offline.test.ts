// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

/** a reply port, duck-typed (happy-dom's MessagePort is not the global one) */
function replyPort(value: unknown): value is { postMessage: (message: unknown) => void } {
  return typeof value === 'object' && value !== null && 'postMessage' in value && typeof value.postMessage === 'function';
}

afterEach(async () => {
  const pill = document.querySelector('.ws-update');
  if (pill !== null) (await import('./hudSlots')).hudSlots.ownerOf(pill)?.dispose();
  (await import('./reloadCover')).hideReloading();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw');
  Reflect.deleteProperty(navigator, 'onLine'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('RL5: a waiting worker that never finishes its precache still reloads hard at 3 s, and the cover says why', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture-after' })));
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?sw=1'), { replace, reload }));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  /** a worker that answers BUILD, and never answers PRECACHE or SKIP_WAITING (the 4G phone) */
  class Silent extends EventTarget {
    state: ServiceWorkerState = 'installed';
    readonly messages: unknown[] = [];
    postMessage(message: unknown, transfer?: Transferable[]): void {
      this.messages.push(message);
      const port: unknown = transfer?.[0];
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'BUILD' && replyPort(port)) port.postMessage({ build: 'fixture-after-stamp' });
    }
  }
  const active = new Silent(), waiting = new Silent();
  active.state = 'activated';
  const registration = Object.assign(new EventTarget(), { installing: null, waiting, active, update: () => Promise.resolve() });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => Promise.resolve(registration), register: () => Promise.resolve(registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  document.body.innerHTML = '<div id="hud" class="intro"><div class="ws-menu"></div></div>';
  await import('./Update');
  await import('../boot/sw');
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  pill.click();
  expect(document.getElementById('ws-reloading')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2900);
  expect(replace).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(replace).toHaveBeenCalledExactlyOnceWith('/'); expect(reload).not.toHaveBeenCalled();
  expect(document.getElementById('ws-reloading')?.textContent).toContain('slow to switch over');
  // an offline page never skips waiting into a build whose code it does not hold (DL1)
  expect(waiting.messages).not.toContainEqual({ type: 'SKIP_WAITING' });
  // and a hand-over that lands later never navigates a second time
  await vi.advanceTimersByTimeAsync(10_000);
  expect(replace).toHaveBeenCalledOnce();
});

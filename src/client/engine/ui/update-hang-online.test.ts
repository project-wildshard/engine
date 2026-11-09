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

test('RL5: online, a precache still running at 2 s is skipped past, so the tap lands on the new build', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture-after' })));
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?sw=1'), { replace, reload }));
  class Slow extends EventTarget {
    state: ServiceWorkerState = 'installed';
    readonly messages: unknown[] = [];
    postMessage(message: unknown, transfer?: Transferable[]): void {
      this.messages.push(message);
      const port: unknown = transfer?.[0], type = typeof message === 'object' && message !== null && 'type' in message ? message.type : '';
      if (type === 'BUILD' && replyPort(port)) port.postMessage({ build: 'fixture-after-stamp' });
      if (type === 'SKIP_WAITING') queueMicrotask(() => { this.state = 'activated'; this.dispatchEvent(new Event('statechange')); });
    }
  }
  const active = new Slow(), waiting = new Slow();
  active.state = 'activated';
  const registration = Object.assign(new EventTarget(), { installing: null, waiting, active, update: () => Promise.resolve() });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => Promise.resolve(registration), register: () => Promise.resolve(registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  document.body.innerHTML = '<div id="hud" class="intro"><div class="ws-menu"></div></div>';
  await import('./Update');
  await import('../boot/sw');
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  pill.click();
  await vi.advanceTimersByTimeAsync(1900);
  expect(waiting.messages).not.toContainEqual({ type: 'SKIP_WAITING' });
  await vi.advanceTimersByTimeAsync(200);
  expect(waiting.messages).toContainEqual({ type: 'SKIP_WAITING' });
  expect(replace).toHaveBeenCalledExactlyOnceWith('/'); expect(reload).not.toHaveBeenCalled();
  expect(document.getElementById('ws-reloading')?.textContent).not.toContain('slow to switch over');
});

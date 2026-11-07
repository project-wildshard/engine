// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

function replyPort(value: unknown): value is { postMessage: (message: unknown) => void } {
  return typeof value === 'object' && value !== null && 'postMessage' in value && typeof value.postMessage === 'function';
}
/** a worker that answers BUILD on its reply port and records what it was sent */
class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  readonly messages: unknown[] = [];
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message);
    const port: unknown = transfer?.[0];
    if (replyPort(port)) port.postMessage({ build: 'fixture-after-stamp', ok: true });
  }
}

afterEach(async () => {
  const pill = document.querySelector('.ws-update');
  if (pill !== null) (await import('./hudSlots')).hudSlots.ownerOf(pill)?.dispose();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('QC3: the lit pill activates the waiting worker before it reloads, so the next document has nothing waiting', async () => {
  vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture-after' })));
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?sw=1'), { replace, reload }));
  const active = new Worker(), waiting = new Worker();
  active.state = 'activated';
  const registration = Object.assign(new EventTarget(), { installing: null, waiting, active, update: () => Promise.resolve() });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => Promise.resolve(registration), register: () => Promise.resolve(registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  document.body.innerHTML = '<div id="hud" class="intro"><div class="ws-menu"></div></div>';
  const lit = new Promise(resolve => { window.addEventListener('ws-sw-waiting', resolve, { once: true }); });
  await import('./Update');
  await import('../boot/sw');
  await lit;
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  expect(pill.classList.contains('newer')).toBe(true);
  pill.dispatchEvent(new Event('pointerup')); pill.click();
  await vi.waitFor(() => { expect(waiting.messages).toContainEqual({ type: 'SKIP_WAITING' }); });
  // RL2 navigated here, in the tap's own turn: the old worker served the next document and the new one stayed waiting
  await Promise.resolve(); expect(replace).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  waiting.state = 'activated'; waiting.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => { expect(replace).toHaveBeenCalledExactlyOnceWith('/'); });
  expect(reload).not.toHaveBeenCalled(); expect(window.__ws_sw?.waiting).toBeNull();
  expect(waiting.messages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'SKIP_WAITING')).toHaveLength(1);
});

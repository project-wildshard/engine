// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';

test('an uncontrolled return watches its pending first install without another register job or readiness wait', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__BUILD_ID__', 'first-install');
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
  const update = vi.fn(() => new Promise<void>(() => { /* An update job never settles. */ }));
  const registration = Object.assign(new EventTarget(), { active: null, installing: worker, waiting: null, update });
  const register = vi.fn(() => new Promise<typeof registration>(() => { /* A queued register job never settles. */ }));
  const getRegistration = vi.fn(() => Promise.resolve(registration));
  const container = Object.assign(new EventTarget(), { controller: null, register, getRegistration });
  const listeners = vi.spyOn(registration, 'addEventListener');
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  try {
    await import('./lastEnd');
    const pageTimers = vi.getTimerCount();
    const { wsSw } = await import('./sw');
    let ready = false;
    void wsSw.ready.then(() => { ready = true; return undefined; });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true); expect(getRegistration).toHaveBeenCalledExactlyOnceWith();
    expect(register).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledTimes(1);
    expect(listeners.mock.calls.some(([name]) => name === 'updatefound')).toBe(true);
    document.dispatchEvent(new Event('ws:control-ready'));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(register).not.toHaveBeenCalled(); expect(getRegistration).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled(); // an installing worker is asked only once it activates
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    expect(container.controller).toBeNull(); expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'PRECACHE' });
    expect(wsSw.waiting).toBeNull(); expect(vi.getTimerCount()).toBe(pageTimers);
  } finally {
    (await import('../../../shared/engine/app/resources')).pageScope.dispose();
    Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

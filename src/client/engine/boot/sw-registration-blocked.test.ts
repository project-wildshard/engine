// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';

test('a host-blocked worker registration settles without installing watchers', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__BUILD_ID__', 'blocked-worker');
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const register = vi.fn(() => Promise.resolve(undefined));
  const container = Object.assign(new EventTarget(), { controller: null, register, getRegistration: () => Promise.resolve(undefined) });
  const listeners = vi.spyOn(container, 'addEventListener');
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  try {
    // PageLife owns a heartbeat independently of worker registration.
    await import('./lastEnd');
    const { pageScope } = await import('../../../shared/engine/app/resources');
    const before = pageScope.census, pageTimers = vi.getTimerCount();
    expect(pageTimers).toBeGreaterThan(0);
    const { wsSw } = await import('./sw');
    let settled = false;
    void wsSw.ready.then(() => { settled = true; return undefined; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true); expect(register).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('ws:control-ready')); // Control does not retry a refused first registration.
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledExactlyOnceWith(import.meta.env.DEV ? '/sw.js?sw=1' : '/sw.js', { scope: '/', updateViaCache: 'all' });
    expect(settled).toBe(true);
    expect(wsSw.waiting).toBeNull();
    expect(listeners).not.toHaveBeenCalled();
    expect(pageScope.census.listeners).toBe(before.listeners);
    expect(pageScope.census.timers).toBe(before.timers);
    expect(pageScope.census.rafs).toBe(before.rafs);
    expect(vi.getTimerCount()).toBe(pageTimers);
  } finally {
    (await import('../../../shared/engine/app/resources')).pageScope.dispose();
    const remainingTimers = vi.getTimerCount();
    Reflect.deleteProperty(window, '__ws_sw');
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(remainingTimers).toBe(0);
  }
});

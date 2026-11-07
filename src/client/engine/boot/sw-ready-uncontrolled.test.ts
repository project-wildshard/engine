// @vitest-environment happy-dom
import {expect, test, vi} from 'vitest';

test('first registration starts before control without gating readiness or claiming', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__BUILD_ID__', 'controller-ready');
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), {active: null, installing: worker, waiting: null, update: vi.fn(() => Promise.resolve())});
  let complete = (_value: typeof registration): void => { throw new Error('Registration has not started'); };
  const register = vi.fn(() => new Promise<typeof registration>(resolve => { complete = resolve; }));
  const container = Object.assign(new EventTarget(), {controller: null, register, getRegistration: () => Promise.resolve(undefined)});
  Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: container});
  try {
    await import('./lastEnd');
    const pageTimers = vi.getTimerCount();
    const {wsSw} = await import('./sw');
    let ready = false;
    void wsSw.ready.then(() => {ready = true; return undefined;});
    await vi.advanceTimersByTimeAsync(0);
    // Even an unresolved registration RPC must not hold the title or world entry.
    expect(ready).toBe(true); expect(register).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000); expect(register).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('ws:control-ready')); document.dispatchEvent(new Event('ws:control-ready'));
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledTimes(1);
    complete(registration); await vi.advanceTimersByTimeAsync(0);
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    // DL1: control (already reached) asks the newly activated first install, once, to precache its build's code, a
    // frame after control's own frame, so no precache fetch is open at control.
    expect(worker.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(container.controller).toBeNull(); expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'PRECACHE' });
    worker.dispatchEvent(new Event('statechange')); expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(pageTimers);
  } finally {
    (await import('../../../shared/engine/app/resources')).pageScope.dispose();
    Reflect.deleteProperty(window, '__ws_sw');
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

// @vitest-environment happy-dom
import {afterEach, beforeEach, expect, test, vi} from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('__BUILD_ID__', 'controller-ready');
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
});

afterEach(async () => {
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  Reflect.deleteProperty(window, '__ws_sw');
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('an existing controller watches getRegistration without entering a blocked register queue', async () => {
  const controller = Object.assign(new EventTarget(), {state: 'activated', postMessage: vi.fn()});
  const registration = Object.assign(new EventTarget(), {waiting: null, installing: null, update: vi.fn(() => Promise.resolve())});
  const register = vi.fn(() => new Promise<typeof registration>(() => { /* The job queue never settles. */ }));
  const getRegistration = vi.fn(() => Promise.resolve(registration));
  const listeners = vi.spyOn(registration, 'addEventListener');
  const container = Object.assign(new EventTarget(), {controller, register, getRegistration});
  Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: container});
  await import('./lastEnd');
  const pageTimers = vi.getTimerCount();
  const {wsSw} = await import('./sw');
  let ready = false;
  void wsSw.ready.then(() => {ready = true; return undefined;});
  await vi.advanceTimersByTimeAsync(0);
  expect(getRegistration).toHaveBeenCalledExactlyOnceWith();
  expect(register).not.toHaveBeenCalled();
  expect(ready).toBe(true);
  expect(vi.getTimerCount()).toBe(pageTimers);
  expect(listeners.mock.calls.some(([name]) => name === 'updatefound')).toBe(true);
  expect(registration.update).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).toHaveBeenCalledTimes(2);
  expect(wsSw.waiting).toBeNull();
});

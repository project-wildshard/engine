// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

/** a worker that records what it was sent */
class Worker extends EventTarget {
  state: ServiceWorkerState = 'activated';
  readonly messages: unknown[] = [];
  postMessage(message: unknown): void { this.messages.push(message); }
}
afterEach(async () => {
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  delete document.documentElement.dataset['wsTitleSettled']; Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test('OF5a: a settled title asks the active and the waiting worker for an update precache once, even when its registration lands late', async () => {
  vi.stubGlobal('__BUILD_ID__', 'fixture');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture' })));
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const active = new Worker(), waiting = new Worker();
  waiting.state = 'installed';
  const registration = Object.assign(new EventTarget(), { installing: null, waiting, active, update: () => Promise.resolve() });
  let land = (_value: typeof registration): void => undefined;
  const pending = new Promise<typeof registration>(resolve => { land = resolve; });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => pending, register: () => pending });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  await import('./sw');
  const update = { type: 'PRECACHE', update: true };
  const asked = (worker: Worker): number => worker.messages.filter(message => JSON.stringify(message) === JSON.stringify(update)).length;
  // a slow registration (WebKit): the title settles first, and its ask waits for the registration
  document.documentElement.dataset['wsTitleSettled'] = '1'; document.dispatchEvent(new Event('ws:title-settled'));
  expect(asked(active)).toBe(0);
  land(registration);
  await vi.waitFor(() => { expect(waiting.messages).toContainEqual({ type: 'PAUSE' }); }); // registered: this page is loading
  await vi.waitFor(() => { expect(asked(active)).toBe(1); });
  expect(asked(waiting)).toBe(1);
  document.dispatchEvent(new Event('ws:title-settled'));
  expect([asked(active), asked(waiting)], 'once a page').toEqual([1, 1]);
});

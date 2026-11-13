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
  Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test('OF5a: a settled title asks the active and the waiting worker for an update precache, once', async () => {
  vi.stubGlobal('__BUILD_ID__', 'fixture');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture' })));
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const active = new Worker(), waiting = new Worker();
  waiting.state = 'installed';
  const registration = Object.assign(new EventTarget(), { installing: null, waiting, active, update: () => Promise.resolve() });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => Promise.resolve(registration), register: () => Promise.resolve(registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  await import('./sw');
  await vi.waitFor(() => { expect(waiting.messages).toContainEqual({ type: 'PAUSE' }); }); // registered: this page is loading
  const update = { type: 'PRECACHE', update: true };
  expect(active.messages).not.toContainEqual(update);
  document.dispatchEvent(new Event('ws:title-settled'));
  document.dispatchEvent(new Event('ws:title-settled'));
  expect(active.messages.filter(message => JSON.stringify(message) === JSON.stringify(update))).toHaveLength(1);
  expect(waiting.messages.filter(message => JSON.stringify(message) === JSON.stringify(update))).toHaveLength(1);
});

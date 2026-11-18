// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

/** STAGING-BUGBASH SB37b: an update worker activates behind an old title by itself (sw.js STALESHELL skipWaiting) and claims
 *  no document (039d), so the title kept painting the old build until the player's next navigation (K2 `old-cache-first-page`).
 *  The page now hears it: `ws-sw-activated` names the newer build, and `__ws_sw.activated` keeps it for a title built later. */

function replyPort(value: unknown): value is { postMessage: (message: unknown) => void } {
  return typeof value === 'object' && value !== null && 'postMessage' in value && typeof value.postMessage === 'function';
}
/** a worker that answers BUILD with its own build */
class Worker extends EventTarget {
  readonly build: string;
  state: ServiceWorkerState;
  constructor(build: string, state: ServiceWorkerState) { super(); this.build = build; this.state = state; }
  postMessage(_message: unknown, transfer?: Transferable[]): void {
    const port: unknown = transfer?.[0];
    if (replyPort(port)) port.postMessage({ build: this.build, ok: true });
  }
  move(state: ServiceWorkerState): void { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

afterEach(async () => {
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function oldPage(live: string): Promise<{ registration: EventTarget & { installing: Worker | null }; heard: string[] }> {
  vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: live })));
  vi.stubGlobal('location', new URL('https://example.com/?sw=1'));
  const active = new Worker('fixture-before-stamp', 'activated');
  const registration = Object.assign(new EventTarget(), { installing: null as Worker | null, waiting: null, active, update: () => Promise.resolve() });
  const container = Object.assign(new EventTarget(), { controller: active, getRegistration: () => Promise.resolve(registration), register: () => Promise.resolve(registration) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  const heard: string[] = [];
  window.addEventListener('ws-sw-activated', event => { if (event instanceof CustomEvent) heard.push((event.detail as { build: string }).build); });
  const { wsSw } = await import('./sw');
  await wsSw.ready;
  await vi.waitFor(() => { expect(window.__ws_sw).toBe(wsSw); });
  return { registration, heard };
}

test('SB37b: only the live build\'s worker activating behind an old page is announced, once, and kept for a later title', async () => {
  const { registration, heard } = await oldPage('fixture-after');
  await new Promise(resolve => { setTimeout(resolve, 0); });
  /** @param build the worker's BUILD reply */
  const activate = (build: string): Worker => {
    const worker = new Worker(build, 'installing');
    registration.installing = worker; registration.dispatchEvent(new Event('updatefound'));
    worker.move('installed'); worker.move('activating'); worker.move('activated');
    return worker;
  };
  // this page's own build again, and a build the server no longer names: neither is a newer build
  activate('fixture-before-stamp2'); activate('fixture-older-stamp');
  await new Promise(resolve => { setTimeout(resolve, 20); });
  expect(heard).toEqual([]); expect(window.__ws_sw?.activated).toBeNull();
  const update = activate('fixture-after-stamp');
  await vi.waitFor(() => { expect(heard).toEqual(['fixture-after']); });
  expect(window.__ws_sw?.activated).toBe('fixture-after');
  update.move('activated');
  await new Promise(resolve => { setTimeout(resolve, 10); });
  expect(heard).toEqual(['fixture-after']);
});

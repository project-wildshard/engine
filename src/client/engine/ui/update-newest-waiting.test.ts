// @vitest-environment happy-dom
import {afterEach, expect, test, vi} from 'vitest';

interface ReplyPort { postMessage: (value: unknown) => void; close: () => void }
function replyPort(value: unknown): value is ReplyPort {
  return typeof value === 'object' && value !== null && 'postMessage' in value && typeof value.postMessage === 'function'
    && 'close' in value && typeof value.close === 'function';
}
class Worker extends EventTarget {
  readonly build: string;
  state: ServiceWorkerState = 'installed';
  readonly messages: unknown[] = [];
  hold = false;
  readonly replies: ReplyPort[] = [];
  constructor(build: string) { super(); this.build = build; }
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message); const port: unknown = transfer?.[0];
    if (replyPort(port)) { if (this.hold) this.replies.push(port); else port.postMessage({build: this.build, ok: true}); }
  }
  async reply(): Promise<void> {
    for (const port of this.replies.splice(0)) {
      const closed = vi.spyOn(port, 'close'); port.postMessage({build: this.build, ok: true});
      await vi.waitFor(() => { expect(closed).toHaveBeenCalled(); });
    }
  }
}
afterEach(async () => {
  const pill = document.querySelector('.ws-update');
  if (pill !== null) (await import('./hudSlots')).hudSlots.ownerOf(pill)?.dispose();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('a third discovery darkens B until C is installed and stale version replies cannot relight B', async () => {
  vi.stubGlobal('__BUILD_ID__', 'fixture-before');
  let latest = 'fixture-second';
  const fetch = vi.fn(() => Promise.resolve(Response.json({build: latest})));
  vi.stubGlobal('fetch', fetch);
  const replace = vi.fn<(url: string) => void>(), reload = vi.fn();
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?sw=1'), {replace, reload}));
  const active = new Worker('fixture-before-stamp'); active.state = 'activated';
  const second = new Worker('fixture-second-stamp'), third = new Worker('fixture-third-stamp'); third.state = 'installing';
  const registration = Object.assign(new EventTarget(), {installing: third, waiting: second, update: vi.fn(() => Promise.resolve())});
  const container = Object.assign(new EventTarget(), {controller: active, getRegistration: () => Promise.resolve(registration), register: vi.fn()});
  Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: container});
  document.body.innerHTML = '<div id="hud" class="intro"><div class="ws-menu"></div></div>';
  await import('./Update'); const {wsSw} = await import('../boot/sw');
  const pill = document.querySelector('.ws-update');
  if (!(pill instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  await vi.waitFor(() => { expect(wsSw.waiting).toBe(second); expect(pill.classList.contains('newer')).toBe(true); });
  second.hold = true;
  let finishOld = (_value: Response): void => { throw new Error('Missing old request'); };
  fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
  document.dispatchEvent(new Event('visibilitychange'));
  latest = 'fixture-third'; document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => { expect(wsSw.waiting).toBeNull(); expect(pill.classList.contains('newer')).toBe(false); });
  const stale = Response.json({build: 'fixture-second'}), read = vi.spyOn(stale, 'json'); finishOld(stale);
  await vi.waitFor(() => { expect(read).toHaveBeenCalled(); });
  const consumed: unknown = read.mock.results[0]?.value; await consumed; await Promise.resolve();
  expect(pill.classList.contains('newer')).toBe(false);
  registration.waiting = third; third.state = 'installed'; third.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => { expect(wsSw.waiting).toBe(third); expect(pill.classList.contains('newer')).toBe(true); });
  expect(second.replies.length).toBeGreaterThan(0); await second.reply();
  expect(wsSw.waiting).toBe(third); expect(pill.classList.contains('newer')).toBe(true);
  pill.dispatchEvent(new Event('pointerup')); pill.click();
  await vi.waitFor(() => { expect(third.messages).toContainEqual({type: 'SKIP_WAITING'}); });
  expect(second.messages).not.toContainEqual({type: 'SKIP_WAITING'});
  third.state = 'activated'; third.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => { expect(replace).toHaveBeenCalledExactlyOnceWith('/'); });
  expect(wsSw.waiting).toBeNull();
  expect(container.register).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});

// @vitest-environment happy-dom
// QA 11-19 row 17 (Jake: "There's no like error model of worst case here"): a load past its step's deadline shows what it is
// stuck on, a connection check, RETRY and EXIT TO TITLE on the card, and goes when loading moves.
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { checkConnection, connectionLine, showSlowLoad, type ConnectionPorts } from './slowLoad';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function ports(answer: Promise<{ ok: boolean; status: number }> | 'never', online = true, clock?: { at: number }): ConnectionPorts & { fire: () => void } {
  let fire = (): void => undefined;
  return {
    online: () => online, now: () => clock?.at ?? 0,
    read: () => answer === 'never' ? new Promise(() => { /* never answers */ }) : answer,
    wait: () => new Promise<void>((resolve) => { fire = resolve; }),
    fire: () => { fire(); },
  };
}

test('the connection check names offline, a fast or slow answer, an error status and no answer', async () => {
  expect(await checkConnection(ports('never', false))).toEqual({ state: 'offline' });
  expect(await checkConnection(ports(Promise.resolve({ ok: true, status: 200 })))).toEqual({ state: 'ok', ms: 0 });
  const clock = { at: 0 };
  const slow = { ...ports('never', true, clock), read: () => { clock.at = 2400; return Promise.resolve({ ok: true, status: 200 }); } };
  expect(await checkConnection(slow)).toEqual({ state: 'slow', ms: 2400 });
  expect(await checkConnection(ports(Promise.resolve({ ok: false, status: 503 })))).toEqual({ state: 'down', why: 'the page answered 503' });
  const hung = ports('never'), checked = checkConnection(hung);
  hung.fire();
  expect(await checked).toEqual({ state: 'down', why: 'no answer in 5 s' });
  expect(connectionLine(null)).toBe('Connection: checking…');
  expect(connectionLine({ state: 'offline' })).toBe('Connection: this device is offline');
});

test('the slow strip sits on the card with the step, the check, RETRY and EXIT, and its removal takes it away', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200 })));
  const card = document.createElement('div'); card.className = 'ws-load'; document.body.append(card);
  const owner = new Scope('test');
  const remove = showSlowLoad(owner, 'admission.modules', 20_000, card);
  const strip = card.querySelector<HTMLElement>('.ws-load-slow');
  expect(strip?.textContent).toContain('stuck at "admission.modules"');
  expect(strip?.textContent).toContain('20 s');
  expect([...card.querySelectorAll<HTMLButtonElement>('.ws-load-slow button')].map((b) => b.dataset['slow'])).toEqual(['retry', 'exit']);
  await vi.waitFor(() => { expect(strip?.dataset['connection']).toBe('ok'); });
  expect(strip?.querySelector('[data-el="connection"]')?.textContent).toMatch(/^Connection: OK \(\d+ ms\)$/u);
  remove();
  expect(card.querySelector('.ws-load-slow')).toBeNull();
  owner.dispose();
});

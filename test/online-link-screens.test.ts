// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { NetClient } from '../src/client/engine/net/client';
import type { LinkCause, LinkProgress } from '../src/client/engine/net/redial';
import type { NetChannel, Transport, TransportStats } from '../src/shared/engine/net/transport';
import { linkScreens } from '../src/client/host/online/linkScreens';

// FM4 (meta MMO-FAILURE-MODES-PLAN): the link's banner, its hold card, the Reconnected notice and the cards, as a page shows them.
function harness(): { scope: Scope; screens: ReturnType<typeof linkScreens>; calls: string[]; set: (next: Partial<LinkProgress> & { why?: LinkCause }) => void } {
  const scope = new Scope('test.link'), calls: string[] = [];
  let progress: LinkProgress = { dials: 1, nextDialMs: 1800, downMs: 4000 }, why: LinkCause = 'closed';
  const screens = linkScreens(scope, { retry: () => { calls.push('retry'); }, dialNow: () => { calls.push('dialNow'); }, reload: () => { calls.push('reload'); },
    doctor: from => { calls.push(`doctor:${from}`); }, progress: () => progress, why: () => why });
  return { scope, screens, calls, set: next => { progress = { ...progress, ...next }; if (next.why !== undefined) why = next.why; } };
}
const shown = (ids: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-failmode~="${ids}"]:not([hidden])`);
const click = (root: HTMLElement | null, label: string): void => { [...root?.querySelectorAll('button') ?? []].find(button => button.textContent === label)?.click(); };
afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); });

test('a dropped link shows the banner; a tap that needs the world opens its hold card instead of going out', () => {
  const { scope, screens, calls } = harness();
  expect(screens.allow('Talk')).toBe(true);
  screens.link('reconnecting', 'closed');
  const banner = shown('drop');
  expect(banner?.dataset['failmode']).toBe('drop reset');
  expect(banner?.textContent).toContain('Reconnecting');
  expect(screens.allow('Talk')).toBe(false);
  const card = shown('drop-blocked');
  expect(card?.textContent).toContain('You tapped Talk');
  expect(card?.textContent).toContain('Try 2');
  expect(card?.textContent).toContain('Next dial in 2 s');
  expect(card?.textContent).toContain('held for 26 s more');
  click(card, 'Try now');
  expect(calls).toEqual(['dialNow']);
  click(card, 'Keep waiting');
  expect(shown('drop-blocked')).toBeNull();
  // for a while after Keep waiting, a tap pulses the banner rather than opening the card again
  expect(screens.allow('Talk')).toBe(false);
  expect(shown('drop-blocked')).toBeNull();
  expect(banner?.classList.contains('pulse')).toBe(true);
  screens.link('live');
  expect(shown('drop')).toBeNull();
  expect(shown('reconnected')?.textContent).toContain('Reconnected');
  scope.dispose();
});

test('a chat line typed while down is held, and sent in order when the link is back', () => {
  const { scope, screens } = harness(), sent: string[] = [];
  screens.link('reconnecting', 'closed');
  expect(screens.holdChat('hello', line => { sent.push(line); }, () => undefined)).toBe(true);
  expect(screens.holdChat('anyone?', line => { sent.push(line); }, () => undefined)).toBe(true);
  expect(shown('reset-blocked')?.textContent).toContain('Your message will send when you\'re back');
  expect(sent).toEqual([]);
  screens.link('live');
  expect(sent).toEqual(['hello', 'anyone?']);
  expect(shown('reset-blocked')).toBeNull();
  expect(screens.holdChat('now', () => undefined, () => undefined)).toBe(false);
  scope.dispose();
});

test('Don\'t send it drops the held lines', () => {
  const { scope, screens } = harness(), dropped: string[] = [], sent: string[] = [];
  screens.link('reconnecting', 'closed');
  screens.holdChat('oops', line => { sent.push(line); }, () => { dropped.push('oops'); });
  click(shown('reset-blocked'), 'Don\'t send it');
  screens.link('live');
  expect(dropped).toEqual(['oops']);
  expect(sent).toEqual([]);
  scope.dispose();
});

test('the banner names the cause: a restart, a silent link, a return to the tab, and 35 s down', () => {
  const { scope, screens, set } = harness();
  set({ why: 'restart' }); screens.link('reconnecting', 'restart');
  expect(shown('restart')?.textContent).toContain('Restarting');
  screens.allow('Play');
  expect(shown('restart-blocked')?.textContent).toContain('The world is restarting');
  screens.link('live');
  set({ why: 'silent' }); screens.link('reconnecting', 'silent');
  expect(shown('half-open')).not.toBeNull();
  screens.link('live');
  set({ why: 'hidden' }); screens.link('reconnecting', 'hidden');
  expect(shown('background-short')?.textContent).toContain('welcome back');
  set({ downMs: 41_000 }); screens.link('resuming', 'hidden');
  expect(shown('resuming')?.textContent).toContain('Still reconnecting');
  screens.allow('Talk');
  expect(shown('resuming-blocked')?.textContent).toContain('You\'ll rejoin at your last save');
  scope.dispose();
});

test('the cards: gave up, world full, another tab, turned away; a stale build is left to its reload', () => {
  const { scope, screens, calls } = harness();
  screens.link('lost');
  expect(shown('lost')?.textContent).toContain('Couldn\'t reconnect');
  expect(screens.allow('Talk')).toBe(false);
  expect(shown('lost-blocked')).toBeNull();
  click(shown('lost'), 'Try again');
  click(shown('lost'), 'Check connection');
  screens.link('full');
  expect(shown('lost')).toBeNull();
  expect(shown('full')?.textContent).toContain('Next try in 2 s');
  screens.link('ended', 'replaced');
  click(shown('replaced'), 'Play here');
  screens.link('ended', 'refused');
  expect(shown('refused')?.textContent).toContain('turned this connection away');
  expect(document.body.textContent).not.toContain('(refused)');
  screens.link('ended', 'reload');
  expect(shown('refused')).not.toBeNull();
  expect(calls).toEqual(['retry', 'doctor:lost', 'reload']);
  scope.dispose();
});

test('the deploy countdown gives way to a dropped link and comes back with it', () => {
  const { scope, screens } = harness();
  screens.countdown({ seconds: 42 } as Parameters<typeof screens.countdown>[0]);
  expect(shown('deploy')?.textContent).toContain('in 42 s');
  screens.link('reconnecting', 'closed');
  expect(shown('deploy')).toBeNull();
  screens.link('live');
  expect(shown('deploy')).not.toBeNull();
  scope.dispose();
});

class CountingLink implements Transport {
  readonly stats: TransportStats = { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 };
  sent = 0;
  send(_channel: NetChannel, _bytes: ArrayBuffer): void { this.sent++; }
  onMessage(): () => void { return () => undefined; }
  onClose(): () => void { return () => undefined; }
  close(): void { /* nothing to close */ }
}
test('a gated client drops a tap the gate refuses, and never sends it late; chat and reports are not gated', () => {
  const link = new CountingLink(), client = new NetClient(link);
  let open = false;
  const asked: string[] = [];
  client.gateActions(what => { asked.push(what); return open; });
  client.act({ kind: 'interact', seq: 0, id: 'npc' });
  client.act({ kind: 'buy', seq: 0, good: 1 });
  client.say('room', 'hi');
  expect(link.sent).toBe(1);
  expect(asked).toEqual(['Interact', 'Buy']);
  open = true;
  client.act({ kind: 'interact', seq: 0, id: 'npc' });
  expect(link.sent).toBe(2);
  client.dispose();
});

test('Try again on the lost card gives way to the banner; a cause that changes mid-outage repaints it; a new outage takes the notice away', () => {
  const { scope, screens, set } = harness();
  screens.link('lost');
  click(shown('lost'), 'Try again');
  screens.link('reconnecting', 'closed');
  expect(shown('lost')).toBeNull();
  expect(shown('drop')).not.toBeNull();
  set({ why: 'restart' }); screens.link('reconnecting', 'restart');
  expect(shown('restart')?.textContent).toContain('Restarting');
  screens.link('live');
  expect(document.querySelectorAll('[data-failmode="reconnected"]')).toHaveLength(1);
  set({ why: 'closed' }); screens.link('reconnecting', 'closed');
  expect(document.querySelectorAll('[data-failmode="reconnected"]')).toHaveLength(0);
  screens.link('live');
  expect(document.querySelectorAll('[data-failmode="reconnected"]')).toHaveLength(1);
  scope.dispose();
  expect(document.querySelectorAll('.ws-link')).toHaveLength(0);
});

test('a chat line after the world ended is not held', () => {
  const { scope, screens } = harness();
  screens.link('ended', 'refused');
  expect(screens.holdChat('anyone?', () => undefined, () => undefined)).toBe(false);
  scope.dispose();
});

test('an open hold card follows its banner when the cause changes', () => {
  const { scope, screens, set } = harness();
  set({ why: 'silent' }); screens.link('reconnecting', 'silent');
  screens.allow('Talk');
  expect(shown('half-open-blocked')).not.toBeNull();
  set({ why: 'restart' }); screens.link('reconnecting', 'restart');
  expect(shown('half-open-blocked')).toBeNull();
  expect(shown('restart-blocked')?.textContent).toContain('You tapped Talk');
  scope.dispose();
});

test('a held chat card follows a new cause too', () => {
  const { scope, screens, set } = harness();
  screens.link('reconnecting', 'closed');
  screens.holdChat('hi', () => undefined, () => undefined);
  expect(shown('reset-blocked')?.textContent).toContain('Reconnecting');
  set({ why: 'restart' }); screens.link('reconnecting', 'restart');
  expect(shown('reset-blocked')?.textContent).toContain('Restarting');
  scope.dispose();
});

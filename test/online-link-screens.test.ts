// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
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
  expect(card?.textContent).toContain('Down for 4 s');
  expect(card?.textContent).not.toContain('held for');
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

test('a chat line typed while down is held as one draft, and sent once when the link is back', () => {
  const { scope, screens } = harness(), sent: string[] = [];
  screens.link('reconnecting', 'closed');
  const dropped: string[] = [];
  expect(screens.holdChat('hello', line => { sent.push(line); }, () => { dropped.push('hello'); })).toBe(true);
  // one held draft at a time: a second line replaces the first
  expect(screens.holdChat('anyone?', line => { sent.push(line); }, () => undefined)).toBe(true);
  expect(dropped).toEqual(['hello']);
  expect(shown('reset-blocked')?.textContent).toContain('Your message will send when you\'re back');
  expect(sent).toEqual([]);
  screens.link('live');
  expect(sent).toEqual(['anyone?']);
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
  expect(shown('resuming-blocked')?.textContent).toContain('we\'ll keep trying for 79 s more');
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

test('a held draft goes out once, to its own send, and an ended world drops it', () => {
  const { scope, screens } = harness(), first: string[] = [], second: string[] = [], dropped: string[] = [];
  screens.link('reconnecting', 'closed');
  screens.holdChat('one', line => { first.push(line); }, () => { dropped.push('one'); });
  screens.holdChat('two', line => { second.push(line); }, () => { dropped.push('two'); });
  screens.link('live'); screens.link('live');
  expect(first).toEqual([]); expect(second).toEqual(['two']); expect(dropped).toEqual(['one']);
  screens.link('reconnecting', 'closed');
  screens.holdChat('three', line => { first.push(line); }, () => { dropped.push('three'); });
  screens.link('ended', 'refused'); screens.link('live');
  expect(first).toEqual([]); expect(dropped).toEqual(['one', 'three']);
  scope.dispose();
});

test('the hold card\'s bar is the page\'s give-up clock: full at the start, empty past 2 minutes', () => {
  const { scope, screens, set } = harness();
  set({ downMs: 0 }); screens.link('reconnecting', 'closed'); screens.allow('Talk');
  const bar = (): string => shown('drop-blocked')?.querySelector<HTMLElement>('.ws-link-hold i')?.style.width ?? '';
  expect(bar()).toBe('100%');
  screens.allow('Talk');
  set({ downMs: 130_000 }); screens.link('resuming', 'closed'); screens.allow('Talk');
  expect(shown('resuming-blocked')?.querySelector<HTMLElement>('.ws-link-hold i')?.style.width).toBe('0%');
  scope.dispose();
});

test('a card keeps Tab inside its buttons, and hands focus back when the link returns', () => {
  const { scope, screens } = harness(), field = document.createElement('input');
  document.body.append(field); field.focus();
  screens.link('reconnecting', 'closed'); screens.allow('Talk');
  const card = shown('drop-blocked'), buttons = [...card?.querySelectorAll('button') ?? []];
  expect(document.activeElement).toBe(buttons[0]);
  buttons.at(-1)?.focus();
  const tab = new KeyboardEvent('keydown', { code: 'Tab', bubbles: true, cancelable: true });
  buttons.at(-1)?.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(buttons[0]);
  screens.link('live');
  expect(document.activeElement).toBe(field);
  scope.dispose();
});

test('the card\'s Tab ring includes Details and wraps both ways; focus falls back to nothing when its old home is gone', () => {
  const { scope, screens } = harness(), field = document.createElement('input');
  document.body.append(field); field.focus();
  screens.link('lost');
  const card = shown('lost'), ring = [...card?.querySelectorAll<HTMLElement>('button, summary') ?? []];
  expect(ring.at(-1)?.tagName).toBe('SUMMARY');
  const key = (target: HTMLElement | undefined, shiftKey: boolean): KeyboardEvent => { const event = new KeyboardEvent('keydown', { code: 'Tab', shiftKey, bubbles: true, cancelable: true }); target?.dispatchEvent(event); return event; };
  ring.at(-1)?.focus(); expect(key(ring.at(-1), false).defaultPrevented).toBe(true); expect(document.activeElement).toBe(ring[0]);
  expect(key(ring[0], true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(ring.at(-1));
  // a stop card replaced by the banner on Try again, then the link back: focus returns to the field it came from
  screens.link('reconnecting', 'closed'); screens.link('live');
  expect(document.activeElement).toBe(field);
  // the field is gone by the next card's end: nothing to return to, and nothing throws
  screens.link('lost'); field.remove(); screens.link('reconnecting', 'closed'); screens.link('live');
  expect(document.activeElement === field).toBe(false);
  scope.dispose();
});

test('FM4b mode 2: offline shows the offline-play card over play; taps wait; the network back gives way to the banner, the link to the notice', () => {
  const { scope, screens, calls, set } = harness();
  set({ why: 'offline', downMs: 12_000 });
  screens.link('reconnecting', 'offline');
  const card = shown('offline-play');
  expect(card?.getAttribute('role')).toBe('alertdialog');
  expect(card?.textContent).toContain('You\'re offline');
  expect(card?.textContent).toContain('Down for 12 s');
  expect(card?.textContent).not.toMatch(/held for|30 seconds|saved/);
  expect(shown('drop'), 'the card is the screen: no Reconnecting banner under it').toBeNull();
  // a tap the world must hear: refused, and the card stays (no hold card on top of it)
  expect(screens.allow('Talk')).toBe(false);
  expect(shown('drop-blocked')).toBeNull();
  // a chat line is still held for the link, under the same card
  const sent: string[] = [];
  expect(screens.holdChat('brb', line => { sent.push(line); }, () => undefined)).toBe(true);
  expect(shown('reset-blocked')).toBeNull();
  click(document.querySelector('.ws-link-scrim[data-failmode="offline-play"]'), 'Check connection');
  expect(calls).toEqual(['doctor:offline-play']);
  // the network is back: the cause changes while the link is still down, and the banner takes over
  set({ why: 'closed' });
  screens.link('reconnecting', 'closed');
  expect(document.querySelector('.ws-link-scrim[data-failmode="offline-play"]')).toBeNull();
  expect(shown('drop')?.textContent).toContain('Reconnecting');
  screens.link('live');
  expect(sent).toEqual(['brb']);
  expect(shown('reconnected')).not.toBeNull();
  scope.dispose();
});

test('FM4b mode 2: the link back while the card shows closes it at once', () => {
  const { scope, screens, set } = harness();
  set({ why: 'offline' });
  screens.link('reconnecting', 'offline');
  expect(shown('offline-play')).not.toBeNull();
  screens.link('live');
  expect(shown('offline-play')).toBeNull();
  scope.dispose();
});

test('FM4b modes 4 and 45: back from away to a quiet link shows Welcome back over play, says how long, and closes with the link', () => {
  const { scope, screens, calls, set } = harness();
  set({ why: 'hidden', dials: 0, nextDialMs: 200, downMs: 0, away: { ms: 240_000, how: 'hidden' } });
  screens.link('reconnecting', 'hidden');
  const card = document.querySelector<HTMLElement>('.ws-link-scrim[data-failmode="background-long"]');
  expect(card?.getAttribute('role')).toBe('alertdialog');
  expect(card?.textContent).toContain('Welcome back');
  expect(card?.textContent).toContain('away for 4 min');
  expect(card?.textContent).toContain('Checking your connection');
  expect(card?.textContent, 'J229: no seat-hold or last-save claim').not.toMatch(/save|let your character go|held for/i);
  expect(shown('background-short'), 'the card is the screen: no banner under it').toBeNull();
  expect(screens.allow('Talk')).toBe(false);
  expect(shown('background-short-blocked')).toBeNull();
  click(card, 'Try now');
  click(card, 'Check connection');
  expect(calls).toEqual(['dialNow', 'doctor:background-long']);
  screens.link('resuming', 'hidden');
  expect(document.querySelector('.ws-link-scrim[data-failmode="background-long"]')).toBe(card);
  screens.link('live');
  expect(shown('background-long')).toBeNull();
  expect(shown('reconnected')).not.toBeNull();
  // asleep: the same card, under mode 45's id, naming what was measured
  set({ away: { ms: 45_000, how: 'asleep' } });
  screens.link('reconnecting', 'hidden');
  const slept = shown('sleep-wake');
  expect(slept?.dataset['failmode']).toBe('background-long sleep-wake');
  expect(slept?.textContent).toContain('away for 45 s');
  expect(slept?.textContent).toContain('no page clock tick 45 s');
  scope.dispose();
});

test('FM4b modes 21 and 22: Slow and Unstable chips from measured RTT and server skips, sustained 5 s, cleared after 10 good, once a minute', () => {
  vi.useFakeTimers();
  try {
    const stats = { rttMs: 80, lossPct: 0, sentBytes: 0, recvBytes: 0 };
    const scope = new Scope('test.quality');
    linkScreens(scope, { retry: () => undefined, dialNow: () => undefined, reload: () => undefined, progress: () => ({ dials: 0, nextDialMs: null, downMs: 0 }), why: () => 'closed', stats: () => stats });
    const chip = (kind: string): HTMLElement | null => document.querySelector<HTMLElement>(`.ws-link-notice[data-failmode="${kind}"]`);
    const run = (seconds: number): void => { vi.advanceTimersByTime(seconds * 1000); };
    stats.rttMs = 480; run(4);
    expect(chip('slow'), 'four slow seconds are not yet a chip').toBeNull();
    run(1);
    expect(chip('slow')?.textContent).toBe('Slow connection480 ms');
    expect(chip('slow')?.textContent, 'only what was measured').not.toMatch(/%|packet/u);
    // the drop from 480 to 90 ms is itself a spread for the next four samples, then 10 good seconds clear it
    stats.rttMs = 90; run(13);
    expect(chip('slow'), 'it stays until 10 good seconds').not.toBeNull();
    run(1);
    expect(chip('slow')).toBeNull();
    // slow again within the minute: no chip until a minute after the last one showed
    stats.rttMs = 480; run(10);
    expect(chip('slow')).toBeNull();
    run(40);
    expect(chip('slow')).not.toBeNull();
    stats.rttMs = 90; run(14);
    expect(chip('slow')).toBeNull();
    // unstable: the server says it skipped 6% of this client's frames, for 5 s; with the minute gone it shows
    run(60);
    stats.lossPct = 6; run(5);
    expect(chip('lossy')?.textContent).toBe('Unstable connectionothers may jump');
    scope.dispose();
  } finally { vi.useRealTimers(); }
});

test('FM4b modes 21 and 22: a quality chip waits while the link is down, and an RTT spread of 250 ms over five samples is unstable', () => {
  vi.useFakeTimers();
  try {
    const stats = { rttMs: 80, lossPct: 0, sentBytes: 0, recvBytes: 0 };
    const scope = new Scope('test.quality2');
    const screens = linkScreens(scope, { retry: () => undefined, dialNow: () => undefined, reload: () => undefined, progress: () => ({ dials: 0, nextDialMs: null, downMs: 0 }), why: () => 'closed', stats: () => stats });
    const chip = (kind: string): HTMLElement | null => document.querySelector<HTMLElement>(`.ws-link-notice[data-failmode="${kind}"]`);
    // never slow 5 s in a row, but each five samples span 260 ms
    const rtts = [20, 280, 20, 280, 20, 280, 20, 280, 20, 280];
    for (const rtt of rtts) { stats.rttMs = rtt; vi.advanceTimersByTime(1000); }
    expect(chip('lossy')).not.toBeNull();
    expect(chip('slow'), 'no five slow seconds in a row').toBeNull();
    screens.link('reconnecting', 'closed');
    expect(chip('lossy'), 'the banner takes the band').toBeNull();
    for (let second = 0; second < 6; second++) { stats.rttMs = rtts[second % 2] ?? 0; vi.advanceTimersByTime(1000); }
    expect(chip('lossy'), 'nothing while down').toBeNull();
    scope.dispose();
  } finally { vi.useRealTimers(); }
});

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { Redial, type LinkCause, type LinkState } from '../src/client/engine/net/redial';
import type { DecodedFrame } from '../src/shared/engine/net/frame';
import type { NetChannel, Transport, TransportStats } from '../src/shared/engine/net/transport';

// E7.1b: when a link is watched, dropped and dialled, on a clock this test holds.
class FakeLink implements Transport {
  readonly stats: TransportStats = { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 };
  closedAs: string | null = null;
  private readonly closes = new Set<(reason: string) => void>();
  send(_channel: NetChannel, _bytes: ArrayBuffer): void { /* nothing listens */ }
  onMessage(): () => void { return () => undefined; }
  onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void { this.closedAs ??= reason; this.fail(reason); }
  /** The far end, or the network, ended it. */
  fail(reason: string): void { for (const listener of [...this.closes]) listener(reason); this.closes.clear(); }
}
const frame = { tick: 1 } as DecodedFrame;
function harness(random = 0.5, online: () => boolean = () => true): { client: NetClient; redial: Redial; links: FakeLink[]; states: LinkState[]; causes: LinkCause[]; dialTimes: number[]; now: () => number; heard: () => void; run: (ms: number) => void; failDials: (reason: string) => void } {
  let clock = 0, failing: string | null = null;
  const first = new FakeLink(), links = [first], states: LinkState[] = [], causes: LinkCause[] = [], dialTimes: number[] = [];
  const client = new NetClient(first, () => clock), frames: ((value: DecodedFrame) => void)[] = [], onFrame = client.onFrame.bind(client);
  vi.spyOn(client, 'onFrame').mockImplementation(fn => { frames.push(fn); return onFrame(fn); });
  const redial = new Redial({ client, transport: first, now: () => clock, random: () => random, online, onState: state => { states.push(state); }, onCause: cause => { causes.push(cause); },
    dial: () => { const link = new FakeLink(); links.push(link); dialTimes.push(clock); return link; } });
  return { client, redial, links, states, causes, dialTimes, now: () => clock, heard: () => { for (const fn of frames) fn(frame); }, failDials: reason => { failing = reason; },
    run: ms => { for (let left = ms; left > 0; left -= 50) { clock += 50; vi.advanceTimersByTime(50); if (failing !== null) links.at(-1)?.fail(failing); } } };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('no frame for 1 s shows the strip; 3 s closes and dials; a frame clears it', () => {
  const { heard, run, states, links, redial } = harness();
  run(5000);
  expect(states, 'no frame has ever come: a page still loading is left alone').toEqual([]);
  heard(); run(900);
  expect(states).toEqual([]);
  run(200);
  expect(states).toEqual(['reconnecting']);
  expect(links).toHaveLength(1);
  run(2000);
  expect(links[0]?.closedAs).toBe('stalled');
  run(400);
  expect(links).toHaveLength(2);
  expect(redial.attempts).toBe(1);
  heard(); run(100);
  expect(states).toEqual(['reconnecting', 'live']);
  redial.dispose();
});

test.each([[0, 0.8], [0.5, 1], [1, 1.2]])('dials back off at 0.25, 0.5, 1, 2 and 4 s, then every 4 s, within ±20%, says Resuming past 35 s, and asks at 2 minutes (random %d)', (random, jitter) => {
  const { heard, run, states, dialTimes, failDials, redial, links } = harness(random);
  heard(); failDials('lost'); links[0]?.fail('lost');
  run(119_000);
  const waits = dialTimes.map((at, index) => at - (dialTimes[index - 1] ?? 0));
  [250, 500, 1000, 2000, 4000, 4000, 4000].forEach((wait, index) => { const said = waits[index] ?? 0; expect(said).toBeGreaterThanOrEqual(wait * jitter - 1); expect(said).toBeLessThanOrEqual(wait * jitter + 150); });
  expect(states).toEqual(['reconnecting', 'resuming']);
  run(2000);
  expect(states).toEqual(['reconnecting', 'resuming', 'lost']);
  const dials = dialTimes.length;
  run(10_000);
  expect(dialTimes, 'it has asked, so it waits').toHaveLength(dials);
  redial.retry(); run(4000);
  expect(states.at(-1)).toBe('reconnecting');
  expect(dialTimes.length).toBeGreaterThan(dials);
  redial.dispose();
});

test('a server that says stop is obeyed: no redial', () => {
  for (const reason of ['reload', 'refused', 'replaced']) {
    const { heard, run, states, links, redial } = harness();
    heard(); links[0]?.fail(reason); run(10_000);
    expect(links).toHaveLength(1);
    expect(states).toEqual(['ended']);
    redial.dispose();
  }
});

test('a full world says so and asks again every 30 s, for as long as it takes', () => {
  const { heard, run, states, links, redial } = harness();
  heard(); links[0]?.fail('full');
  expect(states).toEqual(['full']);
  run(29_000);
  expect(links, 'not yet').toHaveLength(1);
  run(1100);
  expect(links).toHaveLength(2);
  links[1]?.fail('full'); run(300_000);
  expect(links.length, 'it never gives up, and it never hurries').toBeGreaterThan(9);
  expect(links.length).toBeLessThan(13);
  expect(states).toEqual(['full']);
  heard();
  expect(states).toEqual(['full', 'live']);
  redial.dispose();
});

test('a restart is redialled, and a page back in view redials at once', () => {
  const { heard, run, states, links, redial } = harness();
  heard(); links[0]?.fail('restart'); run(400);
  expect(links).toHaveLength(2);
  heard(); run(100);
  run(1100);
  expect(states.at(-1)).toBe('reconnecting');
  run(1); redial.check(); run(100);
  expect(links).toHaveLength(3);
  redial.dispose();
});

// FM4: the screens say why the link is down and how the dial is doing, without changing when it dials.
test('a down link says why: closed, a restart, silence, a return to the tab', () => {
  const reasons = (fail: (h: ReturnType<typeof harness>) => void): (string | undefined)[] => {
    const h = harness(), said: (string | undefined)[] = [];
    // the harness's own listener keeps states; a second Redial would dial twice, so read the cause off the first
    h.heard(); fail(h); h.run(100); said.push(h.redial.why); h.redial.dispose();
    return said;
  };
  expect(reasons(h => { h.links[0]?.fail('lost'); })).toEqual(['closed']);
  expect(reasons(h => { h.links[0]?.fail('restart'); })).toEqual(['restart']);
  expect(reasons(h => { h.run(1100); })).toEqual(['silent']);
  expect(reasons(h => { h.run(1050); h.redial.check(); })).toEqual(['hidden']);
});

test('the reason rides onState for reconnecting and resuming', () => {
  let clock = 0;
  const first = { stats: { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 }, closes: new Set<(reason: string) => void>(), send(): void { /* none */ }, onMessage: () => () => undefined,
    onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }, close(): void { /* none */ } };
  const client = new NetClient(first, () => clock), said: [string, string | undefined][] = [];
  const redial = new Redial({ client, transport: first, now: () => clock, random: () => 0.5, dial: () => ({ ...first, closes: new Set(), onClose: () => () => undefined }), onState: (state, reason) => { said.push([state, reason]); } });
  for (const listener of first.closes) listener('restart');
  clock += 100; vi.advanceTimersByTime(100);
  expect(said[0]).toEqual(['reconnecting', 'restart']);
  redial.dispose(); client.dispose();
});

test('progress counts dials, the wait to the next, and the time down', () => {
  const { heard, run, links, redial, failDials } = harness();
  expect(redial.progress).toEqual({ dials: 0, nextDialMs: null, downMs: 0 });
  heard(); failDials('lost'); links[0]?.fail('lost');
  run(100);
  const early = redial.progress;
  expect(early.downMs).toBeGreaterThanOrEqual(100);
  run(5000);
  const later = redial.progress;
  expect(later.dials).toBeGreaterThan(1);
  expect(later.downMs).toBeGreaterThan(early.downMs);
  expect(later.nextDialMs === null || later.nextDialMs <= 4800).toBe(true);
  redial.dispose();
});

test('a restart close while already dialling changes the cause and says so, with the dial times unchanged', () => {
  let clock = 0;
  const links: FakeLink[] = [], first = new FakeLink(), causes: string[] = [];
  links.push(first);
  const client = new NetClient(first, () => clock), frames: ((value: DecodedFrame) => void)[] = [], onFrame = client.onFrame.bind(client);
  vi.spyOn(client, 'onFrame').mockImplementation(fn => { frames.push(fn); return onFrame(fn); });
  const redial = new Redial({ client, transport: first, now: () => clock, random: () => 0.5, onState: () => undefined, onCause: cause => { causes.push(cause); },
    dial: () => { const link = new FakeLink(); links.push(link); return link; } });
  for (const fn of frames) fn(frame);
  first.fail('lost');
  for (let t = 0; t < 400; t += 50) { clock += 50; vi.advanceTimersByTime(50); }
  expect(links).toHaveLength(2);
  links[1]?.fail('restart');
  expect(redial.why).toBe('restart');
  expect(causes).toEqual(['restart']);
  redial.dispose();
});

test('a link that went silent and dropped while the page was away is told as a return to the tab', () => {
  const { heard, run, redial } = harness();
  heard(); run(3200);
  expect(redial.why).toBe('silent');
  redial.check();
  expect(redial.why).toBe('hidden');
  redial.dispose();
});

test('dialNow brings a waiting dial forward and leaves the cause alone', () => {
  const { heard, run, redial, links, failDials } = harness();
  heard(); failDials('lost'); run(3200);
  const cause = redial.why;
  // run until a dial is waiting more than half a second away
  for (let step = 0; step < 200 && (redial.progress.nextDialMs ?? 0) < 600; step++) run(50);
  expect(redial.progress.nextDialMs).toBeGreaterThanOrEqual(600);
  const before = links.length;
  redial.dialNow(); run(100);
  expect(links.length).toBe(before + 1);
  expect(redial.why).toBe(cause);
  redial.dispose();
});

// WR5 (5.5): the refusal policy as a client sees it.
test('`retry` from an older server says Server updating and dials again, never ending the link', () => {
  const { heard, run, links, redial, states } = harness();
  heard(); links[0]?.fail('retry'); run(30_000);
  expect(states).not.toContain('ended');
  expect(links.length, 'it dials again, and again').toBeGreaterThanOrEqual(4);
  expect(redial.why).toBe('updating');
  redial.dispose();
});

test('a refusal before any frame is the cut: the page is asked, and the link keeps dialling as Server updating', () => {
  let clock = 0;
  const first = new FakeLink(), links = [first], said: [string, string | undefined][] = [], cuts: string[] = [];
  const client = new NetClient(first, () => clock);
  const redial = new Redial({ client, transport: first, now: () => clock, random: () => 0.5, onState: (state, reason) => { said.push([state, reason]); },
    onCut: reason => { cuts.push(reason); }, dial: () => { const link = new FakeLink(); links.push(link); return link; } });
  first.fail('reload');
  for (let at = 0; at < 200; at++) { clock += 50; vi.advanceTimersByTime(50); }
  expect(cuts).toEqual(['reload']);
  expect(said.map(([state]) => state)).not.toContain('ended');
  expect(redial.why).toBe('updating');
  expect(links.length).toBeGreaterThan(1);
  redial.dispose(); client.dispose();
});

test('after the first frame, `reload` still ends the link: a refused build reloads once', () => {
  const { heard, links, states, redial } = harness();
  heard(); links[0]?.fail('reload');
  expect(states).toContain('ended');
  redial.dispose();
});

test('FM4b mode 2: offline, nothing is dialled and the give-up clock stands still; the network back dials at once', () => {
  let online = true;
  const { heard, run, states, causes, dialTimes, failDials, links, redial } = harness(0.5, () => online);
  heard(); run(100);
  online = false;
  // the network went, then the frames: the strip says offline, and 3 s closes the dead socket as before
  run(1100);
  expect(states).toEqual(['reconnecting']);
  expect(redial.why).toBe('offline');
  run(2000);
  expect(links[0]?.closedAs).toBe('stalled');
  failDials('lost');
  run(10 * 60_000);
  expect(dialTimes, 'no dial goes out while the device says it is offline').toEqual([]);
  expect(states, 'ten minutes offline is neither Resuming nor lost').toEqual(['reconnecting']);
  online = true;
  run(100);
  expect(dialTimes, 'the network back dials within one watch').toHaveLength(1);
  expect(redial.why).toBe('closed');
  expect(causes, 'offline rode the strip\'s own state; the network back is told at once').toEqual(['closed']);
  // the clock goes on from where it stopped: about 3 s down before Redial saw it offline, so Resuming about 32 s from here
  run(31_000);
  expect(states).toEqual(['reconnecting']);
  run(1500);
  expect(states).toEqual(['reconnecting', 'resuming']);
  run(86_000);
  expect(states).toEqual(['reconnecting', 'resuming', 'lost']);
  redial.dispose();
});

test('FM4b mode 2: a link closed while offline is told as offline, and a frame clears it', () => {
  let online = false;
  const { heard, run, states, dialTimes, links, redial } = harness(0.5, () => online);
  heard(); links[0]?.fail('lost'); run(5000);
  expect(states).toEqual(['reconnecting']);
  expect(redial.why).toBe('offline');
  expect(dialTimes).toEqual([]);
  online = true; run(100);
  expect(dialTimes).toHaveLength(1);
  heard(); run(100);
  expect(states).toEqual(['reconnecting', 'live']);
  redial.dispose();
});

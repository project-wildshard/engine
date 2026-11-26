import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { DAY_LOGOUT_MS, LOGOUT_CARD_MS, OLD_TAB_RELOAD_KEY, armDayLogout, claimSessionReload, createOldTabHandler, missKind, type OldTabCard, type OldTabPorts } from './oldTab';
import type { BrowserErrorTags } from '../telemetry/browserErrors';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-26T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function rig(): { ports: OldTabPorts; shown: OldTabCard[]; events: { error: Error; tags: BrowserErrorTags }[]; order: string[] } {
  const shown: OldTabCard[] = [], events: { error: Error; tags: BrowserErrorTags }[] = [], order: string[] = [];
  const ports: OldTabPorts = {
    build: 'abc-build', now: () => Date.now(),
    show: card => { shown.push(card); order.push(`show ${card}`); },
    capture: (error, tags) => { events.push({ error, tags }); order.push('event'); },
    signOut: () => { order.push('sign out'); },
    reload: () => { order.push('reload'); },
  };
  return { ports, shown, events, order };
}

test('PV12: a client open 24 hours shows the card, sends one event, signs out and reloads', () => {
  const { ports, shown, events, order } = rig(), scope = new Scope('test.day-logout');
  armDayLogout(scope, ports);
  vi.advanceTimersByTime(DAY_LOGOUT_MS - 1);
  expect(order).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(shown).toEqual(['day-logout']);
  expect(events).toHaveLength(1);
  expect(events[0]?.tags).toMatchObject({ screen: 'day-logout', build: 'abc-build', system: 'old-tab', fatal: false });
  expect(order).toEqual(['show day-logout', 'event', 'sign out']);
  // the card stays up a moment so the player reads it, then the page reloads onto the current build
  vi.advanceTimersByTime(LOGOUT_CARD_MS);
  expect(order).toEqual(['show day-logout', 'event', 'sign out', 'reload']);
  vi.advanceTimersByTime(DAY_LOGOUT_MS * 2);
  expect(order).toHaveLength(4);
  scope.dispose();
});

test('PV12: a laptop that slept through the mark logs out on the next check, and a disposed page never does', () => {
  const { ports, order } = rig(), scope = new Scope('test.day-logout-slept');
  const opened = Date.now();
  armDayLogout(scope, ports, opened - DAY_LOGOUT_MS - 60_000);
  vi.advanceTimersByTime(0);
  expect(order.slice(0, 3)).toEqual(['show day-logout', 'event', 'sign out']);
  scope.dispose();

  const quiet = rig(), gone = new Scope('test.day-logout-gone');
  armDayLogout(gone, quiet.ports);
  gone.dispose();
  vi.advanceTimersByTime(DAY_LOGOUT_MS + LOGOUT_CARD_MS);
  expect(quiet.order).toEqual([]);
});

function missRig(session: Map<string, string>, worldRunning = false) {
  const shown: { card: OldTabCard; button: boolean }[] = [], events: BrowserErrorTags[] = [], reloads: number[] = [];
  const store = { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); } };
  const handler = createOldTabHandler({
    build: 'old-build',
    show: (card, _text, reload) => { shown.push({ card, button: reload !== undefined }); },
    capture: (_error, tags) => { events.push(tags); },
    claim: () => !worldRunning && claimSessionReload(store),
    reload: () => { reloads.push(Date.now()); },
  });
  return { handler, shown, events, reloads };
}

test('PV11: a missing chunk, pack and book each show the card once, send one event and reload once', () => {
  for (const [kind, what] of [['code', '/builds/0.1.96/old/main-AbCd1234.js'], ['pack', '/assets/spawn/parts/7ae0849f94f43033.pack.br'], ['book', '/assets/spawn/server-old.json']] as const) {
    const session = new Map<string, string>(), { handler, shown, events, reloads } = missRig(session);
    expect(handler(kind, what)).toBe('reload');
    expect(handler(kind, what)).toBe('shown');
    expect(shown).toEqual([{ card: 'old-tab-updated', button: false }]);
    expect(events).toEqual([expect.objectContaining({ screen: 'old-tab-updated', build: 'old-build', diagnostic: { kind, what, reload: true } })]);
    expect(reloads).toHaveLength(1);
    expect(session.get(OLD_TAB_RELOAD_KEY)).toBe('1');
  }
  expect(missKind('/assets/spawn/parts/7ae0849f94f43033.pack.br')).toBe('pack');
  expect(missKind('https://cooked.wildshard.io/shards/x/1.0.0/cooks/1/abc/index.json?v=1')).toBe('book');
});

test('PV11: a second miss in one session shows the card with its Reload button and never loops; a running world never reloads by itself', () => {
  const session = new Map<string, string>([[OLD_TAB_RELOAD_KEY, '1']]);
  const again = missRig(session);
  expect(again.handler('code', '/builds/0.1.96/old/late-AbCd1234.js')).toBe('card');
  vi.advanceTimersByTime(DAY_LOGOUT_MS);
  expect(again.reloads).toEqual([]);
  expect(again.shown).toEqual([{ card: 'old-tab-updated', button: true }]);
  expect(again.events).toHaveLength(1);
  const world = missRig(new Map(), true);
  expect(world.handler('pack', '/assets/spawn/parts/x.pack.br')).toBe('card');
  vi.advanceTimersByTime(DAY_LOGOUT_MS);
  expect(world.reloads).toEqual([]);
});

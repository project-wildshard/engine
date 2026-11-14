// @vitest-environment happy-dom
// SENTRY-TRIAGE S20 (meta docs/plans/SENTRY-TRIAGE-PLAN.md): which ways a page ends read as a crash on the next page.
// opus-iosmem's probe. Case 4 was the bug: a new tab opened while another tab plays has no session copy, read the playing tab's
// fresh device beat (`life.alive.once`) and classified `unexpected`. S20's fix: each page holds a Web Lock named for its page id
// (on the beat), and an end that rests on the device beat alone settles on a lock query.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PageLife, type PageLocks } from './lastEnd';
import { Scope } from '../../../shared/engine/app/scope';

const scopes: Scope[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.useRealTimers(); });
function fixture() {
  const local = new Map<string, string>(), session = new Map<string, string>();
  // the origin's Web Locks: one registry every tab shares
  const held = new Set<string>();
  const locks: PageLocks = { hold: (name) => { held.add(name); return () => { held.delete(name); }; }, held: (name) => Promise.resolve(held.has(name)) };
  const make = (tabSession: Map<string, string>) => (kind: 'local' | 'session') => {
    const values = kind === 'local' ? local : tabSession;
    return { getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); } };
  };
  const page = (navigation = 'navigate', tabSession = session): PageLife => {
    const scope = new Scope('reload-kinds'); scopes.push(scope);
    return new PageLife(scope, make(tabSession), () => navigation, undefined, locks);
  };
  const playing = page();
  playing.setAliveSource(() => ({ slug: 'driftwood-isle', resident: 'one', mode: 'shard' }));
  return { page, playing, local, session, held };
}

test('a browser reload of a visible page is never unexpected', () => {
  const f = fixture();
  window.dispatchEvent(new Event('pagehide'));
  expect(f.page('reload').lastEnd().kind).not.toBe('unexpected');
});

test('a service-worker update reload is intentional', () => {
  const f = fixture();
  f.playing.markReload('new build adopted: the new service worker took over');
  window.dispatchEvent(new Event('pagehide'));
  expect(f.page('reload').lastEnd().kind).toBe('intentional');
});

test('a bfcache hide then restore leaves no stale marker for a later page', () => {
  const f = fixture();
  window.dispatchEvent(new Event('pagehide'));
  const shown = new Event('pageshow');
  Object.defineProperty(shown, 'persisted', { value: true });
  window.dispatchEvent(shown);
  window.dispatchEvent(new Event('pagehide'));
  expect(f.page('reload').lastEnd().kind).not.toBe('unexpected');
});

test('a second tab opened while the first plays is not unexpected (S20)', async () => {
  const f = fixture();
  vi.advanceTimersByTime(5000);
  const second = f.page('navigate', new Map());
  expect((await second.settle()).kind).toBe('fresh');
  expect(second.lastEnd().kind).toBe('fresh');
  // and nothing recorded a crash for the device's Debug line
  expect(f.local.has('life.lastEnd')).toBe(false);
});

test('a page killed with its session lost is still unexpected: its lock went with it (S20)', async () => {
  const f = fixture();
  scopes[0]?.dispose(); // the process died: no pagehide, and its lock is gone
  const next = f.page('navigate', new Map());
  expect(next.lastEnd().kind).toBe('unexpected'); // pending, as the beat said
  expect(await next.settle()).toMatchObject({ kind: 'unexpected', slug: 'driftwood-isle' });
  expect(JSON.parse(f.local.get('life.lastEnd') ?? '{}')).toMatchObject({ kind: 'unexpected' });
});

test('a page killed with its session kept is unexpected (S20)', async () => {
  const f = fixture();
  scopes[0]?.dispose();
  expect((await f.page('navigate').settle()).kind).toBe('unexpected');
});

test("a duplicated tab starts with the playing tab's session copy, and is not unexpected (S20)", async () => {
  const f = fixture();
  vi.advanceTimersByTime(5000);
  expect((await f.page('navigate', new Map(f.session)).settle()).kind).toBe('fresh');
});

test("a lock query that never answers leaves the beat's word, after at most 500 ms (S20)", async () => {
  const f = fixture();
  const scope = new Scope('slow'); scopes.push(scope);
  const slow: PageLocks = { hold: () => () => undefined, held: () => new Promise<boolean>(() => { /* never answers */ }) };
  const next = new PageLife(scope, (kind) => { const values = kind === 'local' ? f.local : new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; },
    () => 'navigate', undefined, slow);
  const settled = next.settle();
  vi.advanceTimersByTime(500);
  expect((await settled).kind).toBe('unexpected');
});

test('a hidden page lets its lock go, and takes it back from the bfcache (S20)', () => {
  const f = fixture();
  expect(f.held.size).toBe(1);
  window.dispatchEvent(new Event('pagehide'));
  expect(f.held.size).toBe(0);
  const shown = new Event('pageshow');
  Object.defineProperty(shown, 'persisted', { value: true });
  window.dispatchEvent(shown);
  expect(f.held.size).toBe(1);
  // iOS: a pagehide on an app switch, then visible again with no pageshow
  window.dispatchEvent(new Event('pagehide'));
  expect(f.held.size).toBe(0);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(f.held.size).toBe(1);
});

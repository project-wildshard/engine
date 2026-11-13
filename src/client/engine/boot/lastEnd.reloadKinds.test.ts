// @vitest-environment happy-dom
// SENTRY-TRIAGE S20 (meta docs/plans/SENTRY-TRIAGE-PLAN.md): which ways a page ends read as a crash on the next page.
// opus-iosmem's probe. Cases 1 to 3 hold today. Case 4 is the bug: a new tab opened while another tab plays has no session copy,
// reads the playing tab's fresh device beat (`life.alive.once`) and classifies `unexpected`. It is `test.fails` until S20's fix (a
// page id on the beat and a liveness check of that page); then drop `.fails`.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PageLife } from './lastEnd';
import { Scope } from '../../../shared/engine/app/scope';

const scopes: Scope[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.useRealTimers(); });
function fixture() {
  const local = new Map<string, string>(), session = new Map<string, string>();
  const make = (tabSession: Map<string, string>) => (kind: 'local' | 'session') => {
    const values = kind === 'local' ? local : tabSession;
    return { getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); } };
  };
  const page = (navigation = 'navigate', tabSession = session): PageLife => {
    const scope = new Scope('reload-kinds'); scopes.push(scope);
    return new PageLife(scope, make(tabSession), () => navigation);
  };
  const playing = page();
  playing.setAliveSource(() => ({ slug: 'driftwood-isle', resident: 'one', mode: 'shard' }));
  return { page, playing };
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

test.fails('a second tab opened while the first plays is not unexpected (S20, open)', () => {
  const f = fixture();
  vi.advanceTimersByTime(5000);
  expect(f.page('navigate', new Map()).lastEnd().kind).not.toBe('unexpected');
});

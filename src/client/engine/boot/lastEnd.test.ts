// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PageLife } from './lastEnd';
import { Scope } from '../../../shared/engine/app/scope';

const scopes: Scope[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.useRealTimers(); });
function fixture() {
  const local = new Map<string, string>(), session = new Map<string, string>();
  const storage = (kind: 'local' | 'session') => {
    const values = kind === 'local' ? local : session;
    return { getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); } };
  };
  const page = (): PageLife => { const scope = new Scope('test-page'); scopes.push(scope); return new PageLife(scope, storage); };
  const playing = page();
  playing.setAliveSource(() => ({ slug: 'coast', resident: 'one world', mode: 'shard' }));
  return { local, session, page, playing };
}

test('a kill survives lost sessionStorage through the durable alive copy', () => {
  const f = fixture();
  scopes[0]?.dispose(); // process died: no pagehide handler ran
  f.session.clear();
  expect(f.page().lastEnd()).toMatchObject({ kind: 'unexpected', slug: 'coast', mode: 'shard', at: 100_000 });
});

test('clean exit stays intentional even if navigation lasts beyond the recent-reason window', () => {
  const f = fixture(); f.playing.markUnload('exit to main menu (fresh page)');
  vi.advanceTimersByTime(15_000);
  expect(f.page().lastEnd()).toMatchObject({ kind: 'intentional', reason: 'exit to main menu (fresh page) (15 s before this load)' });
});

test('explicit RELOAD is intentional and selects the title; GPU recovery stays distinct', () => {
  const f = fixture(); f.playing.markReload('RELOAD');
  expect(f.page().lastEnd()).toMatchObject({ kind: 'intentional', reload: true });
  const g = fixture(); g.playing.markReload('context recovery', 'gpu');
  expect(g.page().lastEnd().reload).toBeUndefined();
});

test('normal pagehide clears both alive copies', () => {
  const f = fixture(); window.dispatchEvent(new Event('pagehide'));
  expect(f.session.has('life.alive')).toBe(false);
  expect(f.local.has('life.alive.once')).toBe(false);
  expect(f.page().lastEnd().kind).toBe('fresh');
});

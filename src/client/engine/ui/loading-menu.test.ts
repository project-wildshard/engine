// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Scope } from '../../../shared/engine/app/scope';
import { Loading } from './Loading';

// QA 30 (Jake, 2026-11-10: "You can't like regret loading the wrong shard and bail out and go to the other shard"): a shard's
// loading card carries SETTINGS and EXIT TO TITLE; Exit replaces the page with the title, ending the in-flight load with it.
const owners: Scope[] = [];
beforeEach(() => {
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport here */ }
    disconnect(): void { /* no observer work */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();
});

function card(scoped = false): Loading {
  const loading = new Loading({ id: 'driftwood-isle', name: 'Driftwood Isle' }, { scoped });
  owners.push(loading.scope);
  return loading;
}

it('a shard load offers Settings and Exit to title', () => {
  const buttons = [...card().root.querySelectorAll<HTMLButtonElement>('.ws-load-menu button')];
  expect(buttons.map(b => [b.dataset['loadMenu'], b.textContent])).toEqual([['settings', 'Settings'], ['exit', 'Exit to title']]);
});

it('a mid-play cell load keeps its own exits: no menu row', () => {
  expect(card(true).root.querySelector('.ws-load-menu')).toBeNull();
});

it('Exit to title replaces the page with a fresh title, once', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { href: 'https://play.wildshard.io/?chunk=driftwood-isle&sw=0', replace });
  const exit = card().root.querySelector<HTMLButtonElement>('[data-load-menu="exit"]');
  exit?.click();
  await vi.waitFor(() => { expect(replace).toHaveBeenCalledTimes(1); });
  expect(replace).toHaveBeenCalledWith('https://play.wildshard.io/');
  expect(exit?.disabled).toBe(true);
  exit?.click();
  await Promise.resolve();
  expect(replace).toHaveBeenCalledTimes(1);
});

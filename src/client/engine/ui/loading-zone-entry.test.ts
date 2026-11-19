// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { enterOwner } from '../../../shared/engine/app/ownership';
import { beginNavigationShell } from '../boot/shell';
import { beginLoading } from './Loading';

// QA 11-19 row 17 (Jake, staging v0.1.50: "it's just completely broken and frozen. Can't press any buttons"): a zone entry runs
// the next boot in the same page, under the entry's card (`beginNavigationShell`). Its Loading must adopt that card, and live
// for the page: the retired session's owner, still ambient, took the first card's clock and taps with it, and the boot's live
// card was built beneath the dead one (two `.ws-load` cards, the top one frozen at "0 / 111 files").
let now = 1000;
beforeEach(() => {
  vi.useFakeTimers(); now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport */ }
    disconnect(): void { /* no observer work */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => { enterOwner(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.ws-load:not([data-veil])')];

it('a zone entry boot paints one card, the entry card, and its clock runs past a retired session owner', () => {
  const page = new Scope('page'), oldLevel = new Scope('old-level');
  const attempt = beginNavigationShell('Sky Reach', page, () => undefined);
  // the retired session's level is the ambient owner when the next boot's code runs (Game.beginLevelSystems' enterOwner)
  enterOwner(oldLevel); oldLevel.dispose();
  const first = beginLoading({ id: 'sky-reach', name: 'Sky Reach' });
  expect(cards()).toHaveLength(1);
  expect(first.root.dataset['navigation']).toBe('');
  const clock = first.root.querySelector('[data-el="clock"]');
  const before = clock?.textContent;
  now += 3000; vi.advanceTimersByTime(3000);
  expect(clock?.textContent).not.toBe(before);
  expect(first.scope.disposed).toBe(false);
  first.scope.dispose(); attempt.dispose(); page.dispose();
});

it('a second Loading in the same entry takes the entry card over afresh, never a second card beneath it', () => {
  const page = new Scope('page');
  const attempt = beginNavigationShell('Sky Reach', page, () => undefined);
  const first = beginLoading({ id: 'driftwood-isle', name: 'Driftwood Isle' });
  first.waiting('Reading build files');
  const second = beginLoading({ id: 'sky-reach', name: 'Sky Reach' });
  expect(first.scope.disposed).toBe(true);
  expect(cards()).toHaveLength(1);
  expect(cards()[0]).toBe(second.root);
  expect(second.root.querySelectorAll('[data-el="clock"]')).toHaveLength(1);
  second.scope.dispose(); attempt.dispose(); page.dispose();
});

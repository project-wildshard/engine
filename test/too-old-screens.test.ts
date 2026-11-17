// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { tooOldScreens } from '../src/client/host/online/tooOldScreens';

// FM5b2 and FM5b3 (meta MMO-FAILURE-MODES-PLAN mode 24, J219/J229): code retired in play. A banner while playing, a countdown only from
// a signed deadline, never a navigation by itself; the page at the next zone entry, reconnect or boot; Update is the player's own reload.
const shown = (ids: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-failmode~="${ids}"]:not([hidden])`);
const click = (root: HTMLElement | null, label: string): void => { [...root?.querySelectorAll('button') ?? []].find(button => (button.textContent ?? '').includes(label))?.click(); };

let scope: Scope;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 17, 14, 0, 0)); scope = new Scope('test.too-old'); });
afterEach(() => { scope.dispose(); vi.useRealTimers(); document.body.replaceChildren(); document.head.replaceChildren(); });

test('kept or unknown code shows nothing and refuses nothing', () => {
  const update = vi.fn<() => void>(), screens = tooOldScreens(scope, { update });
  screens.retention({ availability: 'unknown', retireAt: null });
  screens.retention({ availability: 'kept', retireAt: null });
  expect(document.querySelector('[data-failmode]:not([hidden])')).toBeNull();
  expect(screens.refuse('zone')).toBe(false);
});

test('FM5b2: a signed deadline counts down, and at zero the banner says update at the next load; it never navigates', () => {
  const update = vi.fn<() => void>(), screens = tooOldScreens(scope, { update });
  screens.retention({ availability: 'retired', retireAt: Date.now() + 125_000 });
  const banner = shown('too-old-warning');
  expect(banner?.textContent).toContain('Update needed');
  expect(banner?.textContent).toContain('in 2 min');
  vi.advanceTimersByTime(70_000);
  expect(banner?.textContent).toContain('in 55 s');
  vi.advanceTimersByTime(120_000);
  expect(shown('too-old-warning')?.textContent).toContain('at the next load');
  // no page, no reload: a fight goes on
  expect(shown('too-old')).toBeNull();
  expect(update).not.toHaveBeenCalled();
});

test('FM5b2: with no signed deadline there is no countdown, and Update is the player\'s own reload, once', () => {
  const update = vi.fn<() => void>(), screens = tooOldScreens(scope, { update });
  screens.retention({ availability: 'retired', retireAt: null });
  const banner = shown('too-old-warning');
  expect(banner?.textContent).toContain('at the next load');
  expect(banner?.textContent).not.toMatch(/\d+ (?:s|min)\b/u);
  click(banner, 'Update');
  click(banner, 'Update');
  expect(update).toHaveBeenCalledOnce();
});

test('FM5b2: while the link is down the link banner speaks; the warning comes back with the link', () => {
  const screens = tooOldScreens(scope, { update: () => undefined });
  screens.retention({ availability: 'retired', retireAt: null });
  screens.link(false);
  expect(shown('too-old-warning')).toBeNull();
  screens.link(true);
  expect(shown('too-old-warning')).not.toBeNull();
});

test('FM5b3: the next zone entry or reconnect of a retired build is refused with the page; Update now reloads once', () => {
  const update = vi.fn<() => void>(), screens = tooOldScreens(scope, { update });
  screens.retention({ availability: 'retired', retireAt: null });
  expect(screens.refuse('zone')).toBe(true);
  const page = shown('too-old');
  expect(page?.getAttribute('role')).toBe('alertdialog');
  expect(page?.textContent).toContain('Your game is too old');
  expect(page?.textContent).toContain('Your progress is safe on the server');
  // the page is the whole screen: the banner under it goes
  expect(shown('too-old-warning')).toBeNull();
  click(page, 'Update now');
  click(page, 'Update now');
  expect(update).toHaveBeenCalledOnce();
});

test('FM5b3: a verified keep after the warning lifts it, and the next entry goes ahead', () => {
  const screens = tooOldScreens(scope, { update: () => undefined });
  screens.retention({ availability: 'retired', retireAt: null });
  screens.retention({ availability: 'kept', retireAt: null });
  expect(shown('too-old-warning')).toBeNull();
  expect(screens.refuse('reconnect')).toBe(false);
});

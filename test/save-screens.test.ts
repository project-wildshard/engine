// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { PersistenceWord } from '../src/shared/engine/net/persistenceWord';
import { SAVE_FAILED_MS, SAVE_LATE_MS, saveScreens } from '../src/client/host/online/saveScreens';

// FM8s (meta MMO-FAILURE-MODES-PLAN modes 30, 30b and 31): what a player sees when the server's own saves are late or failing. The facts
// are the server's per-player `save-confirmed` / `save-failed` (FM7b3); nothing here guesses one, and a last-save time is only ever the
// moment this page heard a confirmed save.
const confirmed = (sequence: number, scope = 'driftwood-isle'): PersistenceWord => ({ code: 'save-confirmed', sequence, scope });
const failed = (sequence: number, scope = 'driftwood-isle'): PersistenceWord => ({ code: 'save-failed', sequence, scope });
const shown = (ids: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-failmode~="${ids}"]:not([hidden])`);
const click = (root: HTMLElement | null, label: string): void => { [...root?.querySelectorAll('button') ?? []].find(button => (button.textContent ?? '').includes(label))?.click(); };
/** The player's own Leave the world, as the HUD asks it: true when nothing held it. */
const leave = (go: () => void): boolean => document.dispatchEvent(new CustomEvent('ws:leave-world', { cancelable: true, detail: { go } }));

let scope: Scope;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 17, 14, 2, 11)); scope = new Scope('test.saves'); });
afterEach(() => { scope.dispose(); vi.useRealTimers(); document.body.replaceChildren(); document.head.replaceChildren(); });

test('an older server or a memory store says nothing: no fact heard is never a late save, and Leave goes at once', () => {
  saveScreens(scope);
  vi.advanceTimersByTime(SAVE_LATE_MS * 3);
  expect(document.querySelector('[data-failmode]')).toBeNull();
  const go = vi.fn<() => void>();
  expect(leave(go)).toBe(true);
});

test('mode 30: no confirmed save for longer than the checkpoint shows the Saving chip, with the time it was last confirmed; a save clears it', () => {
  const saves = saveScreens(scope);
  saves.fact(confirmed(1));
  vi.advanceTimersByTime(SAVE_LATE_MS - 2000);
  expect(shown('save-slow')).toBeNull();
  vi.advanceTimersByTime(3000);
  const chip = shown('save-slow');
  expect(chip?.textContent).toContain('Saving');
  expect(chip?.textContent).toContain('last saved 14:02');
  saves.fact(confirmed(2));
  vi.advanceTimersByTime(1000);
  expect(shown('save-slow')).toBeNull();
});

test('mode 31: a failed save shows Saving · retrying at once, the card once it keeps failing, Keep playing leaves a warning, a save clears all', () => {
  const saves = saveScreens(scope);
  saves.fact(confirmed(4));
  vi.advanceTimersByTime(5000);
  saves.fact(failed(5));
  vi.advanceTimersByTime(1000);
  expect(shown('save-slow')?.textContent).toContain('retrying');
  saves.fact(failed(5)); saves.fact(failed(6));
  vi.advanceTimersByTime(SAVE_FAILED_MS);
  const card = shown('save-failed');
  expect(card?.getAttribute('role')).toBe('alertdialog');
  expect(card?.textContent).toContain('Progress isn\'t saving');
  // the last-save time is the confirmed save this page heard, never a guess
  expect(card?.textContent).toContain('anything after 14:02');
  expect(card?.textContent).toContain('Save failed 3 times');
  click(card, 'Keep playing');
  expect(shown('save-failed')?.getAttribute('role')).toBe('status');
  expect(shown('save-failed')?.textContent).toContain('Not saving');
  vi.advanceTimersByTime(30_000);
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  // an older save's confirmation clears no newer failure
  saves.fact(confirmed(4));
  vi.advanceTimersByTime(1000);
  expect(shown('save-failed')).not.toBeNull();
  saves.fact(confirmed(6));
  vi.advanceTimersByTime(1000);
  expect(document.querySelector('[data-failmode]')).toBeNull();
});

test('with no save confirmed this session the card omits the time instead of making one up', () => {
  const saves = saveScreens(scope);
  saves.fact(failed(1));
  vi.advanceTimersByTime(SAVE_FAILED_MS + 1000);
  const card = shown('save-failed');
  expect(card?.textContent).toContain('since the last confirmed save');
  expect(card?.textContent).not.toMatch(/\d\d:\d\d/u);
});

test('mode 30b: Leave while a save is late opens the hold card; Leave when saved leaves on the next confirmed save, not before', () => {
  const saves = saveScreens(scope), go = vi.fn<() => void>();
  saves.fact(confirmed(1));
  vi.advanceTimersByTime(SAVE_LATE_MS + 1000);
  expect(leave(go)).toBe(false);
  const card = shown('save-slow-blocked');
  expect(card?.textContent).toContain('You tapped Leave the world');
  expect(card?.textContent).toContain('Last saved 14:02');
  click(card, 'Leave when saved');
  vi.advanceTimersByTime(20_000);
  expect(go).not.toHaveBeenCalled();
  saves.fact(confirmed(2));
  expect(go).toHaveBeenCalledOnce();
  expect(shown('save-slow-blocked')).toBeNull();
});

test('Keep playing cancels the wait: a later save does not leave; Leave now leaves at once', () => {
  const saves = saveScreens(scope), kept = vi.fn<() => void>(), now = vi.fn<() => void>();
  saves.fact(confirmed(1)); saves.fact(failed(2));
  expect(leave(kept)).toBe(false);
  click(shown('save-slow-blocked'), 'Leave when saved');
  click(shown('save-slow-blocked'), 'Keep playing');
  expect(shown('save-slow-blocked')).toBeNull();
  saves.fact(failed(3));
  expect(leave(now)).toBe(false);
  click(shown('save-slow-blocked'), 'Leave now');
  expect(now).toHaveBeenCalledOnce();
  saves.fact(confirmed(3));
  expect(kept).not.toHaveBeenCalled();
});

test('the save-failed card\'s Leave the world asks the page to leave, which the hold card then warns about', () => {
  const saves = saveScreens(scope), asked = vi.fn<() => void>();
  document.addEventListener('ws:exit-to-main', asked);
  saves.fact(failed(1));
  vi.advanceTimersByTime(SAVE_FAILED_MS + 1000);
  click(shown('save-failed'), 'Leave the world');
  expect(asked).toHaveBeenCalledOnce();
  document.removeEventListener('ws:exit-to-main', asked);
});

test('while the link is down the link screens speak: no save chip, Leave is not held, and the late clock starts again when it is back', () => {
  const saves = saveScreens(scope), go = vi.fn<() => void>();
  saves.fact(confirmed(1));
  vi.advanceTimersByTime(SAVE_LATE_MS + 1000);
  expect(shown('save-slow')).not.toBeNull();
  saves.link(false);
  vi.advanceTimersByTime(1000);
  expect(shown('save-slow')).toBeNull();
  expect(leave(go)).toBe(true);
  saves.link(true);
  vi.advanceTimersByTime(SAVE_LATE_MS - 5000);
  expect(shown('save-slow')).toBeNull();
  vi.advanceTimersByTime(6000);
  expect(shown('save-slow')).not.toBeNull();
});

test('review: Keep playing on the hold card while saves fail leaves the lasting warning, not the failed card a second later', () => {
  const saves = saveScreens(scope);
  saves.fact(confirmed(1)); saves.fact(failed(2));
  vi.advanceTimersByTime(SAVE_FAILED_MS + 1000);
  click(shown('save-failed'), 'Keep playing');
  leave(() => undefined);
  click(shown('save-slow-blocked'), 'Keep playing');
  vi.advanceTimersByTime(3000);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(shown('save-failed')?.textContent).toContain('Not saving');
});

test('review: back after a drop, failures heard before it say nothing about now: no failed card on reconnect', () => {
  const saves = saveScreens(scope);
  saves.fact(confirmed(1)); saves.fact(failed(2));
  saves.link(false);
  vi.advanceTimersByTime(SAVE_FAILED_MS * 3);
  saves.link(true);
  vi.advanceTimersByTime(1000);
  expect(shown('save-failed')).toBeNull();
});

test('a scope that ends takes its chip, cards and the leave hold with it', () => {
  const saves = saveScreens(scope), go = vi.fn<() => void>();
  saves.fact(failed(1));
  vi.advanceTimersByTime(SAVE_FAILED_MS + 1000);
  expect(shown('save-failed')).not.toBeNull();
  scope.dispose();
  expect(document.querySelector('[data-failmode]')).toBeNull();
  expect(leave(go)).toBe(true);
});

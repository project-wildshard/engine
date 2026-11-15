// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { releaseScreens, stagingMark } from '../src/client/host/online/releaseScreens';
import type { ReleaseFault } from '../src/client/host/online/release';

// FM5 (meta MMO-FAILURE-MODES-PLAN modes 1, 11, 12, 37 to 39, 46): the pages a load shows while it has no release file to dial from.
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
const shown = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-failmode]');
const primary = (): string => { const copy = shown()?.cloneNode(true) as HTMLElement; for (const part of copy.querySelectorAll('details, button')) part.remove(); return copy.textContent ?? ''; };
const labels = (): string[] => [...document.querySelectorAll('[data-failmode] button')].map(button => button.textContent ?? '');

test('a 5xx page counts down the real scheduled read, reads again by itself, and never shows the status as primary copy', async () => {
  vi.useFakeTimers();
  const scope = new Scope('test'), wait = releaseScreens(scope, { title: () => undefined, doctor: () => undefined });
  let read = false;
  const next = wait.after({ kind: 'status', status: 503, retryAfterMs: null }, 0, 2000, 'No release file at https://cdn.example/x: 503').then(() => { read = true; });
  expect(shown()?.dataset['failmode']).toBe('release-5xx');
  expect(primary()).toContain('Next try in 2 s');
  expect(primary()).not.toMatch(/503|https?:/u);
  expect(document.querySelector('[data-failmode] details')?.textContent).toContain('HTTP 503');
  expect(labels()).toEqual(['Try now', 'Check connection', 'Title screen']);
  expect(document.activeElement?.textContent).toBe('Try now'); // the page takes focus, so Enter or Space acts at once
  await vi.advanceTimersByTimeAsync(1999);
  expect(read).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await next;
  expect(read).toBe(true);
  wait.done();
  expect(shown()).toBeNull();
  scope.dispose();
});

test('429 waits what the world asked with no Try now; offline waits for the network; a portal reads again when the page is back in view', async () => {
  const scope = new Scope('test'), wait = releaseScreens(scope, { title: () => undefined });
  void wait.after({ kind: 'status', status: 429, retryAfterMs: 5000 }, 0, 5000, '');
  expect(shown()?.dataset['failmode']).toBe('release-429');
  expect(labels()).toEqual(['Title screen']);
  const back = wait.after({ kind: 'offline' }, 1, null, 'Failed to fetch');
  expect(document.querySelectorAll('[data-failmode]')).toHaveLength(1);
  expect(shown()?.dataset['failmode']).toBe('offline-launch');
  window.dispatchEvent(new Event('online'));
  await back;
  const portal = wait.after({ kind: 'portal', why: 'html' }, 2, null, '');
  expect(shown()?.dataset['failmode']).toBe('captive-portal');
  document.dispatchEvent(new Event('visibilitychange'));
  await portal;
  wait.done(); scope.dispose();
});

test('404 and a bad signature: Try again reads once; Title screen stops the load and leaves', async () => {
  let left = 0;
  const scope = new Scope('test'), wait = releaseScreens(scope, { title: () => { left++; } });
  const missing = wait.after({ kind: 'status', status: 404, retryAfterMs: null }, 0, 60_000, '');
  expect(shown()?.dataset['failmode']).toBe('release-404');
  document.querySelector<HTMLButtonElement>('[data-failmode] button.go')?.click();
  await missing;
  const bad: ReleaseFault = { kind: 'unsigned' }, leaving = wait.after(bad, 1, null, 'A release file has a bad signature');
  expect(primary()).toContain('can\'t verify');
  [...document.querySelectorAll<HTMLButtonElement>('[data-failmode] button')].find(button => button.textContent === 'Title screen')?.click();
  await expect(leaving).rejects.toThrow(/title/u);
  expect(left).toBe(1);
  wait.done(); scope.dispose();
});

test('staging says so for the session', () => {
  const scope = new Scope('test'), mark = stagingMark(scope);
  expect(mark.dataset['failmode']).toBe('staging');
  expect(mark.textContent).toBe('Staging · not the live world');
  scope.dispose();
  expect(document.querySelector('[data-failmode="staging"]')).toBeNull();
});

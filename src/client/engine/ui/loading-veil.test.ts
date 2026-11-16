// @vitest-environment happy-dom
// STAGING-BUGBASH SB5: the grid reveal hid the canvas past the card's end and the page showed black (0.4 to 1.6 s). While a
// part holds the veil, the finished card leaves a still copy that takes no input and fades once the hold lets go.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { holdLoadingVeil, Loading } from './Loading';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport in this DOM regression */ }
    disconnect(): void { /* no transport in this DOM regression */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const veil = (): HTMLElement | null => document.querySelector<HTMLElement>('.ws-load[data-veil="true"]');

it('a held veil keeps a still copy of the finished card up, done() resolves on time, and it fades when the hold lets go', async () => {
  const reveal = new Scope('reveal-test'), release = holdLoadingVeil(reveal);
  const loading = new Loading({ id: 'veil', name: 'Veil' });
  const done = loading.done();
  await vi.advanceTimersByTimeAsync(400); await done;
  expect(loading.scope.disposed).toBe(true);
  const copy = veil();
  expect(copy).not.toBeNull();
  expect(copy?.classList.contains('hide')).toBe(false);
  expect(copy?.inert).toBe(true);
  release();
  expect(copy?.classList.contains('hide')).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(veil()).toBeNull();
  reveal.dispose();
});

it('no hold, no copy; a hold that never lets go still fades within VEIL_MS', async () => {
  const plain = new Loading({ id: 'plain', name: 'Plain' }), first = plain.done();
  await vi.advanceTimersByTimeAsync(400); await first;
  expect(veil()).toBeNull();
  const stuck = new Scope('stuck-test'); holdLoadingVeil(stuck);
  const loading = new Loading({ id: 'stuck', name: 'Stuck' }), done = loading.done();
  await vi.advanceTimersByTimeAsync(400); await done;
  expect(veil()).not.toBeNull();
  await vi.advanceTimersByTimeAsync(4300);
  expect(veil()).toBeNull();
  stuck.dispose();
});

it('a hold that does not want the world next (a title-first page, a pause menu) leaves no copy', async () => {
  const title = new Scope('title-first'); holdLoadingVeil(title, () => false);
  const loading = new Loading({ id: 'title', name: 'Title' }), done = loading.done();
  await vi.advanceTimersByTimeAsync(400); await done;
  expect(veil()).toBeNull();
  title.dispose();
});

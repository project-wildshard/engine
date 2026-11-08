// @vitest-environment happy-dom
// LS3 (J188) at the card's outer edge: its bars move only on real events, never on time.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Loading, phaseTenths, type LoadingDownloadSource } from './Loading';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';

let now = 100;
beforeEach(() => {
  vi.useFakeTimers(); now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport here */ }
    disconnect(): void { /* no transport here */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const widths = (loading: Loading): string[] => ['stBar', 'dlBar', 'suBar']
  .map(key => loading.root.querySelector<HTMLElement>(`[data-el="${key}"]`)?.style.width ?? '');

it('holds every bar through 30 quiet seconds, then moves Download on streamed bytes and Load on a finished step', () => {
  const loading = new Loading({ id: 'bar-rule', name: 'Bar rule' });
  let row = { totalBytes: 1000, completedBytes: 0, cachedBytes: 0, filesTotal: 4, filesDone: 0, complete: false, error: null };
  let notify = (): void => undefined;
  const source: LoadingDownloadSource = { ready: new Promise<void>(() => { /* the manifest never closes here */ }), snapshot: () => row,
    subscribe: listener => { notify = listener; listener(); return () => undefined; } };
  void loading.setDownloadSource(source);
  loading.setPath({ id: 'rule', steps: [{ key: 'a', label: 'A', weight: 1 }, { key: 'b', label: 'B', weight: 1 }] });
  loading.endAdmission();
  vi.advanceTimersByTime(300);
  const before = widths(loading);
  for (let second = 0; second < 30; second++) { now += 1000; vi.advanceTimersByTime(1000); }
  expect(widths(loading)).toEqual(before); // no creep: time alone moves nothing
  row = { ...row, completedBytes: 250, filesDone: 1 }; notify();
  expect(Number.parseFloat(widths(loading)[1] ?? '')).toBe(25);
  const timeline = currentLoadingTimeline();
  if (timeline === undefined) throw new Error('Missing timeline');
  timeline.begin('a').end(); timeline.begin('b'); now += 200; vi.advanceTimersByTime(200);
  expect(Number.parseFloat(widths(loading)[2] ?? '')).toBe(50);
  for (let second = 0; second < 10; second++) { now += 1000; vi.advanceTimersByTime(1000); }
  expect(Number.parseFloat(widths(loading)[2] ?? '')).toBe(50);
  loading.scope.dispose();
});

it('LS2: the ready card shows phase times whose tenths add up to its clock', () => {
  // 0.24 + 0.34 + 1.24 s is 1.82 s: rounding each alone shows 0.2 + 0.3 + 1.2 = 1.7, not the clock's 1.8
  const shown = phaseTenths([240, 340, 1240], 1820);
  expect(shown.reduce((sum, value) => sum + value, 0)).toBe(18);
  shown.forEach((value, index) => { expect(Math.abs(value - ([2.4, 3.4, 12.4][index] ?? 0))).toBeLessThan(1); });
  expect(phaseTenths([28_100, 14_000, 40_100], 82_200)).toEqual([281, 140, 401]);
});

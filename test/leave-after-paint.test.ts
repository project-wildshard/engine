import { afterEach, expect, test, vi } from 'vitest';
import { leaveAfterPaint } from '../src/client/engine/boot/leaveAfterPaint';

afterEach(() => { vi.useRealTimers(); });

// FM3's proof (MMO-FAILURE-MODES, version-skew, 2026-11-15): the new-build panel's Reload ran this in a graph with no browser
// frame environment; the bare frame threw before the fallback timer was set, so the page sat at RELOADING forever.
test('a host with no frame scheduling still leaves, on the timer', () => {
  vi.useFakeTimers();
  const go = vi.fn();
  expect(() => { leaveAfterPaint(go); }).not.toThrow();
  expect(go).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(go).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(go).toHaveBeenCalledTimes(1);
});

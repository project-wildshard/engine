// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { afterControl, reachControl, whenControl } from './prefetch';

afterEach(() => { vi.useRealTimers(); });

test('background I/O waits for control and paint, rearms on pause, and starts once', async () => {
  vi.useFakeTimers();
  const scope = new Scope('control'), frames: (() => void)[] = [], run = vi.fn<() => void>();
  let ready = false;
  try {
    afterControl(scope, frame => { frames.push(frame); }, () => ready, run);
    frames[0]?.(); await vi.advanceTimersByTimeAsync(40); expect(run).not.toHaveBeenCalled();
    ready = true; frames[0]?.(); expect(run).not.toHaveBeenCalled();
    ready = false; await vi.advanceTimersByTimeAsync(40); expect(run).not.toHaveBeenCalled();
    ready = true; frames[0]?.(); await vi.advanceTimersByTimeAsync(40); expect(run).toHaveBeenCalledTimes(1);
    frames[0]?.(); await vi.advanceTimersByTimeAsync(40); expect(run).toHaveBeenCalledTimes(1);
  } finally { scope.dispose(); }
});

test('a retired world cannot publish queued background work', async () => {
  vi.useFakeTimers();
  const scope = new Scope('retired'), frames: (() => void)[] = [], run = vi.fn<() => void>();
  afterControl(scope, frame => { frames.push(frame); }, () => true, run);
  frames[0]?.(); scope.dispose();
  await vi.advanceTimersByTimeAsync(40); expect(run).not.toHaveBeenCalled();
});

test('sample warm-up waits for its actual level control and a retired borrower cannot publish', () => {
  const level = new Scope('sample-level'), live = level.child('live'), retired = level.child('retired');
  const warm = vi.fn<() => void>(), stale = vi.fn<() => void>();
  try {
    whenControl(level, live, warm); whenControl(level, retired, stale);
    expect(warm).not.toHaveBeenCalled(); expect(stale).not.toHaveBeenCalled();
    retired.dispose(); reachControl(level); reachControl(level);
    expect(warm).toHaveBeenCalledOnce(); expect(stale).not.toHaveBeenCalled();
    whenControl(level, retired, stale); expect(stale).not.toHaveBeenCalled();
    const outside = new Scope('external-sample-borrower');
    try { level.dispose(); whenControl(level, outside, stale); expect(stale).not.toHaveBeenCalled(); }
    finally { outside.dispose(); }
  } finally { level.dispose(); }
});

test('an already controlled level permits live demand but blocks a sliced retiring ancestor', () => {
  const level = new Scope('controlled-level'), live = new Scope('new-loadout'), ancestor = new Scope('retiring-loadout'), child = ancestor.child('audio');
  const warm = vi.fn<() => void>(), stale = vi.fn<() => void>();
  reachControl(level); ancestor.onDispose(() => { /* Yield before its audio child. */ });
  const retirement = ancestor.disposeSteps();
  try {
    whenControl(level, live, warm); expect(warm).toHaveBeenCalledOnce();
    expect(retirement.next().done).toBe(false); expect(child.disposed).toBe(false);
    whenControl(level, child, stale); expect(stale).not.toHaveBeenCalled();
  } finally { for (const _step of retirement) { /* Finish the existing cleanup. */ } live.dispose(); level.dispose(); }
});

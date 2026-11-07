import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import * as clock from '@wildshard/engine/core/clock';
import * as framePacing from '@wildshard/engine/core/framePacing';
import { regionalBuildCheckpoint } from './regionalBuildCheckpoint';

afterEach(() => { vi.restoreAllMocks(); });

test('cheap stages share one CPU slice; spent stages keep the original injected pause', async () => {
  expect(framePacing.presenting()).toBe(false);
  let now = 0;
  vi.spyOn(clock, 'diagnosticNow').mockImplementation(() => now);
  const owner = new Scope('foundation-budget'), pause = vi.fn(() => Promise.resolve());
  const checkpoint = regionalBuildCheckpoint(owner, pause);
  try {
    for (let stage = 0; stage < 5; stage++) { now++; await checkpoint(); }
    expect(pause).not.toHaveBeenCalled();
    now = 8; await checkpoint(); expect(pause).toHaveBeenCalledTimes(1);
    now = 9; await checkpoint(); expect(pause).toHaveBeenCalledTimes(1);
    now = 16; await checkpoint(); expect(pause).toHaveBeenCalledTimes(2);
  } finally { owner.dispose(); }
});

test('retirement refuses even a cheap checkpoint without calling its pause', async () => {
  vi.spyOn(clock, 'diagnosticNow').mockReturnValue(0);
  const owner = new Scope('foundation-retired'), pause = vi.fn(() => Promise.resolve());
  const checkpoint = regionalBuildCheckpoint(owner, pause); owner.dispose();
  await expect(checkpoint()).rejects.toThrow('left during foundation');
  expect(pause).not.toHaveBeenCalled();
});

test('a spent stage drains its injected pause and refuses a retired owner before continuation', async () => {
  let now = 0, finish = (): void => undefined;
  vi.spyOn(clock, 'diagnosticNow').mockImplementation(() => now);
  const owner = new Scope('foundation-retired-during-pause');
  const pause = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const checkpoint = regionalBuildCheckpoint(owner, pause); now = 8;
  const pending = checkpoint(), refused = expect(pending).rejects.toThrow('left during foundation');
  expect(pause).toHaveBeenCalledTimes(1); owner.dispose(); finish(); await refused;
});

test('an injected pause error propagates without a second attempt', async () => {
  let now = 0;
  vi.spyOn(clock, 'diagnosticNow').mockImplementation(() => now);
  const owner = new Scope('foundation-refused'), error = new Error('original pause refusal');
  const pause = vi.fn(() => Promise.reject(error)), checkpoint = regionalBuildCheckpoint(owner, pause); now = 8;
  try { await expect(checkpoint()).rejects.toBe(error); expect(pause).toHaveBeenCalledTimes(1); }
  finally { owner.dispose(); }
});


test('a spent shared frame yields even when this builder has spent no local time', async () => {
  vi.spyOn(clock, 'diagnosticNow').mockReturnValue(0);
  vi.spyOn(framePacing, 'presenting').mockReturnValue(true);
  vi.spyOn(framePacing, 'frameBudgetSpent').mockReturnValue(true);
  const owner = new Scope('foundation-shared-budget'), pause = vi.fn(() => Promise.resolve());
  const checkpoint = regionalBuildCheckpoint(owner, pause);
  try { await checkpoint(); expect(pause).toHaveBeenCalledTimes(1); }
  finally { owner.dispose(); }
});

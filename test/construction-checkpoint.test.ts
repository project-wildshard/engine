import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import * as clock from '../src/shared/engine/core/clock';
import * as pacing from '../src/shared/engine/core/framePacing';
import * as work from '../src/shared/engine/core/workSlice';
import { constructionCheckpoint } from '../src/client/game/shardfile/constructionCheckpoint';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
beforeEach(() => {
  vi.spyOn(pacing, 'buildHeld').mockReturnValue(false);
  vi.spyOn(pacing, 'frameDue').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
  else Object.defineProperty(globalThis, 'document', originalDocument);
});

test('cheap live completions stay synchronous and check the shared budget at every row', async () => {
  const owner = new Scope('checkpoint'), turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  const spent = vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(false);
  try {
    const events: string[] = [];
    void Promise.resolve().then(() => { events.push('other microtask'); return undefined; });
    for (let i = 0; i < 3; i++) {
      const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
      events.push(String(i));
    }
    expect(events).toEqual(['0', '1', '2']);
    expect(turn).not.toHaveBeenCalled();
    expect(spent.mock.calls).toEqual([[work.WORK_SLICE_MS], [work.WORK_SLICE_MS], [work.WORK_SLICE_MS]]);
    spent.mockReturnValue(true);
    await constructionCheckpoint(owner);
    expect(turn).toHaveBeenCalledExactlyOnceWith(owner);
    expect(events).toEqual(['0', '1', '2', 'other microtask']);
  } finally { owner.dispose(); }
});

test('Node keeps the original turn even with an unspent CPU clock', async () => {
  const owner = new Scope('checkpoint-loading');
  vi.spyOn(pacing, 'presenting').mockReturnValue(false);
  const spent = vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(false);
  const turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  try {
    const pause = constructionCheckpoint(owner); expect(pause).toBeInstanceOf(Promise);
    await pause;
    expect(turn).toHaveBeenCalledExactlyOnceWith(owner);
    expect(spent).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});

test('retirement during a spent-budget turn refuses the continuation', async () => {
  const owner = new Scope('checkpoint-retire'); let release = (): void => undefined;
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(true);
  vi.spyOn(work, 'buildYield').mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  const pending = constructionCheckpoint(owner); owner.dispose(); release();
  await expect(pending).rejects.toThrow('scope has closed');
  expect(() => constructionCheckpoint(owner)).toThrow('scope has closed');
});

test('a retiring owner refuses before any checkpoint task is started', () => {
  const owner = new Scope('checkpoint-disposing'), turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  owner.onDispose(() => { expect(() => constructionCheckpoint(owner)).toThrow('scope has closed'); });
  owner.dispose(); expect(turn).not.toHaveBeenCalled();
});

test('the original budget turn failure propagates without an extra task', async () => {
  const owner = new Scope('checkpoint-failure'), failure = new Error('original frame failure');
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(true);
  const turn = vi.spyOn(work, 'buildYield').mockRejectedValue(failure);
  try { await expect(constructionCheckpoint(owner)).rejects.toBe(failure); expect(turn).toHaveBeenCalledOnce(); }
  finally { owner.dispose(); }
});


test('an unheld due frame yields even when an overrun leaves CPU budget', async () => {
  const owner = new Scope('checkpoint-due');
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  vi.spyOn(pacing, 'frameDue').mockReturnValue(true);
  const spent = vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(false);
  const turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  try {
    await constructionCheckpoint(owner);
    expect(turn).toHaveBeenCalledExactlyOnceWith(owner);
    expect(spent).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});

test('held completion uses the shared held budget instead of ordinary frame due', () => {
  const owner = new Scope('checkpoint-held');
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  vi.spyOn(pacing, 'buildHeld').mockReturnValue(true);
  const due = vi.spyOn(pacing, 'frameDue').mockReturnValue(true);
  const spent = vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(false);
  const turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  try {
    expect(constructionCheckpoint(owner)).toBeUndefined();
    expect(spent).toHaveBeenCalledExactlyOnceWith(work.WORK_SLICE_MS);
    expect(due).not.toHaveBeenCalled();
    expect(turn).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});


function loading() {
  const owner = new Scope('loading-browser');
  let now = 0;
  Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: {}});
  vi.spyOn(clock, 'diagnosticNow').mockImplementation(() => now);
  const live = vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  const spent = vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(false);
  const turn = vi.spyOn(work, 'buildYield').mockResolvedValue();
  // Start a new loading interval through the real live-to-loading boundary.
  expect(constructionCheckpoint(owner)).toBeUndefined(); live.mockReturnValue(false);
  return { owner, live, spent, turn, at: (value: number) => { now = value; } };
}

test('loading completions batch within 50ms and yield twenty times per work second', async () => {
  const f = loading();
  try {
    for (let ms = 0; ms <= 1000; ms++) {
      f.at(ms); const pause = constructionCheckpoint(f.owner);
      if (pause !== undefined) await pause;
      expect(f.turn).toHaveBeenCalledTimes(Math.floor(ms / 50));
    }
    expect(f.spent).toHaveBeenCalledOnce(); // Only the initial live control consults frame budget.
    expect(f.turn.mock.calls.every(([owner]) => owner === f.owner)).toBe(true);
  } finally { f.owner.dispose(); }
});

test('parallel loading owners share one slice instead of accumulating independent 50ms stretches', async () => {
  const f = loading(), other = new Scope('other-loading-owner');
  try {
    expect(constructionCheckpoint(f.owner)).toBeUndefined();
    f.at(30); expect(constructionCheckpoint(other)).toBeUndefined();
    f.at(50); await constructionCheckpoint(other);
    expect(f.turn).toHaveBeenCalledExactlyOnceWith(other);
    f.at(70); expect(constructionCheckpoint(f.owner)).toBeUndefined();
    f.at(100); await constructionCheckpoint(f.owner);
    expect(f.turn).toHaveBeenCalledTimes(2);
  } finally { f.owner.dispose(); other.dispose(); }
});

test('returning to live rendering immediately restores its original shared frame fence', async () => {
  const f = loading();
  try {
    expect(constructionCheckpoint(f.owner)).toBeUndefined();
    f.at(1); f.live.mockReturnValue(true); f.spent.mockReturnValue(true);
    await constructionCheckpoint(f.owner);
    expect(f.turn).toHaveBeenCalledExactlyOnceWith(f.owner);
    expect(f.spent).toHaveBeenLastCalledWith(work.WORK_SLICE_MS);
  } finally { f.owner.dispose(); }
});

test('loading retirement during a batched turn preserves the original continuation refusal', async () => {
  const f = loading(); let resume = (): void => undefined;
  try {
    expect(constructionCheckpoint(f.owner)).toBeUndefined();
    f.at(50); f.turn.mockReturnValue(new Promise<void>(resolve => { resume = resolve; }));
    const pending = constructionCheckpoint(f.owner);
    f.owner.dispose(); resume();
    await expect(pending).rejects.toThrow('scope has closed');
    expect(() => constructionCheckpoint(f.owner)).toThrow('scope has closed');
  } finally { f.owner.dispose(); }
});

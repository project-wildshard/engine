import {afterEach, expect, test, vi} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {controlIdle, idleTurn, type IdleQueue} from './idle';
import {reachControl} from './prefetch';

afterEach(() => {vi.useRealTimers();});

function fixture(): {queue: IdleQueue; pending: Map<number, () => void>; cancelled: number[]; deliver: () => void} {
  let serial = 0;
  const pending = new Map<number, () => void>(), cancelled: number[] = [];
  return {pending, cancelled, queue: {
    request: run => {const id = ++serial; pending.set(id, run); return id;},
    cancel: id => {cancelled.push(id); pending.delete(id);},
  }, deliver: () => {const first = pending.entries().next().value; if (first === undefined) throw new Error('No idle callback'); pending.delete(first[0]); first[1]();}};
}

test('background work waits for both native control and its own idle opportunity', async () => {
  const owner = new Scope('idle-control'), f = fixture(); let done = false;
  try {
    const ready = controlIdle(owner, f.queue).then(live => {done = live; return live;});
    expect(f.pending.size).toBe(0); expect(done).toBe(false);
    reachControl(owner); reachControl(owner);
    expect(f.pending.size).toBe(1); expect(done).toBe(false);
    f.deliver(); expect(await ready).toBe(true); expect(done).toBe(true);
    expect(f.pending.size).toBe(0);
  } finally {owner.dispose();}
});

test('an already controlled level still yields to idle', async () => {
  const owner = new Scope('idle-live'), f = fixture(); reachControl(owner);
  try {
    const ready = controlIdle(owner, f.queue); expect(f.pending.size).toBe(1);
    f.deliver(); expect(await ready).toBe(true);
  } finally {owner.dispose();}
});

test('retirement before control never queues idle work', async () => {
  const owner = new Scope('idle-retired'), f = fixture(), ready = controlIdle(owner, f.queue);
  owner.dispose(); reachControl(owner);
  expect(await ready).toBe(false); expect(f.pending.size).toBe(0);
});

test('retirement cancels native idle work and a late delivery stays retired', async () => {
  const owner = new Scope('idle-cancel'), f = fixture(), ready = idleTurn(owner, f.queue);
  const late = f.pending.values().next().value;
  if (late === undefined) throw new Error('Missing queued idle callback');
  owner.dispose(); expect(await ready).toBe(false); expect(f.cancelled).toEqual([1]);
  late(); expect(f.pending.size).toBe(0); expect(f.cancelled).toEqual([1]);
});

test('hosts without idle callbacks use the existing 50 ms opportunity', async () => {
  vi.useFakeTimers(); const owner = new Scope('idle-fallback'); let done = false;
  try {
    const ready = idleTurn(owner, null).then(live => {done = live; return live;});
    await vi.advanceTimersByTimeAsync(49); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {owner.dispose();}
});

test('fallback retirement cancels its timer and settles without work', async () => {
  vi.useFakeTimers(); const owner = new Scope('idle-fallback-cancel');
  const ready = idleTurn(owner, null); owner.dispose();
  expect(await ready).toBe(false); await vi.advanceTimersByTimeAsync(50);
  expect(vi.getTimerCount()).toBe(0);
});

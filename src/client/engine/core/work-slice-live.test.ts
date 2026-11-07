import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { buildYield, workSlice } from '../../../shared/engine/core/workSlice';
import { slicer } from '../boot/plan';

const environment = scopeEnvironment(), channel = globalThis.MessageChannel, raf = globalThis.requestAnimationFrame;
let now = 1000;
beforeEach(() => {
  vi.useFakeTimers(); now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  noteFrameDrawn(Number.NEGATIVE_INFINITY); setBuildHeld(false);
});
afterEach(() => {
  installScopeEnvironment(environment); noteFrameDrawn(Number.NEGATIVE_INFINITY); setBuildHeld(false);
  Reflect.set(globalThis, 'MessageChannel', channel);
  if (raf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  else Reflect.set(globalThis, 'requestAnimationFrame', raf);
  vi.restoreAllMocks(); vi.useRealTimers();
});
const microtasks = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function messages(): { readonly queue: (() => void)[]; readonly closed: (() => boolean)[] } {
  const queue: (() => void)[] = [], closed: (() => boolean)[] = [];
  class Port extends EventTarget {
    stopped = false;
    onmessage: (() => void) | null = null;
    start(): void { /* Explicit test delivery. */ }
    close(): void { this.stopped = true; }
  }
  Reflect.set(globalThis, 'MessageChannel', class {
    readonly port1 = new Port();
    private secondClosed = false;
    readonly port2 = { close: (): void => { this.secondClosed = true; }, postMessage: (): void => {
      queue.push(() => { if (!this.port1.stopped) { this.port1.dispatchEvent(new Event('message')); this.port1.onmessage?.(); } });
    } };
    constructor() { closed.push(() => this.port1.stopped && this.secondClosed); }
  });
  return { queue, closed };
}

test.each([false, true])('a read spanning draws does not spend the next CPU slice (held %s)', held => {
  const owner = new Scope('read-spanning-frames'), slice = workSlice(8, owner);
  try {
    now = 1100; noteFrameDrawn(now, now, 30); setBuildHeld(held); now++;
    expect(slice.due()).toBe(false);
    now = held ? 1135 : 1108;
    expect(slice.due()).toBe(true);
    noteFrameDrawn(now, now, 30); now++;
    expect(slice.due()).toBe(false);
  } finally { owner.dispose(); }
});

test('an explicit cheap live yield is a scoped task without a nested timer', async () => {
  const turns = messages(), owner = new Scope('cheap-live-turn'), before = owner.census;
  now = 1100; noteFrameDrawn(now, now, 30); now++;
  let advanced = false;
  try {
    const pending = workSlice(8, owner).yield().then(() => { advanced = true; return undefined; });
    await microtasks(); expect(advanced).toBe(false); expect(turns.queue).toHaveLength(1);
    expect(owner.census.timers).toBe(0);
    turns.queue.shift()?.(); await pending;
    expect(advanced).toBe(true); expect(owner.census).toEqual(before);
    expect(turns.closed.every(read => read())).toBe(true);
  } finally { owner.dispose(); }
});

test('another builder spending the frame before task delivery retains the completed-draw fence', async () => {
  const turns = messages(), owner = new Scope('delayed-live-turn'), frames: FrameRequestCallback[] = [];
  Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  installScopeEnvironment({ ...environment, frame: frame => { frames.push(frame); return frames.length; }, cancelFrame: () => undefined });
  now = 1100; noteFrameDrawn(now, now, 30); now++;
  let advanced = false;
  try {
    const pending = workSlice(8, owner).yield().then(() => { advanced = true; return undefined; });
    now = 1110; turns.queue.shift()?.(); await microtasks();
    expect(advanced).toBe(false); expect(frames).toHaveLength(1);
    now = 1134; noteFrameDrawn(now, now, 30); frames.shift()?.(now); await microtasks();
    expect(advanced).toBe(false); turns.queue.shift()?.(); await pending;
    expect(advanced).toBe(true); expect(turns.closed.every(read => read())).toBe(true);
  } finally { owner.dispose(); }
});

test('loading retains its local elapsed slice and timer turn', async () => {
  const turns = messages(), owner = new Scope('loading-local-slice'), slice = workSlice(8, owner);
  try {
    now += 9; expect(slice.due()).toBe(true);
    const pending = slice.yield(); expect(turns.queue).toHaveLength(0); expect(owner.census.timers).toBe(1);
    await vi.advanceTimersByTimeAsync(1); await pending; expect(slice.due()).toBe(false);
  } finally { owner.dispose(); }
});

test('retirement before message delivery closes both ports and refuses continuation', async () => {
  const turns = messages(), owner = new Scope('retired-live-slice');
  now = 1100; noteFrameDrawn(now, now, 30); now++;
  const pending = workSlice(8, owner).yield(), refused = expect(pending).rejects.toThrow('scope has closed');
  owner.dispose(); turns.queue.shift()?.(); await refused;
  expect(turns.closed.every(read => read())).toBe(true);
});

test.each(['slice', 'build'])("%s cannot resume during its ancestor's sliced retirement", async mode => {
  const turns = messages(), parent = new Scope('retiring-parent'), owner = parent.child('pending-builder');
  now = 1100; noteFrameDrawn(now, now, 30); now++;
  const pending = mode === 'slice' ? workSlice(8, owner).yield() : buildYield(owner);
  const refused = expect(pending).rejects.toThrow('scope has closed');
  parent.onDispose(() => undefined); const retirement = parent.disposeSteps(); retirement.next();
  try {
    expect(owner.disposed).toBe(false); expect(owner.disposing).toBe(true);
    turns.queue.shift()?.(); await refused;
    const next = mode === 'slice' ? workSlice(8, owner).yield() : buildYield(owner);
    await expect(next).rejects.toThrow('scope has closed');
    expect(turns.closed.every(read => read())).toBe(true); expect(turns.queue).toHaveLength(0);
  } finally { for (const _step of retirement) { /* Complete the original retirement. */ } }
});

test.each([false, true])('step slicers share the current live CPU budget after reads (held %s)', held => {
  const turns = messages(), slice = slicer(30);
  now = 1100; noteFrameDrawn(now, now, 30); setBuildHeld(held); now++;
  expect(slice.due()).toBeNull(); expect(turns.queue).toHaveLength(0);
});

test('loading step slicers retain their declared local budget and close both task ports', async () => {
  const turns = messages(), slice = slicer(30);
  now += 9; expect(slice.due()).toBeNull();
  now += 22; const pending = slice.due(); expect(pending).not.toBeNull(); expect(turns.queue).toHaveLength(1);
  turns.queue.shift()?.(); await pending;
  expect(turns.closed.every(read => read())).toBe(true); expect(slice.due()).toBeNull();
});

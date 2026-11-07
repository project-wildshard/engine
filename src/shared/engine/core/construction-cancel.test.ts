import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../app/scopeEnvironment';
import { nextDrawnFrame, noteFrameDrawn, setBuildHeld } from './framePacing';
import { buildYield, workSlice, yieldTask } from './workSlice';

const environment = scopeEnvironment(), animationFrame = globalThis.requestAnimationFrame;
const messageChannel = globalThis.MessageChannel;
let now = 1000;
beforeEach(() => {
  now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  noteFrameDrawn(Number.NEGATIVE_INFINITY); setBuildHeld(false);
});
afterEach(() => {
  installScopeEnvironment(environment); vi.restoreAllMocks();
  noteFrameDrawn(Number.NEGATIVE_INFINITY); setBuildHeld(false);
  if (animationFrame === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  else Reflect.set(globalThis, 'requestAnimationFrame', animationFrame);
  Reflect.set(globalThis, 'MessageChannel', messageChannel);
});
const microtasks = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function pendingFrame(): { frames: ((at: number) => void)[]; cancelled: number[] } {
  const frames: ((at: number) => void)[] = [], cancelled: number[] = [];
  Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  Reflect.set(globalThis, 'MessageChannel', undefined);
  installScopeEnvironment({ ...environment,
    frame: render => { frames.push(render); return frames.length; },
    cancelFrame: id => { cancelled.push(id); } });
  now = 1035; noteFrameDrawn(1000, 1000, 30);
  return { frames, cancelled };
}

test('G723: retiring an owner settles its queued timer task', async () => {
  const owner = new Scope('cancelled-build-task'); let settled = false;
  const pending = (async () => { await yieldTask(owner); settled = true; })();
  owner.dispose(); await microtasks();
  expect(settled).toBe(true); await pending;
});

test('G723: a previously closed owner needs no timer to settle a task', async () => {
  const owner = new Scope('already-closed-build-task'); owner.dispose(); let settled = false;
  const pending = (async () => { await yieldTask(owner); settled = true; })();
  await microtasks(); expect(settled).toBe(true); await pending;
});

test('G723: retiring an owner settles a drawn-frame wait and cancels its frame', async () => {
  const { frames, cancelled } = pendingFrame(), owner = new Scope('cancelled-build-frame'); let settled = false;
  const pending = (async () => { await nextDrawnFrame(owner); settled = true; })();
  expect(frames).toHaveLength(1);
  owner.dispose(); await microtasks();
  expect(cancelled).toEqual([1]); expect(settled).toBe(true); await pending;
});

test.each(['timer', 'frame'])('G723: buildYield reaches its cancellation fence after %s retirement', async mode => {
  if (mode === 'frame') pendingFrame();
  const owner = new Scope(`cancelled-build-${mode}`); let result = 'pending';
  const pending = (async () => {
    try { await buildYield(owner); result = 'advanced'; } catch (error) { result = String(error); }
  })();
  owner.dispose(); await microtasks();
  expect(result).toContain('scope has closed'); expect(result).not.toBe('advanced'); await pending;
});

test('G723: a work slice cannot advance native work after its owner retires', async () => {
  const owner = new Scope('cancelled-work-slice'); let result = 'pending';
  const pending = (async () => {
    try { await workSlice(8, owner).yield(); result = 'advanced'; } catch (error) { result = String(error); }
  })();
  owner.dispose(); await microtasks();
  expect(result).toContain('scope has closed'); expect(result).not.toBe('advanced'); await pending;
});

test('completed task and frame waits forget their disposal callbacks', async () => {
  const owner = new Scope('completed-build-waits'), before = owner.census;
  try {
    await yieldTask(owner); expect(owner.census).toEqual(before);
    const { frames } = pendingFrame(), pending = nextDrawnFrame(owner);
    now = 1068; noteFrameDrawn(now, 1066, 30);
    for (const frame of frames) frame(now);
    await pending; expect(owner.census).toEqual(before);
  } finally { owner.dispose(); }
});

test('G723: sliced retirement also settles a pending construction task', async () => {
  const owner = new Scope('sliced-cancelled-build'); let settled = false;
  const pending = (async () => { await yieldTask(owner); settled = true; })();
  for (const _step of owner.disposeSteps()) { /* Same lifetime completion as whole retirement. */ }
  await microtasks(); expect(settled).toBe(true); await pending;
});


test('a missing animation frame still settles at the existing 100ms cap', async () => {
  vi.useFakeTimers();
  const { frames, cancelled } = pendingFrame(), owner = new Scope('suspended-build-frame'), before = owner.census;
  let settled = false;
  try {
    const pending = nextDrawnFrame(owner).then(() => { settled = true; return undefined; });
    expect(frames).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(99); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await pending;
    expect(settled).toBe(true); expect(cancelled).toEqual([1]); expect(owner.census).toEqual(before);
    for (const frame of frames) frame(now);
    await microtasks(); expect(owner.census).toEqual(before);
  } finally { owner.dispose(); vi.useRealTimers(); }
});

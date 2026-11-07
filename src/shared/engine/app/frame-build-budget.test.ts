import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from './scope';
import { installScopeEnvironment, scopeEnvironment } from './scopeEnvironment';
import { frameBudgetSpent, nativeBudgetSpent, noteFrameDrawn, paceYield, setBuildHeld } from '../core/framePacing';

const environment = scopeEnvironment();
const messageChannel = globalThis.MessageChannel, animationFrame = globalThis.requestAnimationFrame;
let now = 1000;
beforeEach(() => { vi.spyOn(performance, 'now').mockImplementation(() => now); });
afterEach(() => {
  installScopeEnvironment(environment); setBuildHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY);
  vi.restoreAllMocks();
  Reflect.set(globalThis, 'MessageChannel', messageChannel); Reflect.set(globalThis, 'requestAnimationFrame', animationFrame);
});

test('busy draws retain the ordinary allowance until the actual frame deadline', () => {
  noteFrameDrawn(1028, 1000, 30);
  expect(frameBudgetSpent(8, 1029)).toBe(false);
  expect(frameBudgetSpent(8, 1030)).toBe(false);
  expect(frameBudgetSpent(8, 1031.4)).toBe(true);
  noteFrameDrawn(1020, 1000, 30);
  expect(frameBudgetSpent(8, 1027.9)).toBe(false);
  expect(frameBudgetSpent(8, 1028)).toBe(true);
  noteFrameDrawn(1004, 1000, 60);
  expect(frameBudgetSpent(8, 1008)).toBe(false);
  expect(frameBudgetSpent(8, 1008.2)).toBe(true);
  // A caller's tighter budget still wins; a held traveller's CPU slices run to the 30 fps held floor from the frame's start
  // (G782: 1000 + 33.3 less 2 ms slack) and its native GPU units retain their 24 ms allowance.
  expect(frameBudgetSpent(1, 1005)).toBe(true);
  setBuildHeld(true);
  expect(frameBudgetSpent(8, 1031)).toBe(false);
  expect(frameBudgetSpent(8, 1031.4)).toBe(true);
  expect(nativeBudgetSpent(8, 1027)).toBe(false);
  expect(nativeBudgetSpent(8, 1028)).toBe(true);
});

test('a frame that overran its interval still admits the ordinary slice after it is drawn (D110)', () => {
  // 30 fps cap, a 60 ms frame (4x CPU): due the moment it lands, yet a build may start right after it
  noteFrameDrawn(1060, 1000, 30);
  expect(frameBudgetSpent(8, 1060.5)).toBe(false);
  expect(frameBudgetSpent(8, 1067.9)).toBe(false);
  expect(frameBudgetSpent(8, 1068)).toBe(true);
  // a frame within its interval keeps the due rule
  noteFrameDrawn(1090, 1060, 30);
  expect(frameBudgetSpent(8, 1091.4)).toBe(true);
});

test('queued continuations recheck the shared budget after their task wakes', async () => {
  Reflect.set(globalThis, 'MessageChannel', undefined); Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  const frames: ((time: number) => void)[] = [];
  installScopeEnvironment({ ...environment, frame: render => { frames.push(render); return frames.length; }, cancelFrame: () => undefined });
  const owner = new Scope('queued-build');
  let wake: () => void = () => { throw new Error('No queued task'); };
  const turn = new Promise<void>(resolve => { wake = resolve; });
  now = 1028; noteFrameDrawn(now, 1000, 30);
  let continued = false;
  const pending = paceYield(() => turn, owner, 8).then(() => { continued = true; return undefined; });
  // Another builder consumes the remaining deadline while this message/timer is queued.
  now = 1032; wake();
  await Promise.resolve(); await Promise.resolve();
  expect(continued).toBe(false); expect(frames).toHaveLength(1);
  now = 1061; noteFrameDrawn(now, 1033, 30);
  for (const render of frames.splice(0)) render(now);
  await pending;
  expect(continued).toBe(true); owner.dispose();
});

test('loading turns retain their original promise and cheap live turns need no drawn frame', async () => {
  noteFrameDrawn(Number.NEGATIVE_INFINITY);
  const turn = Promise.resolve();
  expect(paceYield(() => turn, undefined, 8)).toBe(turn);
  now = 1004; noteFrameDrawn(now, 1000, 60);
  await paceYield(() => turn, undefined, 8);
});

test('a closed owner can reach its caller cancellation fence without scheduling another frame', async () => {
  const owner = new Scope('retired-queued-build');
  let wake: () => void = () => { throw new Error('No queued task'); };
  const turn = new Promise<void>(resolve => { wake = resolve; });
  now = 1028; noteFrameDrawn(now, 1000, 30);
  const pending = paceYield(() => turn, owner, 8);
  owner.dispose(); now = 1040; wake();
  await pending;
});

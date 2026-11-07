// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRigLoader } from './rigParser';
import { bootWaits } from '../../../shared/engine/boot/waits';
import { pageScope } from '../../../shared/engine/app/resources';
import * as pacing from '../../../shared/engine/core/framePacing';
import * as slices from '../../../shared/engine/core/workSlice';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  vi.restoreAllMocks();
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', previousWindow);
});
const empty = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] });

function liveBudget(held: boolean, due: boolean, spent: boolean): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  vi.spyOn(pacing, 'presenting').mockReturnValue(true);
  vi.spyOn(pacing, 'buildHeld').mockReturnValue(held);
  vi.spyOn(pacing, 'frameDue').mockReturnValue(due);
  vi.spyOn(pacing, 'frameBudgetSpent').mockReturnValue(spent);
}

test.each(['cheap', 'held', 'spent', 'due'] as const)('a %s live decode checks the current budget before its original serial parse', async mode => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader();
  const needsDraw = mode === 'spent' || mode === 'due';
  liveBudget(mode === 'held' || mode === 'spent', mode === 'held' || mode === 'due', mode === 'spent');
  const stale = vi.fn(() => Promise.reject(new Error('The stale local clock must not pace a live decode')));
  const local = vi.spyOn(slices, 'workSlice').mockReturnValue({ check: stale, due: () => true, yield: stale });
  let release = (): void => undefined;
  const draw = new Promise<void>(resolve => { release = resolve; });
  const turn = vi.spyOn(slices, 'buildYield').mockReturnValue(draw);
  const parse = vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, _path, onLoad) => { onLoad(file); });
  const pending = loader.parseAsync(empty, '/live/');
  try {
    if (needsDraw) {
      await vi.waitFor(() => { expect(turn).toHaveBeenCalledExactlyOnceWith(pageScope); });
      expect(parse).not.toHaveBeenCalled();
      expect(bootWaits().filter(wait => wait.label.startsWith('GLTF ')).map(wait => wait.label)).toEqual(['GLTF decode pacing']);
      release();
    }
    expect(await pending).toBe(file);
    expect(parse).toHaveBeenCalledOnce();
    expect(local).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    if (!needsDraw) expect(turn).not.toHaveBeenCalled();
    expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
  } finally { release(); await Promise.allSettled([pending]); }
});

test('a refused live frame releases the serial slot and preserves the original error', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader(), failure = new Error('original live frame refusal');
  liveBudget(true, true, true);
  const spent = vi.mocked(pacing.frameBudgetSpent);
  const turn = vi.spyOn(slices, 'buildYield').mockImplementation(() => { spent.mockReturnValue(false); return Promise.reject(failure); });
  const paths: string[] = [];
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, path, onLoad) => { paths.push(path); onLoad(file); });
  const first = loader.parseAsync(empty, '/refused/'), next = loader.parseAsync(empty, '/next/');
  await expect(first).rejects.toBe(failure);
  expect(await next).toBe(file);
  expect(turn).toHaveBeenCalledExactlyOnceWith(pageScope);
  expect(paths).toEqual(['/next/']);
  expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
});

test('loading retains the original local slice and native parser result', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  vi.spyOn(pacing, 'presenting').mockReturnValue(false);
  const turn = vi.spyOn(slices, 'buildYield').mockResolvedValue();
  const check = vi.fn(() => Promise.resolve());
  const local = vi.spyOn(slices, 'workSlice').mockReturnValue({ check, due: () => true, yield: check });
  const parse = vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, _path, onLoad) => { onLoad(file); });
  expect(await loader.parseAsync(empty, '/loading/')).toBe(file);
  expect(local).toHaveBeenCalledExactlyOnceWith(undefined, pageScope);
  expect(check).toHaveBeenCalledOnce();
  expect(turn).not.toHaveBeenCalled();
  expect(parse).toHaveBeenCalledOnce();
});

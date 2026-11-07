import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { recordProgressClip, type ProgressClipCamera } from '../scripts/progress-recording.mjs';

const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
const stream = { getTracks: () => tracks };
const capture = vi.fn(() => stream), start = vi.fn(), stop = vi.fn();
const query = vi.fn((): { captureStream: typeof capture } | null => ({ captureStream: capture }));
const raf = vi.fn<typeof requestAnimationFrame>();
let constructorFails = false, startFails = false, stopFails = false;
let options: MediaRecorderOptions | undefined;
let blobs: Blob[];
let restoreUrl: () => void;
const original = new Map<string, PropertyDescriptor | undefined>();
class Recorder {
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor(recorded: typeof stream, provided: MediaRecorderOptions) {
    expect(recorded).toBe(stream); options = provided;
    if (constructorFails) throw new Error('constructor refused');
  }
  start(timeslice: number): void {
    start(timeslice);
    if (startFails) throw new Error('start refused');
    this.ondataavailable?.({ data: new Blob([new Uint8Array([0, 128])]) });
  }
  stop(): void {
    stop();
    if (stopFails) throw new Error('stop refused');
    this.ondataavailable?.({ data: new Blob([new Uint8Array([255, 1])]) });
    if (this.onstop === null) throw new Error('Stop listener must be installed first');
    this.onstop();
  }
}
const camera: ProgressClipCamera = { secs: 0.25, center: [10, 20, 30], radius: 2, height: 3, startDeg: 0, sweepDeg: 180 };
const windowState: { __prog?: { pos: readonly number[]; look: readonly number[]; fov: number } } = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  constructorFails = false; startFails = false; stopFails = false; options = undefined; blobs = [];
  delete windowState.__prog;
  capture.mockClear(); start.mockClear(); stop.mockClear(); raf.mockReset().mockReturnValue(1);
  query.mockReset().mockReturnValue({ captureStream: capture });
  for (const track of tracks) track.stop.mockClear();
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('Expected video Blob');
    blobs.push(blob); return 'blob:owned-progress';
  });
  restoreUrl = () => { create.mockRestore(); };
  for (const [name, value] of Object.entries({ window: windowState, document: { querySelector: query }, MediaRecorder: Recorder, requestAnimationFrame: raf })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});
afterEach(() => {
  restoreUrl();
  for (const [name, descriptor] of original) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, descriptor);
  }
  original.clear(); vi.useRealTimers();
});

test('retains original capture settings, orbit equation, native bytes and default FOV', async () => {
  const recorded = recordProgressClip(camera);
  expect(capture).toHaveBeenCalledExactlyOnceWith(30);
  expect(options).toEqual({ mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8_000_000 });
  expect(start).toHaveBeenCalledExactlyOnceWith(250);
  expect(windowState.__prog).toEqual({ pos: [10, 23, 32], look: camera.center, fov: 60 });
  await vi.advanceTimersByTimeAsync(125);
  const next = raf.mock.calls[0]?.[0]; if (next === undefined) throw new Error('Missing orbit frame');
  next(125);
  expect(windowState.__prog).toEqual({ pos: [12, 23, 30], look: camera.center, fov: 60 });
  await vi.advanceTimersByTimeAsync(125);
  await expect(recorded).resolves.toEqual({ url: 'blob:owned-progress', bytes: 4 });
  expect(stop).toHaveBeenCalledOnce(); for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  const blob = blobs[0]; if (blob === undefined) throw new Error('Missing native clip');
  expect(blob.type).toBe('video/webm');
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255, 1]));
});
test('retains an explicitly authored FOV', async () => {
  const recorded = recordProgressClip({ ...camera, fov: 85 });
  expect(windowState.__prog?.fov).toBe(85);
  await vi.advanceTimersByTimeAsync(250); await recorded;
});
test('missing canvas refuses before capture or URL allocation', async () => {
  query.mockReturnValue(null);
  await expect(recordProgressClip(camera)).rejects.toThrow('no canvas');
  expect(capture).not.toHaveBeenCalled(); expect(blobs).toHaveLength(0);
});
test.each(['constructor', 'start', 'stop'])('%s refusal stops every acquired track and creates no URL', async phase => {
  constructorFails = phase === 'constructor'; startFails = phase === 'start'; stopFails = phase === 'stop';
  const refusal = expect(recordProgressClip(camera)).rejects.toThrow(`${phase} refused`);
  await vi.advanceTimersByTimeAsync(250); await refusal;
  for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  expect(blobs).toHaveLength(0);
});

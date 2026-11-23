// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { onFault, type Fault } from '../../../shared/engine/core/faults';
import { jsonSlot } from '../saves/slots';
import { canvasHiddenBy, installWorldWatch, judgeWorldPixels, lookVerdict, worldWatchAsync, type WorldWatchHost } from './worldWatch';

/** n RGBA pixels of one colour */
const fill = (n: number, rgba: readonly [number, number, number, number]): number[] => Array.from({ length: n }, () => [...rgba]).flat();

test('SB48: a transparent copy (the page shows through) and a flat black one are not a drawn world; a lit one is', () => {
  expect(judgeWorldPixels(fill(400, [0, 0, 0, 0]))).toBe('transparent');
  expect(judgeWorldPixels(fill(400, [0, 0, 0, 255]))).toBe('black');
  expect(judgeWorldPixels(fill(400, [2, 3, 4, 255]))).toBe('black');
  // a dark but textured night: drawn
  const night = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? [2, 2, 6, 255] : [30, 34, 48, 255])).flat();
  expect(judgeWorldPixels(night)).toBe('drawn');
  // Driftwood's sky and sea
  expect(judgeWorldPixels(fill(400, [120, 190, 240, 255]))).toBe('drawn');
});

test('DF14: the watch reads in a worker unless the device slot turns it off', () => {
  const slot = jsonSlot('debug.worldWatchDrawCheck', 'device');
  try {
    slot.write(null); expect(worldWatchAsync()).toBe(true);
    slot.write(false); expect(worldWatchAsync()).toBe(false);
    slot.write(true); expect(worldWatchAsync()).toBe(true);
  } finally { slot.write(null); }
});

test('a canvas style that keeps the world off screen is named', () => {
  expect(canvasHiddenBy({ visibility: 'hidden', display: 'block', opacity: '1' })).toBe('visibility: hidden');
  expect(canvasHiddenBy({ visibility: 'visible', display: 'none', opacity: '1' })).toBe('display: none');
  expect(canvasHiddenBy({ visibility: 'visible', display: 'block', opacity: '0' })).toBe('opacity: 0');
  expect(canvasHiddenBy({ visibility: 'visible', display: 'block', opacity: '1' })).toBeNull();
});

const faults: Fault[] = [];
let off: (() => void) | undefined;
afterEach(() => { off?.(); faults.length = 0; vi.useRealTimers(); });

/** a host whose frames copy as `pixels` */
function host(pixels: () => number[], scope: Scope, canvas: HTMLCanvasElement = document.createElement('canvas')): WorldWatchHost {
  return {
    canvas, hold: false, scope, contextLost: () => false, playing: () => true, detail: () => ({ graphics: 'low' }),
    captureFrame: () => {
      const data = pixels(), c = { width: 10, height: 10, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(data) }) }) };
      return Promise.resolve(c as unknown as HTMLCanvasElement);
    },
  };
}

test('SB48: a world that stays transparent is reported, then gets the error card (never a silent black world)', async () => {
  vi.useFakeTimers();
  off = onFault((f) => { faults.push(f); });
  const scope = new Scope('test');
  document.body.append(document.createElement('canvas'));
  installWorldWatch(host(() => fill(100, [0, 0, 0, 0]), scope), [1, 2]);
  await vi.advanceTimersByTimeAsync(1100);
  expect(faults.map((f) => f.verdict)).toEqual(['retry']);
  expect(String(faults[0]?.error)).toContain('transparent');
  await vi.advanceTimersByTimeAsync(1100);
  expect(faults.map((f) => f.verdict)).toEqual(['retry', 'uncaught']);
  scope.dispose();
});

test('a drawn world reports nothing; a canvas left hidden is shown again and reported once', async () => {
  vi.useFakeTimers();
  off = onFault((f) => { faults.push(f); });
  const scope = new Scope('test'), canvas = document.createElement('canvas');
  document.body.append(canvas);
  installWorldWatch(host(() => fill(100, [120, 190, 240, 255]), scope, canvas), [1, 2]);
  await vi.advanceTimersByTimeAsync(2100);
  expect(faults).toEqual([]);
  scope.dispose();
  const hiddenScope = new Scope('hidden'), hidden = document.createElement('canvas');
  hidden.style.visibility = 'hidden'; document.body.append(hidden);
  installWorldWatch(host(() => fill(100, [120, 190, 240, 255]), hiddenScope, hidden), [1, 2]);
  await vi.advanceTimersByTimeAsync(1100);
  expect(hidden.style.visibility).toBe('visible');
  expect(faults.map((f) => f.verdict)).toEqual(['retry']);
  expect(String(faults[0]?.error)).toContain('visibility: hidden');
  await vi.advanceTimersByTimeAsync(1100);
  expect(faults.length).toBe(1);
  hiddenScope.dispose();
});

test('no look while the loop is held or play is not on screen', async () => {
  vi.useFakeTimers();
  off = onFault((f) => { faults.push(f); });
  const scope = new Scope('test');
  installWorldWatch({ ...host(() => fill(100, [0, 0, 0, 0]), scope), hold: true }, [1]);
  installWorldWatch({ ...host(() => fill(100, [0, 0, 0, 0]), scope), playing: () => false }, [1]);
  await vi.advanceTimersByTimeAsync(1100);
  expect(faults).toEqual([]);
  scope.dispose();
});

test('nightly 45158091056: a look judges a missing frame by the loop\'s own turns, not wall time', () => {
  expect(lookVerdict(3000, 180, 180)).toBe('undrawn'); // 60 fps of turns and no frame: the world cannot draw
  expect(lookVerdict(3000, 0, 0)).toBe('wait'); // the browser gave no animation frame (a screenshot copying the surface)
  expect(lookVerdict(30_000, 0, 0)).toBe('wait');
  expect(lookVerdict(3000, 2, 2)).toBe('wait'); // a slow SwiftShader turn is still drawing
  expect(lookVerdict(12_000, 400, 1)).toBe('wait');
  expect(lookVerdict(15_000, 400, 1)).toBe('undrawn'); // frames given for 15 s and the pacing let none draw
});

test('a loop given no animation frames is waited for; one that takes its turns and draws nothing is named', async () => {
  vi.useFakeTimers();
  off = onFault((f) => { faults.push(f); });
  const scope = new Scope('frozen'), sky = fill(100, [120, 190, 240, 255]);
  let given = 0, due = 0;
  const base = host(() => sky, scope);
  // the gameplay screenshot holds the compositor 7 s: no animation frame, then the next one draws
  const frozen: WorldWatchHost = { ...base, turns: () => ({ given, due }),
    captureFrame: (w) => new Promise((resolve) => { scope.timeout(7000, () => { given++; due++; void base.captureFrame(w).then(resolve); }); }) };
  installWorldWatch(frozen, [3]);
  await vi.advanceTimersByTimeAsync(3000 + 8000);
  expect(faults).toEqual([]);
  scope.dispose();
  // the loop is given frames and takes its turns, but no frame ever draws: named at the first slice
  const stuck = new Scope('stuck');
  given = 0; due = 0;
  stuck.interval(16, () => { given++; due++; });
  installWorldWatch({ ...host(() => sky, stuck), turns: () => ({ given, due }),
    captureFrame: () => new Promise<HTMLCanvasElement>(() => { /* the world never draws */ }) }, [3]);
  await vi.advanceTimersByTimeAsync(3000 + 2900);
  expect(faults).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  expect(faults.map((f) => String(f.error))).toEqual([expect.stringMatching(/^Error: World not drawn: no world frame drew in 3000 ms of play \(\d+ draw turns, \d+ animation frames\)$/u)]);
  stuck.dispose();
});

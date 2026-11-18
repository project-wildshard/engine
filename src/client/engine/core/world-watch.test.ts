// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { onFault, type Fault } from '../../../shared/engine/core/faults';
import { canvasHiddenBy, installWorldWatch, judgeWorldPixels, type WorldWatchHost } from './worldWatch';

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

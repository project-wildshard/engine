import { afterAll, afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { frameFailure } from '../src/scripts/parity/black-frame.mjs';
import type { Page } from 'playwright';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { nightlyCapturePixels, nightlyDrawSamples, NIGHTLY_FRAME_LIMIT, NIGHTLY_WALL_MS, observeNightlyFrames } from '../src/scripts/parity/nightly-frames.mjs';

const watchFrames = (draws: number) => observeNightlyFrames({draws, frames: NIGHTLY_FRAME_LIMIT, wallMs: NIGHTLY_WALL_MS});

function frames() {
  vi.useFakeTimers();
  const game = { frameCount: 5, lastFrame: { calls: 12 } };
  vi.stubGlobal('window', { __wildshard: { world: { game } } });
  let pending: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = undefined; });
  return (draws: number, calls: number): void => {
    const next = pending;
    if (next === undefined) throw new Error('No frame waiter');
    pending = undefined;
    game.frameCount += draws;
    game.lastFrame.calls = calls;
    next(performance.now());
  };
}

afterEach(() => { vi.useRealTimers(); });
afterAll(() => { vi.unstubAllGlobals(); });

test('collects 30 distinct draws after the event on a slower than 60-second runner', async () => {
  const frame = frames();
  const watch = watchFrames(30);
  frame(0, 12);
  for (let i = 0; i < 30; i++) {
    await vi.advanceTimersByTimeAsync(2100);
    frame(1, i + 1);
  }
  expect(await watch.result).toEqual({ error: null, samples: Array.from({ length: 30 }, (_, i) => i + 1) });
  expect(vi.getTimerCount()).toBe(0);
});

test('fails a capture past 120 rendered frames and stops a draw wait after 90 seconds', async () => {
  const frame = frames();
  const capture = watchFrames(0);
  frame(120, 1);
  frame(1, 1);
  expect(await capture.result).toMatchObject({ error: expect.stringContaining('120') });

  const stalled = watchFrames(30);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(await stalled.result).toMatchObject({ error: expect.stringContaining('90') });
  expect(vi.getTimerCount()).toBe(0);
});

test('enforces the wall ceiling when the page cannot start the observer', async () => {
  vi.useFakeTimers();
  const evaluateHandle = vi.fn<Page['evaluateHandle']>().mockReturnValue(new Promise(() => {
    // The renderer cannot reply.
  }));
  const page = legacyDouble<Page>({ evaluateHandle });
  const refused = expect(nightlyDrawSamples(page)).rejects.toThrow('Nightly frame proof exceeded 90 s');
  await vi.advanceTimersByTimeAsync(90_000);
  await refused;
  expect(vi.getTimerCount()).toBe(0);
});

test('samples the captured gameplay PNG off-page and refuses the same black frame', async () => {
  const pixels = (red: number) => sharp({
    create: { width: 390, height: 844, channels: 4, background: { r: red, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
  const black = await nightlyCapturePixels(await pixels(0));
  expect(black).toMatchObject({ width: 390, height: 844, darkShare: 1 });
  expect(frameFailure(black)).toBe('frame is at least 90% near-black');
  expect(frameFailure(await nightlyCapturePixels(await pixels(16)))).toBeNull();
});

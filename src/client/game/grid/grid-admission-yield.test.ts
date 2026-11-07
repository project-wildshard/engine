import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { yieldGridConstruction } from './admissionYield';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('on the loading screen construction pieces share a 12 ms slice, then take one paint boundary', async () => {
  vi.useFakeTimers();
  let now = 1000, frames = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback): number => { frames++; setTimeout(() => { run(now); }, 16); return frames; });
  const scope = new Scope('grid.yield');
  try {
    const settle = async (pause: Promise<void>): Promise<void> => { await vi.advanceTimersByTimeAsync(40); await pause; };
    await settle(yieldGridConstruction(scope)); expect(frames).toBe(1);
    // pieces inside the slice continue at once, with no frame
    now += 3; await yieldGridConstruction(scope); now += 4; await yieldGridConstruction(scope); expect(frames).toBe(1);
    // past the slice: one paint boundary, and the slice starts again after it
    now += 6; await settle(yieldGridConstruction(scope)); expect(frames).toBe(2);
    now += 2; await yieldGridConstruction(scope); expect(frames).toBe(2);
  } finally { scope.dispose(); }
  await expect(yieldGridConstruction(scope)).rejects.toThrow('disposed');
});

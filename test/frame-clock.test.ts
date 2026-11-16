import { expect, test } from 'vitest';
import { FrameClock } from '../src/client/engine/core/Game';

// meta SHARD-SOURCE SS-NE16: the frame loop's clock keeps three Clock's reading (the first read starts it at 0, each
// read is the time since the last, elapsedTime sums them) without the deprecated Clock's warning
test('the frame clock reads deltas as Clock did', async () => {
  const clock = new FrameClock();
  expect(clock.getDelta()).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 30));
  const a = clock.getDelta();
  expect(a).toBeGreaterThan(0.02); expect(a).toBeLessThan(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  const b = clock.getDelta();
  expect(clock.elapsedTime).toBeCloseTo(a + b, 9);
  clock.start();
  expect(clock.elapsedTime).toBe(0);
});

// meta DRIFTWOOD-FPS DF8 (mini-driftwood13g): the outer ring's paced start: the slot's pick and the pooled block reads.
import { describe, expect, test } from 'vitest';
import { outerStartPaced, OUTER_START_PACED_DEFAULT, OUTER_START_PACED_PHONE_LOW } from './outerPaced';
import { OUTER_BLOCK_READS, pooled } from '../../../shared/game/grid/compiledStrips';

describe('outerStartPaced', () => {
  test('a saved boolean wins; unset, phone Low takes its own default', () => {
    expect(outerStartPaced(true)).toBe(true);
    expect(outerStartPaced(false, true)).toBe(false);
    expect(outerStartPaced(null, true)).toBe(OUTER_START_PACED_PHONE_LOW);
    expect(outerStartPaced(undefined, false)).toBe(OUTER_START_PACED_DEFAULT);
  });
});

describe('pooled', () => {
  test('keeps order, never has more than the limit in flight, and starts only that many at once', async () => {
    let live = 0, most = 0;
    const started: number[] = [];
    const run = pooled(Array.from({ length: 10 }, (_, i) => i), OUTER_BLOCK_READS, async (i) => {
      started.push(i); live++; most = Math.max(most, live);
      await new Promise((resolve) => { setTimeout(resolve, (i * 7) % 5); });
      live--; return i * 2;
    });
    expect(started).toHaveLength(OUTER_BLOCK_READS); // the synchronous start: the limit, not every item
    expect(await run).toEqual(Array.from({ length: 10 }, (_, i) => i).map((i) => i * 2));
    expect(most).toBe(OUTER_BLOCK_READS);
  });

  test('the first failure rejects and starts nothing new', async () => {
    const started: number[] = [];
    await expect(pooled([0, 1, 2, 3, 4, 5], 2, async (i) => {
      started.push(i); await Promise.resolve();
      if (i === 1) throw new Error('read failed');
      return i;
    })).rejects.toThrow('read failed');
    expect(started.length).toBeLessThan(6);
  });
});

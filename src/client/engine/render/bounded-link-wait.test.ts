import { expect, test, vi } from 'vitest';
import { boundedLinkWait } from './precompile';

test('a link that reports done ends the wait (O14)', async () => {
  let asks = 0;
  expect(await boundedLinkWait(() => ++asks >= 3, () => Promise.resolve(), 1000)).toBe(true);
  expect(asks).toBe(3);
});

test('a link that never reports gives up at its bound, for the caller\'s synchronous link', async () => {
  let waits = 0;
  const wait = (): Promise<void> => { waits++; return new Promise(resolve => { setTimeout(resolve, 5); }); };
  expect(await boundedLinkWait(() => false, wait, 30)).toBe(false);
  expect(waits).toBeGreaterThan(0);
  expect(waits).toBeLessThan(20);
});

test('a sliced readiness scan is awaited before choosing to poll again', async () => {
  let asks = 0, waits = 0;
  expect(await boundedLinkWait(async () => { await Promise.resolve(); return ++asks === 3; }, () => { waits++; return Promise.resolve(); })).toBe(true);
  expect(asks).toBe(3); expect(waits).toBe(2);
});

test('DL23: a batch still landing links keeps waiting past the bound; a stalled one gives up at the bound after its last', async () => {
  let now = 0, asks = 0, landedAt = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    // a link lands every 6 units against a bound of 10: the wait outlives the bound twice over and ends done
    const landing = await boundedLinkWait(() => { asks++; if (asks % 3 === 0) landedAt = now; return asks >= 12; },
      () => { now += 2; return Promise.resolve(); }, 10, () => landedAt);
    expect(landing).toBe(true); expect(now).toBeGreaterThan(20);
    // nothing lands after unit 4: the wait ends 10 after it, not 10 after its start
    now = 0; landedAt = 0; asks = 0;
    const stalled = await boundedLinkWait(() => { asks++; if (now <= 4) landedAt = now; return false; },
      () => { now += 2; return Promise.resolve(); }, 10, () => landedAt);
    expect(stalled).toBe(false); expect(now).toBe(14);
  } finally { clock.mockRestore(); }
});

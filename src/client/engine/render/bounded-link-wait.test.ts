import { expect, test } from 'vitest';
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

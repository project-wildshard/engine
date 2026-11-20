// meta DRIFTWOOD-FPS DF10 (mini-df10): the warm other-player body draws every frame until it settles, then on a pace.
import { expect, test } from 'vitest';
import { warmDrawn, warmPace, warmSettle, WARM_EVERY, WARM_PACE_DEFAULT, WARM_PACE_PHONE_LOW, WARM_SETTLE, WARM_SETTLE_DEFAULT, WARM_SETTLE_PHONE_LOW } from './warmPace';

test('a saved boolean wins; unset, phone Low takes its own default', () => {
  expect(warmPace(true)).toBe(true);
  expect(warmPace(false, true)).toBe(false);
  expect(warmPace(null, true)).toBe(WARM_PACE_PHONE_LOW);
  expect(warmPace(undefined)).toBe(WARM_PACE_DEFAULT);
});

test('unpaced it always draws; paced, every frame while settling, then one in WARM_EVERY', () => {
  expect([0, WARM_SETTLE + 1, WARM_SETTLE + 7].every(since => warmDrawn(false, since))).toBe(true);
  expect(warmDrawn(true, 0)).toBe(true);
  expect(warmDrawn(true, WARM_SETTLE - 1)).toBe(true);
  const drawn = Array.from({ length: WARM_EVERY * 4 }, (_, i) => warmDrawn(true, WARM_SETTLE + i)).filter(Boolean).length;
  expect(drawn).toBe(4);
});

test('DF10 (mini-df10c): an early settle paces from its own frame', () => {
  expect(warmSettle(true)).toBe(true);
  expect(warmSettle(null, true)).toBe(WARM_SETTLE_PHONE_LOW);
  expect(warmSettle(undefined)).toBe(WARM_SETTLE_DEFAULT);
  expect(warmDrawn(true, 99, 100)).toBe(true);
  const drawn = Array.from({ length: WARM_EVERY * 3 }, (_, i) => warmDrawn(true, 100 + i, 100)).filter(Boolean).length;
  expect(drawn).toBe(3);
});

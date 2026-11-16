import {expect, test} from 'vitest';
import {LOAD_BUDGET_CAP, loadScaledMs} from './fixtures/loadBudget';

test('a load-scaled fence keeps its base when idle, grows with load per core, and stops at its cap', () => {
  expect(loadScaledMs(20_000, [3, 2, 1], 18)).toBe(20_000);
  expect(loadScaledMs(20_000, [18, 9, 4], 18)).toBe(20_000);
  expect(loadScaledMs(20_000, [45, 30, 20], 18)).toBe(50_000);
  expect(loadScaledMs(20_000, [20, 50, 40], 18)).toBe(Math.round(20_000 * 50 / 18));
  expect(loadScaledMs(20_000, [400, 400, 400], 18)).toBe(20_000 * LOAD_BUDGET_CAP);
  expect(loadScaledMs(20_000, [], 0)).toBe(20_000);
});

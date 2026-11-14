import { afterEach, expect, test, vi } from 'vitest';
import { BUDGET_RETRY_MS, BudgetDeferrals } from './budgetDeferral';

afterEach(() => { vi.useRealTimers(); });

test('GC6: a refused optional read waits for freed room or the retry interval, not for any budget change', () => {
  vi.useFakeTimers({ toFake: ['performance', 'Date'] });
  const budget = { revision: 1, playing: 1_190_000_000 };
  const deferrals = new BudgetDeferrals({ get revision() { return budget.revision; }, cost: () => ({ playing: budget.playing, loading: 0, accounted: 0, input: { l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, overlap: 0 } }) });
  deferrals.defer('far-reach');
  expect(deferrals.waiting('far-reach')).toBe(true);
  budget.revision = 2; budget.playing += 5_000_000; // another claim landed: nothing freed
  expect(deferrals.waiting('far-reach')).toBe(true);
  budget.revision = 3; budget.playing -= 10_000_000; // a claim left: room freed
  expect(deferrals.waiting('far-reach')).toBe(false);
  budget.playing += 10_000_000; budget.revision = 4;
  expect(deferrals.waiting('far-reach')).toBe(true);
  vi.advanceTimersByTime(BUDGET_RETRY_MS);
  expect(deferrals.waiting('far-reach')).toBe(false);
  expect(deferrals.waiting('pine-hollow')).toBe(false);
  deferrals.delete('far-reach');
  expect([...deferrals.keys()]).toEqual([]);
});

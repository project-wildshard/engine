import { expect, test } from 'vitest';
import { AchievementCounterBook } from '../../shared/game/achievements';

const rows = { feats: [{ id: 'shells', kind: 'crab', count: 3 }, { id: 'beacon', event: 'light', count: 1 }],
  prefix: 'island.', floorTotals: true, validateTotals: true, write: 'each' as const };

test('native quest counters publish rows once and restore silently at the same totals', () => {
  const book = new AchievementCounterBook(rows, { shells: 1, beacon: 0 });
  book.counters.kill('crab'); book.counters.event('light');
  expect(book.takeFacts()).toEqual([{ fact: 'island.shells', entity: 'shells:2' }, { fact: 'island.beacon', entity: 'beacon:1' }]);
  expect(book.takeFacts()).toEqual([]);
  const saved = book.snapshot(), fork = new AchievementCounterBook(rows);
  fork.restore(saved); expect(fork.takeFacts()).toEqual([]);
  for (const owner of [book, fork]) { owner.counters.kill('crab'); owner.counters.kill('crab'); owner.counters.event('light'); }
  expect(book.snapshot()).toEqual({ shells: 3, beacon: 1 }); expect(fork.snapshot()).toEqual(book.snapshot());
  expect(book.takeFacts()).toEqual([{ fact: 'island.shells', entity: 'shells:3' }]);
  expect(fork.takeFacts()).toEqual([{ fact: 'island.shells', entity: 'shells:3' }]);
});

test('refused totals preserve the live counters and their pending facts', () => {
  const book = new AchievementCounterBook(rows); book.counters.kill('crab');
  for (const count of [Number.NaN, Infinity, -1, 1.5]) expect(() => book.restore({ shells: count })).toThrow();
  expect(book.snapshot()).toEqual({ shells: 1 });
  expect(book.takeFacts()).toEqual([{ fact: 'island.shells', entity: 'shells:1' }]);
  book.counters.kill('crab'); book.restore({ shells: 1 }); expect(book.takeFacts()).toEqual([]);
});

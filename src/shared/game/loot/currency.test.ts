// ONE-FORMAT OF31g2: the coin is the shard's currency row; FORMAT-PRUNE FP31 retired the any-loot-row rule.
import { expect, test } from 'vitest';
import { coinsDeclared, declaredCurrency } from './currency';

const doubloon = { id: 'coin', name: 'Doubloon', model: 'shared/doubloon', icon: 'coin' };

test('a currency row names the shard\'s own coin', () => {
  expect(declaredCurrency([{ economy: { currency: doubloon } }])).toEqual(doubloon);
  expect(coinsDeclared([{ economy: { currency: doubloon } }])).toBe(true);
});

test('no currency row: no coin named and no coins, loot rows or not (FP31)', () => {
  expect(declaredCurrency([{ economy: { goods: [] } }, {}])).toBeNull();
  expect(coinsDeclared([{}])).toBe(false);
  expect(coinsDeclared([{ economy: { goods: [] } }])).toBe(false);
  expect(coinsDeclared([])).toBe(false);
});

test('a malformed currency is refused, not guessed', () => {
  expect(() => declaredCurrency([{ economy: { currency: { ...doubloon, model: '../x' } } }])).toThrow();
});

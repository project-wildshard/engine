// ONE-FORMAT OF31g2: the coin is the shard's currency row; the old any-loot-row rule stays until OF31g4.
import { expect, test } from 'vitest';
import { coinsDeclared, declaredCurrency } from './currency';

const doubloon = { id: 'coin', name: 'Doubloon', model: 'shared/doubloon', icon: 'coin' };

test('a currency row names the shard\'s own coin', () => {
  expect(declaredCurrency([{ economy: { currency: doubloon } }])).toEqual(doubloon);
  expect(coinsDeclared([{ economy: { currency: doubloon } }])).toBe(true);
});

test('no currency row: no coin named, and the old rule still turns coins on for loot rows', () => {
  expect(declaredCurrency([{ economy: { goods: [] } }, {}])).toBeNull();
  expect(coinsDeclared([{}])).toBe(true);
  expect(coinsDeclared([])).toBe(false);
});

test('a malformed currency is refused, not guessed', () => {
  expect(() => declaredCurrency([{ economy: { currency: { ...doubloon, model: '../x' } } }])).toThrow();
});

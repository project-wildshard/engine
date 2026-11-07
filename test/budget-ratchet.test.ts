// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the committed ratchet budgets the script rewrites.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { keptBudgets } from '../scripts/budget-ratchet.mjs';

const ratchet: unknown = JSON.parse(readFileSync('lint/ratchet.json', 'utf8'));
const budgets = (): Record<string, number> => {
  const rows = typeof ratchet === 'object' && ratchet !== null && 'budgets' in ratchet ? ratchet.budgets : undefined;
  if (typeof rows !== 'object' || rows === null) throw new Error('lint/ratchet.json has no budgets');
  return Object.fromEntries(Object.entries(rows).filter((row): row is [string, number] => typeof row[1] === 'number'));
};

test('budget-ceilings keeps the js/* chunk ceilings when it moves the rollout ceilings out', () => {
  const committed = budgets(), owned = Object.keys(committed).filter(key => key.startsWith('js/'));
  expect(owned.length).toBeGreaterThan(0);
  // the committed budgets plus legacy rollout rows the script retires (`<shard>.<tier>.<pose>.<metric>`)
  const input = { ...committed, 'driftwood-isle.phone.spawn.draws': 120, 'pine-hollow.desktop.free.gpuMB': 900 };
  const kept = keptBudgets(input);
  expect(Object.keys(kept)).toEqual(Object.keys(committed).filter(key => !/^[^./]+\.(?:phone|desktop)\.[^.]+\.[^.]+$/u.test(key)));
  for (const key of owned) expect(kept[key]).toBe(committed[key]);
  expect(kept).not.toHaveProperty(['driftwood-isle.phone.spawn.draws']);
  expect(kept).not.toHaveProperty(['pine-hollow.desktop.free.gpuMB']);
  expect(keptBudgets(undefined)).toEqual({});
});

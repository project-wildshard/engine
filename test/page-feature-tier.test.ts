import { parseDeclaredQuestPage } from '@wildshard/format/declaredQuestPage';
import { jsonDataHeapBytes } from '@wildshard/format/json';
import { expect, test } from 'vitest';
import { pageFeatureBudget } from '../src/shared/game/shardfile/pageFeatureTier';
import { emptyShardfile } from '../src/shared/host/author';

const { budgets } = emptyShardfile({ slug: 'page-fixture', name: 'Page fixture', author: 'Test', revision: 1, seed: 1 });
const page = (initial: unknown[]) => parseDeclaredQuestPage({ version: 1, quest: 'walk', prompts: [], actions: [], initial });

test('the tier charges all admitted page feature groups and assigns a real scoped CPU allowance', () => {
  const declared = page([{ when: { all: ['arrived'] }, effects: [] }]);
  const bytes = [declared.prompts, declared.observations, declared.actions, declared.initial]
    .reduce((total, rows) => total + (jsonDataHeapBytes(rows) ?? 0), 0);
  expect(bytes).toBeGreaterThan(0);
  expect(pageFeatureBudget({ budgets, runtime: null, questHost: { page: declared } }))
    .toMatchObject({ bytes, cpuMicrosPerFrame: 1_000 });
  expect(pageFeatureBudget({ budgets, runtime: null })).toBeUndefined();
});

test('a valid feature graph over the small tier refuses before any page work', () => {
  const initial = Array.from({ length: 25 }, (_, row) => ({
    when: { all: Array.from({ length: 48 }, (_, flag) => `row-${row}-flag-${flag}`) }, effects: [],
  }));
  const declared = page(initial);
  const source = { budgets, runtime: null, questHost: { page: declared } };
  expect(() => pageFeatureBudget(source)).toThrow(/against its tier limit of 1000/u);
  expect(pageFeatureBudget({ ...source, budgets: { ...budgets, tier: 'large' } })).toMatchObject({ cpuMicrosPerFrame: 4_000 });
});

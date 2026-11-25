// ONE-FORMAT OF29e4/OF29e8, FORMAT-PRUNE FP43: a quest page binds its population from the declared files under the engine's
// own row (`engine.page-homes`), never a format kind. Dunes is the proof: its homes are declared spawns (OF19b) and its
// plan names no `population.homes` row (OF29e6), so the engine stands its population under its own system. The format
// kind is retired: no pin names it, and a plan that still does is refused rather than converted.
import { expect, test } from 'vitest';
import { HOMES_SYSTEM, PAGE_HOMES, admitClientPlan, pageHomes } from '../src/client/game/shardfile/clientPlan';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';
import { builtFolder } from '../src/test/game/builtFolder';
import { parseClientPlan, type ClientFeatureRow } from '@wildshard/format/clientPlan';

test('Dunes stands its page population as the engine\'s row', async () => {
  const product = await loadHeadlessFolder(builtFolder('sunscar-dunes')), plan = product.section('client/plan');
  expect(plan.features.some(row => (row.kind as string) === 'population.homes'), 'Dunes names no format row').toBe(false);
  expect(pagePopulationRows(product.section('sim/runtime-plan')).homes, 'no plan home: the system never runs').toEqual([]);
  expect(admitClientPlan(plan, product).pageHomes).toEqual({ kind: PAGE_HOMES, system: HOMES_SYSTEM, groups: {} });
}, 120_000);

test('a plan naming the retired population.homes row is refused', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an older pin's row, which today's format may not type
  const retired = { kind: 'population.homes', system: 'old.system', groups: {} } as unknown as ClientFeatureRow;
  expect(() => pageHomes([retired])).toThrow('retired (FORMAT-PRUNE FP43)');
});

test('a plan naming a species-program feature is refused (FORMAT-PRUNE FP20)', () => {
  // A page's species are its declared rows and looks; the format deletes these kinds, so its parser refuses them
  for (const kind of ['species.program', 'population.hull-book', 'population.product-creatures'])
    expect(() => parseClientPlan({ version: 1, features: [{ kind }] })).toThrow();
});

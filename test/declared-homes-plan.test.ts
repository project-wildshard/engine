// ONE-FORMAT OF29e4/OF29e8: a quest page binds its population from the declared files under the engine's own row
// (`engine.page-homes`), never a format kind. Dunes' row is the proof: once its homes became declared spawns (OF19b) the
// format row carried only names: a system that runs only over plan homes (it has none), a witness nothing reads, and no
// groups. Cut from the shipped plan, the engine stands the same population under its own system; a plan naming the format
// row keeps its own facts in the engine's row, so the format can retire the kind once no pin names one.
import { expect, test } from 'vitest';
import { HOMES_SYSTEM, PAGE_HOMES, admitClientPlan } from '../src/client/game/shardfile/clientPlan';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';
import { builtFolder } from '../src/test/game/builtFolder';

test('Dunes stands its page population as the engine\'s row, with or without the format row', async () => {
  const product = await loadHeadlessFolder(builtFolder('sunscar-dunes')), plan = product.section('client/plan');
  const own = plan.features.find(row => row.kind === 'population.homes');
  const stand = { kind: PAGE_HOMES, system: HOMES_SYSTEM, groups: {} };
  expect(pagePopulationRows(product.section('sim/runtime-plan')).homes, 'no plan home: the system never runs').toEqual([]);
  const cut = { ...plan, features: plan.features.filter(row => row !== own) };
  const admitted = admitClientPlan(cut, product);
  expect(admitted.pageHomes).toEqual(stand);
  expect(admitted.features.some(row => (row.kind as string) === 'population.homes')).toBe(false);
  // the shipped row (until Dunes drops it, OF29e6) becomes the engine's row with its own system and groups
  if (own?.kind === 'population.homes') expect(admitClientPlan(plan, product).pageHomes).toEqual({ kind: PAGE_HOMES, system: own.system, groups: own.groups });
}, 120_000);

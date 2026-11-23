// ONE-FORMAT OF29e4: a quest page whose plan names no `population.homes` row binds its population from the declared files.
// Dunes' row is the proof: once its homes became declared spawns (OF19b) the row carried only names: a system that runs
// only over plan homes (it has none), a witness nothing reads, and no groups. Cut from the shipped plan, the engine stands
// the same population under its own system, and the page's ownership rules (which need the row) pass on the admitted
// plan; a plan naming the row keeps its own. The format's author-side rule still asks for the row until OF29e5.
import { expect, test } from 'vitest';
import { HOMES_SYSTEM, admitClientPlan } from '../src/client/game/shardfile/clientPlan';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';
import { builtFolder } from '../src/test/game/builtFolder';

test('Dunes with no population.homes row stands the same page population under the engine system', async () => {
  const product = await loadHeadlessFolder(builtFolder('sunscar-dunes')), plan = product.section('client/plan');
  const own = plan.features.find(row => row.kind === 'population.homes');
  const stand = { kind: 'population.homes', system: HOMES_SYSTEM, witness: { kinds: [] }, bodyHomes: [], groups: {} };
  expect(pagePopulationRows(product.section('sim/runtime-plan')).homes, 'no plan home: the system never runs').toEqual([]);
  // the shipped row (until Dunes drops it, OF29e6) differs from what the engine stands only in those names
  if (own !== undefined) expect({ ...own, system: HOMES_SYSTEM, witness: { kinds: [] } }).toEqual(stand);
  const cut = { ...plan, features: plan.features.filter(row => row !== own) };
  expect(admitClientPlan(cut, product).features.filter(row => row.kind === 'population.homes')).toEqual([stand]);
  if (own !== undefined) expect(admitClientPlan(plan, product).features.filter(row => row.kind === 'population.homes')).toEqual([own]);
}, 120_000);

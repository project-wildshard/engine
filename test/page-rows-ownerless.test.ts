// ONE-FORMAT OF19c0b: format 0.47.2's runtime plan may keep no owner row (its boss is a declared encounter). The page's
// population then draws the keeper's homes alone, with no boss, and the plan section admits it.
import { expect, test } from 'vitest';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';

const plan = parseNativeRuntimePlan({ kind: 'held-melee', baked: {},
  recipe: { terrain: 'none', ground: { size: 64, height: 0 }, player: { speed: 5 }, runtime: { weapon: { id: 'whip' }, quest: { spots: 'metadata' } },
    population: { sources: 'actors', seed: 'declared', rows: { program: { species: [], strikes: [] }, step: 'homes', seed: 1, attackers: null, think: 'legacy',
      admission: 'prepare', homes: [{ id: 'ray', kind: 'duneRay', at: [1, 2], yaw: 0, respawn: 30, look: 'dusk' }] } } } });

test('an ownerless plan draws its keeper homes alone on the page', () => {
  expect(plan.recipe.population.owner).toBeUndefined();
  const rows = pagePopulationRows(plan);
  expect(rows.homes.map(row => row.id)).toEqual(['ray']);
  expect(rows.bosses).toEqual([]);
});

// ONE-FORMAT OF19d: Dunes rev 5 keeps the Matriarch's owner row on its runtime plan (her flag, fact and coins file once
// there), but her body is a declared spawn and her fight a declared boss encounter, so the plan has no boss row. The
// page's population draws the keeper's homes and leaves her body to the declared encounter; it must not refuse the plan.
import { expect, test } from 'vitest';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';

const next = ['arena', 'dead'].map(id => ({ target: id, when: id }));
const owner = { actor: 'matriarch', armed: false, step: 'matriarch',
  definition: { id: 'matriarch', intro: 3.8, introShort: 1.2, name: 'The Dune Matriarch', phases: [{ at: 1, caption: 'Dives', name: 'Dives' }, { at: 0.66, caption: 'Storm', name: 'Storm' }, { at: 0.33, caption: 'Grounded', name: 'Grounded' }],
    retryTitle: 'Again', reward: {}, title: 'Mother' },
  placement: { respawn: { x: -14, yaw: 0, z: -90 }, rewardPoint: { x: -14, y: 0.8, z: -150 } },
  profile: { kind: 'boss', pattern: 'spawned', fight: { arena: { r: 90, x: -14, z: -150 }, fields: { fight: 'fight', phase: 'phase', rise: 'rise' },
    hpShares: [1, 0.66, 0.33], riseSeconds: 3.2, stormFade: 2.5, stormPhases: [1] } },
  record: { defeated: 'matriarch.defeated', paid: 'matriarch.paid' }, reward: { amount: 20, when: 'claim' },
  stages: { id: 'matriarch.encounter', version: 2, script: null, inputs: { arena: 'zone:boss.arena', dead: 'actor:boss.dead' },
    stages: [{ id: 'ready', do: [], next }, { id: 'arena', when: 'arena', do: [{ emit: 'boss.intro', value: 0 }], next },
      { id: 'dead', when: 'dead', do: [{ emit: 'boss.won', value: 0 }], next }] },
  victory: { fact: 'matriarch', flag: 'matriarch.down', once: false } };

const plan = parseNativeRuntimePlan({ kind: 'held-melee', baked: {},
  recipe: { terrain: 'none', ground: { size: 64, height: 0 }, player: { speed: 5 }, runtime: { weapon: { id: 'whip' }, quest: { spots: 'metadata' } },
    population: { sources: 'actors', seed: 'declared', owner, rows: { program: { species: [], strikes: [] }, step: 'homes', seed: 1, attackers: null,
      think: 'legacy', admission: 'prepare', homes: [{ id: 'ray', kind: 'duneRay', at: [1, 2], yaw: 0, respawn: 30, look: 'dusk' }] } } } });

test('a spawned owner with no boss row draws its keeper homes and leaves the boss to its declared encounter', () => {
  expect(plan.recipe.population.owner?.profile.pattern).toBe('spawned');
  expect(plan.recipe.population.rows.boss).toBeUndefined();
  const rows = pagePopulationRows(plan);
  expect(rows.homes.map(row => row.id)).toEqual(['ray']);
  expect(rows.bosses).toEqual([]);
});

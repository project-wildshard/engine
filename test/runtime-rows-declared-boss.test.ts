import { expect, test } from 'vitest';
import { withoutRuntimeRows } from '../src/shared/game/plugin/runtimeRows';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';

// ONE-FORMAT OF22c2: Driftwood's Drowned Captain is a declared spawn a `boss` encounter names, with no runtime boss; his public
// decision fields stay on runtime-bound state (format 0.55.2 admits them). The page admitted none of them, so v0.1.55's
// preparation client refused Driftwood at level.world ("Runtime-bound state supports host fields ...").
const base = emptyShardfile({ slug: 'captain-fixture', name: 'Captain fixture', author: 'Test', revision: 1, seed: 1 });
const field = { id: 1, name: 'phase', type: 'f64' as const, privacy: 'public' as const, default: 1, min: 0, max: 3 };
const source = (spawn: string, entity: string) => ({ ...base,
  runtime: { kind: 'client-plan' as const, cost: FIXTURE_RUNTIME_COST, binds: ['state' as const] },
  state: { ...base.state, shared: [field] },
  creatures: { ...base.creatures, spawns: [{ id: spawn }] as unknown as typeof base.creatures.spawns },
  encounters: [{ kind: 'boss', entity }] as unknown as typeof base.encounters });

test('a boss encounter\'s declared spawn keeps its public fields on runtime-bound state', () => {
  const captain = source('driftwood.captain', 'driftwood.captain');
  // the runtime owns bound state, so the data client's copy holds none of it
  expect(withoutRuntimeRows(captain).state.shared).toEqual([]);
});

test('public runtime-bound fields with no retained actor are still refused', () => {
  expect(() => withoutRuntimeRows(source('driftwood.captain', 'driftwood.other')))
    .toThrow('Runtime-bound state supports host fields and retained-actor numeric fields');
  expect(() => withoutRuntimeRows({ ...source('driftwood.captain', 'driftwood.captain'), encounters: [] }))
    .toThrow('Runtime-bound state supports host fields and retained-actor numeric fields');
});

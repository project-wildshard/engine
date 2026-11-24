// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real native roster over shipped Rapier.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Rng } from '@wildshard/format/seededRng';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { createNativeCreatureRoster } from '../src/server/game/shardfile/homeKeeper';
import { madeUpMarsh } from './fixtures/returnPrograms';
import { fixtureNativeRoster } from './fixtures/native-roster';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test('salt-marsh native returns retain predecessor identities, queue order and quiet restore', async () => {
  const program = madeUpMarsh, sample = SIM_LEVEL.entities[0];
  if (sample === undefined) throw new Error('Missing marsh fixture');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), rng = new Rng(9);
  const { hunt, services } = fixtureNativeRoster(host, rng);
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec], variants: new Map(), rng, services, hunted: 'every', spawnY: 10 });
  const rows = { program, water: -1, fixed: [], interval: 1, limit: 2, outOfSight: 10,
    rules: { [sample.spec.kind]: { delay: { min: 2, max: 4 } } } };
  try {
    const returns = intake.returns(rows);
    const kill = (id: string, x: number): void => {
      const herd = hunt.addHerd(sample.spec.kind, x, 3);
      const actor = intake.arrive(intake.body(id, sample.spec.kind, sample.spec.variant, herd, { x, z: 3 }, 0, [1, 1]));
      host.combat.hit({ source: 'env', sourceTags: [], target: actor.combatActor(), amount: 10000, point: actor.position, dir: actor.position.clone() });
    };
    kill('sentry.left', 2); kill('sentry.right', 4); host.events.flush('fixed.post');
    const state = returns.snapshot(), stream = host.rng.stream('spawn').snapshot();
    expect(state.pending.map(row => row.id)).toEqual(['sentry.left', 'sentry.right']);
    expect(state.pending.map(row => row.due)).toEqual([2, 2]);
    expect(returns.take(1)).toEqual([]); expect(returns.take(1)).toEqual([]);
    leadPlayer(host).position.x = 11;
    expect(returns.take(1).map(row => returns.place(row)).map(row => [row?.id, row?.x, row?.z])).toEqual([['sentry.right', 6, 2], ['sentry.left', 4, 2]]);
    returns.restore(state);
    expect(returns.snapshot()).toEqual(state); expect(host.rng.stream('spawn').snapshot()).toEqual(stream);
    expect([...host.entities.keys()]).toEqual(['sentry.left', 'sentry.right']);
    expect(() => returns.restore({ ...state, pending: [...state.pending, ...state.pending] })).toThrow();
    expect(returns.snapshot()).toEqual(state);
    expect(returns.take(2).map(row => returns.place(row)?.id)).toEqual(['sentry.right', 'sentry.left']);
    expect(() => intake.returns({ ...rows, interval: .01 })).toThrow();
    expect(() => intake.returns({ ...rows, limit: 257 })).toThrow();
  } finally { host.dispose(); }
});

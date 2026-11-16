// oxlint-disable-next-line import/no-nodejs-modules -- The proof runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { proveAuthoredGrid } from '../src/server/game/plugin/simulation';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// meta MU6 (NE6, mini QA 2026-11-15 row 37): an author proof counted only a native pack (`nativeInventories`), so a scene or
// data shard's `requiredItems` could never pass. The proof now holds what the tape was paid, as a data cell pays it: quest
// coins and each kill's own roll off the shard's loot tables, under the `player` pack, the same after a save and restore.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard() {
  const source = emptyShardfile({ slug: 'goods-proof', name: 'Goods proof', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'bandit', kind: 'boar', label: 'Bandit', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Bandit', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = [{ id: 'bandit:1', species: 'bandit', variant: 'base', brain: null, strike: null, seed: 1, scale: 1, at: [4, 0, 6], yaw: 0 }];
  source.rows.loot = [{ id: 'purse', gear: 'purse.coins', finds: null, marks: null, charted: false, chime: 'coin',
    economy: { tables: [{ id: 'coins', domain: 'coins', table: { mode: 'weighted', rows: [{ item: 'coin', weight: 1, count: 7, match: { kind: 'boar' } }] } },
      { id: 'trophies', domain: 'trophies', table: { mode: 'weighted', rows: [{ item: 'tusk', weight: 1, count: 2, match: { kind: 'boar' } }] } }] } }] as never;
  source.quests.flags = ['here', 'q.done'];
  source.quests.quests = [{ id: 'q', title: 'Stand here', completeFlag: 'q.done', steps: [{ id: 'stand', objective: 'Stand here', done: { all: ['here'] } }],
    onComplete: { coins: 5, fact: 'q.paid' } }] as never;
  source.quests.triggers = [{ id: 'here', kind: 'region', flag: 'here', x: 0, z: 0, radius: 50 }] as never;
  return source;
}

test('a data shard\'s proof holds the quest coins and the kill\'s roll, and requiredItems counts them', async () => {
  const proof = await proveAuthoredGrid(shard(), new Map(), { rapier: await rapier },
    { ticks: 40, checkpointTick: 20, requiredFacts: ['q.paid'], requiredItems: { coins: 12, tusk: 2 } },
    (tick, sim) => {
      if (tick === 5) {
        const lead = [...sim.host.players.values()][0], body = sim.host.entities.get('bandit:1');
        if (lead === undefined || body === undefined) throw new Error('Missing fixture');
        sim.host.combat.hit({ source: lead.health, sourceTags: ['actor.player', 'dmg.ranged'], target: body.combatActor(), amount: 1000, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
      }
      return undefined;
    });
  expect(proof.inventory['player']).toEqual({ coins: 12, tusk: 2 });
});

test('a tape short of a required stack names what the player holds', async () => {
  await expect(proveAuthoredGrid(shard(), new Map(), { rapier: await rapier },
    { ticks: 40, checkpointTick: 20, requiredFacts: ['q.paid'], requiredItems: { tusk: 1 } }, () => undefined))
    .rejects.toThrow(/inventory holds 0 of tusk.*"player":\{"coins":5\}/u);
});

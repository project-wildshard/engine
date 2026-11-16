// oxlint-disable-next-line import/no-nodejs-modules -- The proof runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { proveAuthoredGrid } from '../src/server/game/plugin/simulation';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// opus-ss16q, 2026-11-16: sharddev's Template failed every stand-still tape with `restored regional suffix diverged in
// entities.4.1.motion.yaw`. Its player was still falling from the spawn at the checkpoint, and the highway's five ticks
// moved it on (MU6: the restore carries it in as the highway left it) while the never-saved baseline's player had not
// moved, so a creature that reads the player's pose turned a few ulps differently. The baseline now takes the traveler
// as the restore brought it back, at the checkpoint.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard() {
  const source = emptyShardfile({ slug: 'traveler-proof', name: 'Traveler proof', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'watcher', kind: 'boar', label: 'Watcher', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Watcher', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = [{ id: 'watcher:1', species: 'watcher', variant: 'base', brain: null, strike: null, seed: 1, scale: 1, at: [4, 0, 6], yaw: 0 }];
  source.quests.flags = ['here', 'q.done'];
  source.quests.quests = [{ id: 'q', title: 'Stand here', completeFlag: 'q.done', steps: [{ id: 'stand', objective: 'Stand here', done: { all: ['here'] } }],
    onComplete: { coins: 0, fact: 'q.here' } }] as never;
  source.quests.triggers = [{ id: 'here', kind: 'region', flag: 'here', x: 0, z: 0, radius: 50 }] as never;
  return source;
}

test('a player in the air at the checkpoint does not split the restored run from the baseline', async () => {
  const proof = await proveAuthoredGrid(shard(), new Map(), { rapier: await rapier }, { ticks: 60, checkpointTick: 20, requiredFacts: ['q.here'] },
    (tick, sim) => {
      const lead = [...sim.host.players.values()][0], watcher = sim.host.entities.get('watcher:1');
      if (lead === undefined || watcher === undefined) throw new Error('Missing fixture');
      // A hop just before the save: the player is still rising when the region goes out.
      if (tick === 16) { lead.velocity.y = 6; lead.fall.grounded = false; }
      // The watcher turns by where the player is, height included.
      watcher.setMotion(Math.atan2(lead.position.x - watcher.position.x, lead.position.z - watcher.position.z) + lead.position.y, 0, 4);
      return undefined;
    });
  expect(proof.ledger.facts.map(row => row.name)).toEqual(['q.here']);
});

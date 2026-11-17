// oxlint-disable-next-line import/no-nodejs-modules -- The proof runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { proveAuthoredGrid } from '../src/server/game/plugin/simulation';

// SHARD-SOURCE SS-MS1b: a race (`quests.races`) files its own fact, from no quest's onComplete. The author proof read every
// fact as a quest's and refused Mirror Salt's timed arches: "Missing native quest fact provenance".
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard() {
  const source = emptyShardfile({ slug: 'race-proof', name: 'Race proof', author: 'Test', seed: 7, revision: 1 });
  source.quests.flags = ['go', 'end'];
  source.quests.triggers = [{ id: 'go', kind: 'region', flag: 'go', x: 0, z: 0, radius: 50 },
    { id: 'end', kind: 'region', flag: 'end', x: 0, z: 0, radius: 50, when: { all: ['go'] } }] as never;
  (source.quests as { races?: unknown }).races = [{ id: 'arch', start: 'go', stop: 'end', fact: 'arch.time', cap: 60 }];
  return source;
}

test('a race\'s fact passes the author proof and a tape may require it', async () => {
  const proof = await proveAuthoredGrid(shard(), new Map(), { rapier: await rapier },
    { ticks: 40, checkpointTick: 20, requiredFacts: ['arch.time'] }, () => undefined);
  expect(proof).toBeDefined();
});

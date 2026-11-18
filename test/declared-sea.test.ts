import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import type { SimCommand } from '../src/server/engine/sim';

// ONE-FORMAT OF40a (Q-S7): `water.sea` from a plain upload. A declared sea row, with no native host, gives the player
// its water as Driftwood's native sea does: the surface reads at the sea's level and a player standing in deep water swims.
const LEVEL = 3;
function seaShard(water: boolean) {
  const base = emptyShardfile({ slug: 'sea-fixture', name: 'Sea fixture', author: 'Test', revision: 1, seed: 5 });
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, water: water ? [{ id: 'sea' as const, kind: 'sea' as const, level: LEVEL, waves: false }] : [] };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const still: SimCommand = { commandVersion: 1, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, sprint: false, moveX: 0, moveZ: 0, yaw: 0 };

test('OF40a: a plain sea row gives the player the sea: its surface reads and deep water floats them up', () => {
  const sim = createShardfileSim(seaShard(true), new Map(), { rapier });
  try {
    expect(sim.host.hasWater).toBe(true);
    expect(sim.host.waterSurfaceAt(10, 10)).toBe(LEVEL);
    const player = sim.host.players.values().next().value;
    if (player === undefined) throw new Error('Missing player');
    const commands = new Map([[player.id, still]]);
    for (let i = 0; i < 180; i++) sim.host.step(commands);
    expect(player.position.y).toBeGreaterThan(1);
  } finally { sim.dispose(); }
});

test('OF40a: without a sea row the host stays dry, as before', () => {
  const sim = createShardfileSim(seaShard(false), new Map(), { rapier });
  try {
    expect(sim.host.hasWater).toBe(false);
    expect(sim.host.waterSurfaceAt(10, 10)).toBe(null);
  } finally { sim.dispose(); }
});

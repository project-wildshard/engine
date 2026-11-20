// oxlint-disable-next-line import/no-nodejs-modules -- The declared simulation runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { SPAWN_HOLD_STEP } from '../src/server/game/shardfile/declaredHolds';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { questBooks } from '../src/shared/engine/quest/players';

// ONE-FORMAT OF19b: a declared spawn's `hold` (Dunes' first ray, held until the scout). The memory field reads 1 until the
// quest flag is set, then 0, before any brain steps; a shard with no hold registers no step.
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
type Spawn = Shardfile['creatures']['spawns'][number];
function shard(rows: readonly Partial<Spawn>[]): Shardfile {
  const source = emptyShardfile({ slug: 'hold-fixture', name: 'Hold fixture', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'wolf', kind: 'boar', label: 'Wolf', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Wolf', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.quests.flags = ['met'];
  source.creatures.spawns = rows.map((row, index) => ({ id: `wolf:${String(index + 1)}`, species: 'wolf', variant: 'base', brain: null, strike: null,
    seed: index + 1, scale: 1, at: [4 + index * 3, 0, 6], yaw: 0, ...row }));
  return source;
}

test('OF19b: a held body reads its field 1 until the flag is set, then 0; its neighbour is untouched', () => {
  const sim = createShardfileSim(shard([{ hold: { field: 'held', until: 'met' } }, {}]), new Map(), { rapier });
  try {
    const held = sim.host.entities.get('wolf:1'), free = sim.host.entities.get('wolf:2');
    expect(held?.mem['held']).toBe(1);
    sim.host.step();
    expect(held?.mem['held']).toBe(1);
    sim.host.flags.set('met'); sim.host.step();
    expect(held?.mem['held']).toBe(0);
    expect(free?.mem['held']).toBeUndefined();
    expect(sim.host.stepIds()).toContain(SPAWN_HOLD_STEP);
  } finally { sim.dispose(); }
});

test('OF19d: in a room, a second player who has met the scout frees the body; the lead had not', () => {
  const sim = createShardfileSim(shard([{ hold: { field: 'held', until: 'met' } }]), new Map(), { rapier });
  try {
    const held = sim.host.entities.get('wolf:1'), second = sim.host.addPlayer('p2', { x: 2, y: 0, z: 2 }), books = questBooks(sim.host);
    books.claim(['met']); // a quest row's flag is its player's own, as the room's interaction rows claim it
    sim.host.step();
    expect(held?.mem['held']).toBe(1);
    books.of(second.id).flags.set('met'); sim.host.step();
    expect(sim.host.flags.has('met')).toBe(false);
    expect(held?.mem['held']).toBe(0);
  } finally { sim.dispose(); }
});

test('OF19b: a shard with no hold registers no hold step', () => {
  const sim = createShardfileSim(shard([{}]), new Map(), { rapier });
  try { expect(sim.host.stepIds()).not.toContain(SPAWN_HOLD_STEP); } finally { sim.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- The declared simulation runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { ABSENT_Y, SPAWN_WHEN_STEP, spawnAbsent } from '../src/server/game/shardfile/declaredSpawnWhen';
import { hostDay, installDeclaredClimate } from '../src/server/game/shardfile/declaredClimate';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { parseRows } from '@wildshard/format/rows';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// ONE-FORMAT OF29a (OF28c): a declared spawn row's `when`. A body stands in the world only while its condition holds:
// a quest stage, the time of day, or the wave before it having fallen; otherwise it is absent (out of the world, not alive).
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
type Spawn = Shardfile['creatures']['spawns'][number];
function shard(rows: readonly Partial<Spawn>[]): Shardfile {
  const source = emptyShardfile({ slug: 'when-fixture', name: 'When fixture', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'wolf', kind: 'boar', label: 'Wolf', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Wolf', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = rows.map((row, index) => ({ id: `wolf:${String(index + 1)}`, species: 'wolf', variant: 'base', brain: null, strike: null,
    seed: index + 1, scale: 1, at: [4 + index * 3, 0, 6], yaw: 0, ...row }));
  return source;
}
const body = (sim: ShardfileSimulation, id: string) => { const b = sim.host.entities.get(id); if (b === undefined) throw new Error(`Missing ${id}`); return b; };
const present = (sim: ShardfileSimulation, id: string): boolean => { const b = body(sim, id); return b.alive && !spawnAbsent(b) && b.position.y > ABSENT_Y / 2; };
const kill = (sim: ShardfileSimulation, id: string): void => {
  const lead = [...sim.host.players.values()][0], b = body(sim, id); if (lead === undefined) throw new Error('Missing lead');
  sim.host.combat.hit({ source: lead.health, sourceTags: ['actor.player', 'dmg.melee'], target: b.combatActor(), amount: 1000, point: b.position.clone(), dir: new Vector3(0, 0, 1) });
};

test('OF29a: a quest-stage row is absent until a player reaches that stage, then stands at its spawn', () => {
  const sim = createShardfileSim(shard([{ when: { quest: { id: 'hunt', stage: 2 } } }, {}]), new Map(), { rapier });
  try {
    expect(present(sim, 'wolf:1')).toBe(false);
    expect(present(sim, 'wolf:2'), 'a row with no `when` stands as before').toBe(true);
    const lead = [...sim.host.players.values()][0]; if (lead === undefined) throw new Error('Missing lead');
    const book = questBooks(sim.host).of(lead.id);
    book.adopt({ id: 'hunt', title: 'Hunt', completeFlag: 'hunt.done', steps: ['a', 'b', 'c'].map(id => ({ id, objective: id, done: { all: [`hunt.${id}`] } })) });
    book.flags.set('hunt.a'); sim.host.step();
    expect(present(sim, 'wolf:1'), 'stage 1 is not stage 2').toBe(false);
    book.flags.set('hunt.b'); sim.host.step();
    expect(present(sim, 'wolf:1')).toBe(true);
    expect(body(sim, 'wolf:1').position.x).toBeCloseTo(4);
    expect(sim.host.flags.has('dead:wolf:1'), 'leaving and coming back is no death').toBe(false);
  } finally { sim.dispose(); }
});

test('OF29a: a night row leaves at dawn and comes back at dusk; a day row does the opposite', () => {
  // the shard's own day (a `world/days` row, as a data cell installs it), with a night
  const schedule = [{ phase: 'night', from: 0, to: 5 }, { phase: 'dawn', from: 5, to: 7 }, { phase: 'day', from: 7, to: 17 }, { phase: 'dusk', from: 17, to: 19 },
    { phase: 'night', from: 19, to: 24 }].map(row => ({ ...row, minutes: 2 }));
  const day = { id: 'fixture.day', units: 'hour', start: 12, schedule, sun: { maxElevation: 60, azimuthOffset: 35 },
    fixed: { midday: 12, golden: 17, sunset: 18, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 0 } };
  const sim = createShardfileSim(shard([{ when: { time: 'night' } }, { when: { time: 'day' } }]), new Map(), { rapier });
  try {
    installDeclaredClimate(sim.host, parseRows({ weather: [], days: [day], compendiums: [], loot: [], strikes: [], looks: [], species: [] }));
    const hours = { night: 22.5, dawn: 5.6, day: 10, dusk: 18 } as const;
    const at = (phase: keyof typeof hours): void => {
      actRoutes(sim.host).day?.(hours[phase] / 24); // a lone player's day pick, as the page sends it
      expect(hostDay(sim.host)?.dayPhase).toBe(phase); sim.host.step();
    };
    at('night'); expect([present(sim, 'wolf:1'), present(sim, 'wolf:2')]).toEqual([true, false]);
    at('dawn'); expect([present(sim, 'wolf:1'), present(sim, 'wolf:2')]).toEqual([false, true]);
    at('dusk'); expect([present(sim, 'wolf:1'), present(sim, 'wolf:2')]).toEqual([true, false]);
  } finally { sim.dispose(); }
});

test('OF29a: wave 2 comes once every body of wave 1 has fallen, and an absent body takes no blow and pays no respawn', () => {
  const sim = createShardfileSim(shard([{ when: { wave: { set: 'den', index: 1 } } }, { when: { wave: { set: 'den', index: 1 } } },
    { when: { wave: { set: 'den', index: 2 } }, respawn: 5 }]), new Map(), { rapier });
  try {
    expect(['wolf:1', 'wolf:2', 'wolf:3'].map(id => present(sim, id))).toEqual([true, true, false]);
    kill(sim, 'wolf:3'); for (let i = 0; i < 60 * 6; i++) sim.host.step();
    expect(present(sim, 'wolf:3'), 'an absent body is neither hit nor respawned').toBe(false);
    kill(sim, 'wolf:1'); sim.host.step();
    expect(present(sim, 'wolf:3'), 'one of wave 1 still stands').toBe(false);
    kill(sim, 'wolf:2'); sim.host.step();
    expect(present(sim, 'wolf:3')).toBe(true);
  } finally { sim.dispose(); }
});

test('OF29a: a save keeps who is absent and which waves opened; a shard with no `when` installs nothing', () => {
  const rows = [{ when: { quest: { id: 'hunt', stage: 2 } } }];
  const sim = createShardfileSim(shard(rows), new Map(), { rapier });
  let back: ReturnType<typeof restoreSimHost> | undefined;
  try {
    const level = sim.host.level;
    back = restoreSimHost(level, { rapier }, snapshotSimHost(sim.host), fresh => { bindShardfileSim(fresh, shard(rows), new Map(), { rapier, restoring: true }); });
    const restored = back.entities.get('wolf:1');
    expect(restored !== undefined && spawnAbsent(restored) && !restored.alive).toBe(true);
    back.step();
    expect(back.entities.get('wolf:1')?.alive).toBe(false);
  } finally { back?.dispose(); sim.dispose(); }
  const plain = createShardfileSim(shard([{}]), new Map(), { rapier });
  try { expect(plain.host.adapters.has(SPAWN_WHEN_STEP)).toBe(false); } finally { plain.dispose(); }
});

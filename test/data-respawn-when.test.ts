// oxlint-disable-next-line import/no-nodejs-modules -- The declared simulation runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { parseRows } from '@wildshard/format/rows';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { DATA_RESPAWN_STEP } from '../src/server/game/shardfile/dataRespawn';
import { hostDay, installDeclaredClimate } from '../src/server/game/shardfile/declaredClimate';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// ONE-FORMAT OF22b3: a declared spawn's `respawnWhen` waits as Driftwood's island returns do (`mixedRoster.ts`, `ReturnGate`,
// `RespawnQueue`): the practice crab 45 s dead, the player 30 m off, a 1.5 s fade; a crab 240 to 360 s, out of sight; the
// sailor only by night.
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
type Spawn = Shardfile['creatures']['spawns'][number];
const DT = 1 / 60;
function shard(rows: readonly Partial<Spawn>[]): Shardfile {
  const source = emptyShardfile({ slug: 'respawn-when', name: 'Respawn when', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'crab', kind: 'boar', label: 'Crab', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'small', label: 'Crab', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = rows.map((row, index) => ({ id: `crab:${String(index + 1)}`, species: 'crab', variant: 'small', brain: null, strike: null,
    seed: index + 1, scale: 1, at: [4 + index * 3, 0, 6], yaw: 0, ...row }));
  return source;
}
type Hosted = Pick<ShardfileSimulation, 'host'>;
const body = (sim: Hosted, id: string) => { const b = sim.host.entities.get(id); if (b === undefined) throw new Error(`Missing ${id}`); return b; };
const kill = (sim: ShardfileSimulation, id: string): void => {
  const lead = leadPlayer(sim.host), b = body(sim, id);
  sim.host.combat.hit({ source: lead.health, sourceTags: ['actor.player', 'dmg.melee'], target: b.combatActor(), amount: 1000, point: b.position.clone(), dir: new Vector3(0, 0, 1) });
  sim.host.step();
};
/** Step `seconds`, holding the lead player at (x, z); the seconds it took the body to come back, or null. */
function run(sim: Hosted, id: string, seconds: number, x: number, z: number): number | null {
  const lead = leadPlayer(sim.host);
  for (let tick = 0; tick < Math.round(seconds / DT); tick++) {
    lead.position.set(x, lead.position.y, z); lead.velocity.set(0, lead.velocity.y, 0);
    sim.host.step();
    if (body(sim, id).alive) return (tick + 1) * DT;
  }
  return null;
}

test('the practice crab waits out its 45 s with the player near, then fades 1.5 s once the player is 30 m off', () => {
  const sim = createShardfileSim(shard([{ respawn: 45, respawnWhen: { away: 30, fade: 1.5 } }]), new Map(), { rapier });
  try {
    kill(sim, 'crab:1');
    expect(body(sim, 'crab:1').alive).toBe(false);
    expect(run(sim, 'crab:1', 60, 6, 8), 'the player stands beside the spawn').toBeNull();
    const back = run(sim, 'crab:1', 5, 4, 40);
    expect(back).not.toBeNull();
    expect(back ?? 0).toBeCloseTo(1.5, 1);
  } finally { sim.dispose(); }
});

test('a spread return comes back between its respawn and respawn + spread, and a save mid-fade restores exactly', () => {
  const rows = [{ respawn: 4, respawnWhen: { spread: 2, away: 10, fade: 1 } }];
  const sim = createShardfileSim(shard(rows), new Map(), { rapier });
  try {
    kill(sim, 'crab:1');
    const back = run(sim, 'crab:1', 10, 4, 40);
    expect(back).not.toBeNull();
    expect(back ?? 0).toBeGreaterThanOrEqual(5 - DT); expect(back ?? 0).toBeLessThanOrEqual(7 + DT);
    // a save mid-fade keeps its fade; the restore comes back on the same tick
    kill(sim, 'crab:1');
    run(sim, 'crab:1', 2, 6, 8);
    expect(run(sim, 'crab:1', 8, 6, 8)).toBeNull();
    const lead = leadPlayer(sim.host); lead.position.set(4, lead.position.y, 40);
    for (let tick = 0; tick < 20; tick++) sim.host.step();
    const saved = snapshotSimHost(sim.host), step = saved.adapters.find(row => row.id === DATA_RESPAWN_STEP);
    expect(JSON.stringify(step)).toContain('fades');
    const restored = restoreSimHost(sim.host.level, { rapier }, saved, fresh => { bindShardfileSim(fresh, shard(rows), new Map(), { rapier, restoring: true }); });
    try {
      const a = run(sim, 'crab:1', 3, 4, 40), b = run({ host: restored }, 'crab:1', 3, 4, 40);
      expect(a).not.toBeNull(); expect(b).toBe(a);
    } finally { restored.dispose(); }
  } finally { sim.dispose(); }
});

test('a night return waits for the night', () => {
  const schedule = [{ phase: 'night', from: 0, to: 5 }, { phase: 'dawn', from: 5, to: 7 }, { phase: 'day', from: 7, to: 17 }, { phase: 'dusk', from: 17, to: 19 },
    { phase: 'night', from: 19, to: 24 }].map(row => ({ ...row, minutes: 2 }));
  const day = { id: 'fixture.day', units: 'hour', start: 12, schedule, sun: { maxElevation: 60, azimuthOffset: 35 },
    fixed: { midday: 12, golden: 17, sunset: 18, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 0 } };
  const sim = createShardfileSim(shard([{ respawn: 2, respawnWhen: { night: true } }]), new Map(), { rapier });
  try {
    installDeclaredClimate(sim.host, parseRows({ weather: [], days: [day], compendiums: [], loot: [], strikes: [], looks: [], species: [] }));
    actRoutes(sim.host).day?.(10 / 24); sim.host.step();
    expect(hostDay(sim.host)?.dayPhase).toBe('day');
    kill(sim, 'crab:1');
    expect(run(sim, 'crab:1', 5, 4, 40), 'by day it waits').toBeNull();
    actRoutes(sim.host).day?.(22.5 / 24);
    expect(run(sim, 'crab:1', 1, 4, 40)).not.toBeNull();
  } finally { sim.dispose(); }
});

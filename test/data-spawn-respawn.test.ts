// oxlint-disable-next-line import/no-nodejs-modules -- The real host runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, bindShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { questBooks } from '../src/shared/engine/quest/players';
import { captureClientState, restoreClientState } from '../src/shared/game/shardfile/clientState';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { saveRevision } from '../src/shared/game/shardfile/saveRevision';

// TEMPLATE-E2E TC-E2 (J361): a data spawn's `respawn` (shard-format 0.5.8) brings its body back, whole, at its `at` that
// many seconds after it dies; a spawn without one stays dead. The wait is host state: a save keeps the clock.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function fixture() {
  const source = emptyShardfile({ slug: 'respawn-cell', name: 'Respawn', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'bandit', kind: 'boar', label: 'Bandit', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Bandit', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = [
    { id: 'back', species: 'bandit', variant: 'base', brain: null, strike: null, seed: 1, scale: 1, at: [4, 0, 6], yaw: 0.5, respawn: 5 },
    { id: 'gone', species: 'bandit', variant: 'base', brain: null, strike: null, seed: 2, scale: 1, at: [-4, 0, 6], yaw: 0 }];
  return { source, assets: new Map<string, Uint8Array>(), sections: new Map<string, unknown>() };
}
function kill(sim: ShardfileSimulation, id: string): void {
  const body = sim.host.entities.get(id); if (body === undefined) throw new Error(`Missing ${id}`);
  sim.host.combat.hit({ source: 'env', sourceTags: ['actor.player', 'dmg.ranged'], target: body.combatActor(), amount: 1000, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
  expect(body.alive).toBe(false);
}
const steps = (sim: { step: () => void }, n: number): void => { for (let i = 0; i < n; i++) sim.step(); };

test('a spawn with respawn stands again at its spawn, whole, after its seconds; one without stays dead', async () => {
  const f = fixture(), sim = createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: await rapier });
  try {
    const back = sim.host.entities.get('back'), gone = sim.host.entities.get('gone');
    if (back === undefined || gone === undefined) throw new Error('Missing bodies');
    back.place(10, 12, 2); kill(sim, 'back'); kill(sim, 'gone');
    steps(sim.host, 60 * 5 - 2);
    expect(back.alive).toBe(false);
    steps(sim.host, 4);
    expect(back.alive).toBe(true); expect(back.hp).toBe(back.maxHp);
    expect([back.position.x, back.position.z, back.yaw]).toEqual([4, 6, 0.5]);
    expect(back.motor).not.toBeNull(); // still solid: a revived body keeps its capsule (review MUST)
    expect(gone.alive).toBe(false);
    steps(sim.host, 60 * 10);
    expect(gone.alive).toBe(false);
    kill(sim, 'back'); steps(sim.host, 60 * 5 + 2);
    expect(back.alive).toBe(true);
  } finally { sim.dispose(); }
});

test('a save mid-wait keeps the respawn clock', async () => {
  const f = fixture(), R = await rapier, sim = createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: R });
  let resumed: ShardfileSimulation | undefined;
  try {
    kill(sim, 'back'); steps(sim.host, 60 * 3);
    const restored = restoreSimHost(sim.host.level, { rapier: R }, snapshotSimHost(sim.host),
      host => { resumed = bindShardfileSim(host, f.source, f.assets, { sections: f.sections, rapier: R, restoring: true }); });
    const back = restored.entities.get('back'); if (back === undefined) throw new Error('Missing restored body');
    expect(back.alive).toBe(false);
    steps(restored, 60 * 2 - 2); expect(back.alive).toBe(false);
    steps(restored, 4); expect(back.alive).toBe(true);
  } finally { sim.dispose(); resumed?.dispose(); }
});

test('a respawn clears its death flag and a later MMO player can earn the next kill', async () => {
  const f = fixture();
  f.source.quests = { flags: ['bear.dead'], quests: [], dialogue: [], triggers: [{ id: 'bear-kill', kind: 'death', tag: 'creature.bandit', flag: 'bear.dead' }] };
  const sim = createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: await rapier });
  try {
    kill(sim, 'back'); sim.host.step();
    expect(sim.host.flags.has('dead:back')).toBe(true);
    steps(sim.host, 60 * 5 + 2);
    expect(sim.host.flags.has('dead:back')).toBe(false);
    sim.host.addPlayer('late-player', { x: 0, y: 0, z: 0 });
    expect(questBooks(sim.host).of('late-player').flags.has('bear.dead')).toBe(false);
    kill(sim, 'back'); sim.host.step();
    expect(questBooks(sim.host).of('late-player').flags.has('bear.dead')).toBe(true);
  } finally { sim.dispose(); }
});

test('a new revision carries a dead body and resumes its authored timer without the old clock', async () => {
  const f = fixture(), R = await rapier, sim = createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: R });
  let next: ShardfileSimulation | undefined;
  try {
    kill(sim, 'back'); kill(sim, 'gone'); sim.host.step();
    const saved = captureClientState(f.source, sim, new Map());
    // FP26: bump the save lineage under whichever spelling this format pin gives it.
    Object.assign(f.source.identity, { ['saveRevision' in f.source.identity ? 'saveRevision' : 'revision']: saveRevision(f.source.identity) + 1 });
    next = createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: R });
    expect(restoreClientState(f.source, next, new Map(), saved)).toBe(true);
    const body = next.host.entities.get('back'); if (body === undefined) throw new Error('Missing body');
    expect(body.alive).toBe(false);
    next.host.step(); // reconstruct the missing timer, then spend asleep time as declared homes do
    next.host.events.emit('world.slept', { seconds: 6 });
    steps(next.host, 2);
    expect(body.alive).toBe(true);
    expect(next.host.flags.has('dead:back')).toBe(false);
    expect(next.host.entities.get('gone')?.alive).toBe(false);
    expect(next.host.flags.has('dead:gone')).toBe(true);
  } finally { sim.dispose(); next?.dispose(); }
});

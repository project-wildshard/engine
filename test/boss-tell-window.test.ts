// oxlint-disable-next-line import/no-nodejs-modules -- The real host runs the shipped Rapier bytes and the fixture's compiled modules.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseActorMoves } from '@wildshard/format/actorMoves';
import { createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// TE-ENG1: a boss built only from rows and its decision (test/fixtures/boss-tell, built by its build.mjs). The decision
// raises scene field 110 (the tell) with its slam, then drops it and opens scene field 111 (the core) with a declared
// damage window, then shuts both. Panels read those fields; the encounter's guard decides which hits land.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const fixtureBytes = (name: string): Uint8Array => Uint8Array.from(readFileSync(`test/fixtures/boss-tell/${name}.wasm`));
function warden(guard: 'melee' | 'open') {
  const source = emptyShardfile({ slug: 'boss-tell', name: 'Boss tell', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'warden', kind: 'boar', label: 'Warden', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'warden', label: 'Warden', rarity: 'common', weight: 1, scale: [1, 1], hp: 400, mods: structuredClone(native.spec.mods) }] }];
  source.rows.strikes = [{ id: 'slam', shape: { kind: 'sphere', radius: 3 }, windup: 0.6, active: 0.1, recover: 0.2, cooldown: 0.5, range: 30, damage: 1, tags: ['dmg.melee'], weight: 1, speed: 0 }];
  source.creatures.spawns = [{ id: 'warden', species: 'warden', variant: 'warden', brain: null, strike: null, seed: 1, scale: 1, at: [0, 0, 6], yaw: 0 }];
  source.encounters = [{ id: 'warden.fight', entity: 'warden', kind: 'boss', panel: null, name: 'Warden', title: 'Test', retry: 'Retry', arena: { at: [0, 0, 6], radius: 30 },
    intro: 0, introShort: 0, respawn: { at: [0, 0, 0], yaw: 0 }, phases: [{ at: 1, name: 'Fight', caption: 'Fight', speed: 0, stopDistance: 0, turnRate: 2 }] }];
  source.state.shared = [{ id: 110, name: 'warden.tell', type: 'bool', privacy: 'public', default: 0, min: 0, max: 1 },
    { id: 111, name: 'warden.open', type: 'bool', privacy: 'public', default: 0, min: 0, max: 1 }];
  const scene = fixtureBytes('scene'), sceneHash = hashImmutableBytes(scene), decision = fixtureBytes(`decision-${guard}`), hash = hashImmutableBytes(decision);
  source.sim.scripts = [sceneHash]; source.sim.bindings = [{ module: sceneHash, entity: 1, actorId: null, kind: 'server' }];
  const scripts = parseDecisionScripts([{ id: 'warden.decision', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/warden.as',
    binding: { encounter: 'warden.fight' }, onFail: 'hold', on: ['start', 'player.join', 'timer', 'strike.done', 'stop'], reads: [], commands: ['strike', 'field', 'timer', 'encounter'],
    stateVersion: 1, state: [{ name: 'step', type: 'i32', default: 0, scope: 'binding' }], params: {}, timers: ['window'],
    actors: { boss: 'warden' }, strikes: { slam: 'slam' }, fields: { tell: 'warden.tell', open: 'warden.open' } }]);
  const sections = new Map<string, unknown>([['sim/scripts', scripts], ['actors/moves', parseActorMoves([])]]);
  return { source, assets: new Map([[sceneHash, scene], [hash, decision]]), sections };
}
async function fight(guard: 'melee' | 'open'): Promise<ShardfileSimulation> {
  const f = warden(guard);
  return createShardfileSim(f.source, f.assets, { sections: f.sections, rapier: await rapier });
}
function field(sim: ShardfileSimulation, name: string): number | undefined { return sim.lane?.world.publicField(name); }
function hit(sim: ShardfileSimulation, kind: 'melee' | 'ranged'): number {
  const body = sim.host.entities.get('warden'); if (body === undefined) throw new Error('Missing warden');
  const before = body.hp;
  sim.host.combat.hit({ source: 'env', sourceTags: ['actor.player', kind === 'melee' ? 'weapon.sword-iron' : 'weapon.rifle', `dmg.${kind}`], target: body.combatActor(),
    amount: 10, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
  return before - body.hp;
}
/** Step until `when` holds (at most `limit` fixed steps); the step count it took. */
function until(sim: ShardfileSimulation, when: () => boolean, limit = 600): number {
  for (let i = 0; i < limit; i++) { if (when()) return i; sim.host.step(); }
  throw new Error('Condition never held');
}

test('the decision raises the tell before the slam lands, and hits outside the window do nothing', async () => {
  const sim = await fight('melee');
  try {
    expect(field(sim, 'warden.tell')).toBe(0);
    until(sim, () => field(sim, 'warden.tell') === 1);
    expect(sim.host.strikes.get('warden')?.state).toBe('windup');
    expect(sim.encounters.get('warden.fight')?.boss.state).toBe('fight');
    expect(hit(sim, 'melee')).toBe(0); expect(hit(sim, 'ranged')).toBe(0);
    until(sim, () => sim.host.strikes.get('warden')?.state === 'active');
    expect(field(sim, 'warden.tell')).toBe(1); expect(field(sim, 'warden.open')).toBe(0);
    expect(hit(sim, 'melee')).toBe(0);
  } finally { sim.dispose(); }
});

test('sword hits land in the declared window and a gun is gated; the window shuts again', async () => {
  const sim = await fight('melee');
  try {
    until(sim, () => field(sim, 'warden.open') === 1);
    expect(field(sim, 'warden.tell')).toBe(0);
    expect(hit(sim, 'melee')).toBe(10);
    expect(hit(sim, 'ranged')).toBe(0);
    const encounter = sim.host.adapters.get('encounter.warden.fight'), saved = encounter?.snapshot();
    expect(saved).toContain('"guard":2'); encounter?.restore(saved ?? ''); expect(hit(sim, 'ranged')).toBe(0);
    until(sim, () => field(sim, 'warden.open') === 0);
    expect(hit(sim, 'melee')).toBe(0);
  } finally { sim.dispose(); }
});

test('an open window with no weapon gate lets every hit land', async () => {
  const sim = await fight('open');
  try {
    until(sim, () => field(sim, 'warden.open') === 1);
    expect(hit(sim, 'melee')).toBe(10); expect(hit(sim, 'ranged')).toBe(10);
  } finally { sim.dispose(); }
});

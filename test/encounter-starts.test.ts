import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { primitivesOf } from '../src/server/game/shardfile/hostPrimitives';
import type { SimCommand } from '../src/server/engine/sim';

// ONE-FORMAT OF34b (J420 (1), Jake 2026-11-18: bosses are three parts): the declared encounter runs each `start` from a
// plain upload. `placed` stands from load (as before), `spawned` has no body until a player enters the arena, `resident`
// fights from the first blow wherever it stands. `capExempt` keeps the boss's blows out of the fight cap. `room` bounds
// reset the fight once every contender has left; `open` bounds reset it once the boss is drawn past the radius.
type Encounter = Shardfile['encounters'][number];
const BOSS = 'fixture.boss:1', HOME: [number, number, number] = [20, 0, 0], RADIUS = 6;
function bossShard(fields: Partial<Pick<Encounter, 'start' | 'capExempt'>> & { bounds?: 'room' | 'open' } = {}) {
  const base = emptyShardfile({ slug: 'starts-fixture', name: 'Starts fixture', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'fixture.boss.look', species: 'fixture.boss', recipe: 'fixture.placeholder', material: null, parameters: {},
    animation: { recipe: 'fixture.placeholder', parameters: {} } }];
  const species = [{
    id: 'fixture.boss', kind: 'blob', label: 'boss', aggressive: false, lockable: true,
    dims: { bodyY: 0.5, bodyHalfLen: 0.5, bodyRadius: 0.5, headRadius: 0.2, legLen: 0.1, feet: [], halfWidth: 0.5 },
    variants: [{ id: 'grey', label: 'Grey', rarity: 'common', weight: 1, scale: [1, 1], hp: 600,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } }],
    body: { size: 'small', scale: 1, look: 'fixture.boss.look' },
    temperament: { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } },
    senses: { notice: 4 },
  }];
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], strikes: [], looks, species });
  const spawns: ShardCreatures['spawns'] = [{ id: BOSS, species: 'fixture.boss', variant: 'grey', brain: null, strike: null, at: HOME, seed: 1, scale: 1, yaw: 0 }];
  const { bounds, ...rest } = fields;
  const encounter: Encounter = { id: 'fixture.fight', entity: BOSS, kind: 'boss', panel: null, name: 'Boss', title: 'of the fixture', retry: 'Again',
    ...rest, arena: { at: HOME, radius: RADIUS, ...(bounds === undefined ? {} : { bounds }) }, intro: 0, introShort: 0,
    respawn: { at: [0, 0, 0], yaw: 0 }, phases: [{ at: 1, name: 'I', caption: 'one', speed: 0, stopDistance: 1, turnRate: 4 }] };
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, rows, creatures: { brains: [], groups: [], spawns }, encounters: [encounter] };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const still: SimCommand = { moveX: 0, moveZ: 0, yaw: 0 };
function world(fields: Parameters<typeof bossShard>[0]) {
  const sim = createShardfileSim(bossShard(fields), new Map(), { rapier });
  const player = sim.host.players.values().next().value, body = sim.host.entities.get(BOSS), fight = sim.encounters.get('fixture.fight');
  if (player === undefined || body === undefined || fight === undefined) throw new Error('Missing player, body or fight');
  const tick = (count = 1): void => { for (let i = 0; i < count; i++) sim.host.step(new Map([[player.id, still]])); };
  const stand = (x: number, z = 0): void => { player.position.set(x, 0, z); player.motor.resetAt(player.position); };
  return { sim, player, body, fight, tick, stand };
}
/** The player's blow on the boss, wherever the player stands. */
function strike(sim: ShardfileSimulation, amount = 10): void {
  const player = sim.host.players.values().next().value, body = sim.host.entities.get(BOSS);
  if (player === undefined || body === undefined) throw new Error('Missing player or body');
  sim.host.combat.hit({ source: player.health, sourceTags: [], target: body.combatActor(), amount, weaponId: 'weapon.fixture-sword', moveId: 'move.fixture',
    point: body.position.clone(), dir: new Vector3(0, 0, 1) });
}
const hidden = (body: object): boolean => 'hidden' in body && body.hidden === true;

test('OF34b: a placed boss stands from load and fights once a player enters its arena', () => {
  const { sim, body, fight, tick, stand } = world({});
  try {
    tick();
    expect(body.alive).toBe(true);
    expect(fight.boss.state).toBe('armed');
    stand(HOME[0] - 2); tick(3);
    expect(fight.boss.state).toBe('fight');
  } finally { sim.dispose(); }
});

test('OF34b: a spawned boss has no body until a player enters its arena, and leaves again when the fight resets', () => {
  const { sim, body, fight, tick, stand } = world({ start: 'spawned', bounds: 'room' });
  try {
    tick();
    expect(body.alive).toBe(false);
    expect(hidden(body)).toBe(true);
    strike(sim); tick();
    expect(body.hp, 'no blow lands on an absent body').toBe(body.maxHp);
    stand(HOME[0] - 2); tick(3);
    expect(fight.boss.state).toBe('fight');
    expect(body.alive).toBe(true);
    expect(hidden(body)).toBe(false);
    expect(body.position.distanceTo(new Vector3(...HOME))).toBeLessThan(1);
    stand(0); tick(3);
    expect(fight.boss.state).toBe('armed');
    expect(body.alive).toBe(false);
    expect(hidden(body)).toBe(true);
  } finally { sim.dispose(); }
});

test('OF34b: a resident boss ignores its arena and fights from the first blow, wherever the player stands', () => {
  const { sim, body, fight, tick, stand } = world({ start: 'resident' });
  try {
    tick();
    expect(body.alive).toBe(true);
    stand(HOME[0] - 2); tick(30);
    expect(fight.boss.state, 'standing in the arena starts nothing').toBe('armed');
    stand(HOME[0] - 12); tick();
    strike(sim); tick(3);
    expect(fight.boss.state).toBe('fight');
    strike(sim); tick();
    expect(body.hp).toBeLessThan(body.maxHp);
  } finally { sim.dispose(); }
});

test('OF34b: capExempt keeps the boss out of the fight cap', () => {
  const exempt = world({ capExempt: true }), capped = world({});
  try {
    expect(exempt.body.capExempt).toBe(true);
    expect(capped.body.capExempt).not.toBe(true);
  } finally { exempt.sim.dispose(); capped.sim.dispose(); }
});

test('OF34b: room bounds reset the fight when every contender has left the arena', () => {
  const { sim, body, fight, tick, stand } = world({ bounds: 'room' });
  try {
    stand(HOME[0] - 2); tick(3);
    expect(fight.boss.state).toBe('fight');
    strike(sim, 100); tick();
    expect(body.hp).toBeLessThan(body.maxHp);
    stand(0); tick(3);
    expect(fight.boss.state).toBe('armed');
    expect(body.hp).toBe(body.maxHp);
  } finally { sim.dispose(); }
});

test('OF34b: open bounds reset the fight once the boss is drawn past its radius, and it goes home', () => {
  const { sim, body, fight, tick, stand } = world({ bounds: 'open' });
  try {
    stand(HOME[0] - 2); tick(3);
    expect(fight.boss.state).toBe('fight');
    stand(0); tick(3);
    expect(fight.boss.state, 'open ground: the player leaving alone resets nothing').toBe('fight');
    strike(sim, 100); tick();
    body.place(HOME[0] - RADIUS - 2, HOME[2], 0, HOME[1]); body.motor?.resetAt?.(body.position); tick(3);
    expect(fight.boss.state).toBe('armed');
    expect(body.hp).toBe(body.maxHp);
    expect(body.position.distanceTo(new Vector3(...HOME))).toBeLessThan(1);
  } finally { sim.dispose(); }
});

// ONE-FORMAT OF17b2 (J365 (6)): the boss primitive comes from the boss section alone. The fixture names no host and ships
// no native-assembly list; its one boss encounter row switches `boss` on, its arena bounds `boss.arena`, and the same
// product without the row runs neither.
test('OF17b2: a boss section alone switches the boss primitive on, and taking it out switches it off', () => {
  const runs = (shard: ReturnType<typeof bossShard>): readonly string[] => {
    const sim = createShardfileSim(shard, new Map(), { rapier });
    try { return primitivesOf(sim.host); } finally { sim.dispose(); }
  };
  for (const start of ['placed', 'spawned', 'resident'] as const) {
    const on = runs(bossShard({ start }));
    expect(on, start).toContain('boss');
    expect(on, start).not.toContain('boss.arena');
  }
  expect(runs(bossShard({ bounds: 'room' }))).toEqual(expect.arrayContaining(['boss', 'boss.arena']));
  const off = runs({ ...bossShard(), encounters: [] });
  expect(off).not.toContain('boss');
  expect(off).not.toContain('boss.arena');
});

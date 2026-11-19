// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { CREATURE_RANKS } from '@wildshard/format/creatureRanks';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { openCellWorld, type CellWorld } from '../src/server/host/standalone/cellWorld';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// ONE-FORMAT OF33b (OF29c, Q-CC33 (a)): a declared spawn row's `rank` makes a stronger version of the same creature. The
// engine applies the format's own multipliers (`@wildshard/format/creatureRanks`, OF33a), so a shard only names the rank:
// the body's hp, every blow it lands, its size and its loot rolls. An unranked row keeps its own numbers.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const HP = 40, COINS = 7;
function shard() {
  const source = emptyShardfile({ slug: 'rank-cell', name: 'Rank cell', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'wolf', kind: 'boar', label: 'Wolf', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'grey', label: 'Wolf', rarity: 'common', weight: 1, scale: [1, 1], hp: HP, mods: structuredClone(native.spec.mods) }] }];
  const row = { species: 'wolf', variant: 'grey', brain: null, strike: null, seed: 1, scale: 1, yaw: 0 };
  source.creatures.spawns = [{ ...row, id: 'wolf:plain', at: [4, 0, 6] }, { ...row, id: 'wolf:champion', rank: 'champion', at: [-4, 0, 6] },
    { ...row, id: 'wolf:pack', rank: 'veteran', count: { per: 1, max: 2 }, at: [0, 0, 12] }];
  source.rows.loot = [{ id: 'purse', gear: 'purse.coins', finds: null, marks: null, charted: false, chime: 'coin',
    economy: { tables: [{ id: 'coins', domain: 'coins', table: { mode: 'weighted', rows: [{ item: 'coin', weight: 1, count: COINS, match: { kind: 'boar' } }] } }] } }] as never;
  return source;
}
async function open(): Promise<CellWorld> {
  return openCellWorld({ instance: 'rank-cell' }, { shard: shard(), assets: new Map(), sections: new Map(), rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone: false, pageless: true });
}
function body(cell: CellWorld, id: string) {
  const found = cell.host.entities.get(id); if (found === undefined) throw new Error(`Missing ${id}`);
  return found;
}
function lead(cell: CellWorld) {
  const player = [...cell.host.players.values()][0]; if (player === undefined) throw new Error('Missing player');
  return player;
}
/** The lead kills `id` in one blow, and the tick that hears the death runs; the coins it paid. */
function kill(cell: CellWorld, id: string): number[] {
  const target = body(cell, id);
  cell.host.combat.hit({ source: lead(cell).health, sourceTags: ['actor.player', 'dmg.ranged'], target: target.combatActor(), amount: 100000,
    point: target.position.clone(), dir: new Vector3(0, 0, 1) });
  expect(target.alive).toBe(false);
  cell.step([]);
  return cell.effects().flatMap(effect => effect.kind === 'coins' ? [effect.amount] : []);
}
/** What a 10-point blow from `id` takes off the lead. */
function bite(cell: CellWorld, id: string): number {
  const player = lead(cell), before = player.health.attributes.health;
  cell.host.combat.hit({ source: body(cell, id).combatActor(), sourceTags: ['actor.creature'], target: player.health, amount: 10,
    point: player.position.clone(), dir: new Vector3(0, 0, 1) });
  const taken = before - player.health.attributes.health;
  player.health.attributes.health = before;
  return taken;
}

test('OF33b: a champion wolf has its rank\'s hp, damage, size and loot; a plain one keeps its own', async () => {
  const cell = await open(), champion = CREATURE_RANKS.champion;
  try {
    const plain = body(cell, 'wolf:plain'), ranked = body(cell, 'wolf:champion');
    expect(plain.maxHp).toBe(HP);
    expect(ranked.maxHp).toBe(HP * champion.hp);
    expect(ranked.scale).toBeCloseTo(plain.scale * champion.size, 6);
    const plainBite = bite(cell, 'wolf:plain');
    expect(plainBite).toBeGreaterThan(0);
    expect(bite(cell, 'wolf:champion')).toBeCloseTo(plainBite * champion.damage, 6);
    expect(kill(cell, 'wolf:plain')).toEqual([COINS]);
    expect(kill(cell, 'wolf:champion'), 'one payment of the rank\'s rolls').toEqual([COINS * champion.loot]);
  } finally { cell.dispose(); }
});

test('OF33b: a counted ranked row\'s copies carry its rank', async () => {
  const cell = await open(), veteran = CREATURE_RANKS.veteran;
  try {
    for (const id of ['wolf:pack', 'wolf:pack.2']) expect(body(cell, id).maxHp).toBe(HP * veteran.hp);
  } finally { cell.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { openCellWorld, type CellWorld } from '../src/server/host/standalone/cellWorld';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// TEMPLATE-E2E TC-E6 (Jake, 2026-11-15 QA row 33, "kills drop loot"): only a native runtime paid per-kill loot; a grid data
// cell paid coins through quest steps alone, so a single Brasscap bandit dropped nothing. A data cell now rolls each
// meaningful hitter's coins off the shard's `economy` loot tables, as a native room does (J105), and files them in the
// tick's effects. A one-shard page pays its own lone player, so there the cell pays only once a second player is in.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard(tables: boolean) {
  const source = emptyShardfile({ slug: 'loot-cell', name: 'Loot cell', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'bandit', kind: 'boar', label: 'Bandit', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Bandit', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = [{ id: 'bandit:1', species: 'bandit', variant: 'base', brain: null, strike: null, seed: 1, scale: 1, at: [4, 0, 6], yaw: 0 }];
  if (tables) source.rows.loot = [{ id: 'purse', gear: 'purse.coins', finds: null, marks: null, charted: false, chime: 'coin',
    economy: { tables: [{ id: 'coins', domain: 'coins', table: { mode: 'weighted', rows: [{ item: 'coin', weight: 1, count: 7, match: { kind: 'boar' } }] } }] } }] as never;
  return source;
}
async function open(tables: boolean, lone: boolean): Promise<CellWorld> {
  return openCellWorld({ instance: 'loot-cell' }, { shard: shard(tables), assets: new Map(), sections: new Map(), rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone, pageless: true });
}
/** The lead shoots the bandit dead, and the tick that hears the death runs. */
function kill(cell: CellWorld): void {
  const { host } = cell, lead = [...host.players.values()][0], body = host.entities.get('bandit:1');
  if (lead === undefined || body === undefined) throw new Error('Missing fixture');
  host.combat.hit({ source: lead.health, sourceTags: ['actor.player', 'dmg.ranged'], target: body.combatActor(), amount: 1000, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
  expect(body.alive).toBe(false);
  cell.step([]);
}
const coins = (cell: CellWorld): number[] => cell.effects().flatMap(effect => effect.kind === 'coins' ? [effect.amount] : []);

test('a grid data cell pays its lone killer the table\'s coins, once per slot', async () => {
  const cell = await open(true, false);
  try {
    kill(cell);
    const lead = [...cell.host.players.values()][0];
    expect(coins(cell)).toEqual([7]);
    expect(cell.effects().find(effect => effect.kind === 'coins')).toMatchObject({ actorId: lead?.id });
    cell.step([]);
    expect(coins(cell), 'a death pays on the tick that hears it, not again').toEqual([]);
  } finally { cell.dispose(); }
});

test('a data cell with no loot table pays nothing for a kill', async () => {
  const cell = await open(false, false);
  try { kill(cell); expect(coins(cell)).toEqual([]); } finally { cell.dispose(); }
});

test('a one-shard page\'s lone player is paid by the page, not the cell', async () => {
  const cell = await open(true, true);
  try { kill(cell); expect(coins(cell)).toEqual([]); } finally { cell.dispose(); }
});

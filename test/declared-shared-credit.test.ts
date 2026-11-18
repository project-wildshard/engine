// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { CREDIT_PREFIX, questBooks } from '../src/shared/engine/quest/players';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// ONE-FORMAT OF29d (Q-CC36): shared credit on a plain upload. A declared kill credits, and pays its own loot roll to,
// every player over the damage-share bar (J105 `MEANINGFUL_SHARE`, `DamageBook.meaningful`); a 1-hp tap earns neither.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard() {
  const source = emptyShardfile({ slug: 'credit-cell', name: 'Credit cell', author: 'Test', seed: 7, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'wolf', kind: 'boar', label: 'Wolf', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'base', label: 'Wolf', rarity: 'common', weight: 1, scale: [1, 1], hp: 40, mods: structuredClone(native.spec.mods) }] }];
  source.creatures.spawns = [{ id: 'wolf:1', species: 'wolf', variant: 'base', brain: null, strike: null, seed: 1, scale: 1, at: [4, 0, 6], yaw: 0 }];
  source.rows.loot = [{ id: 'purse', gear: 'purse.coins', finds: null, marks: null, charted: false, chime: 'coin',
    economy: { tables: [{ id: 'coins', domain: 'coins', table: { mode: 'weighted', rows: [{ item: 'coin', weight: 1, count: 7, match: { kind: 'boar' } }] } }] } }] as never;
  return source;
}

test('OF29d: two players over the damage-share bar each get the kill and their own roll; a 1-hp tap gets neither', async () => {
  const cell = await openCellWorld({ instance: 'credit-cell' }, { shard: shard(), assets: new Map(), sections: new Map(), rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone: false, pageless: true });
  try {
    const { host } = cell, lead = [...host.players.values()][0], body = host.entities.get('wolf:1');
    if (lead === undefined || body === undefined) throw new Error('Missing fixture');
    const second = host.addPlayer('p2', { x: 2, y: 0, z: 2 }), tapper = host.addPlayer('p3', { x: -2, y: 0, z: 2 });
    const hit = (source: typeof lead, amount: number): void => {
      host.combat.hit({ source: source.health, sourceTags: ['actor.player', 'dmg.melee'], target: body.combatActor(), amount, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    };
    hit(lead, 20); hit(tapper, 1); hit(second, 19);
    expect(body.alive).toBe(false);
    cell.step([]);
    const paid = cell.effects().flatMap(effect => effect.kind === 'coins' ? [[effect.actorId, effect.amount] as const] : []);
    expect(new Map(paid)).toEqual(new Map([[lead.id, 7], [second.id, 7]]));
    const books = questBooks(host), credit = `${CREDIT_PREFIX}wolf:1`;
    expect([lead.id, second.id, tapper.id].map(player => books.of(player).flags.has(credit))).toEqual([true, true, false]);
  } finally { cell.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { eliteNetView } from '../src/shared/engine/sim/encounterRows';
import { questBooks } from '../src/shared/engine/quest/players';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { EliteCore, memoryElitePersistence, type EliteCoreScript } from '../src/shared/game/eliteSystem';
import { eliteDrops, eliteSkinFlag } from '../src/server/game/quest/eliteDrops';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// SERVER-CELLS SC10 item 4 (J328): a grid cell's world is never rebuilt, so in a served world an elite's skin is each player's own.
// Before, the first taker's press marked the lair's world record and no later kill dropped it again, for anyone, until a restart.
interface Body { entityId: string; alive: boolean; position: { x: number; y: number; z: number }; hp: number; maxHp: number; lastHitT: number }
type Script = EliteCoreScript<Body>;

test('in a served world each player takes the lair\'s skin once, and an owner\'s press takes nothing', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try {
    host.respawn.served = true;
    const body: Body = { entityId: 'lair.body', alive: true, position: { x: 4, y: 0, z: 4 }, hp: 10, maxHp: 10, lastHitT: -1 };
    const script: Script = { def: { id: 'lair', lair: { x: 4, z: 4, r: 3 }, awareR: 1, engageR: 1, leashR: 900, rule: 'always', respawnMin: 9, drop: { skin: 'sabre' } }, animal: body, spawn: () => undefined, despawn: () => undefined, tick: () => undefined, enterPhase2: () => undefined, reset: () => undefined, trophy: () => undefined };
    const drops = eliteDrops<Script>(host), core = new EliteCore<Script>({ players: host.players, condition: () => true }, drops.hooks, 'level', memoryElitePersistence());
    drops.bind(core);
    const entry = core.add(script), [lead] = host.players.keys(); if (lead === undefined) throw new Error('No lead');
    host.parked.add(lead); // a served world's lead seat with nobody in it
    const a = host.addPlayer('a', { x: 4, y: 0, z: 5 }), b = host.addPlayer('b', { x: 40, y: 0, z: 40 }), books = questBooks(host);
    const kill = (): void => { entry.drop = null; entry.state = 'idle'; body.alive = true; core.update(0.1, 1); body.alive = false; core.update(0.1, 2); };
    const press = (who: typeof a): void => { const orb = eliteNetView(entry).reward; if (orb !== null) who.position.set(4, orb.y, 5); actRoutes(host).claims.get('lair.reward')?.(who.id); };
    kill(); press(a);
    expect(eliteNetView(entry).reward, 'a took the first').toBeNull();
    expect(books.of(a.id).flags.has(eliteSkinFlag('lair'))).toBe(true);
    expect(books.of(b.id).flags.has(eliteSkinFlag('lair')), 'and it is a\'s alone').toBe(false);
    kill();
    expect(eliteNetView(entry).reward, 'b has none yet, so the next kill drops it again').not.toBeNull();
    press(a);
    expect(eliteNetView(entry).reward, 'an owner\'s press takes nothing').not.toBeNull();
    press(b);
    expect(eliteNetView(entry).reward).toBeNull();
    expect(books.of(b.id).flags.has(eliteSkinFlag('lair'))).toBe(true);
    kill();
    expect(eliteNetView(entry).reward, 'everyone here has it: no orb').toBeNull();
    expect(core.record('lair')?.skinTaken, 'the world record is a page\'s').toBe(false);
  } finally { host.scope.dispose(); }
});

test('SC10: the time a served cell slept counts toward a fallen lair\'s timer', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try {
    const body: Body = { entityId: 'lair.body', alive: true, position: { x: 4, y: 0, z: 4 }, hp: 10, maxHp: 10, lastHitT: -1 };
    let spawns = 0;
    const script: Script = { def: { id: 'lair', lair: { x: 4, z: 4, r: 3 }, awareR: 1, engageR: 1, leashR: 900, rule: 'always', respawnMin: 9, drop: { skin: null } }, animal: body, spawn: () => { spawns++; body.alive = true; }, despawn: () => undefined, tick: () => undefined, enterPhase2: () => undefined, reset: () => undefined, trophy: () => undefined };
    const drops = eliteDrops<Script>(host), core = new EliteCore<Script>({ players: host.players, condition: () => true }, drops.hooks, 'level', memoryElitePersistence());
    drops.bind(core);
    const entry = core.add(script); entry.state = 'idle';
    body.alive = false; core.update(0.1, 1);
    expect(entry.state).toBe('dead');
    host.events.emit('world.slept', { seconds: 9 * 60 + 1 }); host.step(); // events reach their listeners in a tick
    core.update(0.1, 2);
    expect(spawns, 'back on the first tick after the sleep').toBe(1);
  } finally { host.scope.dispose(); }
});

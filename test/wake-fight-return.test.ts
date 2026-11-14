// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { BOSS_RETURN_S } from '../src/server/engine/ai/bossContenders';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { mixedPopulation } from '../src/server/game/population/mixedRoster';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';

// SERVER-CELLS SC10 item 1 (J328): a grid cell's world is never rebuilt, so Driftwood's wake fight must stand again on its own. Before:
// the world's `dead:captain` forced victory forever and the captain spawned once, and in a served world his death was owed as a roster
// body with no scale row, which threw in the tick five minutes later and failed the worker.
test('a served world\'s beaten Drowned Captain stands again once the pool has stood empty five minutes', { timeout: 120_000 }, async () => {
  const directory = builtProduct('driftwood-isle'), product = await loadHeadlessProduct(directory);
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const world = await openCellWorld({ instance: 'driftwood-isle' }, { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier }, undefined,
    { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
  try {
    const { host } = world, island = mixedPopulation(host, 'driftwood.island'), seconds = (s: number): void => { for (let i = 0; i < s * 60; i++) host.step(); };
    const captains = (): number => [...host.entities.values()].filter(actor => actor.kind === 'captain').length;
    expect(host.respawn.served).toBe(true);
    const first = island.spawnCaptain(), pool = first.position.clone();
    const visitor = host.addPlayer('bot:1', { x: pool.x + 3, y: pool.y, z: pool.z });
    host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: first.combatActor(), amount: 1e9, point: pool.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    seconds(1);
    expect(first.alive).toBe(false);
    expect(host.flags.has('dead:captain'), 'his fall is the world\'s').toBe(true);
    seconds(BOSS_RETURN_S + 10);
    expect(host.flags.has('dead:captain'), 'someone stood at the pool all along: he stays beaten').toBe(true);
    visitor.position.set(pool.x + 200, pool.y, pool.z); visitor.motor.resetAt(visitor.position);
    seconds(BOSS_RETURN_S - 10);
    expect(island.captain(), 'not yet').not.toBeNull();
    seconds(20);
    expect(host.flags.has('dead:captain'), 'the world forgets his fall').toBe(false);
    expect(island.captain(), 'his body is gone').toBeNull();
    expect(captains()).toBe(0);
    // SC10: a cell asleep with nobody in it spends that time on his wait: one tick after a long sleep and he is back
    const again = island.spawnCaptain();
    host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: again.combatActor(), amount: 1e9, point: pool.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    seconds(1);
    expect(host.flags.has('dead:captain')).toBe(true);
    host.events.emit('world.slept', { seconds: BOSS_RETURN_S + 60 });
    host.step(); host.step(); // the event reaches its listeners in a tick, the return in the next
    expect(host.flags.has('dead:captain'), 'back after the sleep').toBe(false);
    expect(island.captain()).toBeNull();
    const next = island.spawnCaptain();
    expect(next.alive, 'the next wake cue spawns him afresh').toBe(true);
    expect(next.entityId).not.toBe(first.entityId); expect(next.entityId).not.toBe(again.entityId);
    expect(captains()).toBe(1);
  } finally { world.dispose(); }
});

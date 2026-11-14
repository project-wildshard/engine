// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { BOSS_RETURN_S } from '../src/server/engine/ai/bossContenders';
import { arenaEntryOf } from '../src/server/game/boss/arenaRoomEntry';
import { bossFlagRecord } from '../src/shared/game/plugin/bossRecord';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { Flags } from '../src/shared/engine/world/interact/flags';
import { builtProduct } from './fixtures/builtProduct';

// SERVER-CELLS SC10 item 3 (J328): a grid cell's world is never rebuilt, so when a served world's room boss stands again (SC5) its
// record's world flags (`boss.<id>.defeated`, `.paid`) must clear with it, as a fresh world's would. Before, they only ever set.
const KING_ORIGIN = { x: -40, y: 140, z: -95 }, ROOM_REWARD = [-40, 0, -103.3];

test('a served world\'s beaten King stands again and the world forgets his fall and his paid orb', { timeout: 300_000 }, async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, { room: true }), { host } = live, fight = arenaEntryOf(host);
  try {
    if (fight === undefined) throw new Error('No room fight');
    host.respawn.served = true;
    const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('No lead');
    const { x, y, z } = KING_ORIGIN;
    lead.resetPose({ x, y: y + 0.2, z: z + 2 }, 0);
    for (let tick = 0; tick < 1200 && fight.fight.body() === null; tick++) live.step([]);
    const body = fight.fight.body(); if (body === null) throw new Error('The King never rose');
    for (let tick = 0; tick < 2400 && fight.boss.state !== 'fight'; tick++) live.step([]);
    body.hp = body.maxHp * 0.05; fight.boss.phase = 2; fight.boss.checkpoint = 2;
    for (let tick = 0; tick < 3600 && fight.boss.state !== 'victory'; tick++) {
      if (body.alive) host.combat.hit({ source: lead.health, sourceTags: ['actor.player'], target: body.combatActor(), amount: 200, point: body.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
      live.step([]);
    }
    expect(fight.boss.state).toBe('victory');
    const [orbX = 0, , orbZ = 0] = ROOM_REWARD;
    lead.resetPose({ x: orbX + 0.8, y: y + 0.2, z: orbZ + 0.8 }, 0);
    actRoutes(host).claims.get('golden-king.reward')?.(lead.id); live.step([]);
    const record = (): string[] => host.flags.all.filter(flag => /^boss\..*\.(?:defeated|paid)$/u.test(flag)).sort();
    expect(record(), 'beaten and paid').toHaveLength(2);
    lead.resetPose({ x: x + 300, y: y + 0.2, z: z + 300 }, 0);
    for (let tick = 0; tick < (BOSS_RETURN_S + 5) * 60; tick++) live.step([]);
    expect(fight.boss.state, 'the King stands again').toBe('armed');
    expect(record(), 'and the world forgets his fall and the orb paid for it').toEqual([]);
  } finally { live.dispose(); }
});

test('a boss row\'s flag record clears only when its boss stands again', () => {
  const flags = new Flags('test', false), record = bossFlagRecord(flags, { defeated: 'beaten', paid: 'paid' });
  record.persist({ defeated: true, rewardTaken: false, kills: 1 });
  record.persist({ defeated: true, rewardTaken: true, kills: 1 });
  expect(flags.all.sort()).toEqual(['beaten', 'paid']);
  record.persist({ defeated: true, rewardTaken: false, kills: 1 });
  expect(flags.all.sort(), 'a save that only says the reward is not yet taken clears nothing').toEqual(['beaten', 'paid']);
  record.persist({ defeated: false, rewardTaken: false, kills: 1 });
  expect(flags.all).toEqual([]);
});

// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { arenaEntryOf } from '../src/server/game/boss/arenaRoomEntry';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

// The Golden King from Nalati's product, for a room. A tape's resident has no such fight, so its saves keep their adapters.
const KING_ORIGIN = { x: -40, y: 140, z: -95 }, ROOM_REWARD = [-40, 0, -103.3];
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function nalati(room: boolean): Promise<TrustedHeadlessResident> {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, { room });
}

test('a tape\'s world has no room fight', async () => {
  const live = await nalati(false);
  expect(arenaEntryOf(live.host)).toBeUndefined();
  expect(live.host.adapters.has('nalati.king')).toBe(false);
  live.dispose();
});

test('a room meets the King from the product, and each earner gets the bow', async () => {
  const live = await nalati(true), { host } = live, fight = arenaEntryOf(host);
  if (fight === undefined) throw new Error('No room fight');
  const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('No lead');
  const bot = host.addPlayer('bot:1', { x: lead.position.x + 2, y: lead.position.y, z: lead.position.z });
  const { x, y, z } = KING_ORIGIN;
  for (const player of [lead, bot]) player.resetPose({ x, y: y + 0.2, z: z + 2 }, 0);
  const paid: string[] = [];
  for (let tick = 0; tick < 1200 && fight.fight.body() === null; tick++) live.step([]);
  const body = fight.fight.body(); if (body === null) throw new Error('The King never rose');
  expect(body.kind).toBe('golden-king');
  const blow = (who: typeof lead, amount: number): void => { host.combat.hit({ source: who.health, sourceTags: ['actor.player'], target: body.combatActor(), amount, point: body.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } }); };
  for (let tick = 0; tick < 2400 && fight.boss.state !== 'fight'; tick++) live.step([]);
  expect(fight.boss.state).toBe('fight');
  blow(lead, 200); blow(bot, 200);
  body.hp = body.maxHp * 0.05; fight.boss.phase = 2; fight.boss.checkpoint = 2;
  for (let tick = 0; tick < 3600 && fight.boss.state !== 'victory'; tick++) {
    if (body.alive) { blow(lead, 200); blow(bot, 200); }
    live.step([]);
  }
  expect(fight.boss.state).toBe('victory');
  const claim = actRoutes(host).claims.get('golden-king.reward'); if (claim === undefined) throw new Error('No claim');
  const press = (who: typeof lead): void => {
    claim(who.id); live.step([]);
    for (const effect of live.effects) if (effect.kind === 'item') paid.push(`${effect.actorId}:${effect.item}`);
  };
  press(lead); press(bot);
  expect(paid).toHaveLength(0); // the orb lies on the pedestal, out of reach of the door
  const [orbX = 0, , orbZ = 0] = ROOM_REWARD;
  for (const player of [lead, bot]) player.resetPose({ x: orbX + 0.8, y: y + 0.2, z: orbZ + 0.8 }, 0);
  press(lead); press(bot); press(lead);
  expect(paid).toHaveLength(2);
  expect(paid).toEqual(expect.arrayContaining([`${lead.id}:goldenBow`, 'bot:1:goldenBow']));
  live.dispose();
});

test('the door\'s colliders close on a room fight and open at its end', async () => {
  const live = await nalati(true), { host } = live, fight = arenaEntryOf(host);
  if (fight === undefined) throw new Error('No room fight');
  const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('No lead');
  const seal = host.physics.world.colliders.getAll().filter(collider => !collider.isEnabled());
  expect(seal.length, 'the door is one real collider, baked open').toBe(1);
  const shut = (): boolean[] => seal.map(collider => collider.isEnabled());
  expect(shut().every(on => !on), 'a quiet room stands open').toBe(true);
  const { x, y, z } = KING_ORIGIN;
  lead.resetPose({ x, y: y + 0.2, z: z + 2 }, 0);
  for (let tick = 0; tick < 3600 && fight.boss.state !== 'fight'; tick++) live.step([]);
  expect(fight.boss.state).toBe('fight');
  expect(shut().every(Boolean), 'the fight shuts it').toBe(true);
  const body = fight.fight.body(); if (body === null) throw new Error('No King');
  body.hp = body.maxHp * 0.05; fight.boss.phase = 2; fight.boss.checkpoint = 2;
  for (let tick = 0; tick < 3600 && fight.boss.state !== 'victory'; tick++) {
    if (body.alive) host.combat.hit({ source: lead.health, sourceTags: ['actor.player'], target: body.combatActor(), amount: 400, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    live.step([]);
  }
  expect(fight.boss.state).toBe('victory');
  expect(shut().every(on => !on), 'the win opens it').toBe(true);
  live.dispose();
}, 60_000);

// What the page's own fight proved, on the server's: `pageArenaRoomFight` and the page portal go at the flip.
test('the King runs all his phases on the real fight, his adds clear, and the win pays once', async () => {
  const live = await nalati(true), { host } = live, fight = arenaEntryOf(host);
  if (fight === undefined) throw new Error('No room fight');
  const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('No lead');
  host.events.answer('damage.modify', request => request?.target === lead.health ? null : request, host.scope);
  const { x, y, z } = KING_ORIGIN, trace: string[] = [], down = new Vector3(0, 0, -1);
  const note = (): void => { const line = `${fight.boss.state}:${String(fight.boss.phase)}`; if (trace.at(-1) !== line) trace.push(line); };
  lead.resetPose({ x, y: y + 0.2, z: z + 2 }, 0);
  try {
    for (let tick = 0; tick < 2400 && fight.boss.state !== 'fight'; tick++) { live.step([]); note(); }
    let addsSeen = 0;
    for (let tick = 0; tick < 36_000 && fight.boss.state !== 'victory'; tick++) {
      live.step([]); note();
      if (tick % 15 !== 0 || fight.boss.state !== 'fight') continue;
      const adds = fight.fight.adds().filter(add => add.alive); addsSeen = Math.max(addsSeen, adds.length);
      for (const add of adds) host.combat.hit({ source: lead.health, sourceTags: ['actor.player'], target: add.combatActor(), amount: 1000, point: add.position.clone(), dir: down });
      const body = fight.fight.body();
      if (body !== null && !fight.fight.script.shielded) host.combat.hit({ source: lead.health, sourceTags: ['actor.player'], target: body.combatActor(), amount: 90, point: body.position.clone(), dir: down });
    }
    expect(fight.boss.state).toBe('victory');
    expect(trace.filter(line => line.startsWith('beat') || line.startsWith('fight') || line.startsWith('victory'))).toEqual(['fight:0', 'beat:1', 'fight:1', 'beat:2', 'fight:2', 'victory:2']);
    expect(addsSeen, 'his phases really raised adds').toBeGreaterThan(0);
    expect(fight.fight.adds().filter(add => add.alive)).toHaveLength(0);
    expect(fight.fight.body()?.alive ?? false).toBe(false);
    expect(fight.boss.snapshot().saved).toMatchObject({ defeated: true, rewardTaken: false, kills: 1 });
  } finally { live.dispose(); }
}, 120_000);

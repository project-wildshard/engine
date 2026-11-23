// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { ArenaKingRowsSchema } from '@wildshard/format/arenaRoomDocument';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { beforeAll, expect, test } from 'vitest';
import { createSimHost, type SimCommand, type SimHost } from '../src/server/engine/sim';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';
import { installArenaRoom, type ArenaRoomBody } from '../src/server/game/boss/arenaRoomNative';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { ArenaFightPageSchema, ArenaRoomSchema } from '../src/shared/game/boss/arenaRoomRows';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import room from './fixtures/engine-lift/boss-room.json' with { type: 'json' };
import view from './fixtures/engine-lift/kurgan-view.json' with { type: 'json' };
import { nalatiPin } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';
const king = v.parse(ArenaKingRowsSchema, (await nalatiPin.product.json<{ king: unknown }>('combat/titan-fight.json')).king);

// ONE-FORMAT OF24x: a fighter who leaves or dies while the Golden King locks his health in the coffin shield. Before, the
// King stayed at his shield checkpoint with his balbal wave inside and the door shut, so whoever came back was held at
// the dromos mouth. The real rows, moved onto the flat sim level as arena-room-native.test.ts does.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const DX = 40, DY = -140, DZ = 95;
const ORIGIN = { x: 0, y: 0, z: 0 };
const page = v.parse(ArenaFightPageSchema, king.page), admitted = v.parse(ArenaRoomSchema, { ...room, view });
const fightRows = { ...page,
  profile: { ...king.profile, fight: { ...king.profile.fight, origin: ORIGIN } },
  maxZ: page.maxZ + DZ, respawn: [page.respawn[0] + DX, page.respawn[1] + DY, page.respawn[2] + DZ] satisfies [number, number, number],
  reward: [page.reward[0] + DX, page.reward[1] + DY, page.reward[2] + DZ] satisfies [number, number, number] };
const roomRows = { ...admitted, origin: ORIGIN };
const definition = { ...king.encounter, intro: 0.2, introShort: 0.1, reward: {} };
const ADDS = 8, KING = 'king';
const LEVEL = { ...SIM_LEVEL, entities: [KING, ...Array.from({ length: ADDS }, (_, i) => `add.${String(i)}`)].map((id, i) => Object.assign(structuredClone(SIM_CREATURE_RECIPE), { id, at: { x: 30 + i, y: 0, z: 30 } })) };
const still: SimCommand = { moveX: 0, moveZ: 0, yaw: 0 };
const tick = (host: SimHost, count = 1): void => { for (let i = 0; i < count; i++) host.step(new Map([...host.players.keys()].map(id => [id, still]))); };
function until(host: SimHost, done: () => boolean, limit = 2400): void {
  for (let i = 0; i < limit && !done(); i++) tick(host);
  expect(done()).toBe(true);
}
function roomHost(host: SimHost) {
  const seal: boolean[] = [];
  const body = (id: string): ArenaRoomBody => {
    const actor = host.entities.get(id); if (actor === undefined) throw new Error('No body');
    return Object.assign(actor, { hidden: false });
  };
  let adds = 0;
  const fight = installArenaRoom<ArenaRoomBody>(host, { step: 'room.king', room: roomRows, definition, fight: fightRows }, {
    spawnBody: () => { const actor = body(KING); actor.place(0, -5, 0); return actor; },
    spawnAdd: (_i, x, z, yaw) => { const actor = body(`add.${String(adds++ % ADDS)}`); actor.place(x, z, yaw); return actor; },
    retire: actor => { actor.hidden = true; }, find: id => { const actor = host.entities.get(id); return actor === undefined ? null : body(id); },
    seal: on => { seal.push(on); }, saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined });
  return { ...fight, seal };
}
const place = (player: PlayerSim, x: number, z: number): void => { player.position.set(x, 0, z); player.motor.resetAt(player.position); };

/** One fighter in the chamber, the King driven into his coffin shield (phase II at 60%), his wave out. */
function shielded(players: number) {
  const host = createSimHost(LEVEL, { rapier }), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  const others = Array.from({ length: players - 1 }, (_, i) => host.addPlayer(`bot:${String(i)}`, { x: 0, y: 0, z: 40 }));
  const fight = roomHost(host);
  place(lead, 0, -3);
  until(host, () => fight.boss.state === 'fight');
  const body = fight.fight.body(); if (body === null) throw new Error('The King never rose');
  body.hp = body.maxHp * 0.55;
  until(host, () => fight.fight.mode() === 'shield' && fight.fight.adds().some(add => add.alive), 3600);
  expect(fight.seal.at(-1), 'the door shuts with the fight').toBe(true);
  return { host, lead, others, fight, body };
}

test('OF24x: a lone fighter who dies in the coffin shield can walk back in to the King', () => {
  const { host, lead, fight } = shielded(1);
  try {
    host.combat.hit({ source: 'env', sourceTags: ['creature.boar'], target: lead.health, amount: 100000, point: lead.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    tick(host, 120);
    expect(fight.boss.state, 'the fight waits at the door again').toBe('armed');
    expect(fight.seal.at(-1), 'and the door stands open').toBe(false);
    place(lead, 0, -3);
    until(host, () => fight.boss.state === 'fight', 3600);
  } finally { host.dispose(); }
});

test('OF24x: a fighter who leaves the world in the coffin shield leaves the King to start over', () => {
  const { host, lead, others: [waiting], fight } = shielded(2);
  try {
    if (waiting === undefined) throw new Error('No second player');
    // A served world keeps the lead's seat where its player left it, parked (grid simulation's parkOwner): here, in the chamber.
    host.parked.add(lead.id);
    tick(host, 120);
    expect(fight.boss.state, 'the fight is forgotten').toBe('armed');
    expect(fight.boss.phase, 'from phase I').toBe(0);
    expect(fight.fight.adds().filter(add => add.alive && !add.hidden), 'with no wave left in the chamber').toHaveLength(0);
    expect(fight.seal.at(-1), 'and the door open').toBe(false);
    place(waiting, 0, -3);
    until(host, () => fight.boss.state === 'fight', 3600);
    expect(fight.fight.mode()).not.toBe('shield');
  } finally { host.dispose(); }
});

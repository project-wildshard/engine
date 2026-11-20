// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { PhaseEncounter, type PhaseEncounterSpec } from '../src/server/engine/ai/phases';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { installRoomRespawn } from '../src/server/game/roomRespawn';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// OF19d (opus-of19-dunes3): in a served room, a player the declared encounter's fight killed goes back to the
// encounter's own respawn, not to their last place or the shard's spawn. Dunes' Matriarch sends a fallen player to the
// basin's south rim; on a local rev 5 walk the room's J107 respawn put them at the shard spawn, 150 m off, instead.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const ARENA = { x: 12, z: 12 }, BODY = SIM_CREATURE_RECIPE.id, BACK = { x: -4, z: -4 };
const LEVEL = { ...SIM_LEVEL, entities: [{ ...SIM_CREATURE_RECIPE, at: { x: ARENA.x, y: 0, z: ARENA.z } }] };
const SPEC: PhaseEncounterSpec = { id: 'room.boss', entity: BODY, kind: 'boss', panel: null, name: 'Boar', title: 'of the room', retry: 'Again',
  arena: { at: [ARENA.x, 0, ARENA.z], radius: 6 }, intro: 0.1, introShort: 0.1, respawn: { at: [BACK.x, 0, BACK.z], yaw: 1 },
  phases: [{ at: 1, name: 'I', caption: 'one', speed: 0, stopDistance: 1.2, turnRate: 6 }] };
const PORTS = { saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined, reward: () => undefined };

test('a served room: a player the encounter killed goes to its respawn, the other fights on', () => {
  const host = createSimHost(LEVEL, { rapier }), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  installRoomRespawn(host, []); host.respawn.served = true;
  const fight = new PhaseEncounter(host, SPEC, PORTS), bot = host.addPlayer('bot:1', { x: ARENA.x + 3, y: lead.position.y, z: ARENA.z });
  try {
    host.step(); lead.resetPose({ x: ARENA.x - 3, y: lead.position.y, z: ARENA.z }, 0);
    for (let i = 0; i < 600 && fight.boss.state !== 'fight'; i++) host.step();
    expect(fight.boss.state).toBe('fight');
    const body = host.entities.get(BODY);
    if (body === undefined) throw new Error('No boss body');
    host.combat.hit({ source: body.combatActor(), sourceTags: ['creature.boar'], target: bot.health, amount: 1000, point: bot.position.clone(), dir: new Vector3(0, 0, 1) });
    for (let i = 0; i < 10; i++) host.step();
    expect(fight.boss.state).toBe('fight');
    expect(Math.hypot(bot.position.x - BACK.x, bot.position.z - BACK.z)).toBeLessThan(0.5);
    expect(Math.hypot(lead.position.x - (ARENA.x - 3), lead.position.z - ARENA.z)).toBeLessThan(1);
  } finally { host.dispose(); }
});

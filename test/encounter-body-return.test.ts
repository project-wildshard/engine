// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { PhaseEncounter, type PhaseEncounterSpec } from '../src/server/engine/ai/phases';
import { BOSS_RETURN_S } from '../src/server/engine/ai/bossContenders';
import { installDataRespawns } from '../src/server/game/shardfile/dataRespawn';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimCommand, type SimHost } from '../src/server/engine/sim';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// meta STAGING-BUGBASH SB51: on staging v0.1.44 Brasscap's Dust Wyrm (a declared encounter whose spawn row says
// `respawn: 300`) stood again at full health after a kill while its fight stayed in `victory`: no weak spot opened and no
// shot landed. The fight came back only once its arena had stood empty for 300 s of awake time, so a newcomer standing in
// it waited forever (420 s runs), and the time the cell slept never counted. A body that stands is a fight a newcomer can
// win; a beaten fight's wait spends the time its cell slept.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const ARENA = { x: 12, z: 12 }, BODY = SIM_CREATURE_RECIPE.id, RESPAWN = 300;
const LEVEL = { ...SIM_LEVEL, entities: [{ ...SIM_CREATURE_RECIPE, at: { x: ARENA.x, y: 0, z: ARENA.z } }] };
const SPEC: PhaseEncounterSpec = { id: 'mesa.wyrm', entity: BODY, kind: 'boss', panel: null, name: 'Wyrm', title: 'of the mesa', retry: 'Again',
  arena: { at: [ARENA.x, 0, ARENA.z], radius: 6 }, intro: 0.1, introShort: 0.1, respawn: { at: [-4, 0, -4], yaw: 1 },
  phases: [{ at: 1, name: 'I', caption: 'one', speed: 0, stopDistance: 1.2, turnRate: 6 }] };
const PORTS = { saved: { defeated: false, rewardTaken: false, kills: 0 }, persist: () => undefined, reward: () => undefined };
const still: SimCommand = { moveX: 0, moveZ: 0, yaw: 0 };
const tick = (host: SimHost, count = 1): void => {
  for (let i = 0; i < count; i++) host.step(new Map([...host.players.keys()].map(id => [id, still])));
};
function until(host: SimHost, done: () => boolean, limit = 1800): void {
  for (let i = 0; i < limit && !done(); i++) tick(host);
  expect(done()).toBe(true);
}
/** A served cell (SC5) whose boss body has a spawn row's respawn, or none; the lead stands `at` metres from the arena's middle. */
function cell(respawn: number | undefined, at: number) {
  const host = createSimHost(LEVEL, { rapier }), lead = [...host.players.values()][0], body = host.entities.get(BODY);
  if (lead === undefined || body === undefined) throw new Error('No lead or body');
  host.respawn.served = true;
  installDataRespawns(host, [{ id: BODY, at: [ARENA.x, 0, ARENA.z], yaw: 0, respawn }]);
  const fight = new PhaseEncounter(host, SPEC, PORTS);
  lead.position.set(ARENA.x + at, 0, ARENA.z); lead.motor.resetAt(lead.position);
  return { host, lead, body, fight };
}
const shoot = (host: SimHost, target: NonNullable<ReturnType<SimHost['entities']['get']>>, amount: number): void => {
  host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: target.combatActor(), amount, point: target.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
};

test('a beaten boss whose row brings its body back is a fight again, even with a player standing in its arena', () => {
  const { host, body, fight } = cell(RESPAWN, 3);
  try {
    until(host, () => fight.boss.state === 'fight');
    shoot(host, body, body.maxHp * 10); tick(host);
    expect(fight.boss.state).toBe('victory');
    expect(body.alive).toBe(false);
    // The player never leaves: the body's own clock brings it back, whole.
    until(host, () => body.alive, (RESPAWN + 2) * 60);
    tick(host);
    expect(fight.boss.state, 'a standing body is not a beaten fight').not.toBe('victory');
    until(host, () => fight.boss.state === 'fight', 120);
    const whole = body.hp;
    shoot(host, body, 10); tick(host);
    expect(body.hp, 'a shot hurts it').toBeLessThan(whole);
    shoot(host, body, body.maxHp * 10); tick(host);
    expect(fight.boss.state, 'and a newcomer can win it').toBe('victory');
  } finally { host.dispose(); }
});

test('a beaten boss with no respawn row: the time its cell slept counts toward its return', () => {
  const { host, lead, body, fight } = cell(undefined, 3);
  try {
    until(host, () => fight.boss.state === 'fight');
    shoot(host, body, body.maxHp * 10); tick(host);
    expect(fight.boss.state).toBe('victory');
    lead.position.set(ARENA.x + 60, 0, ARENA.z); lead.motor.resetAt(lead.position);
    tick(host);
    // A cell's wake emits it before its next tick; the bus drains it inside that tick, so the fight reads it on the one after.
    host.events.emit('world.slept', { seconds: BOSS_RETURN_S + 60 });
    tick(host, 2);
    expect(fight.boss.state).toBe('armed');
    expect(body.alive).toBe(true);
    expect(body.hp).toBe(body.maxHp);
  } finally { host.dispose(); }
});

// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { QuestFlagGates } from '../src/shared/game/quest/flagGates';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FLAG_PREFIX } from '../src/shared/engine/net/shardNet';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// J106, personal phasing: a gate's state is each player's own. One physics world, one collider, two answers.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

function room(): { host: SimHost; gate: QuestFlagGates; collider: () => boolean; wall: number } {
  const host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host), wall = lead.position.x + 3;
  const box = { x: wall, z: lead.position.z, hw: 0.25, hd: 8, yTop: lead.position.y + 4, yBottom: lead.position.y - 2 };
  const made = host.physics.world.createCollider(rapier.ColliderDesc.cuboid(box.hw, (box.yTop - box.yBottom) / 2, box.hd).setTranslation(box.x, (box.yTop + box.yBottom) / 2, box.z));
  const gate = new QuestFlagGates(host, { gates: [{ id: 'gate', opensWhen: { all: ['open:gate'] }, target: { kind: 'box', box } }] });
  questBooks(host).claim(['open:gate']);
  return { host, gate, collider: () => made.isEnabled(), wall };
}
/** Walk one player east for a second and report how far it got. */
function walkEast(host: SimHost, id: string, gate: QuestFlagGates): number {
  for (let tick = 0; tick < 120; tick++) {
    gate.sync();
    host.step(new Map([[id, { moveX: 1, moveZ: 0, yaw: -Math.PI / 2 }]]));
  }
  return host.players.get(id)?.position.x ?? Number.NaN;
}

test('a player who opened a gate walks through what another still meets', () => {
  const { host, gate, collider, wall } = room(), lead = leadPlayer(host);
  host.addPlayer('bot:1', { x: lead.position.x, y: lead.position.y, z: lead.position.z + 2 });
  questBooks(host).of('bot:1').flags.set('open:gate');
  gate.sync();
  expect(collider(), 'the lead still meets it').toBe(true);
  expect(walkEast(host, 'bot:1', gate)).toBeGreaterThan(wall + 1);
  expect(walkEast(host, lead.id, gate)).toBeLessThan(wall);
});

test('open for everyone it goes; a room of one closes nothing and splits nothing', () => {
  const both = room(), lead = leadPlayer(both.host);
  both.host.addPlayer('bot:1', { x: lead.position.x, y: lead.position.y, z: lead.position.z + 2 });
  both.host.flags.set('open:gate'); questBooks(both.host).of('bot:1').flags.set('open:gate'); both.gate.sync();
  expect(both.collider()).toBe(false);

  const alone = room(), solo = leadPlayer(alone.host);
  alone.gate.sync(); expect(alone.collider()).toBe(true);
  alone.host.flags.set('open:gate'); alone.gate.sync();
  expect(alone.collider()).toBe(false);
  expect(solo.motor.phased.size, 'a room of one never touches a motor').toBe(0);
});

test('a player who dies keeps its quest progress', () => {
  const { host } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), book = questBooks(host).of('bot:1');
  book.flags.set('open:gate');
  bot.health.attributes.health = 0; bot.health.update(1 / 60);
  expect(bot.health.attributes.health).toBe(bot.health.attributes.maxHealth);
  expect(book.flags.has('open:gate')).toBe(true);
});

test('the flags a whole room sees are the world\'s, never a player\'s', () => {
  const { host } = room(), seen: string[] = [];
  host.flags.set('open:gate'); host.flags.set('dead:wolf');
  new SimNetWorld(host).visit({ entity: id => { if (id.startsWith(FLAG_PREFIX)) seen.push(id.slice(FLAG_PREFIX.length)); } });
  expect(seen).toContain('dead:wolf');
  expect(seen).not.toContain('open:gate');
});

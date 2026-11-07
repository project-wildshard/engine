// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { parseArenaScriptData } from '@wildshard/format/arenaScriptRows';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera,Vector3 } from 'three';
import { beforeAll,expect,test } from 'vitest';
import { silentBossPresentation } from '../src/server/engine/ai/phases';
import { createSimHost,type SimCommand,type SimHost } from '../src/server/engine/sim';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';
import { openArenaNativeViews } from '../src/server/game/boss/headlessArenaViews';
import { OpenArenaRoom } from '../src/server/game/boss/openArenaRoom';
import { BossBrain } from '../src/shared/engine/ai/BossBrain';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { OpenArenaFight,type ArenaDraw } from '../src/shared/game/boss/openArenaFight';
import { lendNalatiPasture,nalatiPin,titanPrograms as programs } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// Row 2 of the boss lane: the Storm Titan's real fight with a room's players behind "the player". The lead stands off while
// a bot does the fighting, on a real host and the real pipeline.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const data = parseArenaScriptData({ ...await nalatiPin.product.json('combat/titan-fight.json'), programs: { attack: programs.attack, wind: programs.wind } }, await nalatiPin.product.json('combat/titan-geometry.json'));
const centre = data.arena.center, radius = data.place.arenaRadius, still: SimCommand = { moveX: 0, moveZ: 0, yaw: 0 };
const tick = (host: SimHost, count = 1): void => { for (let i = 0; i < count; i++) host.step(new Map([...host.players.keys()].map(id => [id, still]))); };
function until(host: SimHost, done: () => boolean, limit = 2400): void {
  for (let i = 0; i < limit && !done(); i++) tick(host);
  expect(done()).toBe(true);
}
function room(extra = 1): { host: SimHost; lead: PlayerSim; bots: PlayerSim[]; arena: OpenArenaRoom; boss: BossBrain; fight: OpenArenaFight<ArenaDraw> } {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  lendNalatiPasture(host.scope);
  lead.position.set(centre.x + radius * 3, 0, centre.z);
  const bots = Array.from({ length: extra }, (_, i) => host.addPlayer(`bot:${String(i)}`, { x: centre.x + 2 + i, y: 0, z: centre.z }));
  const arena = new OpenArenaRoom(host, data, (player, position, yaw) => { player.position.copy(position); player.motor.resetAt(position); player.yaw = yaw; });
  const owner: { boss: BossBrain | null } = { boss: null };
  const fight = new OpenArenaFight({ scope: host.scope, weather: { stormActive: true, flash: 0, raise: () => undefined }, tieSpot: null, ai: () => host.rng.stream('ai'), fog: () => null,
    camera: new PerspectiveCamera(), wild: { trample: () => undefined, onEvent: () => undefined }, phone: true, ground: (x, z) => host.groundHeightAt(x, z), wind: { dirX: 1, dirZ: 0, speed: 1 } },
  { player: arena.party.player, get boss() { return owner.boss; }, get engaged() { return owner.boss?.engaged ?? false; }, mounted: () => true, contact: arena.contact,
    throwRider: arena.throwRider, horseSteed: arena.horseSteed, heartScale: arena.heartScale, feed: () => undefined, toast: () => undefined, riderOwner: () => null }, data, openArenaNativeViews(host, data));
  const boss = new BossBrain({ ...data.definition, reward: {} }, fight, { events: host.events, player: arena.party.player, lockInput: () => undefined, respawn: arena.party.respawn,
    skipHeld: () => true, faceToward: () => undefined, spawnReward: () => undefined, persist: () => undefined }, silentBossPresentation(), { defeated: false, rewardTaken: false, kills: 0 });
  owner.boss = boss; arena.bind(boss, fight, () => null);
  host.events.answer('death.checkpoint', value => arena.party.died(boss) || value === true, host.scope);
  host.onStep('titan', dt => { arena.party.observe(boss); boss.update(dt, host.clock.now); });
  fight.tied = true; boss.arm();
  return { host, lead, bots, arena, boss, fight };
}
const fall = (host: SimHost, target: PlayerSim): void => {
  host.combat.hit({ source: 'env', sourceTags: ['creature.boar'], target: target.health, amount: 100000, point: target.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
};

test('the Titan\'s contacts land on the bot past the wall, not the lead standing off', () => {
  const { host, lead, bots, arena, boss } = room(), bot = bots[0];
  try {
    if (bot === undefined) throw new Error('No bot');
    until(host, () => boss.state === 'fight');
    expect(arena.near.id).toBe(bot.id);
    expect(arena.contact(data.whole[0] ?? '', bot.position, 7, 'why')).toBe(true); tick(host, 2);
    expect(bot.health.attributes.maxHealth - bot.health.attributes.health).toBe(7);
    expect(lead.health.attributes.health).toBe(lead.health.attributes.maxHealth); expect(arena.contacts).toBe(1);
  } finally { host.dispose(); }
});

test('J104: the players past the wall at the start set the heart\'s curve, and a contact shares from five', () => {
  const { host, lead, bots, arena, boss } = room(5);
  try {
    until(host, () => boss.state === 'fight');
    expect(arena.party.engaged).toBe(5); expect(arena.heartScale()).toBe(4);
    const before = bots.map(bot => bot.health.attributes.health);
    arena.contact(data.whole[0] ?? '', arena.near.position, 7, 'why'); tick(host, 2);
    expect(bots.filter((bot, i) => bot.health.attributes.health < (before[i] ?? 0))).toHaveLength(2);
    expect(lead.health.attributes.health).toBe(lead.health.attributes.maxHealth);
  } finally { host.dispose(); }
});

test('J107: a bot that falls goes back alone and the fight carries on for the rest; it resets once nobody is inside', () => {
  const { host, bots, arena, boss, fight } = room(2), [one, two] = bots;
  try {
    if (one === undefined || two === undefined) throw new Error('No bots');
    until(host, () => boss.state === 'fight');
    fall(host, one); tick(host, 2);
    const back = fight.respawnPoint().pos;
    expect(one.position.x).toBeCloseTo(back.x); expect(one.health.alive).toBe(true);
    expect(boss.state).toBe('fight'); expect(boss.attempts).toBe(1);
    one.position.set(centre.x + radius * 3, 0, centre.z); one.motor.resetAt(one.position);
    fall(host, two); two.position.set(centre.x + radius * 3, 0, centre.z); two.motor.resetAt(two.position); tick(host, 3);
    expect(['armed', 'intro']).toContain(boss.state); expect(arena.party.engaged).toBe(0);
  } finally { host.dispose(); }
});

test('the heart is earned by those in the arena when it falls, and each takes it once', () => {
  const { host, bots, arena } = room();
  try {
    const bot = bots[0]; if (bot === undefined) throw new Error('No bot');
    arena.heartFell();
    expect(arena.bounty.owed, 'the lead stands off, the bot is in the arena').toEqual([bot.id]);
    expect(arena.bounty.take(bot.id)).toBe(true); expect(arena.bounty.take(bot.id)).toBe(false);
    expect(arena.bounty.owed).toEqual([]);
  } finally { host.dispose(); }
});

test('alone, the heart names no earner and the row pays as it did', () => {
  const { host, arena } = room(0);
  try { arena.heartFell(); expect(arena.bounty.earned).toEqual([]); } finally { host.dispose(); }
});

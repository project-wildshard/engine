import { expect, test } from 'vitest';
import type { TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { debitNativeInventory } from '../src/shared/game/inventoryLaw';
import { nativeQuestPromptRoster } from '../src/server/game/quest/nativeComposition';
import { nativeMeleeItem } from '../src/server/game/plugin/nativeItems';
import { heldArmsOf } from '../src/server/game/weapons/nativeHeld';
import { mountedPlayerOf } from '../src/server/game/riding/native';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { admittedResidents, press, step } from './fixtures/engine-lift/residents';
import inputs from './fixtures/engine-lift/inputs.json' with { type: 'json' };

// The Titan chain is in engine-rule-successors-titan.test.ts: its cases run in order, so it stays one file.
const { input, open } = admittedResidents(['pine-hollow', 'nalati-grasslands', 'driftwood-isle']);

test('Pine pays Miller after its paid flag, and the actual paid adventure resumes silently without a second grant', async () => {
  const live = await open('pine-hollow'); let resumed: TrustedHeadlessResident | undefined;
  try {
    const host = live.host, miller = inputs.pineSpots.people.find(row => row.kind === 'miller');
    if (miller === undefined) throw new Error('Missing authored miller');
    // Fixture starts at the completed errand's turn-in; payment itself must be earned by the real talk input.
    host.flags.set('errand:asked'); host.flags.set('errand:done');
    const player = leadPlayer(host); player.resetPose({ x: miller.at.x, y: miller.at.y - 1.68, z: miller.at.z + .5 }, 0);
    let paidBeforeAnyReward = false;
    host.flags.onChange((flag, on) => {
      if (flag !== 'errand:paid' || !on) return;
      paidBeforeAnyReward = !debitNativeInventory(host, 'pack', { item: 'lodge-ribbon', count: 1 })
        && !debitNativeInventory(host, 'pack', { item: 'amber-resin', count: 1 });
    });
    for (let line = 0; line < 32 && !host.flags.has('errand:paid'); line++) { press(live, 'talk.miller'); step(live, 20); }
    expect(host.flags.has('errand:paid')).toBe(true); expect(paidBeforeAnyReward).toBe(true);
    resumed = await open('pine-hollow', snapshotSimHostBytes(host));
    expect(resumed.effects).toEqual([]); expect(resumed.host.flags.has('errand:paid')).toBe(true);
    expect(debitNativeInventory(resumed.host, 'pack', { item: 'lodge-ribbon', count: 3 })).toBe(true);
    expect(debitNativeInventory(resumed.host, 'pack', { item: 'amber-resin', count: 4 })).toBe(true);
    for (let line = 0; line < 16; line++) { press(resumed, 'talk.miller'); step(resumed, 20); }
    expect(debitNativeInventory(resumed.host, 'pack', { item: 'lodge-ribbon', count: 1 })).toBe(false);
    expect(debitNativeInventory(resumed.host, 'pack', { item: 'amber-resin', count: 1 })).toBe(false);
  } finally { resumed?.dispose(); live.dispose(); }
}, 10_000);

test('a Nalati adventure resumes its real movement and spent bow ammunition without a refill or duplicate outcomes', async () => {
  const live = await open('nalati-grasslands'); let resumed: TrustedHeadlessResident | undefined;
  try {
    const player = leadPlayer(live.host), arms = heldArmsOf(live.host)?.of(player);
    if (arms === undefined) throw new Error('Missing published held arms');
    const initial = arms.arrows(), start = player.position.clone();
    // Resume an existing adventure milestone as well as a newly spent resource.
    const firstFlag = input('nalati-grasslands').shard.quests.quests[0]?.startWhen?.all?.[0];
    if (firstFlag === undefined) throw new Error('Missing declared adventure start');
    live.host.flags.set(firstFlag);
    for (let tick = 0; tick < 60; tick++) live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0, heavy: {} }]);
    step(live, 45);
    for (let tick = 0; tick < 60; tick++) live.step([{ kind: 'player', moveX: 1, moveZ: 0, yaw: 0 }]);
    expect(arms.arrows()).toBeLessThan(initial); expect(player.position.distanceTo(start)).toBeGreaterThan(.5);
    const arrows = arms.arrows(), position = player.position.clone();
    resumed = await open('nalati-grasslands', snapshotSimHostBytes(live.host));
    expect(resumed.effects).toEqual([]);
    expect(resumed.host.flags.has(firstFlag)).toBe(true);
    expect(heldArmsOf(resumed.host)?.of(leadPlayer(resumed.host)).arrows()).toBe(arrows);
    expect(leadPlayer(resumed.host).position.toArray()).toEqual(position.toArray());
    step(resumed, 10); expect(heldArmsOf(resumed.host)?.of(leadPlayer(resumed.host)).arrows()).toBe(arrows);
  } finally { resumed?.dispose(); live.dispose(); }
}, 10_000);

test('the real harbour rack refuses a living guard despite a stale defeat flag, then grants once after real combat and reload', async () => {
  const live = await open('driftwood-isle'); let resumed: TrustedHeadlessResident | undefined;
  try {
    if (live.host.dayClock === undefined) throw new Error('Missing real island clock');
    live.host.dayClock.phase = .85; step(live, 2);
    const route = actRoutes(live.host).interactions.get('iron-sword');
    const rack = nativeQuestPromptRoster(live.host, 'driftwood.quest').find(row => row.act === route?.value);
    if (rack === undefined) throw new Error('Missing public harbour rack');
    const player = leadPlayer(live.host), gear = nativeMeleeItem(live.host, 'item.driftwood-isle.swords');
    player.health.attributes.incomingCap = 0;
    const tryRack = (): void => {
      for (const [x, z] of [[0, 1.4], [1.4, 0], [-1.4, 0], [0, -1.4], [0, .2]]) {
        player.resetPose({ x: rack.position.x + (x ?? 0), y: rack.position.y + .2, z: rack.position.z + (z ?? 0) }, 0);
        step(live, 35); press(live, 'hold-key'); press(live, 'iron-sword'); step(live, 40);
      }
    };
    const sailor = [...live.host.entities.values()].find(body => body.kind === 'sailor' && body.alive);
    if (sailor === undefined) throw new Error('Missing real harbour guard');
    const before = gear.held();
    live.host.flags.set('dead:sailor'); tryRack();
    expect(gear.held()).toBe(before);
    for (let tick = 0; tick < 720 && sailor.alive; tick++) {
      player.resetPose({ x: sailor.position.x + .3, y: sailor.position.y, z: sailor.position.z + .3 }, Math.PI / 4);
      live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: Math.PI / 4, ...(tick % 50 === 0 ? { attack: { targetId: sailor.entityId } } : {}) }]);
    }
    expect(sailor.alive, `hp ${sailor.hp}; player ${player.health.attributes.health}; swings ${gear.swings()}; hits ${gear.hits()}`).toBe(false);
    tryRack();
    expect(gear.held()).not.toBe(before);
    resumed = await open('driftwood-isle', snapshotSimHostBytes(live.host)); expect(resumed.effects).toEqual([]);
    expect(nativeMeleeItem(resumed.host, 'item.driftwood-isle.swords').held()).toBe(gear.held());
  } finally { resumed?.dispose(); live.dispose(); }
}, 10_000);

test('real mounted lance steering rejects the side cone and spends a target contact once per pass across a reload', async () => {
  const live = await open('nalati-grasslands'); let resumed: TrustedHeadlessResident | undefined;
  try {
    const host = live.host, mount = mountedPlayerOf(host), player = leadPlayer(host);
    if (mount === undefined || mount.mountables[0] === undefined) throw new Error('Missing actual camp mount');
    const horse = mount.mountables[0];
    player.resetPose(horse.position, horse.yaw); expect(mount.mount(horse.entityId)).toBe(true);
    mount.teleport(0, -120, 0);
    const equip = actRoutes(host).equip; if (equip === null) throw new Error('Missing held input route');
    step(live, 1, [{ kind: 'script', actorId: equip, value: 2 }]);
    const reins = (): HeadlessCommand => ({ kind: 'player', moveX: 0, moveZ: 0, yaw: mount.body.heading - Math.PI,
      commandVersion: 1, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, sprint: true });
    for (let tick = 0; tick < 180 && Math.abs(mount.body.speed) < 9; tick++) live.step([reins()]);
    expect(Math.abs(mount.body.speed)).toBeGreaterThan(8);
    const victim = [...host.entities.values()].find(body => body.alive && body.kind === 'wolf');
    if (victim === undefined) throw new Error(`Missing actual lance target: ${[...host.entities.values()].map(body => body.kind).join(',')}`);
    // Give the real target enough fixture health to offer a second contact;
    // the weapon, hit, cone, cadence and rehit rules remain the shipped ones.
    victim.maxHp = 1000; victim.hp = 1000;
    const damage: number[] = [];
    host.events.on('damage.dealt', event => { if (event.req.target === victim.combatActor() && event.dealt > 0) damage.push(event.dealt); }, host.scope);
    const place = (side: number, ahead: number): void => {
      const heading = mount.body.heading, p = player.position;
      victim.place(p.x + Math.sin(heading) * ahead + Math.cos(heading) * side,
        p.z + Math.cos(heading) * ahead - Math.sin(heading) * side, victim.yaw, p.y);
    };
    // Actual bodies form the fixture; only the rider's normal steering advances contact.
    place(4, 4); for (let tick = 0; tick < 6; tick++) live.step([reins()]);
    place(2, 1); for (let tick = 0; tick < 6; tick++) live.step([reins()]); expect(damage).toEqual([]);
    place(0, 2); for (let tick = 0; tick < 8; tick++) live.step([reins()]);
    expect(damage).toHaveLength(1); expect(victim.alive).toBe(true);
    const health = victim.hp, saved = snapshotSimHostBytes(host);
    place(3, 1); for (let tick = 0; tick < 6; tick++) live.step([reins()]);
    place(0, 2); for (let tick = 0; tick < 6; tick++) live.step([reins()]);
    expect(victim.hp).toBe(health); expect(damage).toHaveLength(1);
    resumed = await open('nalati-grasslands', saved);
    const restored = resumed.host.entities.get(victim.entityId); if (restored === undefined) throw new Error('Target did not resume');
    expect(restored.hp).toBe(health); expect(resumed.effects).toEqual([]);
    for (let tick = 0; tick < 8; tick++) resumed.step([reins()]);
    expect(restored.hp).toBe(health);
  } finally { resumed?.dispose(); live.dispose(); }
}, 10_000);

// oxlint-disable-next-line import/no-nodejs-modules -- Exercise admitted products on their shipped native physics binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type HeadlessRuntimeInput, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { debitNativeInventory } from '../src/shared/game/inventoryLaw';
import { nativeQuestPromptRoster } from '../src/server/game/quest/nativeComposition';
import { nativeMeleeItem } from '../src/server/game/plugin/nativeItems';
import { heldArmsOf } from '../src/server/game/weapons/nativeHeld';
import { mountedPlayerOf } from '../src/server/game/riding/native';
import { openArenaOf } from '../src/server/game/boss/openArenaNative';
import { readArenaScriptData } from '../src/shared/game/boss/openArenaFight';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';
import inputs from './fixtures/engine-lift/inputs.json' with { type: 'json' };

const products = new Map<string, HeadlessRuntimeInput>();
beforeAll(async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  for (const slug of ['pine-hollow', 'nalati-grasslands', 'driftwood-isle']) {
    const directory = builtProduct(slug), product = await loadHeadlessProduct(directory);
    products.set(slug, { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier });
  }
});
function input(slug: string): HeadlessRuntimeInput { const value = products.get(slug); if (value === undefined) throw new Error('Missing admitted test product'); return value; }
function open(slug: string, saved?: ReturnType<typeof snapshotSimHost>): Promise<TrustedHeadlessResident> {
  return createTrustedHeadlessResident(input(slug), saved, { room: true });
}
function step(live: TrustedHeadlessResident, ticks = 1, commands: readonly HeadlessCommand[] = []): void {
  for (let tick = 0; tick < ticks; tick++) live.step(tick === 0 ? commands : []);
}
function press(live: TrustedHeadlessResident, id: string): void {
  const route = actRoutes(live.host).interactions.get(id);
  if (route === undefined) throw new Error(`No published interaction: ${id}`);
  step(live, 1, [{ kind: 'script', actorId: route.actorId, value: route.value }]);
}

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
    resumed = await open('pine-hollow', snapshotSimHost(host));
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
    resumed = await open('nalati-grasslands', snapshotSimHost(live.host));
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
    resumed = await open('driftwood-isle', snapshotSimHost(live.host)); expect(resumed.effects).toEqual([]);
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
    const health = victim.hp, saved = snapshotSimHost(host);
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

let titanFight: ReturnType<typeof snapshotSimHost> | undefined;
let titanWind: ReturnType<typeof snapshotSimHost> | undefined, titanFire: ReturnType<typeof snapshotSimHost> | undefined;
let titanArrows: ReturnType<typeof snapshotSimHost> | undefined, titanWindAt: number | undefined;
let titanContact: ReturnType<typeof snapshotSimHost> | undefined, titanBurning: ReturnType<typeof snapshotSimHost> | undefined;
let titanSpent: ReturnType<typeof snapshotSimHost> | undefined, titanFireCell: { cell: number; active: number; spent: number } | undefined;

// Each bounded continuation consumes the preceding actual save, never a
// hand-built phase. Bow damage and fire contact/burning/spent checkpoints
// bound the native work per case without changing simulation speed or caps.
function earnTitanPhase(live: TrustedHeadlessResident, goal: number, health?: number): void {
  const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host);
  if (mount === undefined || arena === undefined) throw new Error('Missing actual Titan continuation');
  host.combat.playerRules(host.scope, { bossGod: true });
  let blade = false;
  for (let tick = 0; tick < 6000 && arena.boss.phase < goal && (health === undefined || arena.fight.hpFrac > health); tick++) {
    if (tick % 900 === 0) heldArmsOf(host)?.of(player).refill();
    const rider = arena.boss.phase === 1 ? [...host.entities.values()].find(body => body.alive && body.kind === 'ghost-rider') : undefined;
    const target = rider?.position.clone() ?? arena.fight.rowlessFocus(), p = player.position;
    if (rider !== undefined) {
      if (mount.mounted) mount.dismount();
      if (!blade) { step(live, 1, [{ kind: 'script', actorId: 'nalati.weapon.swap', value: 1 }]); blade = true; }
      player.resetPose({ x: target.x + 1.2, y: target.y, z: target.z }, Math.PI / 2); target.y += rider.dims.bodyY;
    } else if (blade) { step(live, 1, [{ kind: 'script', actorId: 'nalati.weapon.swap', value: 0 }]); blade = false; }
    const dx = target.x - p.x, dz = target.z - p.z, pitch = Math.atan2(target.y - p.y - 1.68, Math.hypot(dx, dz));
    live.step([{ kind: 'player', moveX: 0, moveZ: 0, commandVersion: 1, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: Math.atan2(-dx, -dz), pitch,
      ...(rider !== undefined ? tick % 24 === 0 ? { swing: true } : {} : tick % 90 < 60 ? { heavy: {} } : {}) },
    { kind: 'script', actorId: 'nalati.weapon.aim', value: 1 }, { kind: 'script', actorId: 'nalati.weapon.pitch', value: pitch }]);
  }
  if (health === undefined) expect(arena.boss.phase).toBe(goal);
  else { expect(arena.fight.hpFrac).toBeLessThanOrEqual(health); expect(arena.boss.phase).toBe(goal - 1); }
}

test('real mounted entry earns the Titan fight checkpoint', async () => {
  const live = await open('nalati-grasslands');
  try {
    const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host);
    const product = input('nalati-grasslands').product;
    if (mount?.mountables[0] === undefined || arena === undefined || product === undefined) throw new Error('Missing actual Titan world');
    const data = await readArenaScriptData(product, { fight: 'combat/titan-fight.json', geometry: 'combat/titan-geometry.json' });
    titanWindAt = data.phases[1]?.at;
    step(live, 120);
    const horse = mount.mountables[0]; player.resetPose(horse.position, horse.yaw); expect(mount.mount(horse.entityId)).toBe(true);
    const cairn = arena.fight.cairnSpot(); mount.teleport(cairn.x, cairn.z, 0);
    actRoutes(host).climate?.({ op: 'force', name: 'storm', at: .1 });
    for (let tick = 0; tick < 4000 && !arena.storm(); tick++) step(live);
    expect(arena.storm()).toBe(true); press(live, 'nalati.titan.tie');
    expect(arena.fight.tied).toBe(true);
    host.combat.playerRules(host.scope, { bossGod: true });
    for (let tick = 0; tick < 240 && arena.boss.state !== 'fight'; tick++) live.step([{ kind: 'script', actorId: 'nalati.titan.skip', value: 1 }]);
    expect(arena.boss.state).toBe('fight');
    mount.teleport(data.arena.center.x + 10, data.arena.center.z + 10, 0);
    titanFight = snapshotSimHost(host);
  } finally { live.dispose(); }
}, 10_000);

for (const quarter of [1, 2, 3, 4]) test(`real mounted arrows earn and resume Titan damage checkpoint ${quarter}/4`, async () => {
  const saved = quarter === 1 ? titanFight : titanArrows;
  if (saved === undefined || titanWindAt === undefined) throw new Error('Real mounted play must earn the preceding checkpoint');
  const live = await open('nalati-grasslands', saved);
  try {
    expect(live.effects).toEqual([]);
    expect(openArenaOf(live.host)?.boss.state).toBe('fight');
    earnTitanPhase(live, 1, quarter === 4 ? undefined : 1 - (1 - titanWindAt) * quarter / 4);
    titanArrows = snapshotSimHost(live.host);
    if (quarter === 4) titanWind = titanArrows;
  } finally { live.dispose(); }
}, 10_000);

test('real support melee resumes the wind checkpoint and earns Titan fire', async () => {
  if (titanWind === undefined) throw new Error('The actual bow input must earn the preceding checkpoint');
  const live = await open('nalati-grasslands', titanWind);
  try {
    expect(live.effects).toEqual([]); earnTitanPhase(live, 2);
    expect(openArenaOf(live.host)?.fight.snapshot().fireOn).toBe(true);
    titanFire = snapshotSimHost(live.host);
  } finally { live.dispose(); }
}, 10_000);

test('earned Titan fire keeps its actual contact cooldown', async () => {
  if (titanFire === undefined) throw new Error('Actual support deaths must earn the preceding fire checkpoint');
  const live = await open('nalati-grasslands', titanFire);
  try {
    const host = live.host, player = leadPlayer(host), mount = mountedPlayerOf(host), arena = openArenaOf(host), product = input('nalati-grasslands').product;
    if (mount === undefined || arena === undefined || product === undefined) throw new Error('Missing actual Titan fire continuation');
    expect(live.effects).toEqual([]);
    const data = await readArenaScriptData(product, { fight: 'combat/titan-fight.json', geometry: 'combat/titan-geometry.json' });
    const field = arena.fight.snapshot().field, cell = field.modes.indexOf(data.field.states.active);
    expect(cell).toBeGreaterThanOrEqual(0);
    const x = data.field.x + (cell % data.field.width + .5) * data.field.cell;
    const z = data.field.z + (Math.floor(cell / data.field.width) + .5) * data.field.cell;
    if (mount.mounted) mount.teleport(x, z, 0);
    else player.resetPose({ x, y: host.groundHeightAt(x, z), z }, 0);
    const contacts: number[] = [];
    host.events.on('damage.dealt', event => { if (event.req.target === player.health && event.req.toast === data.lines.burning && event.dealt > 0) contacts.push(host.state.tick); }, host.scope);
    step(live, 30); expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((tick, index) => index === 0 || tick - (contacts[index - 1] ?? 0) >= 5)).toBe(true);
    titanFireCell = { cell, active: data.field.states.active, spent: data.field.states.spent };
    titanContact = snapshotSimHost(host);
  } finally { live.dispose(); }
}, 10_000);

test('contacted Titan fire advances a real burning save checkpoint', async () => {
  if (titanContact === undefined || titanFireCell === undefined) throw new Error('Actual burning contact must earn this checkpoint');
  const live = await open('nalati-grasslands', titanContact);
  try {
    expect(live.effects).toEqual([]);
    live.host.combat.playerRules(live.host.scope, { bossGod: true });
    const tick = live.host.state.tick;
    step(live, 180); expect(live.host.state.tick).toBe(tick + 180);
    const arena = openArenaOf(live.host); if (arena === undefined) throw new Error('Titan did not resume');
    expect([titanFireCell.active, titanFireCell.spent]).toContain(arena.fight.snapshot().field.modes[titanFireCell.cell]);
    titanBurning = snapshotSimHost(live.host);
  } finally { live.dispose(); }
}, 10_000);

test('the real burning checkpoint earns a spent Titan cell', async () => {
  if (titanBurning === undefined || titanFireCell === undefined) throw new Error('Actual fire steps must earn this checkpoint');
  const live = await open('nalati-grasslands', titanBurning);
  try {
    expect(live.effects).toEqual([]);
    live.host.combat.playerRules(live.host.scope, { bossGod: true });
    const arena = openArenaOf(live.host); if (arena === undefined) throw new Error('Titan did not resume');
    let spent = false;
    for (let tick = 0; tick < 1800 && !spent; tick++) { step(live); if (tick % 30 === 0) spent = arena.fight.snapshot().field.modes[titanFireCell.cell] === titanFireCell.spent; }
    expect(spent).toBe(true);
    titanSpent = snapshotSimHost(live.host);
  } finally { live.dispose(); }
}, 10_000);

test('the earned spent Titan cell resumes without duplicate effects', async () => {
  if (titanSpent === undefined || titanFireCell === undefined) throw new Error('Actual burning must earn the spent checkpoint');
  const live = await open('nalati-grasslands', titanSpent);
  try {
    expect(live.effects).toEqual([]);
    const continued = openArenaOf(live.host); if (continued === undefined) throw new Error('Titan did not resume');
    step(live, 120);
    expect(continued.fight.snapshot().field.modes[titanFireCell.cell]).toBe(titanFireCell.spent);
  } finally { live.dispose(); }
}, 10_000);

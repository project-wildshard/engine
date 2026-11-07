import { admission,admissionNative,lendNalatiAdmission,lendNalatiPasture } from './fixtures/engine-lift/pins';

import type { HuntBody } from '@wildshard/engine/ai/hunt';
import { PackBrain as FixturePack,type PackPrey } from '@wildshard/engine/ai/pack';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
// oxlint-disable-next-line import/no-nodejs-modules -- Real native capsule continuation uses the shipped physics bytes.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Name the charge module by its own bytes.
import { installMountedPlayer,mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { respawnNativeMounted } from '@wildshard/engine/game/riding/nativeTaming';
import { nativeGroupCollection as fixtureGroup,NativeGroupCollection as FixtureNativeGroups,nativeHerdCollection } from '@wildshard/engine/game/shardfile/groupRuntime';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost,type SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { leadCommands,leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import { decodeSimSnapshot,leadSnapshot,serializeSimSnapshot,snapshotSimHost } from '@wildshard/engine/sim/snapshot';
import { nativeGroupBrain as fixtureBrain } from '@wildshard/format/groupBrains';
import { zlibSync } from 'fflate';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { expect,test } from 'vitest';
import { Rng as FixtureRandom } from '../src/shared/engine/core/rng';
import fixtureBrains from './fixtures/engine-lift/brains.json' with { type: 'json' };
import { NALATI_RIDING_PROGRAMS as programs } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';



// Full canonical predecessor histories: 90 native ticks plus dismount,
// recorded before replacing inline fixture inputs with named blocks.

const zeroBytes=zlibSync(new Uint8Array(16));
const zeroPond={file:'world/zero-pond.bin',bytes:zeroBytes},zeroWet={file:'world/zero-wet.bin',bytes:zeroBytes};
const channel=(file:string):{type:'f32';count:number;data:{file:string}}=>({type:'f32',count:4,data:{file}});
const offsetBytes=(bytes:Uint8Array):Uint8Array=>{
  const storage=new Uint8Array(bytes.length+8);storage.set(bytes,4);return storage.subarray(4,-4);
};
const rows = { step: 'orchard.saddle', herds: 'orchard.herds', kinds: ['boar'], adopted: { kind: 'boar', variant: 'boar' },
  mountable: ['boar:1'], speeds: { walk: 1, trot: 3, canter: 5, gallop: 8 }, pose: {},
  world: { res: 2, size: 32, water: -100, wet: channel(zeroWet.file), pond: channel(zeroPond.file) }, thrownDamage: 7, thrownLabel: 'Thrown', program: programs.riding };
// These riding-only fixtures need a dormant, real group owner, without adding
// host entities, random streams or a step participant to the original test.
function herdService(host: SimHost, id: string, group = `fixture:${id}`, tokens?: ConstructorParameters<typeof FixtureNativeGroups>[9]): FixtureNativeGroups {
  const spec = fixtureBrain({ ...fixtureBrains.pack, id: 'fixture.pack', home: [0, 0], members: ['fixture.actor'] });
  if (spec.kind !== 'pack') throw new Error('Missing dormant fixture pack');
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing dormant group member');
  const actor = new AnimalSim(sample.spec, sample.seed, sample.scale, 'fixture.group.actor', { heightAt: () => 0, random: () => .5, now: () => 0 });
  const random = new FixtureRandom(17), pack = new FixturePack<AnimalSim>([actor], 0, 0, spec, {
    sharedRng: () => random, environment: () => ({ playerFwdX: 0, playerFwdZ: -1, playerMounted: false, playerHealth01: 1, grassHeightAt: () => 0 }),
    visibility: () => 1, hearing: () => 10, downwind: () => false, inBounds: () => true, normalY: () => 1, register: () => undefined, bite: () => undefined,
  });
  return new FixtureNativeGroups(host, [pack], [], new Map<string, AnimalSim>(), new Map<string, PackPrey>(), new WeakMap<PackPrey, string>(), [],
    new WeakMap<AnimalSim, FixturePack<AnimalSim>>(), { id: group, herds: id, firstRaid: 0 }, tokens);
}
function install(host: SimHost) { lendNalatiPasture(host.scope); herdService(host, rows.herds); return installMountedPlayer(host, rows,zeroPond,zeroWet); }

test('G478 orchard native fixture owns and restores its actual mounted capsule', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const level = { ...SIM_LEVEL, quests: [] }, host = createSimHost(level, { rapier }), mounted = install(host);
  let restored: SimHost | undefined;
  try {
    expect(mounted.mount('foreign')).toBe(false);
    expect(mounted.mount('boar:1')).toBe(true);
    expect(leadPlayer(host).modes.current()).toBe('ride');
    const command = { moveX: 0, moveZ: 0, yaw: 0, commandVersion: 1 as const, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 } };
    for (let tick = 0; tick < 30; tick++) host.step(leadCommands(host, command));
    const snapshot = snapshotSimHost(host);
    restored = restoreSimHost(level, { rapier }, snapshot, fresh => { install(fresh); });
    for (let tick = 0; tick < 12; tick++) {
      host.step(leadCommands(host, command)); restored.step(leadCommands(restored, command));
      expect(leadPlayer(restored).position.distanceTo(leadPlayer(host).position)).toBeLessThan(1e-6);
    }
    expect(mounted.body.speed).toBeGreaterThan(0);
    mounted.dismount(); expect(leadPlayer(host).modes.current()).toBe('foot');
    mounted.removeMountable('boar:1'); expect(mounted.mountables).toEqual([]);
    mounted.addMountable('boar:1'); expect(mounted.mountables.map(actor => actor.entityId)).toEqual(['boar:1']);
  } finally { restored?.dispose(); host.dispose(); }
});

test('a bot takes its own seat: its own horse, reins, save and fall, and the lead stays on foot', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const level = { ...SIM_LEVEL, quests: [] }, host = createSimHost(level, { rapier }), lead = install(host);
  const bot = host.addPlayer('bot.rider', { x: 2, y: leadPlayer(host).position.y, z: 0 }), seat = mountedPlayerOf(host, bot.id);
  const addBot = (fresh: SimHost): void => { install(fresh); };
  let restored: SimHost | undefined;
  try {
    if (seat === undefined) throw new Error('Missing bot seat');
    expect(seat).not.toBe(lead); expect(mountedPlayerOf(host)).toBe(lead); expect(mountedPlayerOf(host, 'nobody')).toBeUndefined();
    expect(seat.mount('boar:1')).toBe(true);
    expect(bot.modes.current()).toBe('ride'); expect(leadPlayer(host).modes.current()).toBe('foot');
    expect(lead.mount('boar:1')).toBe(false); expect(lead.mounted).toBe(false);
    seat.dismount(); seat.claim('boar:1'); expect(lead.canRide('boar:1')).toBe(false); expect(seat.canRide('boar:1')).toBe(true);
    expect(seat.mount('boar:1')).toBe(true);
    const gallop = { seq: 0, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.sprint };
    const reins = new Map([[bot.id, gallop]]);
    for (let tick = 0; tick < 30; tick++) host.step(reins);
    expect(seat.body.speed).toBeGreaterThan(0); expect(seat.body.target).toBeGreaterThan(0); expect(lead.body.target).toBe(0);
    expect(bot.position.distanceTo(seat.body.feet)).toBeLessThan(4);
    restored = restoreSimHost(level, { rapier }, snapshotSimHost(host), addBot);
    const copy = restored.players.get(bot.id), copySeat = mountedPlayerOf(restored, bot.id);
    if (copy === undefined || copySeat === undefined) throw new Error('Missing restored bot');
    expect(copySeat.horse?.entityId).toBe('boar:1');
    for (let tick = 0; tick < 12; tick++) {
      host.step(reins); restored.step(reins);
      expect(copy.position.distanceTo(bot.position)).toBeLessThan(1e-6);
    }
    const horse = seat.horse; if (horse === null) throw new Error('Missing bot horse');
    seat.dismount(); expect(bot.modes.current()).toBe('foot'); expect(horse.driven).toBe(false); expect(seat.mounted).toBe(false);
  } finally { restored?.dispose(); host.dispose(); }
});

test('a player who leaves mid-ride lets their horse go', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, quests: [] }, { rapier }), lead = install(host);
  const bot = host.addPlayer('bot.rider', { x: 2, y: leadPlayer(host).position.y, z: 0 });
  try {
    expect(mountedPlayerOf(host, bot.id)?.mount('boar:1')).toBe(true);
    host.step(); expect(host.entities.get('boar:1')?.driven).toBe(true);
    host.removePlayer(bot.id); host.step();
    expect(host.entities.get('boar:1')?.driven).toBe(false);
    expect(lead.mount('boar:1')).toBe(true);
  } finally { host.dispose(); }
});

test('an input lock holds the walk and the reins through a save, and a respawn remounts the horse', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const level = { ...SIM_LEVEL, quests: [] }, host = createSimHost(level, { rapier }), mounted = install(host);
  let restored: SimHost | undefined;
  try {
    // on foot: the page Player's moveScale 0 stands the version-1 walk still, and a save keeps the lock
    const walk = { moveX: 0, moveZ: -1, yaw: 0, commandVersion: 1 as const }, start = leadPlayer(host).position.clone();
    leadPlayer(host).moveScale = 0;
    for (let tick = 0; tick < 20; tick++) host.step(leadCommands(host, walk));
    expect(Math.hypot(leadPlayer(host).position.x - start.x, leadPlayer(host).position.z - start.z)).toBeLessThan(1e-3);
    const saved = snapshotSimHost(host);
    expect(leadSnapshot(saved).moveScale).toBe(0);
    expect(leadSnapshot(decodeSimSnapshot(serializeSimSnapshot({...saved,players:[{...leadSnapshot(saved),moveScale:.35}]}))).moveScale).toBe(.35);
    for(const moveScale of [-1,1,Infinity,Number.NaN])expect(()=>serializeSimSnapshot({...saved,players:[{...leadSnapshot(saved),moveScale}]})).toThrow();
    restored = restoreSimHost(level, { rapier }, decodeSimSnapshot(serializeSimSnapshot(saved)), fresh => { install(fresh); });
    expect(leadPlayer(restored).moveScale).toBe(0);
    leadPlayer(host).moveScale = 1;
    for (let tick = 0; tick < 20; tick++) host.step(leadCommands(host, walk));
    expect(leadPlayer(host).position.distanceTo(start)).toBeGreaterThan(1);
    const unlocked=snapshotSimHost(host);
    expect(leadSnapshot(unlocked).moveScale).toBeUndefined();
    expect(decodeSimSnapshot(serializeSimSnapshot(unlocked))).toEqual(unlocked);
    // mounted: the reins read the same scale (a boss intro's lock reins the horse in)
    expect(mounted.mount('boar:1')).toBe(true);
    const gallop = { moveX: 0, moveZ: 0, yaw: 0, sprint: true, commandVersion: 1 as const, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 } };
    for (let tick = 0; tick < 20; tick++) host.step(leadCommands(host, gallop));
    expect(mounted.body.target).toBeGreaterThan(0);
    leadPlayer(host).moveScale = 0;
    host.step(leadCommands(host, gallop)); expect(mounted.body.target).toBe(0);
    leadPlayer(host).moveScale = 1;
    host.step(leadCommands(host, gallop)); expect(mounted.body.target).toBeGreaterThan(0);
    // the arena's respawn: off the horse, at the point at rest, and back on the first horse the rules take
    const at = new Vector3(4, host.groundHeightAt(4, -3), -3);
    respawnNativeMounted(host, at, .7, { yaw: .5, steed: 40 });
    expect(mounted.mounted).toBe(true); expect(mounted.horse?.entityId).toBe('boar:1');
    expect(mounted.body.speed).toBe(0); expect(mounted.body.steed).toBe(40); expect(mounted.body.winded).toBe(false);
    expect(mounted.body.heading).toBeCloseTo(1.2); expect(leadPlayer(host).yaw).toBeCloseTo(1.2 - Math.PI);
    expect([mounted.body.feet.x, mounted.body.feet.z]).toEqual([4, -3]);
    for (let tick = 0; tick < 10; tick++) host.step(leadCommands(host, gallop));
    expect(Math.hypot(mounted.body.feet.x - 4, mounted.body.feet.z + 3)).toBeLessThan(5);
    // no horse the rules take: the player stands at the point on foot
    mounted.dismount(); mounted.removeMountable('boar:1');
    respawnNativeMounted(host, at, .2, { yaw: .5, steed: 40 });
    expect(mounted.mounted).toBe(false); expect(leadPlayer(host).position.toArray()).toEqual(at.toArray()); expect(leadPlayer(host).yaw).toBe(.2);
  } finally { restored?.dispose(); host.dispose(); }
});

test('G478 orchard fixture owns companion allocation, retirement and native taming inputs', async () => {
  const { fixtureNativeRoster } = await import('./fixtures/native-roster');
  const { Rng } = await import('@wildshard/engine/core/rng');
  const { NativeActors } = await import('../src/server/game/population/actors');
  const { BondedMountRoster } = await import('@wildshard/engine/game/riding/roster');
  const { installNativeTaming, nativeTamingControls } = await import('@wildshard/engine/game/riding/nativeTaming');
  const { default: horsePose } = await import('./fixtures/engine-lift/horse-pose.json');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native fixture recipe');
  const random = new Rng(71), { hunt } = fixtureNativeRoster(host, random), retired = new Set<string>();
  const bodies: HuntBody[] = [], sight: (boolean | null | undefined)[] = [];
  herdService(host, 'orchard.herds');
  const service = { host, id: 'orchard.actors', identities: new NativeActors<HuntBody>('creature', 64), random, hunt, bodies, sight, retired, flocks: [] };
  const companionRows: ConstructorParameters<typeof BondedMountRoster>[1] = { id: 'orchard.companions', services: service.id, herds: 'orchard.herds', kind: 'boar', variant: 'boar', wildKinds: ['boar'], specs: [sample.spec], scale: [1, 1], spawnY: 10, program: admission };
  lendNalatiAdmission(host.scope);
  const roster = new BondedMountRoster(host, companionRows, service);
  expect(() => new BondedMountRoster(host, companionRows, service)).toThrow('Duplicate bonded mount roster');
  expect(() => new BondedMountRoster(host, { ...companionRows, id: 'orchard.other' }, { ...service })).toThrow('Duplicate mount roster owner');
  expect(() => new BondedMountRoster(host, { ...companionRows, id: 'orchard.other', services: 'foreign.actors' }, service)).toThrow('Invalid mount roster owners');
  expect(() => new BondedMountRoster(host, { ...companionRows, id: 'orchard.other' }, { ...service, sight: [false] })).toThrow('Invalid mount roster owners');
  const foreign = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try { expect(() => new BondedMountRoster(foreign, companionRows, service)).toThrow('Invalid mount roster owners'); } finally { foreign.dispose(); }
  lendNalatiPasture(host.scope);
  const mounted = installMountedPlayer(host, { ...rows, mountable: [] },zeroPond,zeroWet);
  let lent: ReturnType<Parameters<typeof installNativeTaming>[1]['commands']> = [];
  const taming = installNativeTaming(host, { commands: () => lent }, { step: 'orchard.taming', herds: 'orchard.herds', roster: 'orchard.companions', kinds: [], programs,
    binding: { upgradeKind: 'silver', bonds: ['ordinary', 'silver'], names: ['Juniper', 'Silver'], offset: [1, 2], fields: { upgraded: 'argymaq', horseUpgraded: 'horseArgymaq', candidateUpgraded: 'argymaq' },
      labels: { mount: 'Ride', breaking: 'Tame', trust: 'Trust', start: 'Start', thrown: 'Thrown', bonded: ['Bonded', 'Upgraded'] } },
    poses: [], poseProgram: horsePose, presentation: { alive: 'alive', smooth: [], decay: [], graze: { target: 'graze', rate: 1, speed: .3 }, base: { bone: 'body', target: 'base' }, wind: { x: 'wx', z: 'wz', strength: 'wind' } },
    inputs: { offer: 'orchard.offer', lean: 'orchard.lean', pitch: 'orchard.pitch', mount: 'orchard.mount' }, rest: { x: 0, z: 0, face: { x: 1, z: 0 } }, rail: { x: 0, z: 0 }, eye: 1.6, impactRange: 4, scareRange: 20, scareSeconds: 3, thrownLabel: 'Thrown' });
  try {
    // J108: each player tames for themselves, from their first offer; one player saves no extra row
    const controls = nativeTamingControls(host), first = leadPlayer(host), bot = host.addPlayer('bot.tamer', { x: 8, y: first.position.y, z: 8 });
    const tamingSave = host.adapters.get('orchard.taming'); if (controls === undefined || tamingSave === undefined) throw new Error('Missing taming controls');
    expect(controls.sessionOf(first.id)).toBe(taming); expect(tamingSave.snapshot()).not.toHaveProperty('others');
    // a net lead's lean and look arrive on its command, not by a route: only `others` take one
    lent = [{ kind: 'player', seq: 7, pitch: .5, steer: { keyX: -.5 } }];
    taming.update(1 / 60); expect(tamingSave.snapshot()).toMatchObject({ pitch: .5 });
    lent = [];
    controls.press(bot.id, { lean: 1 }); taming.update(1 / 60); expect(controls.sessionOf(bot.id)).toBeUndefined();
    controls.press(bot.id, { offer: true }); taming.update(1 / 60);
    const own = controls.sessionOf(bot.id); expect(own).toBeDefined(); expect(own).not.toBe(taming);
    const held = tamingSave.snapshot(); expect(held).toHaveProperty(['others', bot.id]);
    tamingSave.restore(held); expect(controls.sessionOf(bot.id)).toBe(own);
    host.removePlayer(bot.id); taming.update(1 / 60); expect(controls.sessionOf(bot.id)).toBeUndefined();
    const actor = roster.spawn(2, 3, 0, false), before = random.snapshot();
    expect(actor.entityId).toBe('creature:0'); expect(bodies).toEqual([actor]); expect(sight).toEqual([false]);
    expect(() => roster.spawn(4, 3, 0, false)).toThrow(); expect(random.snapshot()).toEqual(before);
    mounted.addMountable(actor.entityId);
    // the wire's press takes the horse in reach, and nothing out of it
    const ride = actRoutes(host).ride; if (ride === null) throw new Error('Missing ride route');
    first.position.set(actor.position.x + 40, first.position.y, actor.position.z); ride(first.id, 'mount'); expect(mounted.mounted).toBe(false);
    first.position.set(actor.position.x + 1, first.position.y, actor.position.z); ride(first.id, 'mount'); expect(mounted.mounted).toBe(true);
    ride(first.id, 'dismount'); expect(mounted.mounted).toBe(false);
    expect(mounted.mount(actor.entityId)).toBe(true);
    taming.update(.1); host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0, commandVersion: 1, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 } }));
    mounted.dismount(); mounted.removeMountable(actor.entityId); roster.retire(actor.entityId);
    expect(host.entities.has(actor.entityId)).toBe(false); expect(bodies).toEqual([]); expect(sight).toEqual([]); expect(retired.has(actor.entityId)).toBe(true);
    expect(random.snapshot()).toEqual(before); expect(roster.spawn(2, 3, 0, true).entityId).toBe('creature:1');
  } finally { host.dispose(); }
});

test('orchard native manager drives the admitted roster at ten Hz across body frames', async () => {
  const { fixtureNativeRoster } = await import('./fixtures/native-roster');
  const { Rng } = await import('@wildshard/engine/core/rng');
  const { NativeManager, NativePopulationDriver } = await import('@wildshard/engine/game/population/nativeManager');
  const { createNativeCreatureRoster } = await import('@wildshard/engine/game/shardfile/homeKeeper');
  const { nativeEliteBindings: eliteBindings } = await import('@wildshard/engine/ai/eliteRoster');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier }), random = new Rng(71);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing orchard actor');
  const { hunt, services } = fixtureNativeRoster(host, random);
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec], variants: new Map(), rng: random, services, hunted: 'every', spawnY: 10 });
  const slot = intake.body('orchard.boar', sample.spec.kind, sample.spec.variant, -1, { x: 2, z: 3 }, 0, [1, 1]);
  const actor = intake.arrive(slot); intake.remember(slot);
  const manager = new NativeManager(host, hunt, random, { limit: 64, sightSlots: 1, initialSight: false });
  const groups = herdService(host, 'unused.herds', 'fixture.driver', { id: 'orchard.tokens', owners: new WeakMap() });
  lendNalatiAdmission(host.scope);
  const makeDriver = (id = 'orchard.tokens', ownerHost = host): InstanceType<typeof NativePopulationDriver> => new NativePopulationDriver(ownerHost, manager, hunt, random, [actor], new Map(), new Map(), eliteBindings(), [], [],
    { tokens: id, program: admission, packKind: 'boar', dogKind: 'collie', eliteKinds: [], dispatch: 'dispatch' }, groups);
  expect(() => makeDriver('foreign.tokens')).toThrow('Missing native manager tokens');
  const foreign = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try { expect(groups.owns(foreign)).toBe(false); expect(() => makeDriver('orchard.tokens', foreign)).toThrow('Missing native manager tokens'); }
  finally { foreign.dispose(); }
  const driver = makeDriver();
  host.onStep('orchard.population', dt => { driver.update(dt); });
  try {
    actor.setMotion(1, 3, 1);
    for (let i = 0; i < 3; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    const decision = actor.mem['groupThinkAt'];
    expect(decision).toBeGreaterThanOrEqual(0); expect(actor.speed).toBeLessThan(.1);
    for (let i = 0; i < 2; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(actor.mem['groupThinkAt']).toBe(decision);
    driver.restore(2.5); expect(driver.snapshot()).toBe(2.5);
    expect(() => driver.restore(-1)).toThrow(); expect(() => driver.admit(actor)).toThrow();
  } finally { host.dispose(); }
});

test('orchard deferred actors share allocator, stream and native retirement ownership', async () => {
  const { fixtureNativeRoster } = await import('./fixtures/native-roster');
  const { Rng } = await import('@wildshard/engine/core/rng');
  const { createNativeCreatureRoster, NativeDeferredRoster } = await import('@wildshard/engine/game/shardfile/homeKeeper');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier }), random = new Rng(71), control = new Rng(71);
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing orchard actor');
  const { hunt, services } = fixtureNativeRoster(host, random), bodies: HuntBody[] = [], sight: (boolean | null | undefined)[] = [];
  const retired = new Set<string>(), absent = new Set<AnimalSim>();
  const intake = createNativeCreatureRoster(host, { specs: [sample.spec], variants: new Map([[sample.spec.kind, [{ id: sample.spec.variant, scale: [1, 2] as const }]]]), rng: random, services, hunted: 'every', spawnY: 10 });
  const profile = { limit: 64, spawnY: 10, motorKinds: ['boar'], retiredY: -9999 };
  const deferred = new NativeDeferredRoster(host, intake, hunt, random, bodies, sight, retired, absent, profile);
  try {
    expect(() => new NativeDeferredRoster(host, { ...intake }, hunt, random, bodies, sight, retired, absent, profile)).toThrow('owners');
    const saved = deferred.roll(sample.spec.kind, sample.spec.variant, 2, 3, 0), scale = control.range(1, 2); control.next(); const seed = control.next();
    expect(saved).toMatchObject({ id: 'creature:0', scale, seed }); expect(saved.adopted).toEqual(control.snapshot());
    const actor = deferred.materialize(saved, sample.spec.kind, -1, true); control.next(); control.next(); control.next();
    expect(random.snapshot()).toEqual(control.snapshot()); expect(bodies).toEqual([actor]); expect(sight).toEqual([false]);
    expect(() => deferred.materialize(saved, sample.spec.kind, -1, true)).toThrow('Invalid');
    deferred.release(actor.entityId, 'retire'); expect(host.entities.size).toBe(0); expect(bodies).toEqual([]); expect(retired.has('creature:0')).toBe(true);
    expect(random.snapshot()).toEqual(control.snapshot());
    const next = deferred.roll(sample.spec.kind, sample.spec.variant, 2, 3, 0), parked = deferred.materialize(next, sample.spec.kind, -1, true);
    expect(parked.entityId).toBe('creature:1'); deferred.release(parked.entityId, 'park');
    expect(host.entities.get(parked.entityId)).toBe(parked); expect(absent.has(parked)).toBe(true); expect(parked.alive).toBe(false);
    expect(bodies).toEqual([]); expect(sight).toEqual([]); expect(() => deferred.release(parked.entityId, 'park')).toThrow();
  } finally { host.dispose(); }
});

test('orchard wildlife frame continues real foragers and tramples through numeric rows', async () => {
  const { ForagerPopulation } = await import('@wildshard/engine/ai/ambientForager');
  const { ForagerPopulationSchema } = await import('@wildshard/format/ambientLife');
  const { NativeWildlifeFrame, NativeWildEnvironment } = await import('@wildshard/engine/game/population/nativeManager');
  const { GrassField } = await import('@wildshard/engine/game/systems/looks/grassField');
  const { TrampleField } = await import('@wildshard/engine/game/systems/looks/trampleField');
  const { default: foragerRow } = await import('./fixtures/engine-lift/foragers.json');
  const { bindFlatTerrain } = await import('@wildshard/engine/test/terrain');
  const v = await import('valibot');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, quests: [] }, { rapier });
  host.scope.onDispose(bindFlatTerrain({ heightAt: () => 0, normalAt: () => [0, 1, 0], waterLevel: () => -100 }));
  const native = host.entities.get('boar:1'); if (native === undefined) throw new Error('Missing orchard body');
  const actor: HuntBody = Object.assign(native, { hidden: false, sampleTerrain: () => undefined }); actor.speed = 3;
  const population = new ForagerPopulation(v.parse(ForagerPopulationSchema, { ...foragerRow, id: 'orchard.foragers', count: 4, place: { ...foragerRow.place, size: [2, 2] } }), 41);
  population.colonies([{ x: 5, z: 5 }]);
  const trample = new TrampleField(), wolves: HuntBody[] = [], signals: string[] = [];
  const author = admissionNative(host);
  const frame = new NativeWildlifeFrame(host, author, [actor], [], wolves, [], [], [], population, trample,
    { speed: 'speed', alert: 'whistle', range: 'scare', packRadius: 20, scareSeconds: 6, scareRadius: 60, foragerRunSpeed: 5,
      trample: { kinds: { boar: .5 }, minSpeed: .6, range: 80, fullSpeed: 6 }, knockdown: { speed: 7, min: .4, max: 1.5, seconds: .28 } });
  const field = new GrassField({ seed: 9, half: 16, heightAt: () => 0, normalAt: () => [0, 1, 0], splatAt: () => [1, 0, 0, 0], trailDistance: () => Infinity, cabinMask: () => 0, pondMask: () => 0, waterLevel: () => -100, paint: () => false, layout: null });
  const environment = new NativeWildEnvironment(field, trample, { wind: { x: 1, z: 0, strength: .3 }, flatten: .5 }, admissionNative(host));
  expect(() => environment.onEvent('scare', 0, 0)).toThrow('Unbound'); environment.bind(host, frame);
  host.events.on('creature.signal', event => { signals.push(event.name); }, host.scope);
  host.onStep('orchard.wildlife', dt => { trample.update(dt, leadPlayer(host).position); frame.update(dt, false); });
  try {
    for (let i = 0; i < 12; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    const saved = frame.snapshot(); expect(saved.wild.at).toBeGreaterThan(0); expect(population.rows.length).toBeGreaterThan(0);
    expect(trample.amountAt(actor.position.x, actor.position.z)).toBeGreaterThan(0);
    const standing = environment.grassStandingAt(actor.position.x, actor.position.z);
    expect(environment.grassHeightAt(actor.position.x, actor.position.z)).toBeLessThan(standing);
    environment.onEvent('scare', 3, 4); host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 })); expect(signals).toEqual(['scare']);
    frame.update(.1, true); frame.restore(saved); expect(frame.snapshot()).toEqual(saved);
  } finally { host.dispose(); }
});

test('orchard fixture installs the complete native population through data rows', async () => {
  const { fixtureNativeRoster } = await import('./fixtures/native-roster');
  const { Rng } = await import('@wildshard/engine/core/rng');
  const { PackBrain } = await import('@wildshard/engine/ai/pack');
  const { nativeGroupBrain } = await import('@wildshard/format/groupBrains');
  const { NativeGroupCollection } = await import('@wildshard/engine/game/shardfile/groupRuntime');
  const { NativeWildEnvironment } = await import('@wildshard/engine/game/population/nativeManager');
  const { installNativePopulation, nativePopulationOf } = await import('@wildshard/engine/game/riding/nativePopulation');
  const { nativeEliteBindings: eliteBindings } = await import('@wildshard/engine/ai/eliteRoster');
  const { GrassField } = await import('@wildshard/engine/game/systems/looks/grassField');
  const { TrampleField } = await import('@wildshard/engine/game/systems/looks/trampleField');
  const { ForagerPopulation } = await import('@wildshard/engine/ai/ambientForager');
  const { ForagerPopulationSchema } = await import('@wildshard/format/ambientLife');
  const { BOAR } = await import('@wildshard/engine/game/systems/species/boar');
  const { default: brains } = await import('./fixtures/engine-lift/brains.json');
  const { NALATI_PASTURE: pasture } = await import('./fixtures/engine-lift/pins');
  const { default: foragerRow } = await import('./fixtures/engine-lift/foragers.json');
  const v = await import('valibot');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native orchard actor');
  const host = createSimHost({ ...SIM_LEVEL, entities: [{ ...sample, id: 'creature:0' }], quests: [] }, { rapier });
  const actor = host.entities.get('creature:0'); if (actor === undefined) throw new Error('Missing orchard actor');
  const random = new Rng(71), { hunt } = fixtureNativeRoster(host, random), ids = new WeakMap<PackPrey, string>(), prey = new Map<string, PackPrey>();
  const spec = nativeGroupBrain({ ...brains.pack, id: 'orchard.pack', home: [0, 0], members: [actor.entityId] }); if (spec.kind !== 'pack') throw new Error('Missing pack preset');
  const pack = new PackBrain([actor], 0, 0, spec, { sharedRng: () => host.rng.stream('ai'),
    environment: () => ({ playerFwdX: 0, playerFwdZ: -1, playerMounted: false, playerHealth01: 1, grassHeightAt: () => 0 }),
    visibility: () => 1, hearing: () => 10, downwind: () => false, inBounds: () => true, normalY: () => 1, register: () => undefined, bite: () => undefined,
    preyIdentity: target => ids.get(target) ?? '', resolvePrey: id => prey.get(id) ?? null }); pack.initialize();
  const field = new GrassField({ seed: 9, half: 16, heightAt: () => 0, normalAt: () => [0, 1, 0], splatAt: () => [1, 0, 0, 0], trailDistance: () => Infinity,
    cabinMask: () => 0, pondMask: () => 0, waterLevel: () => -100, paint: () => false, layout: null });
  const environment = new NativeWildEnvironment(field, new TrampleField(), { wind: { x: 1, z: 0, strength: .3 }, flatten: .5 }, admissionNative(host));
  new NativeGroupCollection(host, [pack], [], new Map([[actor.entityId, actor]]), prey, ids, [actor], new WeakMap(), { id: 'orchard.groups', firstRaid: 14, environment }, { id: 'orchard.tokens', owners: new WeakMap() });
  herdService(host, 'orchard.herds');
  const foragers = new ForagerPopulation(v.parse(ForagerPopulationSchema, { ...foragerRow, id: 'orchard.foragers', count: 4, place: { ...foragerRow.place, size: [2, 2] } }), 41); foragers.colonies([{ x: 5, z: 5 }]);
  const checkpoint = random.snapshot(); random.next(); random.next(); random.next(); const stream = random.snapshot(); random.restore(checkpoint);
  lendNalatiPasture(host.scope);
  const owner = installNativePopulation(host, hunt, random, { boot: { admission, pasture, streamSeed: 71, species: { boar: { kind: BOAR.kind, variants: BOAR.variants } }, recipes: [sample.spec] },
    config: { step: 'orchard.population', raidStep: 'orchard.raid', groups: 'orchard.groups', herds: 'orchard.herds', tokens: 'orchard.tokens', preyPrefix: 'orchard:',
      packKind: 'boar', dogKind: 'collie', eliteKinds: ['silver-boar',sample.spec.kind], motorKinds: ['boar'], retiredY: -9999, variants: [], flocks: [], forager: { row: foragers.row, seed: 41 },
      frame: { speed: 'speed', alert: 'whistle', range: 'scare', packRadius: 20, scareSeconds: 6, scareRadius: 60, foragerRunSpeed: 5,
        trample: { kinds: { boar: .5 }, minSpeed: .6, range: 80, fullSpeed: 6 }, knockdown: { speed: 7, min: .4, max: 1.5, seconds: .28 } },
      driver: { dispatch: 'dispatch' }, companion: { id: 'orchard.companion', kind: 'boar', variant: 'boar', wildKinds: ['boar'] }, shepherdOffset: [2, 3], raidVariants: ['boar'] },
    bodies: [{ actor, boot: { id: actor.entityId, seed: actor.seed, adopted: { x: actor.position.x, z: actor.position.z, stream: checkpoint } } }], herds: [], stream, wildStream: new Rng(3).snapshot(),
    bake: { actors: [{ spec: sample.spec }], marmots: foragers.snapshot() }, spawnY: 10, elites: eliteBindings() });
  try {
    expect(nativePopulationOf(host)).toBe(owner); expect(owner.bodies).toEqual([actor]);
    const population=host.adapters.get(owner.id);if(population===undefined)throw new Error('Missing native population save');
    const initialCalm=population.snapshot();
    if(initialCalm===null||typeof initialCalm!=='object'||Array.isArray(initialCalm))throw new Error('Missing population snapshot object');
    expect(owner.calm).toBe(false);expect(Object.hasOwn(initialCalm,'calm')).toBe(false);
    owner.calm=true;const calm=population.snapshot();expect(calm).toEqual({...initialCalm,calm:true});
    owner.calm=false;expect(population.snapshot()).toEqual(initialCalm);
    population.restore(calm);expect(owner.calm).toBe(true);
    population.restore(initialCalm);expect(owner.calm).toBe(false);
    expect(()=>population.restore({...initialCalm,calm:1})).toThrow();
    expect(population.snapshot()).toEqual(initialCalm);
    for (let i = 0; i < 12; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(owner.marmots.rows).toHaveLength(2); expect(owner.raid.raids).toBe(0); expect(host.adapters.has('orchard.population')).toBe(true);
    const { bondedMountRoster } = await import('@wildshard/engine/game/riding/roster');
    const companions = bondedMountRoster(host, 'orchard.companion');
    expect(owner.bondedHorseIds()).toEqual([]);
    const bound = companions.spawn(2, 3, 0, false);
    expect(bound.entityId).toBe('creature:1'); expect(owner.bondedHorseIds()).toEqual([bound.entityId]);
    companions.retire(bound.entityId); expect(owner.bondedHorseIds()).toEqual([]);
    expect(owner.bodies).toEqual([actor]); expect(host.entities.has(bound.entityId)).toBe(false);
    expect(() => owner.spawnElite('foreign', 0, 0, 0, 'boar')).toThrow('Foreign');
    const {SpawnScript}=await import('../src/server/game/population/spawnScript');
    const {charge,chargeModule}=await import('./fixtures/engine-lift/pins');
    const row={...charge,roster:owner.id,bytes:Buffer.from(chargeModule).toString('base64'),
      species:charge.species.map(source=>({id:source.id,kind:sample.spec.kind,variant:sample.spec.variant}))};
    const initial=serializeSimSnapshot(snapshotSimHost(host)),draws=random.snapshot();
    expect(owner.id).toBe('orchard.population');expect(owner.available()).toBe(63);
    owner.validateSpawn(sample.spec.kind,sample.spec.variant);
    expect(()=>owner.validateSpawn('foreign',sample.spec.variant)).toThrow('Foreign');
    expect(()=>owner.validateSpawn(sample.spec.kind,'missing')).toThrow();
    expect(()=>SpawnScript.nativePopulation(host,{...row,roster:'foreign.population'})).toThrow('matching native population');
    expect(()=>SpawnScript.nativePopulation(host,{...row,species:row.species.map(source=>({id:source.id,kind:source.kind,variant:'missing'}))})).toThrow();
    // CI12: the product's row has blank bytes and names its module by hash; the native population takes the module as a loan
    const blank={...row,bytes:''},foreign=Uint8Array.from(chargeModule);foreign[foreign.length-1]=(foreign[foreign.length-1]??0)^1;
    expect(()=>SpawnScript.nativePopulation(host,blank)).toThrow();
    expect(()=>SpawnScript.nativePopulation(host,blank,foreign)).toThrow('Invalid raw spawn module');
    expect(()=>SpawnScript.nativePopulation(host,row,chargeModule)).toThrow('Invalid raw spawn module');
    expect(row.script.module).toBe(`blobs/wasm/${createHash('sha256').update(chargeModule).digest('hex')}.wasm`);
    expect(SpawnScript.nativePopulation(host,blank,chargeModule).failure).toBeNull();
    const script=SpawnScript.nativePopulation(host,row);
    expect(serializeSimSnapshot(snapshotSimHost(host))).toBe(initial);
    expect(random.snapshot()).toEqual(draws);
    const spawn=row.spawns[0],slot=row.slots[0];if(spawn===undefined||slot===undefined)throw new Error('Missing native encounter recipe');
    script.activate(spawn.id,0);
    const borrowed=script.body(slot.id);expect(borrowed).not.toBeNull();
    if(borrowed===null)throw new Error('Missing native script body');
    expect(owner.bodies).toContain(borrowed);expect(host.entities.get(borrowed.entityId)).toBe(borrowed);
    expect(owner.available()).toBe(62);script.retire(slot.id);
    expect(owner.bodies).not.toContain(borrowed);expect(host.entities.has(borrowed.entityId)).toBe(false);
    expect(owner.available()).toBe(63);
  } finally { host.dispose(); }
  expect(()=>owner.calm).toThrow();expect(()=>{owner.calm=true;}).toThrow();
});

test('native herd service keeps both id namespaces and retires with its real group owner', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const before = host.rng.snapshot(), tokens: NonNullable<ConstructorParameters<typeof FixtureNativeGroups>[9]> = { id: 'orchard.same', owners: new WeakMap() }, owner = herdService(host, 'orchard.same', 'orchard.same', tokens);
    expect(owner.owns(host)).toBe(true); expect(owner.tokens?.owners).toBe(tokens.owners);
    expect(() => herdService(host, 'other.herds', 'other.group', tokens)).toThrow('Duplicate native manager token owners');
    expect(() => fixtureGroup(host, 'other.group')).toThrow('Missing native group collection');
    expect(fixtureGroup(host, 'orchard.same')).toBe(owner);
    expect(nativeHerdCollection(host, 'orchard.same')).toBe(owner);
    expect(nativeHerdCollection(host, 'orchard.same').herds).toBe(owner.herds);
    expect(nativeHerdCollection(host, 'orchard.same').wind).toEqual({ x: 0, z: 0, strength: 0 });
    expect(() => herdService(host, 'orchard.same', 'orchard.other')).toThrow('Invalid native herd collection');
    expect(() => fixtureGroup(host, 'orchard.other')).toThrow('Missing native group collection');
    expect(host.rng.snapshot()).toEqual(before); expect(host.entities.size).toBe(0);
  } finally { host.dispose(); }
  expect(() => fixtureGroup(host, 'orchard.same')).toThrow('Missing native group collection');
  expect(() => nativeHerdCollection(host, 'orchard.same')).toThrow('Missing native herd collection');
});


test('v2 thrown dismount uses the original mounted capsule once, without a second ejection', async () => {
  const { applyV2WorldActions } = await import('./fixtures/applyWorldActionsV2');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const level = { ...SIM_LEVEL, quests: [] }, host = createSimHost(level, { rapier }), direct = createSimHost(level, { rapier });
  try {
    const mounted = install(host), original = install(direct);
    expect(mounted.mount('boar:1')).toBe(true); expect(original.mount('boar:1')).toBe(true);
    const action = { binding: 'rider', target: 'player.mount', kind: 'dismount' as const, thrown: true };
    applyV2WorldActions([action,action], [{ binding: 'rider',target: 'player.mount',scope: host.scope,kind: 'mount',owner: mounted }]);
    original.dismount(true);
    expect(mounted.mounted).toBe(false);expect(leadPlayer(host).modes.current()).toBe('foot');
    expect(snapshotSimHost(host)).toEqual(snapshotSimHost(direct));
    expect(leadPlayer(host).impulse.toArray()).toEqual(leadPlayer(direct).impulse.toArray());
    const command = { moveX: 0,moveZ: 0,yaw: 0,commandVersion: 1 as const };
    for (let step = 0; step < 6; step++) { host.step(leadCommands(host, command));direct.step(leadCommands(direct, command));expect(snapshotSimHost(host)).toEqual(snapshotSimHost(direct)); }
  } finally { host.dispose();direct.dispose(); }
});

test('named riding pond retains the predecessor native capsule, effects and save continuation',async()=>{
  const rapier=await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))),hosts=[false,true].map(raw=>{
    const host=createSimHost({...SIM_LEVEL,quests:[]},{rapier});lendNalatiPasture(host.scope);herdService(host,rows.herds);
    const block={file:'world/riding-pond.bin',bytes:raw?zeroBytes:offsetBytes(zeroBytes)};
    if(!raw)expect(block.bytes.byteOffset).toBe(4);
    const profile={...rows,world:{...rows.world,pond:channel(block.file)}};
    const mounted=installMountedPlayer(host,profile,block,zeroWet);expect(mounted.mount('boar:1')).toBe(true);return {host,mounted};
  });
  const original=hosts[0],raw=hosts[1];if(original===undefined||raw===undefined)throw new Error('Missing native comparison');
  try{
    const command={moveX:0,moveZ:0,yaw:0,commandVersion:1 as const,steer:{keyX:0,keyY:1,stickX:0,stickY:0}};
    for(let tick=0;tick<90;tick++){for(const f of hosts)f.host.step(leadCommands(f.host, command));const snapshot=serializeSimSnapshot(snapshotSimHost(original.host));expect(serializeSimSnapshot(snapshotSimHost(raw.host))).toBe(snapshot);}
    expect(raw.mounted.body.speed).toBeGreaterThan(0);raw.mounted.dismount();original.mounted.dismount();
    const dismounted=serializeSimSnapshot(snapshotSimHost(original.host));
    expect(serializeSimSnapshot(snapshotSimHost(raw.host))).toBe(dismounted);
  }finally{for(const f of hosts)f.host.dispose();}
});

test('malformed raw riding ponds refuse before mode, capsule or save ownership changes',async()=>{
  const rapier=await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))),host=createSimHost({...SIM_LEVEL,quests:[]},{rapier});
  try{
    herdService(host,rows.herds);const before=serializeSimSnapshot(snapshotSimHost(host)),file='world/riding-pond.bin';
    const profile={...rows,world:{...rows.world,pond:{type:'f32',count:4,data:{file}}}};
    for(const block of [undefined,{file:'other.bin',bytes:zlibSync(new Uint8Array(16))},{file,bytes:zlibSync(new Uint8Array(20))}]){
      expect(()=>installMountedPlayer(host,profile,block,zeroWet)).toThrow();expect(serializeSimSnapshot(snapshotSimHost(host))).toBe(before);expect(leadPlayer(host).modes.current()).toBe('foot');
    }
  }finally{host.dispose();}
});

test('raw riding wet mask retains native capsule, effects and save continuation',async()=>{
  const rapier=await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const wetBytes=zlibSync(new Uint8Array(Float32Array.from([1,1,1,1]).buffer)),file='world/riding-wet.bin';
  const hosts=[false,true].map(raw=>{
    const host=createSimHost({...SIM_LEVEL,quests:[]},{rapier});lendNalatiPasture(host.scope);herdService(host,rows.herds);
    const profile={...rows,world:{...rows.world,wet:channel(file)}};
    const block={file,bytes:raw?wetBytes:offsetBytes(wetBytes)};
    if(!raw)expect(block.bytes.byteOffset).toBe(4);
    const mounted=installMountedPlayer(host,profile,zeroPond,block);
    expect(mounted.mount('boar:1')).toBe(true);return {host,mounted};
  });
  const old=hosts[0],raw=hosts[1];if(old===undefined||raw===undefined)throw new Error('Missing wet comparison');
  try{
    const command={moveX:0,moveZ:0,yaw:0,commandVersion:1 as const,steer:{keyX:0,keyY:1,stickX:0,stickY:0}};
    for(let tick=0;tick<90;tick++){for(const f of hosts)f.host.step(leadCommands(f.host, command));const snapshot=serializeSimSnapshot(snapshotSimHost(old.host));expect(serializeSimSnapshot(snapshotSimHost(raw.host))).toBe(snapshot);}
    expect(raw.mounted.body.speed).toBeGreaterThan(0);raw.mounted.dismount();old.mounted.dismount();
    const dismounted=serializeSimSnapshot(snapshotSimHost(old.host));
    expect(serializeSimSnapshot(snapshotSimHost(raw.host))).toBe(dismounted);
  }finally{for(const f of hosts)f.host.dispose();}
});

test('malformed raw riding wet masks refuse before mode, capsule or save ownership changes',async()=>{
  const rapier=await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))),host=createSimHost({...SIM_LEVEL,quests:[]},{rapier});
  try{
    herdService(host,rows.herds);const before=serializeSimSnapshot(snapshotSimHost(host)),file='world/riding-wet.bin';
    const profile={...rows,world:{...rows.world,wet:{type:'f32',count:4,data:{file}}}};
    for(const block of [undefined,{file:'other.bin',bytes:zlibSync(new Uint8Array(16))},{file,bytes:zlibSync(new Uint8Array(20))}]){
      expect(()=>installMountedPlayer(host,profile,zeroPond,block)).toThrow();expect(serializeSimSnapshot(snapshotSimHost(host))).toBe(before);expect(leadPlayer(host).modes.current()).toBe('foot');
    }
  }finally{host.dispose();}
});

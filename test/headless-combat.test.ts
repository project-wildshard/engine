// oxlint-disable-next-line import/no-nodejs-modules -- The combat journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import type { NetCommand } from '@wildshard/format/netCommand';
import { app } from '../src/client/engine/app/runtime';
import { BowWeaponProfileSchema, MeleeWeaponProfileSchema, parseNativeFirearmProfile } from '@wildshard/format/weaponProfiles';
import { NetClient } from '../src/client/engine/net/client';
import { CombatWire, type CombatEvent } from '../src/server/engine/net/combatWire';
import type { NetCombatEvent } from '../src/shared/engine/net/messages';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { directLoopback } from '../src/test/engine/netLoopback';
import { CreatureBodies, type Creature } from '../src/shared/engine/physics/creatures';
import { applyMeleeCombatProfile, type MeleeProfile } from '../src/shared/engine/combat/meleeProfile';
import { hitscan } from '../src/client/engine/combat/view/hitscan';
import { Projectiles } from '../src/client/engine/combat/view/projectile';
import { SweptMelee } from '../src/client/engine/combat/view/SweptMelee';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import type { Targets, TargetHit } from '../src/client/engine/combat/types';
import type { Player } from '../src/client/engine/player/Player';
import type { Forest } from '../src/client/engine/world/forest/Forest';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { SWORD_WOOD } from '../src/shared/game/weapons/starterMeleeProfile';
import { HEAVY, SLASH, FINISHER } from '../src/shared/game/weapons/starterMoves';
import { nativeMeleeItem, readNativeRangedItem } from '../src/server/game/plugin/nativeItems';
import { weaponRow } from '../src/server/game/plugin/simulation';
import { FakeGame, legacyDouble } from '../src/test/engine/FakeGame';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands, type HeadlessCommand } from '../src/shared/host/tickProtocol';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// P1-E3.2: hits and damage settled by the shipped headless host (`createTrustedHeadlessResident`, what the standalone
// worker runs) on real shards: Driftwood's swept swords, Pine's bow and lever rifle. Each is held against the browser's own
// weapon classes (`SweptMelee`, `Projectiles`, `hitscan`) over the same bodies, so a law can't drift between the two.

type StandCommand = Extract<HeadlessCommand, { kind: 'player' }>;
let restore = (): void => undefined;
afterEach(() => { restore(); restore = () => undefined; });

async function shipped(slug: string) {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${slug} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier: Rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, resident: (snapshot?: string): Promise<TrustedHeadlessResident> => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const body = (resident: TrustedHeadlessResident, id: string): AnimalSim => {
  const actor = resident.host.entities.get(id); if (actor === undefined) throw new Error(`No creature ${id}`); return actor;
};
const nearest = (resident: TrustedHeadlessResident, kind: string): AnimalSim => {
  const p = leadPlayer(resident.host).position, rows = [...resident.host.entities.values()].filter(row => row.kind === kind && row.alive);
  const best = rows.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
  if (best === undefined) throw new Error(`No ${kind}`); return best;
};
/** Hold every creature where it stands: the fight is about the player's blows. */
const hold = (resident: TrustedHeadlessResident): void => { for (const actor of resident.host.entities.values()) actor.harnessHold = true; };
/** The player's feet and yaw at `gap` metres short of a body, facing it. */
const facing = (resident: TrustedHeadlessResident, target: AnimalSim, gap: number): void => {
  const { host } = resident, p = leadPlayer(host).position, dx = target.position.x - p.x, dz = target.position.z - p.z, span = Math.hypot(dx, dz), yaw = Math.atan2(-dx, -dz);
  const x = target.position.x - dx / span * gap, z = target.position.z - dz / span * gap;
  leadPlayer(host).resetPose({ x, y: host.groundHeightAt(x, z), z }, yaw);
};
/** A body's chest, where a page crosshair and `nativeRangedAim`'s default rest. */
const chest = (target: AnimalSim): Vector3 => { const rear = new Vector3(), front = new Vector3(); target.bodyCapsule(rear, front); return rear.add(front).multiplyScalar(0.5); };
const triple = v.tuple([v.number(), v.number(), v.number()]);
const stand = (resident: TrustedHeadlessResident): StandCommand => ({ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(resident.host).yaw });
const tick = (resident: TrustedHeadlessResident, count: number, commands: readonly HeadlessCommand[] = [stand(resident)]): void => {
  for (let at = 0; at < count; at++) { hold(resident); resident.step(commands); }
};

/** The page's target query: the real hit volumes `AnimalManager.raycast` casts, posed from this world's bodies. */
function pageTargets(resident: TrustedHeadlessResident): Targets {
  const { host } = resident, bodies = new CreatureBodies<Creature & { readonly sim: AnimalSim }>(host.physics);
  bodies.sync([...host.entities.values()].map(sim => ({ sim, position: sim.position, get alive() { return sim.alive; }, hidden: false, scale: sim.scale, dims: sim.dims,
    headWorld: (out: Vector3) => sim.headWorld(out), bodyCapsule: (a: Vector3, b: Vector3) => { sim.bodyCapsule(a, b); }, motor: null, driven: false, simulationBound: true })), leadPlayer(host).position);
  host.physics.step(); // a query reads the world as of its last step
  return { raycast: (origin, dir, maxDist): TargetHit | null => {
    const hit = bodies.cast(origin, dir, maxDist);
    return hit === null ? null : { animal: hit.creature.sim, point: hit.point.clone(), distance: hit.distance, headshot: hit.head };
  } };
}
/** The browser's world for one resident: its physics, and the player the page would hold at the same pose. */
function pageWorld(resident: TrustedHeadlessResident, aimAt: Vector3) {
  const was = app.physics, aimed = app.aimTargets, { host } = resident, game = new FakeGame().asGame();
  app.physics = host.physics; app.aimTargets = legacyDouble<typeof app.aimTargets>([...host.entities.values()]);
  restore = () => { app.physics = was; app.aimTargets = aimed; };
  const position = leadPlayer(host).position, eye = new Vector3(position.x, position.y + 1.68, position.z), direction = aimAt.clone().sub(eye).normalize();
  const player = legacyDouble<Player>({ position, yaw: leadPlayer(host).yaw, pitch: Math.asin(direction.y), fovKick: 0, speedFactor: 0, bobTime: 0, sprinting: false, dashing: false, swinging: false,
    motor: leadPlayer(host).motor, dashTo: () => true, sampleAimCommand: () => ({ origin: { x: eye.x, y: eye.y, z: eye.z }, direction: { x: direction.x, y: direction.y, z: direction.z } }) });
  return { game, player, eye, direction, sky: legacyDouble<SkyRig>({}), forest: legacyDouble<Forest>({}) };
}
/** The page's own sword over `profile`, ready to swing. */
function pageSword(page: ReturnType<typeof pageWorld>, targets: Targets, profile: MeleeProfile): SweptMelee {
  const debris = { surface: 'sand', count: 1, atFeet: true, sparks: false } as const, moves = profile.moves;
  if (moves === undefined) throw new Error('The starter sword declares its moves');
  const sword = new SweptMelee({ game: page.game, sky: page.sky, player: page.player, forest: page.forest }, targets,
    { row: profile, profile, inputContext: 'weapon.melee', rig: { sword: new BoxGeometry(0.1, 0.1, 0.1), arms: new BoxGeometry(0.1, 0.1, 0.1), tipY: 0.62, baseY: 0.1, material: new MeshBasicMaterial() } },
    { moves, slash: SLASH, finisher: FINISHER, heavy: HEAVY, events: {}, debris: () => debris });
  sword.setActive(true); sword.enabled = true;
  return sword;
}

/** Step idle ticks until `done`, answering how many it took. */
function countUntil(resident: TrustedHeadlessResident, done: () => boolean, limit: number): number {
  for (let at = 0; at < limit; at++) { if (done()) return at; tick(resident, 1); }
  throw new Error('The fight never settled');
}

test('Driftwood: a real walk, free swings and the page\'s own Sword land the same damage, knockback and kill', async () => {
  const { product, resident } = await shipped('driftwood-isle');
  const live = await resident(), wire = new CombatWire(live.host);
  try {
    const crab = nearest(live, 'crab'), start = leadPlayer(live.host).position, owner = nativeMeleeItem(live.host, 'item.driftwood-isle.swords');
    const journey = runHeadlessJourney(live.host, input => { hold(live); live.step(input); }, { ticks: 1500, points: [{ x: start.x, z: start.z }, { x: crab.position.x, z: crab.position.z + 4 }], once: true });
    expect(journey.complete).toBe(true);
    facing(live, crab, 1.4); wire.drain();
    const saved = serializeSimSnapshot(snapshotSimHostBytes(live.host)), hpBefore = crab.hp, pushes: number[][] = [], server: number[] = [];

    // three free taps, one per swing: nothing names the crab, the server finds it along the look the page holds below
    const feet = leadPlayer(live.host).position, look = Math.asin(chest(crab).sub(new Vector3(feet.x, feet.y + 1.68, feet.z)).normalize().y);
    for (let swing = 0; swing < 3 && crab.alive; swing++) {
      tick(live, 1, [{ ...stand(live), swing: true, pitch: look }]); tick(live, 29);
      server.push(crab.hp); pushes.push(crab.snapshot().pushDir);
    }
    const rows = wire.drain(), hits = rows.filter(row => row.kind === 'hit');
    expect(owner.swings()).toBe(server.length);
    expect(hits.map(row => row.killed)).toEqual([...Array.from({ length: hits.length - 1 }, () => false), true]);
    expect(hits.every(row => row.target === crab.entityId && row.by === leadPlayer(live.host).id)).toBe(true);
    expect(hits.reduce((sum, row) => sum + row.amount, 0)).toBeGreaterThanOrEqual(hpBefore);
    expect(rows.find(row => row.kind === 'died')).toMatchObject({ id: crab.entityId, by: leadPlayer(live.host).id });
    expect(crab.alive).toBe(false);

    // the browser: the same taps from the same pose, by the page's own class, over a world restored from just before them
    const browser = await resident(saved), twin = body(browser, crab.entityId), rays = pageTargets(browser), page = pageWorld(browser, chest(twin));
    try {
      const row = v.parse(MeleeWeaponProfileSchema, weaponRow(product.shardfile, 'weapon.driftwood-isle.wood').profile);
      const sword = pageSword(page, rays, applyMeleeCombatProfile(SWORD_WOOD, row)), trace: number[] = [], thrown: number[][] = [];
      let frame = 0;
      for (let swing = 0; swing < server.length; swing++) {
        sword.tryFire();
        for (let at = 0; at < 30; at++) { sword.update(1 / 60, frame++ / 60); }
        trace.push(twin.hp); thrown.push(twin.snapshot().pushDir);
      }
      expect(trace).toEqual(server); expect(twin.alive).toBe(false);
      pushes.slice(0, -1).forEach((push, swing) => { push.forEach((axis, index) => { expect(axis).toBeCloseTo(thrown[swing]?.[index] ?? Number.NaN, 1); }); });
    } finally { browser.dispose(); }
  } finally { live.dispose(); }
}, 120_000);

test('Pine: arrows and rifle rounds fly and strike on the tick, and match the page\'s Projectiles and hitscan', async () => {
  const { product, resident } = await shipped('pine-hollow');
  const live = await resident(), wire = new CombatWire(live.host), { host } = live;
  try {
    const boar = nearest(live, 'boar'), start = leadPlayer(host).position, frame = readNativeRangedItem(host, 2).frame, bow = readNativeRangedItem(host, 2), rifle = readNativeRangedItem(host, 1);
    if (bow.kind !== 'bow' || rifle.kind !== 'cycle') throw new Error('Pine declares a bow and a lever rifle');
    const journey = runHeadlessJourney(host, input => { hold(live); live.step(input); }, { ticks: 1500, points: [{ x: start.x, z: start.z }, { x: boar.position.x, z: boar.position.z - 20 }], once: true });
    expect(journey.stuck).toEqual([]);
    facing(live, boar, 14); tick(live, 2); wire.drain();
    for (const flag of ['owned:lever-rifle', 'paid:king']) host.flags.set(flag);
    const pick = (slot: number): void => { tick(live, 40, [stand(live), { kind: 'script', actorId: 'pine.weapon', value: slot }]); expect(frame.live.has(slot)).toBe(true); };

    // the longbow: a held draw on the boar, the release looses, and the arrow flies for real ticks
    pick(2);
    const heavy: StandCommand = { ...stand(live), heavy: { targetId: boar.entityId } }, hpBefore = boar.hp;
    tick(live, 70, [heavy]); const quiver = bow.item.state.arrows;
    tick(live, 1); expect(bow.item.state.arrows).toBe(quiver - 1); expect(bow.item.flying()).toBe(1);
    const flying = v.parse(v.object({ flying: v.array(v.object({ active: v.boolean(), pos: triple, vel: triple })) }), host.adapters.get('pine.longbow')?.snapshot()).flying.find(row => row.active);
    if (flying === undefined) throw new Error('No arrow in flight');
    const midFlight = serializeSimSnapshot(snapshotSimHostBytes(host)), ticksInFlight = countUntil(live, () => bow.item.flying() === 0, 120);
    expect(ticksInFlight).toBeGreaterThan(3);
    const arrow = wire.drain().find(row => row.kind === 'hit');
    expect(arrow).toMatchObject({ kind: 'hit', target: boar.entityId, by: leadPlayer(host).id });
    expect(boar.hp).toBe(hpBefore - (arrow?.kind === 'hit' ? arrow.amount : 0));

    // the page's Projectiles: the same flight from the same world
    const browser = await resident(midFlight), twin = body(browser, boar.entityId), rays = pageTargets(browser), page = pageWorld(browser, chest(twin));
    try {
      const profile = v.parse(BowWeaponProfileSchema, weaponRow(product.shardfile, 'weapon.longbow').profile), got: number[] = [];
      const arrows = new Projectiles({ game: page.game, sky: page.sky, player: page.player, forest: page.forest }, rays,
        { ...profile.flight, length: 0.8, bury: 0.1, recover: 0, maxFlying: 4, maxStuck: 4, substeps: profile.substeps, lifetime: profile.lifetime, geometry: new BoxGeometry(0.02, 0.02, 0.5), material: new MeshBasicMaterial() });
      arrows.onHit = (_kind, _head, _killed, _point, damage) => { got.push(damage); };
      arrows.launch(new Vector3(...flying.pos), new Vector3(...flying.vel), { damageScale: profile.damageScale });
      for (let at = 0; at < 120 && got.length === 0; at++) arrows.update(1 / 60);
      expect(got).toHaveLength(1); expect(twin.hp).toBe(boar.hp);
    } finally { browser.dispose(); }

    // the lever rifle: hitscan on the tick, the page's hitscan over the same aim and the same stream
    pick(1); wire.drain();
    const hpShot = boar.hp, beforeShot = serializeSimSnapshot(snapshotSimHostBytes(host));
    tick(live, 1, [{ ...stand(live), attack: { targetId: boar.entityId } }]); tick(live, 1);
    const round = wire.drain().find(row => row.kind === 'hit');
    if (round?.kind !== 'hit') throw new Error('The rifle did not settle a hit');
    expect(round).toMatchObject({ target: boar.entityId, by: leadPlayer(host).id });
    const shot = await resident(beforeShot), twinShot = body(shot, boar.entityId), rifleRays = pageTargets(shot), aimed = pageWorld(shot, chest(twinShot));
    try {
      const stream = vi.spyOn(app.rng, 'stream').mockImplementation(name => shot.host.rng.stream(name));
      const lever = parseNativeFirearmProfile(weaponRow(product.shardfile, 'weapon.lever').profile, 'lever');
      const result = hitscan((origin, direction) => { origin.copy(aimed.eye); return direction.copy(aimed.direction); }, rifleRays, lever, 0, 0, 0);
      stream.mockRestore();
      expect(result.surface).toBe('flesh'); expect(result.hit?.animal).toBe(twinShot); expect(hpShot - twinShot.hp).toBeCloseTo(round.amount, 5);
    } finally { shot.dispose(); }

    // free aim: no named target, only the yaw and the look pitch, from the server's own eye
    const eye = leadPlayer(host).position.clone().setY(leadPlayer(host).position.y + 1.68), pitch = Math.asin(chest(boar).sub(eye).normalize().y), free: StandCommand = { ...stand(live), pitch, swing: true };
    const hpFree = boar.hp;
    countUntil(live, () => { tick(live, 1, [free]); return boar.hp < hpFree; }, 240);
    expect(wire.drain().find(row => row.kind === 'hit')).toMatchObject({ target: boar.entityId, by: leadPlayer(host).id });

    // and a free loose at the next boar: the held draw names nothing, the release leaves along the look
    const next = nearest(live, 'boar'); facing(live, next, 14); pick(2); wire.drain();
    const lookAt = Math.asin(chest(next).sub(leadPlayer(host).position.clone().setY(leadPlayer(host).position.y + 1.68)).normalize().y), hpLoose = next.hp;
    tick(live, 70, [{ ...stand(live), pitch: lookAt, heavy: {}, swing: true }]); tick(live, 1, [{ ...stand(live), pitch: lookAt }]);
    countUntil(live, () => bow.item.flying() === 0, 120);
    expect(next.hp).toBeLessThan(hpLoose);
    expect(wire.drain().find(row => row.kind === 'hit')).toMatchObject({ target: next.entityId, by: leadPlayer(host).id });
  } finally { live.dispose(); }
}, 180_000);

test('a swing and an arrow restored mid-air finish exactly as the live ones do', async () => {
  const drift = await shipped('driftwood-isle'), live = await drift.resident();
  try {
    const crab = nearest(live, 'crab'); hold(live); facing(live, crab, 1.4);
    // a tap, a queued second tap and a held heavy: the clock, the free aim and the body all sit in the snapshot
    tick(live, 1, [{ ...stand(live), swing: true }]); tick(live, 2); tick(live, 1, [{ ...stand(live), swing: true }]); tick(live, 1);
    const hp = crab.hp, restored = await drift.resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    try {
      expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
      const twin = body(restored, crab.entityId);
      for (const resident of [live, restored]) tick(resident, 40);
      expect(crab.hp).toBeLessThan(hp); expect(twin.hp).toBe(crab.hp);
      expect(nativeMeleeItem(restored.host, 'item.driftwood-isle.swords').hits()).toBe(nativeMeleeItem(live.host, 'item.driftwood-isle.swords').hits());
      expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    } finally { restored.dispose(); }
  } finally { live.dispose(); }

  const pine = await shipped('pine-hollow'), archer = await pine.resident();
  try {
    const { host } = archer, boar = nearest(archer, 'boar'), bow = readNativeRangedItem(host, 2);
    if (bow.kind !== 'bow') throw new Error('Pine declares a longbow');
    hold(archer); facing(archer, boar, 16); host.flags.set('paid:king');
    tick(archer, 40, [stand(archer), { kind: 'script', actorId: 'pine.weapon', value: 2 }]);
    tick(archer, 70, [{ ...stand(archer), heavy: { targetId: boar.entityId } }]); tick(archer, 1);
    expect(bow.item.flying()).toBe(1);
    const hp = boar.hp, restored = await pine.resident(serializeSimSnapshot(snapshotSimHostBytes(host)));
    try {
      const again = readNativeRangedItem(restored.host, 2), twin = body(restored, boar.entityId);
      if (again.kind !== 'bow') throw new Error('Pine restores its longbow');
      expect(again.item.flying()).toBe(1); expect(again.item.state.arrows).toBe(bow.item.state.arrows);
      for (const resident of [archer, restored]) tick(resident, 60);
      expect(boar.hp).toBeLessThan(hp); expect(twin.hp).toBe(boar.hp); expect(again.item.flying()).toBe(0);
      expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    } finally { restored.dispose(); }
  } finally { archer.dispose(); }
}, 180_000);

test('Sunscar: a free whip crack lands what a named one does', async () => {
  const { resident } = await shipped('sunscar-dunes');
  const named = await resident(), free = await resident();
  try {
    const crack = (live: TrustedHeadlessResident, command: StandCommand): CombatEvent | undefined => {
      const wire = new CombatWire(live.host), target = nearest(live, 'sandSkitterer');
      hold(live); facing(live, target, 2); tick(live, 2); wire.drain();
      tick(live, 1, [{ ...command, yaw: leadPlayer(live.host).yaw }]); tick(live, 40);
      return wire.drain().find(row => row.kind === 'hit');
    };
    const target = nearest(named, 'sandSkitterer');
    const by = crack(named, { ...stand(named), attack: { targetId: target.entityId } }), aimed = crack(free, { ...stand(free), swing: true });
    expect(by).toMatchObject({ kind: 'hit', target: target.entityId });
    expect(aimed).toMatchObject({ target: target.entityId, amount: by?.kind === 'hit' ? by.amount : Number.NaN });
  } finally { named.dispose(); free.dispose(); }
}, 120_000);

test('hit and died reach a client over the loopback, in order, confirming the swing that landed them', async () => {
  const { resident } = await shipped('driftwood-isle');
  const live = await resident(), link = directLoopback(), client = new NetClient(link.client), events: NetCombatEvent[] = [];
  const room = new NetRoom({ world: new SimNetWorld(live.host), step: inputs => {
    const own = inputs[0]; hold(live);
    live.step(tickCommands([{ source: 'test', commands: netTickCommands(own?.command ?? null, own?.acts ?? []) }], 8));
  } });
  try {
    const crab = nearest(live, 'crab');
    hold(live); facing(live, crab, 1.4);
    room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
    client.onCombat(event => { events.push(event); });
    const { yaw } = leadPlayer(live.host), aim = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } }, idle = { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 };
    const seqs: number[] = [];
    for (let at = 0; at < 200 && crab.alive; at++) {
      const seq = client.command({ ...idle, ...(at % 30 === 0 ? { attack: { aim } } : {}) });
      if (at % 30 === 0) seqs.push(seq);
      client.flush(); link.pump(); room.tick(); link.pump();
    }
    for (let at = 0; at < 4; at++) { client.command(idle); client.flush(); link.pump(); room.tick(); link.pump(); }
    expect(crab.alive).toBe(false);
    const handle = [...client.entities.values()].find(row => row.id === crab.entityId)?.handle, hits = events.filter(event => event.kind === 'hit'), died = events.filter(event => event.kind === 'died');
    expect(handle).toBeGreaterThan(0); expect(hits.length).toBeGreaterThan(1);
    expect(hits.map(event => event.target)).toEqual(hits.map(() => handle));
    expect(hits.at(-1)?.killed).toBe(true); expect(hits.slice(0, -1).every(event => !event.killed)).toBe(true);
    expect(hits.map(event => event.confirmFor)).toEqual(seqs.slice(0, hits.length));
    expect(hits.reduce((sum, event) => sum + event.amount, 0)).toBeGreaterThanOrEqual(crab.maxHp);
    expect(hits.every(event => Math.hypot(event.at[0] - crab.position.x, event.at[2] - crab.position.z) < 3)).toBe(true);
    expect(died).toMatchObject([{ kind: 'died', id: handle, by: client.welcome?.handle }]);
    expect(events.at(-1)).toBe(died[0]); expect(died[0]?.impulse).toBe(hits.at(-1)?.amount);
  } finally { room.dispose(); client.dispose(); live.dispose(); }
}, 120_000);

/** A NetCommand's idle thumb for `yaw`, looking along `pitch`. */
const thumb = (seq: number, yaw: number, pitch = 0): NetCommand => ({ seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch, buttons: 0 });
const freeAim = { aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } };
/** A second player `gap` metres short of `target`, facing it; answers its yaw. */
function joinFacing(live: TrustedHeadlessResident, id: string, target: AnimalSim, gap: number): number {
  const { host } = live, spawn = leadPlayer(host).position, dx = target.position.x - spawn.x, dz = target.position.z - spawn.z, span = Math.hypot(dx, dz), yaw = Math.atan2(-dx, -dz);
  const x = target.position.x - dx / span * gap, z = target.position.z - dz / span * gap;
  host.addPlayer(id, { x, y: host.groundHeightAt(x, z), z }, yaw);
  return yaw;
}

test('Driftwood: a bot\'s swing lands the sword\'s real damage as its own, and survives a save mid-swing', async () => {
  const { resident } = await shipped('driftwood-isle');
  const live = await resident(), wire = new CombatWire(live.host), bot = 'bot:1';
  try {
    const crab = nearest(live, 'crab'), yaw = joinFacing(live, bot, crab, 1.4), owner = nativeMeleeItem(live.host, 'item.driftwood-isle.swords'), hp = crab.hp;
    const lead = (commands: Map<string, NetCommand>): void => { hold(live); live.step([stand(live)], commands); };
    lead(new Map([[bot, { ...thumb(41, yaw), attack: freeAim }]]));
    for (let at = 0; at < 2; at++) lead(new Map([[bot, thumb(42 + at, yaw)]]));
    // saved mid-swing with two players: the bot's clock and blade sit in the lead's adapter
    const restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    try {
      expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
      const twin = body(restored, crab.entityId);
      for (let at = 0; at < 30; at++) {
        lead(new Map([[bot, thumb(44 + at, yaw)]]));
        hold(restored); restored.step([stand(restored)], new Map([[bot, thumb(44 + at, yaw)]]));
      }
      expect(twin.hp).toBe(crab.hp);
      expect(restored.host.adapters.get('item.driftwood-isle.swords')?.snapshot()).toEqual(live.host.adapters.get('item.driftwood-isle.swords')?.snapshot());
    } finally { restored.dispose(); }
    const hits = wire.drain().filter(row => row.kind === 'hit');
    expect(hits).toMatchObject([{ target: crab.entityId, by: bot, seq: 41, amount: 12 }]);
    expect(crab.hp).toBe(hp - 12); expect(owner.swings()).toBe(0);
  } finally { live.dispose(); }
}, 120_000);

test('Driftwood: a free swing strikes every body the page\'s blade sweep strikes', async () => {
  const { product, resident } = await shipped('driftwood-isle');
  const live = await resident(), wire = new CombatWire(live.host), { host } = live;
  try {
    const crabs = [...host.entities.values()].filter(row => row.kind === 'crab' && row.alive).slice(0, 5), first = crabs[0];
    if (first === undefined || crabs.length < 3) throw new Error('Driftwood has its crabs');
    facing(live, first, 1.3);
    const { position: feet, yaw } = leadPlayer(host), spread = [0, -0.45, 0.45, -0.9, 0.9];
    crabs.forEach((crab, at) => {
      const angle = yaw + (spread[at] ?? 0), x = feet.x - Math.sin(angle) * 1.3, z = feet.z - Math.cos(angle) * 1.3;
      crab.place(x, z, angle, host.groundHeightAt(x, z)); crab.harnessHold = false;
    });
    live.step([stand(live)]); hold(live); wire.drain(); // one free step poses each moved body's hit volumes
    const saved = serializeSimSnapshot(snapshotSimHostBytes(host)), look = -0.45;
    tick(live, 1, [{ ...stand(live), swing: true, pitch: look }]); tick(live, 40);
    const server = wire.drain().flatMap(row => row.kind === 'hit' ? [row.target] : []).sort();

    const browser = await resident(saved), rays = pageTargets(browser), eye = new Vector3(feet.x, feet.y + 1.68, feet.z), page = pageWorld(browser, eye.clone().add(new Vector3(-Math.sin(yaw) * Math.cos(look), Math.sin(look), -Math.cos(yaw) * Math.cos(look))));
    try {
      const row = v.parse(MeleeWeaponProfileSchema, weaponRow(product.shardfile, 'weapon.driftwood-isle.wood').profile);
      const sword = pageSword(page, rays, applyMeleeCombatProfile(SWORD_WOOD, row)), before = new Map(crabs.map(crab => [crab.entityId, body(browser, crab.entityId).hp]));
      sword.tryFire();
      for (let at = 0; at < 40; at++) sword.update(1 / 60, at / 60);
      const shown = crabs.flatMap(crab => body(browser, crab.entityId).hp < (before.get(crab.entityId) ?? 0) ? [crab.entityId] : []).sort();
      expect(shown).toEqual(server); expect(server.length).toBeGreaterThan(1);
    } finally { browser.dispose(); }
  } finally { live.dispose(); }
}, 120_000);

test('Sunscar: a bot\'s whip cracks for the same damage as the lead\'s', async () => {
  const { resident } = await shipped('sunscar-dunes');
  const live = await resident(), wire = new CombatWire(live.host), bot = 'bot:1';
  try {
    const target = nearest(live, 'sandSkitterer'), yaw = joinFacing(live, bot, target, 2), hp = target.hp;
    hold(live); live.step([stand(live)], new Map([[bot, { ...thumb(9, yaw), attack: freeAim }]]));
    for (let at = 0; at < 40; at++) { hold(live); live.step([stand(live)], new Map([[bot, thumb(10 + at, yaw)]])); }
    expect(wire.drain().find(row => row.kind === 'hit')).toMatchObject({ target: target.entityId, by: bot, seq: 9 });
    expect(target.hp).toBeLessThan(hp);
  } finally { live.dispose(); }
}, 120_000);

test('Pine: a bot fires its own crossbow, and an arrow confirms the shot that loosed it, not a later swing', async () => {
  const { resident } = await shipped('pine-hollow');
  const live = await resident(), wire = new CombatWire(live.host), bot = 'bot:1', { host } = live;
  try {
    const boar = nearest(live, 'boar'), yaw = joinFacing(live, bot, boar, 6), hp = boar.hp, feet = host.players.get(bot)?.position;
    if (feet === undefined) throw new Error('No bot');
    const look = Math.asin(chest(boar).sub(new Vector3(feet.x, feet.y + 1.68, feet.z)).normalize().y);
    tick(live, 3); const lever = readNativeRangedItem(host, 1), crossbow = readNativeRangedItem(host, 0);
    if (crossbow.kind !== 'bolt' || lever.kind !== 'cycle') throw new Error('Pine declares a crossbow and a lever rifle');
    const quiver = crossbow.item.state.quiver;
    hold(live); live.step([stand(live)], new Map([[bot, { ...thumb(20, yaw, look), launcher: { slot: 0, ads: 1, fire: true } }]]));
    for (let at = 0; at < 60 && boar.hp === hp; at++) { hold(live); live.step([stand(live)], new Map([[bot, { ...thumb(21 + at, yaw, look), attack: freeAim }]])); }
    expect(wire.drain().find(row => row.kind === 'hit')).toMatchObject({ target: boar.entityId, by: bot, seq: 20 });
    expect(boar.hp).toBeLessThan(hp); expect(crossbow.item.state.quiver).toBe(quiver);
  } finally { live.dispose(); }
}, 120_000);

test('J105: on Driftwood each player who hurt a crab gets their own coins, a chip of damage gets none, and alone nothing changes', async () => {
  const { resident } = await shipped('driftwood-isle');
  const live = await resident(), { host } = live, bot = 'bot:1', chipper = 'bot:2';
  const solo = await resident();
  try {
    const crab = nearest(live, 'crab'), link = { hit: (who: string, amount: number): void => {
      const health = host.players.get(who)?.health; if (health === undefined) throw new Error(`No ${who}`);
      host.combat.hit({ source: health, sourceTags: ['actor.player'], target: crab.combatActor(), amount, point: crab.position, dir: new Vector3(0, 0, 1), throughWalls: true });
    } };
    host.addPlayer(bot, leadPlayer(host).position); host.addPlayer(chipper, leadPlayer(host).position);
    link.hit(bot, crab.maxHp * 0.3); link.hit(chipper, crab.maxHp * 0.01); link.hit(leadPlayer(host).id, crab.maxHp * 2);
    expect(crab.alive).toBe(false);
    hold(live); live.step([stand(live)]); // the tick's flush hears the deaths
    const paid = live.effects.filter(effect => effect.kind === 'coins');
    expect(paid.map(effect => effect.kind === 'coins' ? effect.actorId : '').sort()).toEqual([leadPlayer(host).id, bot].sort());
    expect(host.damage.meaningful(crab.entityId)).toEqual([]);

    // alone: no server grant and no save bytes; the page's own bounty pays exactly what it always did
    const crabAlone = nearest(solo, 'crab'), before = solo.host.slots.ledgerDedupe.length;
    solo.host.combat.hit({ source: leadPlayer(solo.host).health, sourceTags: ['actor.player'], target: crabAlone.combatActor(), amount: crabAlone.maxHp * 2, point: crabAlone.position, dir: new Vector3(0, 0, 1), throughWalls: true });
    solo.step([stand(solo)]);
    expect(crabAlone.alive).toBe(false); expect(solo.effects.filter(effect => effect.kind === 'coins')).toEqual([]); expect(solo.host.slots.ledgerDedupe.length).toBe(before);
    expect(snapshotSimHost(solo.host).damage).toBeUndefined();
  } finally { live.dispose(); solo.dispose(); }
}, 120_000);

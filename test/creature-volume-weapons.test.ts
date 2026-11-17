import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { CreatureBodies, type Creature } from '../src/shared/engine/physics/creatures';
import { hitscan } from '../src/client/engine/combat/view/hitscan';
import { ProjectileLaw } from '../src/shared/engine/combat/projectileLaw';
import type { Targets } from '../src/client/engine/combat/types';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';
import { app } from '../src/client/engine/app/runtime';
import { FakeGame, legacyDouble } from '../src/test/engine/FakeGame';
import { SweptMelee } from '../src/client/engine/combat/view/SweptMelee';
import { SWORD_WOOD } from '../src/shared/game/weapons/starterMeleeProfile';
import { SLASH, FINISHER, HEAVY } from '../src/shared/game/weapons/starterMoves';
import type { Player } from '../src/client/engine/player/Player';
import type { Forest } from '../src/client/engine/world/forest/Forest';
import type { SkyRig } from '../src/client/engine/world/skyRig';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const parts = [{ part: 'head', x: 0, y: 2, multiplier: 2 }, { part: 'body', x: 0, y: .6, multiplier: 1 }, { part: 'shield', x: 1, y: 1, multiplier: 0 }];
for (const family of ['hitscan', 'projectile'] as const) test.each(parts)(`local ${family} uses actual Rapier $part and the authoritative pipeline`, async ({ part, x, y, multiplier }) => {
  const { source, assets } = await creatureVolumeFixture(), sim = createShardfileSim(source, assets, { rapier: await rapier });
  const actor = sim.host.entities.get('fixture.actor');
  if (actor === undefined || actor.hitVolumes === undefined) { sim.dispose(); throw new Error('Missing authored local body'); }
  const bodies = new CreatureBodies(sim.host.physics);
  const proxy: Creature = { position: actor.position, get alive() { return actor.alive; }, hidden: false, scale: actor.scale, dims: actor.dims,
    hitVolumes: actor.hitVolumes, motor: null, driven: false, simulationBound: true, headWorld: out => actor.headWorld(out), bodyCapsule: (rear, front) => actor.bodyCapsule(rear, front) };
  const targets: Targets = { raycast: (from, dir, max) => {
    const hit = bodies.cast(from, dir, max);
    return hit === null ? null : { animal: actor, point: hit.point, distance: hit.distance, headshot: hit.head,
      ...(hit.multiplier === undefined ? {} : { part: hit.part, multiplier: hit.multiplier }) };
  } };
  try {
    bodies.sync([proxy], new Vector3()); sim.host.step();
    const rng = sim.host.rng.snapshot(), baseline = actor.damageFor(false, 7); sim.host.rng.restore(rng);
    const hp = actor.hp, from = new Vector3(x, y, 0), direction = new Vector3(0, 0, 1);
    let outcome: string | undefined, damageEvents = 0;
    sim.host.events.on('damage.dealt', event => { if (event.req.target.id === actor.entityId) { damageEvents++; outcome = event.req.part; } }, sim.host.scope);
    expect(targets.raycast(from, direction, 20)?.part).toBe(part);
    if (family === 'hitscan') {
      const result = hitscan((origin, along) => { origin.copy(from); return along.copy(direction); }, targets,
        { range: 20, damageScale: 1, spreadAds: 0, spreadHip: 0, spreadRadius: 'sqrt', movingSpread: 0, movingAimReduction: 0 }, 0, 0, 0);
      expect(result.hit?.part).toBe(part);
    } else {
      const law = new ProjectileLaw<{ id: number }, null>({ length: .01, gravity: 0, drag: 0, windCoupling: 0, bury: 0,
        recover: 0, maxFlying: 1, maxStuck: 0, stick: false }, {
        feet: new Vector3(100, 0, 100), extent: 100, floorAt: () => -10, world: () => null,
        targets: targets.raycast, wind: () => null, surface: () => 'ground', random: () => .5, canRecover: () => false,
        recover: () => undefined, flight: id => ({ id }), stuck: () => null, moved: () => undefined, ended: () => undefined,
        settled: () => undefined, changed: () => undefined, removed: () => undefined, impact: () => undefined,
        playerHit: () => { throw new Error('Player projectile hit its owner'); }, targetHit: () => undefined, hit: () => undefined,
      });
      law.launch(from, direction.clone().multiplyScalar(20), { damageScale: 1 });
      for (let tick = 0; tick < 60; tick++) law.update(1 / 60);
      expect(law.pool.slots[0]?.active).toBe(false);
    }
    expect(hp - actor.hp).toBe(baseline * multiplier);
    if (multiplier === 0) expect(sim.host.rng.snapshot()).toEqual(rng);
    sim.host.step(); expect(damageEvents).toBe(multiplier === 0 ? 0 : 1); expect(outcome).toBe(multiplier === 0 ? undefined : part);
    expect(bodies.bodies).toBe(0); expect(sim.host.entities.size).toBe(1);
  } finally { bodies.remove(proxy); sim.dispose(); }
});

test.each(parts)('a real local swept sword carries $part through its public swing', async ({ part, multiplier }) => {
  const { source, assets } = await creatureVolumeFixture(), body = source.rows.species[0]?.body, spawn = source.creatures.spawns[0];
  if (body === undefined || spawn === undefined) throw new Error('Missing authored sweep source');
  delete body.skeleton;
  body.volumes = [{ part, bone: 'head', shape: 'sphere', radius: .8, halfLength: 0, axis: 'y', multiplier }];
  spawn.at[2] = 1.8;
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), actor = sim.host.entities.get('fixture.actor');
  if (actor === undefined || actor.hitVolumes === undefined) { sim.dispose(); throw new Error('Missing local sword body'); }
  const bodies = new CreatureBodies(sim.host.physics), fake = new FakeGame(), game = fake.asGame();
  const proxy: Creature = { position: actor.position, alive: true, hidden: false, scale: actor.scale, dims: actor.dims, hitVolumes: actor.hitVolumes,
    motor: null, driven: false, simulationBound: true, headWorld: out => actor.headWorld(out), bodyCapsule: (rear, front) => actor.bodyCapsule(rear, front) };
  const was = app.physics, aimed = app.aimTargets, physicsHits = vi.spyOn(app.combat, 'hit');
  try {
    bodies.sync([proxy], new Vector3()); sim.host.step(); app.physics = sim.host.physics;
    app.aimTargets = legacyDouble<typeof app.aimTargets>([actor]);
    const position = new Vector3(0, .32, 0), player = legacyDouble<Player>({ position, yaw: Math.PI, pitch: 0, fovKick: 0, speedFactor: 0,
      bobTime: 0, sprinting: false, dashing: false, swinging: false, motor: sim.host.focusedPlayer.motor, dashTo: () => true,
      sampleAimCommand: () => ({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: 0, z: 1 } }) });
    const targets: Targets = { raycast: (from, dir, max) => {
      const hit = bodies.cast(from, dir, max);
      return hit === null ? null : { animal: actor, point: hit.point, distance: hit.distance, headshot: hit.head,
        ...(hit.multiplier === undefined ? {} : { part: hit.part, multiplier: hit.multiplier }) };
    } };
    const profile = { ...SWORD_WOOD, damage: 10 }, moves = profile.moves;
    if (moves === undefined) throw new Error('Missing actual sword moves');
    const sword = new SweptMelee({ game, player, sky: legacyDouble<SkyRig>({}), forest: legacyDouble<Forest>({}) }, targets,
      { row: profile, profile, inputContext: 'weapon.melee', rig: { sword: new BoxGeometry(.1, .1, .1), arms: new BoxGeometry(.1, .1, .1),
        tipY: .62, baseY: .1, material: new MeshBasicMaterial() } }, { moves, slash: SLASH, finisher: FINISHER, heavy: HEAVY, events: {} });
    sword.setActive(true); sword.enabled = true;
    const hp = actor.hp; sword.tryFire();
    for (let tick = 0; tick < 30; tick++) sword.update(1 / 60, tick / 60);
    expect(hp - actor.hp).toBe(Math.round(10 * SLASH.damage * multiplier));
    const hits = physicsHits.mock.calls.filter(([request]) => request.target.id === actor.entityId);
    expect(hits).toHaveLength(multiplier === 0 ? 0 : 1);
    if (multiplier !== 0) expect(hits[0]?.[0].part).toBe(part);
  } finally { app.physics = was; app.aimTargets = aimed; physicsHits.mockRestore(); fake.playerScope.dispose(); bodies.remove(proxy); sim.dispose(); }
});

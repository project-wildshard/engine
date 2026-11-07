// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-unassigned-import -- The bits these files pin are the portable ones.
import '../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped player against native Rapier.
import { readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The trace's hash chain.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The recorder's switch.
import process from 'node:process';
import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import { Events } from '../src/shared/engine/events/events';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { lockOn } from '../src/client/engine/player/AimTargets';
import { Player } from '../src/client/engine/player/Player';

// P1-E5.3 B1: the page's motion law on record, before any A row moves the server onto it (J112). One seeded 40,000-tick
// run through the real Player, on its real device path (input, fixed step, update), with the camera in every hash, at the
// phone's two frame rates. No A row may change a hash; A14's swell phase is the one allowed exception. A red here means the
// page's feel moved. Re-record (MOTION_TRACE_RECORD=1) only for a change Jake ruled on, in the commit that makes it.

const TICKS = 40_000, HASH_EVERY = 500, SEGMENT = 900;
const BASELINE = 'test/fixtures/motion-trace/page-law.json';
/** A full-speed phone frame, and Low Power Mode's (J121). */
const RATES = { '60': 1 / 60, '24.3': 1 / 24.3 } as const;

/** mulberry32, so the run never leans on a platform's generator. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotation by `angle` about one axis, as Rapier's quaternion. */
const turn = (axis: 'x' | 'z', angle: number): { x: number; y: number; z: number; w: number } =>
  ({ x: axis === 'x' ? Math.sin(angle / 2) : 0, y: 0, z: axis === 'z' ? Math.sin(angle / 2) : 0, w: Math.cos(angle / 2) });

/** The pond's bottom: a 12° ramp down from its west shore (wading), then 3 m deep (swimming). */
const inPond = (x: number, z: number): boolean => x > 30 && x < 60 && Math.abs(z) < 15;
const pondFloor = (x: number): number => Math.max(-3, -3 * (x - 30) / 14);
const onDeckFunction = (x: number, z: number): boolean => Math.abs(x) < 10 && z > 40 && z < 60;

function arena(R: Rapier, physics: Physics): { deck: (tick: number) => void } {
  const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, rotation?: { x: number; y: number; z: number; w: number }): void => {
    const desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(groups('WORLD'));
    if (rotation !== undefined) desc.setRotation(rotation);
    physics.world.createCollider(desc);
  };
  fixed(65, .5, 100, -35, -.5, 0); fixed(20, .5, 100, 80, -.5, 0); // the floor, either side of the pond
  fixed(15, .5, 42.5, 45, -.5, 57.5); fixed(15, .5, 42.5, 45, -.5, -57.5);
  fixed(15, .5, 15, 45, -3.5, 0); // the pond's bed
  const ramp = Math.atan2(3, 14);
  fixed(Math.hypot(7, 1.5), .25, 15, 37, -1.5 - .25 / Math.cos(ramp), 0, turn('z', -ramp));
  for (const [hx, hz, x, z] of [[100, 1, 0, 100], [100, 1, 0, -100], [1, 100, 100, 0], [1, 100, -100, 0]] as const) fixed(hx, 10, hz, x, 10, z);
  fixed(.5, 2, 6, -20, 2, 20); // a wall a dash ends on
  fixed(4, .125, 4, -20, .125, -20); fixed(3, .125, 3, -20, .375, -20); // steps
  // ground too steep to stand on. The controller calls a steep face ground only from a ledge above it, so a sawtooth of
  // ledges and 58° faces: the feet's ray finds the face while the capsule's edge still holds the ledge
  const steep = 58 * Math.PI / 180, face = .5 / Math.sin(steep), inset = .5 / Math.tan(steep);
  for (let i = 0; i < 40; i++) {
    const y = 20 - i * .5, z = 60 + i * (.3 + inset);
    fixed(10, .1, .15, -60, y - .1, z);
    fixed(10, .1, face / 2, -60, y - .25 - .1 / Math.cos(steep), z + .15 + inset / 2, turn('x', steep));
  }
  const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, .6, -50));
  physics.world.createCollider(R.ColliderDesc.cuboid(5, .25, 5).setCollisionGroups(groups('WORLD')), body);
  return { deck: tick => { const t = tick * FIXED_STEP; body.setNextKinematicTranslation({ x: Math.sin(t * .7) * 4, y: .6 + Math.sin(t * 1.3) * .3, z: -50 }); } };
}

interface Trace { hashes: string[]; seen: Record<string, number> }

async function run(frame: number): Promise<Trace> {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  const { deck } = arena(R, physics);
  const camera = new PerspectiveCamera(), canvas = document.createElement('canvas');
  const player = new Player(camera, physics, canvas, { waterLine: { update: () => undefined, setHint: () => undefined } });
  const events = new Events(), scope = new Scope('motion-trace'), target = { alive: true, kind: 'trace', position: new Vector3() };
  let traversing = false, crouch = false;
  player.traversalEvents = events; player.locked = true;
  events.answer('player.crouch', ({ want }) => ({ allowed: want && crouch, latched: false }), scope);
  events.answer('player.traversal', () => {
    if (traversing) player.motor.move(player.position, { x: .04, y: -.02, z: .02 });
    return traversing;
  }, scope);
  player.motor.resetAt(player.position);
  player.bindFrame(physics, player.motor, {
    heightAt: (x, z) => inPond(x, z) ? pondFloor(x) : 0,
    waterSurfaceAt: (x, z) => inPond(x, z) ? -.2 : null,
    platforms: [(x, z) => onDeckFunction(x, z) ? 1 : undefined],
  });
  lockOn.state = 'off'; lockOn.target = null; lockOn.r0 = 0;

  const rng = seeded(0x5EED), hash = createHash('sha256'), hashes: string[] = [], seen: Record<string, number> = {};
  const sample = new Float64Array(29), bytes = new Uint8Array(sample.buffer);
  let tick = 0, next = 0, acc = 0, segment = -1, phase = '';
  const count = (what: string): void => { seen[what] = (seen[what] ?? 0) + 1; };
  const clearDevice = (): void => { player.keys.clear(); player.touchMove.x = 0; player.touchMove.y = 0; player.touchSprint = false; player.touchDive = false; player.touchSurface = false; };
  const enter = (index: number): void => {
    phase = ['open', 'slope', 'deck', 'platform', 'pond', 'board', 'lock', 'traversal', 'effects'][index % 9] ?? 'open';
    clearDevice(); player.setHover(false); traversing = false; crouch = false;
    player.moveScale = 1; player.effectMoveScale = 1; player.effectMoveLocked = false; player.carried = false; player.hoverSpeedLimit = null;
    lockOn.state = 'off'; lockOn.target = null;
    if (phase === 'open') player.spawn(-30 + rng() * 20, rng() * 20 - 10, rng() * 6.28);
    if (phase === 'slope') player.spawn(-60, 60, 0, 20.5);
    if (phase === 'deck') player.spawn(0, -50, rng() * 6.28, 1.2);
    if (phase === 'platform') player.spawn(0, 50, rng() * 6.28, 1);
    if (phase === 'pond') player.spawn(28, 0, -Math.PI / 2);
    if (phase === 'board') { player.spawn(0, 0, rng() * 6.28); player.setHover(true); if (index % 2 === 0) player.hoverSpeedLimit = () => 9; }
    if (phase === 'lock') { player.spawn(0, 8, 0); target.position.set(0, 0, 0); lockOn.state = 'locked'; lockOn.target = target; lockOn.r0 = 8; }
    if (phase === 'traversal') player.spawn(-10, 0, rng() * 6.28);
    if (phase === 'effects') player.spawn(10, 0, rng() * 6.28);
  };
  /** One seeded change of the controls, on the tick stream, so both frame rates see the same inputs at their own frames. */
  const steer = (): void => {
    player.touchMove.x = rng() < .35 ? 0 : rng() * 2 - 1; player.touchMove.y = rng() < .2 ? 0 : rng() * 2 - 1;
    const keyed = rng();
    player.keys.delete('KeyW'); player.keys.delete('KeyA');
    if (keyed < .2) player.keys.add('KeyW'); else if (keyed < .3) player.keys.add('KeyA');
    player.touchSprint = rng() < .4; crouch = rng() < .1;
    if (rng() < .3) player.touchJump = true;
    if (rng() < .2) player.touchDodge = true;
    if (phase !== 'lock') player.look((rng() - .5) * 400, (rng() - .5) * 60);
    if (phase === 'pond') { player.touchDive = rng() < .35; player.touchSurface = rng() < .25; }
    if (phase === 'board' && rng() < .1) player.setHover(!player.hover);
    if (phase === 'traversal') traversing = rng() < .4;
    if (phase === 'slope' && player.position.y < 1) player.spawn(-60, 60, 0, 20.5);
    if (phase === 'effects') {
      const roll = rng();
      if (roll < .15) player.shove(player.position.x + rng() - .5, player.position.z + rng() - .5, 3 + rng() * 5);
      else if (roll < .3) player.impulse(new Vector3(rng() * 6 - 3, rng() * 8, rng() * 6 - 3));
      else if (roll < .4) player.dash(rng() * 12 - 6, rng() * 12 - 6, .2);
      else if (roll < .5) player.dashTo(player.position.x + rng() * 8 - 4, player.position.z + rng() * 8 - 4, .5, .2);
      player.moveScale = rng() < .15 ? .4 : 1;
      player.effectMoveScale = rng() < .15 ? .6 : 1;
      player.effectMoveLocked = rng() < .08;
      player.carried = rng() < .05;
    }
  };
  while (tick < TICKS) {
    if (Math.floor(tick / SEGMENT) !== segment) { segment = Math.floor(tick / SEGMENT); enter(segment); next = tick; }
    while (tick >= next) { next += 12 + Math.floor(rng() * 60); steer(); }
    player.input(frame);
    acc += frame;
    let steps = 0;
    while (acc >= FIXED_STEP && steps < MAX_FIXED_STEPS) {
      deck(tick); physics.step();
      if (phase === 'lock') target.position.set(Math.sin(tick * .003) * 2, 0, Math.cos(tick * .004) * 2);
      player.setBodyEnabled(true); player.stepDevice(FIXED_STEP);
      acc -= FIXED_STEP; steps++; tick++;
      count(player.hover ? 'board' : player.swimming ? 'swim' : player.sliding ? 'slide' : player.wading ? 'wade' : player.onPlatform ? 'platform' : player.dashing ? 'dash' : player.onGround ? 'ground' : 'air');
      if (traversing) count('traversal');
      if (phase === 'lock') count('lock');
      if (player.motor.result.groundCollider?.parent()?.isKinematic() === true) count('deck');
      if (tick % HASH_EVERY === 0) hashes.push(hash.copy().digest('hex').slice(0, 16));
    }
    if (steps === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(frame, acc / FIXED_STEP);
    const { position: p, velocity: v } = player, c = camera.position, q = camera.quaternion;
    sample.set([p.x, p.y, p.z, v.x, v.y, v.z, player.yaw, player.pitch, Number(player.onGround), Number(player.hover), Number(player.swimming), Number(player.sliding),
      Number(player.wading), Number(player.crouching), Number(player.sprinting), Number(player.diving), player.depth, player.fovKick, player.hoverBlend, player.hoverLat, player.hoverFwd,
      c.x, c.y, c.z, q.x, q.y, q.z, q.w, player.dodgeCooldown]);
    hash.update(bytes);
  }
  lockOn.state = 'off'; lockOn.target = null;
  scope.dispose(); player.motor.dispose(); physics.dispose();
  return { hashes, seen };
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string[]>;
const recording = process.env['MOTION_TRACE_RECORD'] === '1';

test.each(Object.entries(RATES))('the page law at %s frames/s', async (rate, frame) => {
  const first = await run(frame), second = await run(frame);
  expect(second.hashes).toEqual(first.hashes); // one hash, two runs
  expect(first.hashes).toHaveLength(TICKS / HASH_EVERY);
  // the run reached every mode it says it pins
  for (const mode of ['board', 'swim', 'slide', 'wade', 'platform', 'dash', 'ground', 'air', 'traversal', 'lock', 'deck']) expect(first.seen[mode] ?? 0, `${mode} in ${JSON.stringify(first.seen)}`).toBeGreaterThan(mode === 'slide' ? 40 : 100);
  if (recording) { baseline[rate] = first.hashes; writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 1)}\n`); return; }
  expect(first.hashes).toEqual(baseline[rate]);
}, 240_000);

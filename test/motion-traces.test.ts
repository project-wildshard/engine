// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-unassigned-import -- The bits these files pin are the portable ones.
import '../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The trace's hash chain.
import { createHash, type Hash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The baseline is a file.
import { readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The recorder's switch.
import process from 'node:process';
import { SkinnedMesh, Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import type { AnimalManager } from '@wildshard/engine/entities/AnimalManager';
import { App } from '../src/client/engine/app/app';
import { app } from '../src/client/engine/app/runtime';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { LevelContext } from '../src/server/engine/level/context';
import { Scope } from '../src/shared/engine/app/scope';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { playerModes } from '../src/shared/engine/player/modes';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { bindFlatTerrain } from '../src/test/engine/terrain';
import { Mount } from '../src/client/game/riding/mount';
import { courseHeightAt, DECK, HILL_X, HostSide, LEDGE, loadCourseRapier, PageSide, POOL_X, RAMP_Z, terrainHeight, type MotionIntent, type MotionScenario } from './fixtures/motion-trace/parity';
import { lendNalatiRiding } from './fixtures/nalati-riding-loan';

// E4.1's evidence, rebuilt: seeded traces of 40,000 ticks, so a refactor can say "bit-identical" and be checked. Two page traces
// (state, every callback in order, the camera; and a real Mount carrying the real Player through `stepPlayerMotion`) and six host
// traces (legacy, versioned, wet, dry, driver, walking control: state, every event, and the host's snapshot bytes every 500
// ticks). The page's law on the feel side is B1's (test/motion-trace.test.ts). A law row moves the host traces on purpose:
// re-record in that commit with MOTION_TRACE_RECORD=1. Any other change must leave all eight alone. The hashes hold on every
// platform: this is what fails when a Mac and a Linux server stop agreeing (J97).

const TICKS = 40_000, HASH_EVERY = 500, SEGMENT = 900;
const BASELINE = 'test/fixtures/motion-trace/seven-traces.json', RECORDING = process.env['MOTION_TRACE_RECORD'] === '1';

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

const onTerrain = (x: number, z: number): { x: number; y: number; z: number } => ({ x, y: terrainHeight(x, z), z });
const SITES = [onTerrain(-10, 0), onTerrain(POOL_X - 8, 4), onTerrain(POOL_X - 25, -8), onTerrain(HILL_X + 2.4, 0), onTerrain(4, RAMP_Z - 2), { x: LEDGE.x, y: LEDGE.top, z: LEDGE.z }, { x: DECK.x, y: DECK.y + .1, z: DECK.z }] as const;

/** One seeded player: its held input, changed every 12 to 72 ticks, and a press now and then. */
function seededIntent(seed: number): { intent: (tick: number) => MotionIntent; site: (tick: number) => (typeof SITES)[number] | null } {
  const rng = seeded(seed);
  let held: MotionIntent = {}, next = 0, spot = 0;
  const axis = (): number => rng() < .3 ? 0 : Math.round((rng() * 2 - 1) * 127) / 127;
  return {
    intent: tick => {
      if (tick >= next) {
        next = tick + 12 + Math.floor(rng() * 60);
        held = { stickX: axis(), stickY: axis(), keyY: rng() < .2 ? 1 : 0, yaw: rng() * 6.28 - 3.14, sprint: rng() < .4, crouch: rng() < .1, dive: rng() < .3, surface: rng() < .2 };
        return { ...held, jump: rng() < .3, dodge: rng() < .15, hover: rng() < .06 };
      }
      return held;
    },
    site: tick => {
      if (tick % SEGMENT !== 0) return null;
      spot = Math.floor(rng() * SITES.length);
      return SITES[spot] ?? SITES[0];
    },
  };
}

/** A run's hashes, and which modes it really reached, so a trace cannot pin nothing. */
interface Trace { readonly hashes: string[]; readonly seen: Set<string>; readonly hash: Hash }
const trace = (): Trace => ({ hashes: [], seen: new Set<string>(), hash: createHash('sha256') });
const sample = new Float64Array(16), bytes = new Uint8Array(sample.buffer);

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const scenario = (id: string, extra: Partial<MotionScenario> = {}): MotionScenario => ({ id, start: { x: -10, z: 0, yaw: 0 }, ticks: TICKS, intent: () => ({}), ...extra });

function pageTrace(): Trace {
  const page = new PageSide(R, scenario('page')), { player, camera } = page, out = trace(), { intent, site } = seededIntent(0x5EED);
  const moment = (name: string, value = 0): void => { sample.fill(0); sample[0] = name.length * 1000 + (name.codePointAt(0) ?? 0); sample[1] = value; out.hash.update(bytes); };
  player.onJump = () => { moment('jump'); }; player.onLand = hard => { moment('land', Number(hard)); }; player.onStroke = () => { moment('stroke'); };
  player.onSwimChange = on => { moment('swim', Number(on)); }; player.onHoverChange = on => { moment('hover', Number(on)); };
  player.onEnterWater = impact => { moment('enter', impact); }; player.onExitWater = () => { moment('exit'); };
  player.onSubmerge = () => { moment('submerge'); }; player.onSurface = () => { moment('surface'); };
  player.onDodge = () => { moment('dodge'); }; player.onLunge = () => { moment('lunge'); }; player.onStep = sprinting => { moment('step', Number(sprinting)); };
  try {
    for (let tick = 0; tick < TICKS; tick++) {
      const at = site(tick);
      if (at !== null) page.reset(at.x, at.y, at.z, 0);
      page.tick(tick, intent(tick));
      player.update(1 / 60, 1);
      const p = player.position, v = player.velocity, c = camera.position, q = camera.quaternion;
      sample.set([p.x, p.y, p.z, v.x, v.y, v.z, player.yaw, Number(player.onGround) + 2 * Number(player.hover) + 4 * Number(player.swimming) + 8 * Number(player.sliding) + 16 * Number(player.wading), c.x, c.y, c.z, q.x, q.y, q.z, q.w, player.fovKick]);
      out.hash.update(bytes);
      for (const [mode, on] of [['air', !player.onGround], ['board', player.hover], ['dash', player.dashing], ['slide', player.sliding], ['swim', player.swimming], ['wade', player.wading]] as const) if (on) out.seen.add(mode);
      if ((tick + 1) % HASH_EVERY === 0) out.hashes.push(out.hash.copy().digest('hex').slice(0, 16));
    }
  } finally { page.dispose(); }
  return out;
}

const RIDE_SPEEDS = { walk: 1, trot: 3, canter: 5, gallop: 8 };
/** The page's own ride, off the wire: the reins read the keys, and each fixed step is `stepPlayerMotion` handing a real Mount the tick. */
function ridingTrace(): Trace {
  const scope = new Scope('riding-trace'), page = new PageSide(R, scenario('riding')), { player, camera } = page, out = trace(), { intent, site } = seededIntent(0x1D1E);
  lendNalatiRiding(scope);
  const undoTerrain = bindFlatTerrain({ heightAt: courseHeightAt, normalAt: () => [0, 1, 0] }), was = app.physics;
  app.physics = page.physics;
  const start = { x: -10, y: courseHeightAt(-10, 0), z: 0 };
  const horse = legacyDouble<Animal>({ entityId: 'riding-trace.horse', kind: 'horse', variant: 'starter', alive: true, hidden: false, hp: 100, maxHp: 100, yaw: 0, speed: 0, state: 'idle',
    lookWeight: 0, gaitPhase: 0, scale: 1, seed: .5, position: new Vector3(start.x, start.y, start.z), lookTarget: new Vector3(), mem: {}, mesh: new SkinnedMesh(), setMotion: (): void => undefined,
    place: (x: number, z: number): void => { horse.position.set(x, courseHeightAt(x, z), z); } });
  playerModes(player).register({ id: 'ride', hud: 'ride' }, scope);
  const mount = new Mount(legacyDouble<LevelContext>({ app: new App(), scope }), player, legacyDouble<AnimalManager>({ animals: [horse] }),
    { speeds: RIDE_SPEEDS, names: {}, thrownDamage: 7, thrownLabel: 'Thrown', restAt: { x: 3, z: 5 } });
  mount.input = null; mount.addMountable(horse.entityId, 'Companion');
  if (!mount.mount(horse.entityId)) throw new Error('The trace has no horse under it');
  const keys = player.keys, held = (key: string, on: boolean): void => { if (on) keys.add(key); else keys.delete(key); };
  try {
    for (let tick = 0; tick < TICKS; tick++) {
      const at = site(tick), now = intent(tick);
      if (at !== null) mount.teleport(at.x, at.z, 0);
      // every other stretch runs flat out, which is the only way to a gallop
      const run = Math.floor(tick / SEGMENT) % 2 === 1;
      held('KeyW', run || (now.stickY ?? 0) > .2 || now.keyY === 1); held('KeyS', !run && (now.stickY ?? 0) < -.6); held('KeyD', (now.stickX ?? 0) > .3); held('KeyA', (now.stickX ?? 0) < -.3);
      held('ShiftLeft', run || now.sprint === true); held('Space', now.jump === true);
      player.input(1 / 60);
      page.tick(tick, now);
      player.update(1 / 60, 1);
      const p = player.position, f = mount.feet, c = camera.position, q = camera.quaternion;
      sample.set([p.x, p.y, p.z, f.x, f.y, f.z, mount.heading, mount.speed, mount.vy, Number(mount.grounded), c.x, c.y, c.z, q.x, q.y, q.w]);
      out.hash.update(bytes); out.seen.add(mount.gait);
      if (mount.galloping) out.seen.add('spurred');
      if (!mount.grounded) out.seen.add('air');
      if (mount.horse === null) throw new Error(`Thrown at tick ${tick}`);
      if ((tick + 1) % HASH_EVERY === 0) out.hashes.push(out.hash.copy().digest('hex').slice(0, 16));
    }
  } finally { app.physics = was; undoTerrain(); scope.dispose(); page.dispose(); }
  return out;
}

interface HostProfile {
  readonly seed: number; readonly extra?: Partial<MotionScenario>;
  /** Install a law on the player. */
  readonly install?: (side: HostSide, tick: () => number) => void;
}
function hostTrace(id: string, { seed, extra, install }: HostProfile): Trace {
  const side = new HostSide(R, scenario(id, extra)), { host, player } = side, out = trace(), { intent, site } = seededIntent(seed);
  let tick = 0;
  const event = (name: string, value: number): void => { sample.fill(0); sample[0] = name.length; sample[1] = value; out.hash.update(bytes); };
  host.events.on('player.jump', () => { event('jump', 1); }, host.scope);
  host.events.on('player.dodge', () => { event('dodge', 1); }, host.scope);
  host.events.on('player.swim', on => { event('swim', Number(on)); }, host.scope);
  install?.(side, () => tick);
  try {
    for (tick = 0; tick < TICKS; tick++) {
      const at = site(tick);
      if (at !== null) side.reset(at.x, at.y, at.z, 0);
      side.tick(tick, intent(tick));
      const p = player.position, v = player.velocity;
      sample.fill(0);
      sample.set([p.x, p.y, p.z, v.x, v.y, v.z, player.yaw, Number(player.fall.grounded) + 2 * Number(player.board.on) + 4 * Number(player.swim.on)]);
      out.hash.update(bytes);
      for (const [mode, on] of [['air', !player.fall.grounded], ['board', player.board.on], ['swim', player.swim.on]] as const) if (on) out.seen.add(mode);
      if ((tick + 1) % HASH_EVERY === 0) { out.hash.update(JSON.stringify(snapshotSimHostBytes(host))); out.hashes.push(out.hash.copy().digest('hex').slice(0, 16)); }
    }
  } finally { side.dispose(); }
  return out;
}

/** A driver that owns the player's motion for one tick stretch in three. */
const driven = (side: HostSide, tick: () => number): void => {
  const { player } = side;
  player.useDriver({ input: () => Math.floor(tick() / 240) % 3 === 0, step: () => { player.motor.move(player.position, { x: .02, y: -.02, z: .01 }); } });
};
/** A scoped on-foot law: a slower walk with a crouch, then none. */
const walked = (side: HostSide, tick: () => number): void => {
  const control = { get speed(): number { return 2 + (Math.floor(tick() / 180) % 3); }, get crouching(): boolean { return Math.floor(tick() / 500) % 2 === 1; } };
  side.player.useWalkingControl(control);
};
const HOSTS: Readonly<Record<string, HostProfile>> = {
  legacy: { seed: 1, extra: { wire: 'legacy' } },
  versioned: { seed: 2 },
  wet: { seed: 3 },
  dry: { seed: 4, extra: { dry: true } },
  driver: { seed: 5, install: driven },
  walking: { seed: 6, extra: { wire: 'legacy' }, install: walked },
};

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string[]>;
function check(name: string, modes: readonly string[], run: () => Trace): void {
  const { hashes, seen } = run();
  expect(run().hashes).toEqual(hashes); // one hash, two runs
  expect(hashes).toHaveLength(TICKS / HASH_EVERY);
  expect(modes.filter(mode => !seen.has(mode))).toEqual([]);
  if (RECORDING) { baseline[name] = hashes; writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 1)}\n`); return; }
  expect(hashes).toEqual(baseline[name]);
}

test('the page trace: state, callbacks and camera', () => { check('page', ['air', 'board', 'dash', 'slide', 'swim', 'wade'], pageTrace); }, 240_000);
test('the riding trace: a real Mount through the step', () => { check('riding', ['stand', 'walk', 'trot', 'canter', 'spurred', 'air'], ridingTrace); }, 240_000);
test.each(Object.keys(HOSTS))('the %s host trace: state, events and snapshot bytes', name => {
  const profile = HOSTS[name];
  if (profile === undefined) throw new Error(`No host ${name}`);
  check(name, profile.extra?.dry === true ? ['air', 'board'] : ['air', 'board', 'swim'], () => hostTrace(name, profile));
}, 240_000);

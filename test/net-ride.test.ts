// @vitest-environment happy-dom
import { zlibSync } from 'fflate';
import type { NetCommand } from '@wildshard/format/netCommand';
import type { MountProfile } from '@wildshard/format/riding';
import { SkinnedMesh, Vector3 } from 'three';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { App } from '../src/client/engine/app/app';
import { app } from '../src/client/engine/app/runtime';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { Scope } from '../src/shared/engine/app/scope';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { playerModes } from '../src/shared/engine/player/modes';
import { overrideTerrain } from '../src/test/engine/terrain';
import { directLoopback } from '../src/test/engine/netLoopback';
import { legacyDouble } from '../src/test/engine/FakeGame';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { AnimalManager } from '@wildshard/engine/entities/AnimalManager';
import type { LevelContext } from '../src/server/engine/level/context';
import { Mount } from '../src/client/game/riding/mount';
import { installMountedPlayer, type NativeMountedPlayer } from '../src/server/game/riding/native';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { dormantHerd } from './fixtures/dormant-herd';
import { courseHeightAt, HostSide, loadCourseRapier, PageSide, TARGET_ID, type MotionScenario } from './fixtures/motion-trace/parity';
import { lendNalatiPasture, lendNalatiRiding } from './fixtures/nalati-return-modules';
import { installWorldFixture } from './fixtures/worldSetup';
import { NALATI_RIDING_PROGRAMS as programs } from './fixtures/nalati-riding';

await installWorldFixture();

// P1-E5.3-D (J48): a real Mount on a real Player, through a real NetClient and NetRoom, against the real riding law on the
// server. On a page the ride starts on the server's word, each step reads its command, and the saddle is predicted.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const SPEEDS: MountProfile['speeds'] = { walk: 1, trot: 3, canter: 5, gallop: 8 };
const zero = zlibSync(new Uint8Array(16)), block = { file: 'world/zero.bin', bytes: zero }, channel = { type: 'f32' as const, count: 4, data: { file: block.file } };
const scenario: MotionScenario = { id: 'net-ride', start: { x: -10, z: -4, yaw: 0 }, ticks: 0, intent: () => ({}), bodyAt: { x: -8, z: -4 } };
const undo: (() => void)[] = [];
afterEach(() => { for (const run of undo.splice(0).reverse()) run(); });

interface Rig { readonly page: PageSide; readonly host: HostSide; readonly seat: NativeMountedPlayer; readonly mount: Mount; readonly net: NetPlayer; readonly room: NetRoom; readonly pump: () => void; clock: number; readonly client: NetClient; readonly client_seat: number }
function rig(): Rig {
  const scope = new Scope('net-ride'), page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback();
  lendNalatiPasture(host.host.scope); lendNalatiRiding(scope);
  undo.push(overrideTerrain({ heightAt: courseHeightAt, normalAt: () => [0, 1, 0], waterLevel: () => -100 }));
  const was = app.physics;
  app.physics = page.physics;
  undo.push(() => { app.physics = was; scope.dispose(); page.dispose(); host.dispose(); });
  host.host.useBodyBands(); dormantHerd(host.host, 'net.herds');
  const seat = installMountedPlayer(host.host, { step: 'net.saddle', herds: 'net.herds', kinds: [SIM_CREATURE_RECIPE.spec.kind], adopted: { kind: SIM_CREATURE_RECIPE.spec.kind, variant: 'boar' }, mountable: [TARGET_ID], speeds: SPEEDS, pose: {},
    world: { res: 2, size: 400, water: -100, wet: channel, pond: channel }, thrownDamage: 7, thrownLabel: 'Thrown', program: programs.riding }, block, { ...block, file: 'world/zero-wet.bin' });
  const state = { clock: 0 }, client = new NetClient(link.client, () => state.clock);
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) {
      if (row.command !== null) commands.set(row.player, row.command);
      for (const act of row.acts) if (act.kind === 'ride') { if (act.action === 'dismount') seat.dismount(); else seat.mount(TARGET_ID); }
    }
    host.host.step(commands);
  } });
  const client_seat = room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const { player } = page, body = host.host.entities.get(TARGET_ID);
  if (body === undefined) throw new Error('No mount on the server');
  body.harnessHold = true;
  const actor = legacyDouble<Animal>({ entityId: TARGET_ID, kind: body.kind, variant: 'boar', alive: true, hidden: false, hp: 100, maxHp: 100, yaw: body.yaw, speed: 0, state: 'idle', lookWeight: 0, gaitPhase: 0, scale: body.scale, seed: .5,
    position: body.position.clone(), lookTarget: new Vector3(), mem: {}, mesh: new SkinnedMesh(), setMotion: (): void => undefined });
  const ctx = legacyDouble<LevelContext>({ app: new App(), scope });
  playerModes(player).register({ id: 'ride', hud: 'ride' }, scope);
  const mount = new Mount(ctx, player, legacyDouble<AnimalManager>({ animals: [actor] }), { speeds: SPEEDS, names: {}, thrownDamage: 7, thrownLabel: 'Thrown', restAt: { x: 3, z: 5 } });
  mount.input = null; mount.addMountable(TARGET_ID, 'Companion');
  const net = new NetPlayer(client, player, page.physics);
  player.link = net; player.locked = true;
  mount.bindWire(net.ride); net.bindRide({ enter: () => { mount.enter(TARGET_ID); }, leave: () => { mount.leave(); } });
  return { page, host, seat, mount, net, room, pump: () => { link.pump(); }, client, client_seat, get clock() { return state.clock; }, set clock(value) { state.clock = value; } };
}

/** Play `seconds`, with the server on its own clock in batches of two, as `net-player.test.ts` does. */
function play(f: Rig, seconds: number, frameMs: (frame: number) => number, press: (frame: number) => void = () => undefined): { commands: number } {
  const { page, net, room, pump, client } = f, { player } = page, tickMs = FIXED_STEP * 1000, end = f.clock + seconds * 1000;
  let due = f.clock, last = f.clock, acc = 0, nextTick = f.clock, frame = 0, commands = 0;
  while (f.clock < end) {
    if (nextTick <= due) { room.tick(); room.tick(); nextTick += 2 * tickMs * 60 / 59.9; pump(); f.clock = Math.max(f.clock, nextTick - 2 * tickMs); continue; }
    f.clock = due;
    const dt = (f.clock - last) / 1000;
    last = f.clock;
    press(frame);
    net.reconcile(); player.input(dt);
    acc += dt;
    let ran = 0;
    while (acc >= FIXED_STEP && ran < MAX_FIXED_STEPS) {
      page.stepWorld(); player.setBodyEnabled(true);
      const before = net.predictor.pending; player.stepDevice(FIXED_STEP); if (net.predictor.pending > before) commands++;
      acc -= FIXED_STEP; ran++;
    }
    if (ran === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(dt, acc / FIXED_STEP);
    net.present(dt); pump(); client.present();
    frame++; due += frameMs(frame);
  }
  for (let settle = 0; settle < 6; settle++) { room.tick(); room.tick(); pump(); }
  net.reconcile();
  return { commands };
}
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const lowPower = (): ((frame: number) => number) => { const rng = seeded(21); return frame => frame % 24 === 0 ? 60 : 41.15 + (rng() * 16 - 8); };

test.each([['Low Power Mode', lowPower()], ['60 frames/s', () => 1000 / 60]] as const)('%s: a gallop is predicted, and corrected nowhere', (_name, frameMs) => {
  const f = rig(), { page, seat, mount, net, room } = f, { player } = page, { stats } = room;
  play(f, .4, frameMs);
  expect(mount.mounted).toBe(false);
  const walking = { bytes: stats.frameBytes, frames: stats.frames };
  expect(mount.mount(TARGET_ID)).toBe(false); // a press, not a ride: the server says when
  play(f, .4, frameMs);
  expect(seat.mounted).toBe(true); expect(mount.mounted).toBe(true);
  player.keys.add('KeyW'); player.keys.add('ShiftLeft');
  const foot = walking.bytes / walking.frames, riding = { bytes: stats.frameBytes, frames: stats.frames }, run = play(f, 4, frameMs);
  expect((stats.frameBytes - riding.bytes) / (stats.frames - riding.frames) - foot).toBeLessThan(160); // 38 f32s, only in the saddle
  expect(run.commands).toBeGreaterThan(90);
  expect(seat.body.speed).toBeGreaterThan(5);
  expect(net.predictor.corrections).toBe(0);
  expect(net.predictor.replays).toBe(0);
  expect(mount.feet.distanceTo(seat.body.feet)).toBeLessThan(.02);
  player.keys.clear();
  mount.dismount();
  play(f, .4, frameMs);
  expect(seat.mounted).toBe(false); expect(mount.mounted).toBe(false);
  play(f, .4, frameMs);
  expect(net.predictor.corrections).toBe(0);
});

test('a ride put back replays exactly: its words and its capsule are the whole of its state', () => {
  const f = rig(), { page, mount } = f, { player } = page;
  mount.mount(TARGET_ID);
  play(f, .3, () => 1000 / 60);
  player.keys.add('KeyW'); player.keys.add('ShiftLeft');
  play(f, 1.5, () => 1000 / 60);
  const { predicted } = mount;
  if (predicted === undefined) throw new Error('Not on a wire');
  const saved = new Float64Array(64), command: NetCommand = { seq: 1, viewTick: 0, steer: { keyX: .4, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
  predicted.capture(saved, 0);
  const run = (): readonly number[] => { const out: number[] = []; for (let step = 0; step < 90; step++) { player.stepNet(FIXED_STEP, command, true); out.push(mount.feet.x, mount.feet.y, mount.feet.z, mount.heading, mount.speed); } return out; };
  const first = run();
  predicted.restore(saved, 0);
  expect(run()).toEqual(first);
});

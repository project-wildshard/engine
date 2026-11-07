// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Count collections around a tight loop.
import { PerformanceObserver } from 'node:perf_hooks';
import { Vector3 } from 'three';
import type { NetCommand } from '@wildshard/format/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { PREDICTION_RING, Predictor, type PredictedBody } from '../src/client/engine/net/predictor';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { BitReader, BitWriter } from '../src/shared/engine/net/bits';
import { quantiseCommand, readCommand, writeCommand } from '../src/shared/engine/net/command';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { MOTOR_WORDS, type CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { CAPTURED, captureMotion, createMotionState, MOTION_WORDS } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { linkedPlayer, type LinkedPlayer } from './fixtures/motion-trace/link';
import { loadCourseRapier, type MotionScenario } from './fixtures/motion-trace/parity';

// P1-E5.3-C4: the predictor on the real Player against the real PlayerSim.

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const DELAY = 3, EAST = -Math.PI / 2;
const scenario: MotionScenario = { id: 'predict', start: { x: -10, z: 0, yaw: EAST }, ticks: 0, intent: () => ({}) };
const forward = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, standing = { keyX: 0, keyY: 0, stickX: 0, stickY: 0 };
const linked = (): LinkedPlayer => linkedPlayer(R, scenario, DELAY);

test('a walk the server agrees with writes nothing', () => {
  const link = linked();
  try {
    let corrections = 0;
    for (let at = 0; at < 120; at++) if (link.run().corrected) corrections++;
    expect(corrections).toBe(0);
    expect(link.predictor.replays).toBe(0);
    expect(link.player.renderOffset.length()).toBe(0);
    expect(link.player.position.x).toBeGreaterThan(-10 + 4);
  } finally { link.dispose(); }
});

test('a 1 m server shove reconverges in 10 ticks and glides on the camera', () => {
  const link = linked();
  try {
    for (let at = 0; at < 30; at++) link.run();
    link.host.player.position.z += 1; // the server moved us, and said nothing else
    let corrected = -1, settled = -1;
    for (let at = 0; at < 40; at++) {
      const { corrected: now } = link.run();
      if (now && corrected === -1) corrected = at;
      else if (corrected !== -1 && !now && settled === -1) settled = at;
      if (now && settled !== -1) settled = -1;
    }
    expect(corrected).toBeGreaterThanOrEqual(0);
    expect(settled - corrected).toBeLessThanOrEqual(10);
    expect(link.player.position.z).toBeCloseTo(1, 1);
    const glide = link.player.renderOffset;
    expect(glide.z).toBeGreaterThan(-1.1); expect(glide.z).toBeLessThan(-.9);
    link.predictor.update(.5);
    expect(link.player.renderOffset.length()).toBeLessThan(.01);
  } finally { link.dispose(); }
});

test('a teleport snaps: no glide over 3 m', () => {
  const link = linked();
  try {
    for (let at = 0; at < 30; at++) link.run();
    link.host.player.position.z += 6;
    for (let at = 0; at < 2 * DELAY + 2; at++) link.run();
    expect(link.player.renderOffset.length()).toBe(0);
    expect(link.player.position.z).toBeCloseTo(6, 1);
  } finally { link.dispose(); }
});

test('a replayed jump plays nothing, and the replay keeps its speed', () => {
  const link = linked(), { player } = link;
  try {
    let jumps = 0, lands = 0, hovers = 0;
    player.onJump = () => { jumps++; }; player.onLand = () => { lands++; }; player.onHoverChange = () => { hovers++; };
    for (let at = 0; at < 30; at++) link.run();
    link.run({ buttons: NET_BUTTONS.jump }); link.run({ buttons: NET_BUTTONS.hover });
    expect(jumps).toBe(1); expect(hovers).toBe(1);
    link.host.player.position.z += 1; // the frames that carry this also ack the two presses' neighbours
    const from = link.predictor.replays;
    link.run(); link.run();
    for (let at = 0; at < 8; at++) link.run();
    expect(link.predictor.replays).toBeGreaterThan(from);
    expect(jumps).toBe(1); expect(hovers).toBe(1);
    expect(lands).toBeLessThanOrEqual(1);
  } finally { link.dispose(); }
});

test('the client steps what the server decodes', () => {
  const samples: NetCommand[] = [{ seq: 1, viewTick: 2, steer: { keyX: 1, keyY: -1, stickX: .31415, stickY: -.77 }, yaw: 1.23456789, pitch: -.3333, buttons: 3 },
    { seq: 2, viewTick: 2, steer: standing, yaw: -2.5, pitch: 1.2, buttons: 0 }, { seq: 3, viewTick: 2, steer: forward, yaw: 9.75, pitch: 0, buttons: 8 }];
  for (const command of samples) {
    const writer = new BitWriter(64); writeCommand(writer, command, () => 0);
    const decoded = readCommand(new BitReader(new Uint8Array(writer.finish())), () => undefined), quantised = quantiseCommand(command);
    expect(quantised.steer).toEqual(decoded.steer); expect(quantised.pitch).toBeCloseTo(decoded.pitch, 12);
    expect(Math.sin(quantised.yaw)).toBeCloseTo(Math.sin(decoded.yaw), 12); expect(Math.cos(quantised.yaw)).toBeCloseTo(Math.cos(decoded.yaw), 12);
  }
});

test('a full ring holds still', () => {
  const link = linked(), { predictor, player } = link;
  try {
    expect(predictor.pending).toBe(0);
    const command = (seq: number): NetCommand => ({ seq, viewTick: 0, steer: forward, yaw: EAST, pitch: 0, buttons: 0 });
    for (let seq = 1; seq <= PREDICTION_RING; seq++) expect(predictor.step(command(seq))).toBe(true);
    expect(predictor.full).toBe(true);
    const at = player.position.x;
    expect(predictor.step(command(PREDICTION_RING + 1))).toBe(false);
    expect(player.position.x).toBe(at);
  } finally { link.dispose(); }
});

test('an old frame is ignored, and seq wraps', () => {
  const state = createMotionState(), steps: number[] = [];
  const body: PredictedBody = { motionState: state, motor: legacyDouble<CharacterMotor>({ result: { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null }, captureState: () => undefined, restoreState: () => undefined }), ride: null, renderOffset: new Vector3(),
    step: command => { steps.push(command.seq); return true; } };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), owner = new Float64Array(PLAYER_CLASS.owner.length);
  for (const seq of [0xfffe, 0xffff, 0, 1]) predictor.step({ seq, viewTick: 0, steer: standing, yaw: 0, pitch: 0, buttons: 0 });
  predictor.reconcile(0xffff, owner);
  expect(predictor.pending).toBe(2);
  predictor.reconcile(0xfffe, owner);
  expect(predictor.pending).toBe(2);
  predictor.reconcile(1, owner);
  expect(predictor.pending).toBe(0);
});

test('a step and a frame within tolerance allocate nothing', async () => {
  const state = createMotionState();
  const body: PredictedBody = { motionState: state, motor: legacyDouble<CharacterMotor>({ result: { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null }, captureState: () => undefined, restoreState: () => undefined }), ride: null, renderOffset: new Vector3(), step: () => true };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), owner = new Float64Array(PLAYER_CLASS.owner.length);
  PLAYER_CLASS.owner.forEach((column, index) => { if (column.name === 'grounded') owner[index] = 1; });
  const commands = Array.from({ length: 0x10000 }, (_, seq) => ({ seq, viewTick: 0, steer: standing, yaw: 0, pitch: 0, buttons: 0 }));
  const seen: number[] = [], observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.push(entry.startTime); });
  observer.observe({ entryTypes: ['gc'] });
  await new Promise(resolve => { setTimeout(resolve, 0); });
  const start = performance.now();
  for (let at = 0; at < 2_000_000; at++) {
    const command = commands[at & 0xffff];
    if (command === undefined) throw new Error('No command');
    predictor.step(command); predictor.reconcile(command.seq, owner);
  }
  const end = performance.now();
  await new Promise(resolve => { setTimeout(resolve, 20); });
  observer.disconnect();
  expect(predictor.corrections).toBe(0);
  expect(seen.filter(time => time >= start && time <= end).length).toBeLessThanOrEqual(2);
}, 30_000);

test('P1-E5.3-C2: a correction puts back everything a step reads, exact to the wire\'s float', () => {
  const link = linkedPlayer(R, scenario, 0), { player: client } = link, server = link.host.player;
  try {
    link.run();
    server.position.set(1, 2, 3); server.velocity.set(4, 5, 6); server.impulse.set(.1, .2, .3); server.moveScale = .5;
    server.fall.grounded = false; Object.assign(server.shove, { t: .1, vx: 1.5, vz: -1.5 }); Object.assign(server.dash, { t: .2, vx: 2.5, vz: -2.5 }); Object.assign(server.dodge, { t: .3, cd: .4 });
    Object.assign(server.jump, { ago: .25, left: 1 }); server.board.on = true; server.board.hoverAir = true; server.board.hoverBob = .125;
    Object.assign(server.swim, { on: true, stood: true, diving: true, climbTo: 7.5, climbCooldown: .75, strokeTime: 1.25 });
    Object.assign(server.footing, { water: 8.5, depth: 1.5, wading: true, onPlatform: true, sliding: true });
    Object.assign(server.motor.result, { grounded: true, groundNormalY: .75, downhillX: .5, downhillZ: .25, horizontalFreedom: .625 });
    server.resets++; // the frame that says so takes the server's state whatever its seq
    const owner = Float64Array.from(PLAYER_CLASS.owner, column => column.sample(server, () => 0)), mine = new Float64Array(MOTION_WORDS), theirs = new Float64Array(MOTION_WORDS);
    link.predictor.reconcile(1, owner);
    captureMotion(client.motionState, client.motor, mine); captureMotion(server, server.motor, theirs);
    const doubles = new Set([CAPTURED.x, CAPTURED.y, CAPTURED.z, CAPTURED.x + 3, CAPTURED.y + 3, CAPTURED.z + 3]); // J140
    const skipped = new Set([CAPTURED.yaw, ...[0, 1, 2, 3, 9].map(word => MOTION_WORDS - MOTOR_WORDS + word)]); // the view is ours, and anchors and handles are each world's own
    theirs.forEach((word, at) => { if (!skipped.has(at)) expect(mine[at], `word ${String(at)}`).toBe(doubles.has(at) ? word : Math.fround(word)); });
    const bits = PLAYER_CLASS.owner.reduce((sum, column) => sum + column.bits, 0);
    expect(Math.ceil(bits / 8)).toBeLessThanOrEqual(174); // the plan's 150, and J140's doubles
  } finally { link.dispose(); }
});

test('a null clock stays null across the wire', () => {
  const link = linkedPlayer(R, scenario, 0), { player: client } = link, server = link.host.player;
  try {
    link.run();
    server.swim.climbTo = null; server.footing.water = null; server.resets++;
    link.predictor.reconcile(1, Float64Array.from(PLAYER_CLASS.owner, column => column.sample(server, () => 0)));
    expect(client.motionState.swim.climbTo).toBeNull(); expect(client.motionState.footing.water).toBeNull();
  } finally { link.dispose(); }
});

test('while the server leads the client takes no step and compares nothing, and the end of it replays what is still in flight', () => {
  const link = linked(), { predictor, player, host } = link;
  let carried = true;
  try {
    for (let at = 0; at < 30; at++) link.run();
    const walked = predictor.corrections, ride = host.player.position.clone();
    host.host.leading.push(() => carried);
    for (let at = 0; at < 60; at++) {
      host.player.position.copy(ride.set(ride.x, ride.y, at * .2)); host.player.motor.resetAt(ride);
      link.run();
    }
    expect(player.position.z).toBeGreaterThan(10); // it follows the server, with no walk of its own in the way
    expect(player.position.distanceTo(host.player.position)).toBeLessThan(2);
    expect(predictor.corrections).toBe(walked);
    const replays = predictor.replays;
    carried = false;
    for (let at = 0; at < 2 * DELAY + 2; at++) link.run();
    expect(predictor.replays).toBeGreaterThan(replays); // the moves in flight when it ended are walked, not lost
    let drift = 0;
    for (let at = 0; at < 30; at++) { if (link.run().corrected) drift++; }
    expect(drift).toBe(0);
    expect(Math.abs(player.position.x - host.player.position.x)).toBeLessThan(1.5); // the same walk, DELAY × 2 steps ahead
  } finally { carried = false; link.dispose(); }
});

test('a reset is heard with no command on its way', () => {
  const link = linked(), { predictor, player, host } = link;
  try {
    for (let at = 0; at < 2 * DELAY + 4; at++) link.run();
    const seq = host.player.position.clone();
    host.player.position.set(seq.x, seq.y, 40); host.player.resets++;
    predictor.reconcile(2, Float64Array.from(PLAYER_CLASS.owner, column => column.sample(host.player, () => 0)));
    expect(player.position.z).toBeLessThan(39); // an old frame says nothing
    predictor.reconcile(DELAY + 2, Float64Array.from(PLAYER_CLASS.owner, column => column.sample(host.player, () => 0)));
    expect(player.position.z).toBeCloseTo(40, 3);
  } finally { link.dispose(); }
});

test('the swell clock joins the server on the first frame and on a correction, and a replay keeps its phase', () => {
  const state = createMotionState(), replayed: number[] = [];
  const body: PredictedBody = { motionState: state, ride: null, renderOffset: new Vector3(), motor: legacyDouble<CharacterMotor>({ result: { grounded: false, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null }, captureState: () => undefined, restoreState: () => undefined, resetAt: () => undefined }),
    step: (_command, replay) => { state.tick++; if (replay) replayed.push(state.tick); return true; } };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), owner = new Float64Array(PLAYER_CLASS.owner.length);
  predictor.adopt(0, owner, 500);
  expect(state.tick).toBe(500);
  for (const seq of [1, 2, 3]) predictor.step({ seq, viewTick: 0, steer: standing, yaw: 0, pitch: 0, buttons: 0 });
  expect(state.tick).toBe(503);
  // the server has stepped command 1 at its own tick 520, and says it reset this body: a correction, with commands 2 and 3 to replay
  const resets = PLAYER_CLASS.owner.findIndex(column => column.name === 'resets');
  owner[resets] = 1;
  predictor.reconcile(1, owner, 520);
  expect(replayed).toEqual([521, 522]);
  expect(state.tick).toBe(522);
});

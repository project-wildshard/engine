// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, LOW_DECK, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// P1-E5.3-I5: Low Power Mode in Node, on every push (J121). The client on 41.15 ms frames, ±8 ms, a 60 ms frame every second;
// the server in batches of 2 at 59.9 ticks/s, over a real wire. Commands drive motion, so a step is a step whatever the rate.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const TICK_MS = FIXED_STEP * 1000, EAST = -Math.PI / 2;
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

interface Run { readonly commands: number; readonly steps: number; readonly corrections: number; readonly replays: number; readonly offset: number; readonly feetGap: number; readonly deckTicks: number }
/** `stall`: the worker misses these server ticks, and its clock makes them up in a burst. */
function play(scenario: MotionScenario, seconds: number, press: (frame: number, page: PageSide) => void, stall?: { readonly at: number; readonly ticks: number }): Run {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback(), rng = seeded(21);
  let clock = 0;
  const client = new NetClient(link.client, () => clock), { player } = page;
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.course.advance(host.host.state.tick);
    host.host.step(commands);
  } });
  const seat = room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const net = new NetPlayer(client, player, page.physics);
  // the step after this one is the next command's: a replay stands the decks at this command's own pose, at once
  net.world.addMover({ at: (tick, replay) => { if (replay) page.course.place(tick - 1); else page.course.advance(tick); } });
  player.link = net; player.locked = true;
  let due = 0, acc = 0, commands = 0, nextTick = 0, last = 0, frame = 0, deckTicks = 0, missed = stall?.ticks ?? 0;
  const end = seconds * 1000, batch = 2 * TICK_MS * 60 / 59.9;
  while (clock < end) {
    if (nextTick <= due) {
      if (stall !== undefined && nextTick >= stall.at && missed > 0) { missed -= 2; nextTick += batch; continue; }
      const burst = stall !== undefined && nextTick >= stall.at ? 2 + Math.min(2, stall.ticks + missed) : 2;
      for (let run = 0; run < burst; run++) room.tick();
      nextTick += batch; link.pump(); clock = Math.max(clock, nextTick - batch); continue;
    }
    clock = due;
    const dt = (clock - last) / 1000;
    last = clock;
    press(frame, page);
    net.reconcile(); player.input(dt);
    acc += dt;
    let ran = 0;
    while (acc >= FIXED_STEP && ran < MAX_FIXED_STEPS) {
      page.stepWorld(); player.setBodyEnabled(true);
      const before = net.predictor.pending; player.stepDevice(FIXED_STEP); if (net.predictor.pending > before) commands++;
      if (player.motor.result.groundCollider?.parent()?.isKinematic() === true) deckTicks++;
      acc -= FIXED_STEP; ran++;
    }
    if (ran === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(dt, acc / FIXED_STEP);
    net.present(dt); link.pump();
    frame++; due += frame % 24 === 0 ? 60 : 41.15 + (rng() * 16 - 8);
  }
  for (let settle = 0; settle < 8; settle++) { room.tick(); room.tick(); link.pump(); }
  net.reconcile();
  const report = { commands, steps: room.lastSeq(seat), corrections: net.predictor.corrections, replays: net.predictor.replays, offset: net.worstOffset, feetGap: player.position.distanceTo(host.player.position), deckTicks };
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
  return report;
}

const onto: MotionScenario = { id: 'low-power-deck', start: { x: LOW_DECK.x - 12, z: LOW_DECK.z, yaw: EAST }, ticks: 0, intent: () => ({}) };
const walkOn = (frame: number, page: PageSide): void => {
  if (frame === 0) page.player.keys.add('KeyW');
  if (page.player.position.x > LOW_DECK.x - 2 && page.player.motor.result.groundCollider?.parent()?.isKinematic() === true) page.player.keys.delete('KeyW');
};

test('a walk, a jump, a dodge and a stand on a moving deck: every step a command, and nothing corrected', () => {
  const run = play(onto, 8, (frame, page) => {
    walkOn(frame, page);
    if (frame === 30) page.player.touchJump = true;
    if (frame === 44) page.player.touchDodge = true;
  });
  expect(run.deckTicks).toBeGreaterThan(100); // it really stood there, carried
  expect(run.steps).toBe(run.commands); // J125
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(.02);
});

test('catching up on a moving deck: the second step reads the deck a tick off, and that is bounded', () => {
  const run = play(onto, 8, walkOn, { at: 5000, ticks: 12 });
  expect(run.deckTicks).toBeGreaterThan(100);
  expect(run.steps).toBe(run.commands);
  expect(run.offset).toBeLessThan(.1); // a few centimetres, glided out
  expect(run.feetGap).toBeLessThan(.02);
});

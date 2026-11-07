// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/format/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// P1-E5.3-C6: a real Player, through a real NetClient and NetRoom, on the real bytes. A page frame takes its render step as
// bootstrap does, and Low Power Mode is the rate that matters (J121): 41 ms frames, ±8 ms, a 60 ms frame every second.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const TICK_MS = FIXED_STEP * 1000, EAST = -Math.PI / 2;
const scenario: MotionScenario = { id: 'net-player', start: { x: -10, z: 0, yaw: EAST }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };
/** mulberry32. */
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; };

interface Run { readonly commands: number; readonly steps: number; readonly corrections: number; readonly replays: number; readonly offset: number; readonly feetGap: number; readonly delayMs: number; readonly drawn: readonly number[]; readonly rowSpeed: number }

/** Play `seconds` at a frame time, with the server ticking on its own clock in batches of two. */
function play(seconds: number, frameMs: (frame: number) => number, press: (frame: number, page: PageSide) => void = () => undefined): Run {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback();
  let clock = 0;
  const client = new NetClient(link.client, () => clock), { player } = page;
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.host.step(commands);
  } });
  const seat = room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const net = new NetPlayer(client, player, page.physics), body = [...host.host.entities.values()][0];
  if (body === undefined) throw new Error('No body on the server');
  player.link = net; player.keys.add('KeyW'); player.locked = true; body.harnessHold = true;
  const speed = 3 * FIXED_STEP, drawn: number[] = [], out = new Float64Array(16);
  let due = 0, acc = 0, commands = 0, nextTick = 0, last = 0, frame = 0, handle = 0;
  for (const [id, info] of client.entities) if (info.id === body.entityId) handle = id;
  const end = seconds * 1000;
  while (clock < end) {
    const tick = (): void => { body.position.x += speed; room.tick(); };
    if (nextTick <= due) { for (let run = 0; run < 2; run++) tick(); nextTick += 2 * TICK_MS * 60 / 59.9; link.pump(); clock = Math.max(clock, nextTick - 2 * TICK_MS); continue; }
    clock = due;
    const dt = (clock - last) / 1000;
    last = clock;
    press(frame, page);
    net.reconcile(); player.input(dt);
    acc += dt;
    let ran = 0;
    while (acc >= FIXED_STEP && ran < MAX_FIXED_STEPS) { page.stepWorld(); player.setBodyEnabled(true); const before = net.predictor.pending; player.stepDevice(FIXED_STEP); if (net.predictor.pending > before) commands++; acc -= FIXED_STEP; ran++; }
    if (ran === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(dt, acc / FIXED_STEP);
    net.present(dt); link.pump();
    const render = client.present();
    if (client.interpolator.sample(handle, render, out)) drawn.push(out[0] ?? 0);
    frame++; due += frameMs(frame);
  }
  for (let settle = 0; settle < 6; settle++) { for (let run = 0; run < 2; run++) room.tick(); link.pump(); }
  net.reconcile();
  const report = { commands, steps: room.lastSeq(seat), corrections: net.predictor.corrections, replays: net.predictor.replays, offset: net.worstOffset, feetGap: player.position.distanceTo(host.player.position), delayMs: client.clock.delayMs, drawn, rowSpeed: speed };
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
  return report;
}
const lowPower = (): ((frame: number) => number) => { const rng = seeded(21); return frame => frame % 24 === 0 ? 60 : 41.15 + (rng() * 16 - 8); };

test.each([['Low Power Mode', lowPower()], ['60 frames/s', () => 1000 / 60]] as const)('%s: a clean walk is corrected nowhere', (_name, frameMs) => {
  const run = play(8, frameMs);
  expect(run.commands).toBeGreaterThan(300);
  expect(run.steps).toBe(run.commands); // the server reached the last one, and a step is a command (J125)
  expect(run.corrections).toBe(0);
  expect(run.replays).toBe(0);
  expect(run.offset).toBe(0);
  expect(run.feetGap).toBeLessThan(0.02);
});

test('at Low Power Mode rows move on every drawn frame, never back, and the delay settles under 90 ms', () => {
  const run = play(10, lowPower()), settled = run.drawn.slice(run.drawn.length >> 1), gaps = settled.slice(1).map((x, at) => x - (settled[at] ?? 0));
  expect(run.delayMs).toBeLessThan(90);
  expect(Math.min(...gaps)).toBeGreaterThan(0);
  const expected = run.rowSpeed * 60 * 0.06; // m a 60 ms frame
  expect(Math.max(...gaps)).toBeLessThan(expected * 1.5);
});

test('a jump and a dodge reach the server on the seq that ran them', () => {
  const run = play(4, lowPower(), (frame, page) => { if (frame % 30 === 10) page.player.touchJump = true; if (frame % 37 === 12) page.player.touchDodge = true; });
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(0.02);
});

test('a board press waits for its command, and both sides step on it', () => {
  const run = play(3, lowPower(), (frame, page) => { if (frame === 20) page.player.setHover(true); });
  expect(run.corrections).toBe(0);
});

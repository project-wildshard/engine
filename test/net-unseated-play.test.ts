// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { PREDICTION_RING, PREDICTION_SNAP } from '../src/client/engine/net/predictor';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// OFFLINE OF10 (J298, Jake 2026-11-12: "have a really hard time moving around"): a world page that opened without its seat (OF9)
// plays its own input for the predictor's ring, sends nothing, then holds while the key stays down; the seat glides it home.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'net-unseated-play', start: { x: -10, z: 0, yaw: -Math.PI / 2 }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };

function harness() {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback();
  const client = new NetClient(link.client, () => 0), { player } = page, world = new SimNetWorld(host.host);
  const room = new NetRoom({ world, step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.host.step(commands);
  } });
  const net = new NetPlayer(client, player, page.physics);
  player.link = net; player.keys.add('KeyW'); player.locked = true;
  const frame = (): void => {
    net.reconcile(); player.input(FIXED_STEP);
    page.stepWorld(); player.setBodyEnabled(true);
    player.stepDevice(FIXED_STEP); player.update(FIXED_STEP, 0); net.present(FIXED_STEP);
  };
  return { page, host, link, client, room, net, player, frame };
}

test('OF10: unseated, holding forward moves the player for the ring only, then the position holds; nothing is sent', () => {
  const { net, player, frame, client } = harness();
  net.playUnseated();
  const start = player.position.clone(), path: number[] = [];
  for (let step = 0; step < PREDICTION_RING * 2; step++) { frame(); path.push(player.position.distanceTo(start)); }
  expect(net.joined).toBe(false);
  expect(net.predictor.pending, 'the ring is spent').toBe(PREDICTION_RING);
  expect(net.unseatedHeld).toBe(true);
  expect(path[PREDICTION_RING - 2] ?? 0, 'it walked').toBeGreaterThan(0.5);
  const held = path.slice(PREDICTION_RING + 2);
  expect(Math.max(...held) - Math.min(...held), 'then it stood still with the key down').toBeLessThan(1e-6);
  expect(client.welcome, 'no seat was heard').toBeNull();
});

test('OF10: a page not told to play unseated (a rejoin, a crossing) holds still before its first frame', () => {
  const { net, player, frame } = harness();
  const start = player.position.clone();
  for (let step = 0; step < 30; step++) frame();
  expect(net.predictor.pending).toBe(0);
  expect(player.position.distanceTo(start)).toBeLessThan(1e-6);
});

test('OF10: the seat\'s first frame takes the server\'s place in one correction, gliding when it is near', () => {
  const { net, player, frame, room, link, host, client } = harness();
  net.playUnseated();
  for (let step = 0; step < 20; step++) frame();
  const walked = player.position.clone();
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  for (let tick = 0; tick < 2; tick++) room.tick();
  link.pump();
  net.reconcile();
  expect(net.joined).toBe(true);
  expect(net.unseatedHeld).toBe(false);
  expect(player.position.distanceTo(host.player.position), 'at the seat').toBeLessThan(0.5);
  const gap = walked.distanceTo(player.position);
  expect(gap).toBeLessThan(PREDICTION_SNAP);
  expect(player.renderOffset.length(), 'the camera glides from where it stood').toBeCloseTo(gap, 3);
});

// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/format/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// E7.1b: a real Player over a rejoin. Its saved moves named the old link, so it holds still until the first frame and snaps to it.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'net-player-rejoin', start: { x: -10, z: 0, yaw: -Math.PI / 2 }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };

test('a walking player rejoins: no command until the first frame, a snap to it, and a clean walk after', () => {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), one = directLoopback(), two = directLoopback();
  const client = new NetClient(one.client, () => 0), { player } = page, world = new SimNetWorld(host.host);
  const room = new NetRoom({ world, step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.host.step(commands);
  } });
  room.join(one.server); client.hello(); one.pump(); room.open(); one.pump();
  const net = new NetPlayer(client, player, page.physics);
  let link = one;
  player.link = net; player.keys.add('KeyW'); player.locked = true; net.attacks.started(1);
  const frame = (): number => {
    net.reconcile(); player.input(FIXED_STEP);
    page.stepWorld(); player.setBodyEnabled(true);
    const before = net.predictor.pending;
    player.stepDevice(FIXED_STEP); player.update(FIXED_STEP, 0); net.present(FIXED_STEP); link.pump();
    return net.predictor.pending - before;
  };
  for (let tick = 0; tick < 60; tick++) { frame(); room.tick(); link.pump(); }
  net.reconcile();
  expect(player.position.x, 'it walked').toBeGreaterThan(-9.9);
  expect(net.joined).toBe(true);
  const carried = player.position.clone();
  one.client.close('lost');
  for (let lost = 0; lost < 90; lost++) { room.tick(); host.host.step(new Map()); } // a body with no client, as the hold will leave it
  room.join(two.server); client.rejoin(two.client); link = two;
  expect(net.joined, 'a new link is a page with no frame yet').toBe(false);
  expect(net.attacks.pending).toBe(0);
  expect(frame(), 'nothing is stepped or sent before the first frame').toBe(0);
  two.pump();
  for (let tick = 0; tick < 2; tick++) room.tick();
  two.pump();
  expect(client.latest).not.toBeNull();
  frame();
  expect(net.predictor.pending, 'the ring started over').toBeLessThanOrEqual(1);
  expect(player.position.distanceTo(host.player.position)).toBeLessThan(0.5);
  const corrections = net.predictor.corrections;
  for (let tick = 0; tick < 120; tick++) { frame(); room.tick(); link.pump(); }
  net.reconcile();
  expect(net.predictor.corrections, 'seq started over cleanly').toBe(corrections);
  expect(player.position.x).toBeGreaterThan(carried.x);
  expect(player.position.distanceTo(host.player.position)).toBeLessThan(0.1);
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
});

// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { publishScriptBody } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { NetMovers } from '../src/client/game/plugin/moverViews';
import type { MoverView } from '../src/server/game/plugin/mover';
import { HostSide, loadCourseRapier, LOW_DECK, lowDeckAt, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// A deck a client can't work out for itself: its pose comes up the wire as a `script` row, and the rider stands on it. This is the
// Far Reach lift's shape, with a real NetRoom, NetClient, Player and physics, at a phone's frame rates. `net-low-power` proves the
// same law for a deck the client can compute; here all it knows is the rows. Comparing with a deck drawn at render time is the proof.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const TICK_MS = FIXED_STEP * 1000, EAST = -Math.PI / 2;
interface Run { readonly corrections: number; readonly deckTicks: number; readonly feetGap: number; readonly worst: number }

function ride(frameMs: number, predicted: boolean, seconds = 8): Run {
  const scenario: MotionScenario = { id: 'row-deck', start: { x: LOW_DECK.x - 12, z: LOW_DECK.z, yaw: EAST }, ticks: 0, intent: () => ({}) };
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback();
  let clock = 0;
  publishScriptBody(host.host, 'deck', () => ({ position: lowDeckAt(host.host.state.tick), euler: { x: 0, y: 0, z: 0 }, enabled: true }));
  const client = new NetClient(link.client, () => clock), { player } = page;
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.course.advance(host.host.state.tick);
    host.host.step(commands);
  } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const net = new NetPlayer(client, player, page.physics);
  const view: MoverView = { pose: pose => { page.course.lowDeck(pose.position); }, place: (at, next) => { page.course.lowDeck(next.position, at.position); } };
  // The page before this: the deck stays at render time. A body far off a deck is the same path.
  const movers = new NetMovers(client, new Map([['deck', view]]), predicted ? player.position : { x: 1e6, z: 1e6 });
  net.world.addMover(movers);
  player.link = net; player.locked = true;
  let due = 0, acc = 0, nextTick = 0, last = 0, deckTicks = 0, worst = 0;
  const batch = 2 * TICK_MS;
  while (clock < seconds * 1000) {
    if (nextTick <= due) {
      for (let run = 0; run < 2; run++) room.tick();
      nextTick += batch; link.pump(); clock = Math.max(clock, nextTick - batch); continue;
    }
    clock = due;
    const dt = (clock - last) / 1000;
    last = clock;
    if (due < 1) player.keys.add('KeyW');
    if (player.position.x > LOW_DECK.x - 2 && player.motor.result.groundCollider?.parent()?.isKinematic() === true) player.keys.delete('KeyW');
    net.reconcile(); player.input(dt);
    acc += dt;
    let ran = 0;
    while (acc >= FIXED_STEP && ran < MAX_FIXED_STEPS) {
      page.stepWorld(); player.setBodyEnabled(true); player.stepDevice(FIXED_STEP);
      if (player.motor.result.groundCollider?.parent()?.isKinematic() === true) deckTicks++;
      acc -= FIXED_STEP; ran++;
    }
    if (ran === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(dt, acc / FIXED_STEP);
    movers.frame(client.present());
    net.present(dt); link.pump();
    worst = Math.max(worst, net.worstOffset);
    due += frameMs;
  }
  for (let settle = 0; settle < 8; settle++) { room.tick(); room.tick(); link.pump(); }
  net.reconcile();
  const report = { corrections: net.predictor.corrections, deckTicks, feetGap: player.position.distanceTo(host.player.position), worst };
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
  return report;
}

test.each([['60 fps', 1000 / 60], ['Low Power, 41 ms', 41.15]])('a rider on a deck known only by its rows is not corrected every frame at %s', (_name, frameMs) => {
  const before = ride(frameMs, false), after = ride(frameMs, true);
  expect(before.deckTicks).toBeGreaterThan(100); // it really stood there, carried
  expect(after.deckTicks).toBeGreaterThan(100);
  expect(before.corrections, 'the deck drawn at render time').toBeGreaterThan(50);
  expect(after.corrections).toBeLessThan(before.corrections / 10);
  expect(after.worst, 'nothing the eye can see').toBeLessThan(.01);
  expect(after.worst).toBeLessThanOrEqual(before.worst);
  expect(after.feetGap, 'read after the settle, where no command runs and the server\'s deck moves on').toBeLessThan(.05);
});

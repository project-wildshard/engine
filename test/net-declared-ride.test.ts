// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { app } from '../src/client/engine/app/runtime';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { overrideTerrain } from '../src/test/engine/terrain';
import { directLoopback } from '../src/test/engine/netLoopback';
import { installDeclaredRiding } from '../src/server/game/shardfile/declaredRiding';
import { courseHeightAt, HostSide, loadCourseRapier, PageSide, TARGET_ID, type MotionScenario } from './fixtures/motion-trace/parity';
import { installKitWorldFixture } from './fixtures/kit-world';

await installKitWorldFixture();

// ONE-FORMAT OF25b: a data shard's page has no Mount of its own, so it cannot predict the one riding primitive's ride. On
// staging the server seated Ana on the stranger's skeleton horse, her page waited for a ride it would never enter, its
// prediction ring filled in a second and it stopped sending commands: neither horse nor rider moved. The server leads a
// declared ride; the page follows it and keeps sending the reins.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'net-declared-ride', start: { x: -10, z: -4, yaw: 0 }, ticks: 0, intent: () => ({}), bodyAt: { x: -8, z: -4 } };
const undo: (() => void)[] = [];
afterEach(() => { for (const run of undo.splice(0).reverse()) run(); });

function rig() {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback();
  undo.push(overrideTerrain({ heightAt: courseHeightAt, normalAt: () => [0, 1, 0], waterLevel: () => -100 }));
  const was = app.physics;
  app.physics = page.physics;
  undo.push(() => { app.physics = was; page.dispose(); host.dispose(); });
  const horse = host.host.entities.get(TARGET_ID);
  if (horse === undefined) throw new Error('No mount on the server');
  horse.harnessHold = true;
  const riding = installDeclaredRiding(host.host, { rows: { species: [{ id: horse.species, mount: { gaits: { walk: 2, gallop: 10 } } }] } } as unknown as Pick<Shardfile, 'rows'>);
  if (riding === null) throw new Error('No riding primitive');
  const state = { clock: 0 }, client = new NetClient(link.client, () => state.clock), routes = actRoutes(host.host);
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) {
      if (row.command !== null) commands.set(row.player, row.command);
      for (const act of row.acts) if (act.kind === 'ride') routes.ride?.(row.player, act.action);
    }
    host.host.step(commands);
  } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const net = new NetPlayer(client, page.player, page.physics);
  page.player.link = net; page.player.locked = true;
  // A data shard's page: its seat has no Mount to enter (clientWorker's `mount` is null).
  net.bindRide({ enter: () => undefined, leave: () => undefined });
  return { page, host, horse, riding, net, room, client, pump: () => { link.pump(); }, state };
}

function play(f: ReturnType<typeof rig>, seconds: number): number {
  const { page, net, room, pump, client, state } = f, { player } = page, tickMs = FIXED_STEP * 1000, end = state.clock + seconds * 1000;
  let due = state.clock, last = state.clock, acc = 0, nextTick = state.clock, commands = 0;
  while (state.clock < end) {
    if (nextTick <= due) { room.tick(); room.tick(); nextTick += 2 * tickMs; pump(); state.clock = Math.max(state.clock, nextTick - 2 * tickMs); continue; }
    state.clock = due;
    const dt = (state.clock - last) / 1000;
    last = state.clock;
    net.reconcile(); player.input(dt);
    acc += dt;
    for (let ran = 0; acc >= FIXED_STEP && ran < MAX_FIXED_STEPS; ran++) {
      page.stepWorld(); player.setBodyEnabled(true);
      const before = net.predictor.pending; player.stepDevice(FIXED_STEP); if (net.predictor.pending > before) commands++;
      acc -= FIXED_STEP;
    }
    player.update(dt, acc / FIXED_STEP);
    net.present(dt); pump(); client.present();
    due += 1000 / 60;
  }
  return commands;
}

test('a page with no Mount rides a declared mount: the server leads, the reins keep coming, horse and rider move', () => {
  const f = rig(), { page, host, horse, riding, net } = f, { player } = page;
  play(f, .4);
  net.ride('mount');
  play(f, .4);
  expect(riding.ridden(host.player.id)).toBe(horse);
  const from = horse.position.clone();
  player.keys.add('KeyW');
  const commands = play(f, 3);
  // three seconds of reins at about 60 a second; a page stuck behind a full ring sends about one second's
  expect(commands).toBeGreaterThan(150);
  expect(net.predictor.full).toBe(false);
  expect(horse.position.distanceTo(from)).toBeGreaterThan(4);
  // the page follows the server's rider
  expect(Math.hypot(player.position.x - host.player.position.x, player.position.z - host.player.position.z)).toBeLessThan(1);
});

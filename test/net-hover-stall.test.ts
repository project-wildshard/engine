// @vitest-environment happy-dom
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = {id: 'hover-stall', start: {x: -10, z: 0, yaw: 0}, ticks: 0, intent: () => ({})};

for (const stall of [10, 30, 90, 150]) for (const order of ['frame-first', 'messages-first'] as const) test(`mount then unmount across ${stall}-tick stalls, ${order}`, () => {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), wire = directLoopback();
  let now = 0;
  const client = new NetClient(wire.client, () => now), changes: boolean[] = [];
  const room = new NetRoom({world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    const before = host.player.board.on;
    host.host.step(commands);
    if (host.player.board.on !== before) changes.push(host.player.board.on);
  }});
  room.join(wire.server); client.hello(); wire.pump();
  room.open(); wire.pump();
  const {player} = page, net = new NetPlayer(client, player, page.physics);
  player.link = net; player.locked = true;
  net.reconcile(); net.driveDevice(() => 'live', () => player.sampleHeldCommand());
  const server = wire.server as unknown as {deliver: () => void}, toPage = wire.client as unknown as {deliver: () => void};
  const renderStep = () => {
    player.input(FIXED_STEP); page.stepWorld(); player.setBodyEnabled(true);
    player.stepDevice(FIXED_STEP); net.present(FIXED_STEP); server.deliver();
  };
  const render = (press: boolean, ticks: number) => {
    net.reconcile();
    if (press) player.tapHover(now);
    for (let step = 0; step < Math.min(ticks, MAX_FIXED_STEPS); step++) renderStep();
  };
  // the page's main thread is stuck for `ticks` server ticks: server frames queue in its socket
  const frame = (press = false, ticks = 1) => {
    for (let tick = 0; tick < ticks; tick++) { now += FIXED_STEP * 1000; room.tick(); server.deliver(); }
    if (order === 'messages-first') { toPage.deliver(); server.deliver(); render(press, ticks); }
    else { render(press, ticks); toPage.deliver(); server.deliver(); }
    wire.pump();
  };
  try {
    for (let f = 0; f < 20; f++) frame();
    frame(true, stall);
    for (let f = 0; f < 4; f++) frame(false, stall);
    for (let f = 0; f < 20; f++) frame();
    const mounted = {hover: player.hover, host: host.player.board.on};
    frame(true, stall);
    for (let f = 0; f < 4; f++) frame(false, stall);
    for (let f = 0; f < 60; f++) frame();
    expect({mounted, changes, hover: player.hover, host: host.player.board.on, corrections: net.predictor.corrections})
      .toMatchObject({mounted: {hover: true, host: true}, hover: false, host: false});
  } finally {net.dispose(); room.dispose(); page.dispose(); host.dispose();}
}, 20000);

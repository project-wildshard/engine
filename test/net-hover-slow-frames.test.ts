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
const scenario: MotionScenario = {id: 'hover-slow', start: {x: -10, z: 0, yaw: 0}, ticks: 0, intent: () => ({})};

for (const [ticksPerFrame, unseated] of [[1, false], [4, false], [8, false], [22, false], [1, true], [22, true]] as const) test(`a tap mounts at ${ticksPerFrame} server ticks a render frame${unseated ? ', before the seat' : ''}`, () => {
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
  if (!unseated) { room.open(); wire.pump(); }
  const {player} = page, net = new NetPlayer(client, player, page.physics);
  player.link = net; player.locked = true;
  net.reconcile(); net.driveDevice(() => 'live', () => player.sampleHeldCommand());
  const renderStep = () => {
    player.input(FIXED_STEP); page.stepWorld(); player.setBodyEnabled(true);
    player.stepDevice(FIXED_STEP); net.present(FIXED_STEP); wire.pump();
  };
  const frame = (press = false) => {
    for (let tick = 0; tick < ticksPerFrame; tick++) { now += FIXED_STEP * 1000; room.tick(); wire.pump(); }
    net.reconcile();
    if (press) player.tapHover(now);
    for (let step = 0; step < Math.min(ticksPerFrame, MAX_FIXED_STEPS); step++) renderStep();
  };
  const blends: boolean[] = [];
  try {
    if (unseated) {
      // OF10: the seat's first frame has not come; the page plays unseated
      expect(net.joined).toBe(false);
      net.playUnseated();
      player.tapHover(now);
      for (let step = 0; step < MAX_FIXED_STEPS; step++) renderStep();
      blends.push(player.hover);
      room.open(); wire.pump();
    }
    for (let f = 0; f < 10; f++) frame();
    if (!unseated) frame(true);
    for (let f = 0; f < 30; f++) { frame(); blends.push(player.hover); }
    expect({changes, hover: player.hover, host: host.player.board.on, corrections: net.predictor.corrections, blends: blends.join('')}).toMatchObject({hover: true, host: true});
  } finally {net.dispose(); room.dispose(); page.dispose(); host.dispose();}
}, 20000);

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
const scenario: MotionScenario = {id: 'hover-admission', start: {x: -10, z: 0, yaw: 0}, ticks: 0, intent: () => ({})};

// TC8: a real touch was accepted, but sampling erased its board edge before
// the live link admitted a tick. New coverage reports during the soak week.
test('mount and unmount survive a render step with no new server tick', () => {
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
  const seat = room.join(wire.server); client.hello(); wire.pump(); room.open(); wire.pump();
  const {player} = page, net = new NetPlayer(client, player, page.physics);
  player.link = net; player.locked = true;
  net.reconcile(); net.driveDevice(() => 'live', () => player.sampleHeldCommand());
  const renderStep = () => {
    player.input(FIXED_STEP); page.stepWorld(); player.setBodyEnabled(true);
    player.stepDevice(FIXED_STEP); net.present(FIXED_STEP); wire.pump();
  };
  const advance = () => {
    now += FIXED_STEP * 1000; room.tick(); wire.pump(); net.reconcile(); renderStep();
  };
  try {
    for (const [index, on] of [true, false].entries()) {
      // Spend the current tick's allowance, then press without inventing
      // server time. Several refused render steps must retain that press.
      for (let step = 0; step < MAX_FIXED_STEPS + 2; step++) renderStep();
      const sequence = room.lastSeq(seat);
      player.tapHover(1000 + index * 1000);
      for (let step = 0; step < MAX_FIXED_STEPS + 2; step++) renderStep();
      expect(player.hover).toBe(!on); expect(host.player.board.on).toBe(!on);
      expect(room.lastSeq(seat)).toBe(sequence);
      for (let tick = 0; tick < 12; tick++) advance();
      expect(player.hover).toBe(on); expect(host.player.board.on).toBe(on);
    }
    for (let tick = 0; tick < 12; tick++) advance();
    expect(changes).toEqual([true, false]);
    expect(net.predictor.corrections).toBe(0);
  } finally {net.dispose(); room.dispose(); page.dispose(); host.dispose();}
}, 9500);

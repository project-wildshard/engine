// @vitest-environment happy-dom
import { beforeAll, expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// J116 for grapple: a LOCK press goes out with the hook the client's camera picked, and a claw's JUMP goes to the server
// without stepping this body: a crossing carries it by `led`.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'net-hook', start: { x: -10, z: 0, yaw: 0 }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };

test('the next command carries a hook press, and a claw shot never steps the body', () => {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: () => { host.host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump(); room.tick(); room.tick(); link.pump();
  const net = new NetPlayer(client, page.player, page.physics);
  net.reconcile();
  const sent = vi.spyOn(client, 'command'), stepped = vi.spyOn(net.predictor, 'step'), input = { steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
  const seq = net.hooks.lock(3); net.hooks.fire();
  expect(net.step(input)).toBe(true);
  const command = sent.mock.calls[0]?.[0];
  expect(sent.mock.results[0]?.value).toBe(seq);
  expect(command?.hookTarget).toBe(3);
  expect((command?.buttons ?? 0) & NET_BUTTONS.lock).toBe(NET_BUTTONS.lock);
  expect((command?.buttons ?? 0) & NET_BUTTONS.jump).toBe(NET_BUTTONS.jump);
  expect((stepped.mock.calls[0]?.[0].buttons ?? 0) & NET_BUTTONS.jump).toBe(0);
  net.step(input);
  expect(sent.mock.calls[1]?.[0]).not.toHaveProperty('hookTarget');
  expect(sent.mock.calls[1]?.[0].buttons).toBe(0);
  net.dispose();
});

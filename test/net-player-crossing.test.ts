// @vitest-environment happy-dom
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { commandsOf } from '../src/server/game/grid/roomNet';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// E6, J130: a crossing is a snap. A real Player through a real NetClient hears `travel`, stops sending, waits behind `inCell`
// while the page makes the crossing, and the next world's first frame seats it there, in that world's coordinates.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const FROM: MotionScenario = { id: 'road', start: { x: -10, z: 0, yaw: -Math.PI / 2 }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };
const TO: MotionScenario = { ...FROM, id: 'cell', start: { x: 4, z: -6, yaw: -Math.PI / 2 } };

test('a client holds through a crossing and takes the next world from its first frame', () => {
  const page = new PageSide(R, FROM), road = new HostSide(R, FROM), cell = new HostSide(R, TO), link = directLoopback(), clock = { now: 0 };
  const client = new NetClient(link.client, () => clock.now), { player } = page;
  const stepped = ({ host }: HostSide) => (inputs: readonly NetTickInput[]): void => { host.step(commandsOf(inputs)); };
  const first = new SimNetWorld(road.host, 0), second = new SimNetWorld(cell.host, 7);
  const roadRoom = new NetRoom({ world: first, step: stepped(road) }), cellRoom = new NetRoom({ world: second, step: stepped(cell) });
  const seat = roadRoom.join(link.server); client.hello(); link.pump(); roadRoom.open(); cellRoom.open(); link.pump();
  const net = new NetPlayer(client, player, page.physics);
  let pageCell = 0, sent = 0, travels = 0;
  net.inCell = at => at === pageCell;
  player.link = net; player.keys.add('KeyW'); player.locked = true;
  const original = client.command.bind(client);
  client.command = input => { sent++; return original(input); };
  client.onTravel(() => { travels++; });
  const frame = (room: NetRoom): void => {
    room.tick(); link.pump(); clock.now += 16;
    net.reconcile(); player.input(FIXED_STEP); page.stepWorld(); player.setBodyEnabled(true); player.stepDevice(FIXED_STEP);
    net.present(FIXED_STEP); link.pump();
  };
  for (let run = 0; run < 12; run++) frame(roadRoom);
  expect(net.joined).toBe(true);
  expect(sent).toBeGreaterThan(5);

  const held = player.position.clone();
  roadRoom.handOff(seat, cellRoom, second.playerOf(second.player.id)); link.pump();
  expect(travels).toBe(1);
  expect(net.joined).toBe(false);
  const before = sent;
  for (let run = 0; run < 6; run++) frame(cellRoom);
  expect(client.latest?.cell).toBe(7);
  expect(net.joined).toBe(false); // the page has not crossed: these frames wait, in a world it doesn't stand in
  expect(sent).toBe(before);
  expect(player.position.distanceTo(held)).toBeLessThan(0.001);

  pageCell = 7;
  frame(cellRoom);
  expect(net.joined).toBe(true);
  expect(Math.abs(player.position.x - 4)).toBeLessThan(0.1);
  expect(Math.abs(player.position.z + 6)).toBeLessThan(0.1);
  const corrections = net.predictor.corrections;
  for (let run = 0; run < 30; run++) frame(cellRoom);
  expect(sent).toBeGreaterThan(before + 20); // the same stream of commands goes on
  expect(player.position.x).toBeGreaterThan(5);
  expect(net.predictor.corrections).toBe(corrections);
  expect(client.dropped).toBe(0);
});

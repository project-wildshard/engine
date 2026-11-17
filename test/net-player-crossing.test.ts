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

// MMO-PLAN MP1.6b: a crossing onto another worker. The road lets the client go (`handOut`) and the cell there seats it on a queue of its
// own; past 0x8000 a fresh queue's `lastSeq` 0 reads as ahead of every command the predictor holds, so it stopped reconciling until
// `seq` wrapped. The hand-out carries the source queue's `lastSeq`, and the arriving owner block starts from it.
test('a predicted client past half its seq range reconciles at once after a crossing to another worker', () => {
  const page = new PageSide(R, FROM), road = new HostSide(R, FROM), cell = new HostSide(R, TO), link = directLoopback(), clock = { now: 0 };
  const client = new NetClient(link.client, () => clock.now), { player } = page;
  const stepped = ({ host }: HostSide) => (inputs: readonly NetTickInput[]): void => { host.step(commandsOf(inputs)); };
  const first = new SimNetWorld(road.host, 0), second = new SimNetWorld(cell.host, 7);
  const roadRoom = new NetRoom({ world: first, step: stepped(road) }), cellRoom = new NetRoom({ world: second, step: stepped(cell) });
  Reflect.set(client, 'seq', 40_000);
  const seat = roadRoom.join(link.server); client.hello(); link.pump(); roadRoom.open(); cellRoom.open(); link.pump();
  const net = new NetPlayer(client, player, page.physics);
  let pageCell = 0;
  net.inCell = at => at === pageCell;
  player.link = net; player.keys.add('KeyW'); player.locked = true;
  const acked = (): number | null => Reflect.get(net.predictor, 'acked') as number | null;
  const frame = (room: NetRoom): void => {
    room.tick(); link.pump(); clock.now += 16;
    net.reconcile(); player.input(FIXED_STEP); page.stepWorld(); player.setBodyEnabled(true); player.stepDevice(FIXED_STEP);
    net.present(FIXED_STEP); link.pump();
  };
  for (let run = 0; run < 12; run++) frame(roadRoom);
  expect(roadRoom.lastSeq(seat)).toBeGreaterThan(40_000);

  // The other worker: the road lets the client go on its open link, and the cell seats it with the road's last stepped seq
  const handed = roadRoom.handOut(seat, 7);
  expect(handed?.seq).toBeGreaterThan(40_000);
  const arrived = cellRoom.arrive(link.server, second.playerOf(second.player.id), handed?.seq);
  client.hello(); link.pump();
  pageCell = 7;
  const owners: number[] = [];
  client.onFrame(decoded => { owners.push(decoded.lastSeq); });
  for (let run = 0; run < 6; run++) frame(cellRoom);
  expect(net.joined).toBe(true);
  expect(owners.length).toBeGreaterThan(0);
  expect(owners.filter(seq => seq === 0), 'the arriving owner block never says 0').toEqual([]);
  expect(cellRoom.lastSeq(arrived)).toBeGreaterThan(40_000);

  // The server's body slips half a metre the page never stepped: the next frame's compare must catch it and put the page there
  const corrections = net.predictor.corrections;
  cell.player.position.x += 0.5;
  for (let run = 0; run < 3; run++) frame(cellRoom);
  expect(acked(), 'the predictor reconciles every frame').toBe(client.latest?.lastSeq);
  expect(net.predictor.corrections, 'the correction lands').toBeGreaterThan(corrections);
  expect(client.dropped).toBe(0);
});

// MP1.6b review: a queue that never stepped a command says 0 for "nothing yet"; handing that 0 on would make every command past 0x8000
// read as spent. It hands on nothing, and the target's queue starts fresh.
test('a hand-out before any command names no seq', () => {
  const road = new HostSide(R, FROM), link = directLoopback(), client = new NetClient(link.client);
  const roadRoom = new NetRoom({ world: new SimNetWorld(road.host, 0), step: () => undefined });
  const seat = roadRoom.join(link.server); client.hello(); link.pump(); roadRoom.open(); link.pump();
  expect(roadRoom.handOut(seat, 7)).toEqual({ seq: undefined });
});

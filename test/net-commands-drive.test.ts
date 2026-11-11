// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { STALL_TICKS } from '../src/server/engine/net/commandQueue';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.3-C3, J125: commands drive motion. A server step and a client step are the same step, at any frame rate.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const walking: Omit<NetCommand, 'seq'> = { viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0.4, pitch: 0, buttons: 0 };
const TICK_MS = 1000 / 60, FRAME_MS = 41.15;

interface Stage { host: SimHost; room: NetRoom; client: NetClient; link: DirectLoopback; id: number }
function stage(): Stage {
  const host = createSimHost(SIM_LEVEL, { rapier }), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  const id = room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  return { host, room, client, link, id };
}

test('at 24.3 frames/s every server step is a client command, one for one', () => {
  const { host, room, client, link, id } = stage(), steps = 600;
  const direct = createSimHost(SIM_LEVEL, { rapier }), directId = leadPlayer(direct).id;
  for (let seq = 1; seq <= steps; seq++) direct.step(new Map([[directId, { ...walking, seq }]]));
  let sent = 0, frames = 0;
  for (let clock = 0, due = 0; sent < steps || room.lastSeq(id) < steps; clock += TICK_MS) {
    while (due <= clock) { // one page frame: the steps it owes, sent together
      const owed = Math.round(((frames + 1) * FRAME_MS) / TICK_MS) - Math.round((frames * FRAME_MS) / TICK_MS);
      for (let step = 0; step < owed && sent < steps; step++) { client.command(walking); sent++; }
      client.flush(); link.pump(); frames++; due += FRAME_MS;
    }
    room.tick(); link.pump();
  }
  expect(room.lastSeq(id)).toBe(steps);
  const server = leadPlayer(host).position, plain = leadPlayer(direct).position;
  expect(server.distanceTo(plain)).toBeLessThan(0.02); // the predictor's tolerance
  expect(plain.distanceTo({ x: 0, y: plain.y, z: 0 })).toBeGreaterThan(1);
  room.dispose(); host.dispose(); direct.dispose();
});

test('a client that catches up steps twice a tick, and lands where it would have', () => {
  const { host, room, client, link, id } = stage();
  const direct = createSimHost(SIM_LEVEL, { rapier }), directId = leadPlayer(direct).id;
  for (let seq = 1; seq <= 40; seq++) direct.step(new Map([[directId, { ...walking, seq }]]));
  for (let tick = 0; tick < 12; tick++) room.tick(); // a late packet: these ticks are the budget its commands spend
  for (let burst = 0; burst < 2; burst++) {
    for (let step = 0; step < 6; step++) client.command(walking);
    client.flush(); link.pump();
  }
  let ticks = 0;
  for (; room.lastSeq(id) < 12; ticks++) room.tick();
  expect(ticks).toBeLessThan(10);
  for (let step = 12; step < 40; step++) { client.command(walking); client.flush(); link.pump(); room.tick(); }
  expect(leadPlayer(host).position.distanceTo(leadPlayer(direct).position)).toBeLessThan(0.02);
  room.dispose(); host.dispose(); direct.dispose();
});

test('no command, no step: a player freezes for 250 ms, then falls with no input', () => {
  const { host, room, client, link } = stage(), player = leadPlayer(host);
  for (let step = 0; step < 20; step++) { client.command(walking); client.flush(); link.pump(); room.tick(); }
  player.position.y += 3; player.motor.resetAt(player.position); player.fall.grounded = false; player.velocity.y = 0;
  const hung = player.position.clone();
  for (let tick = 0; tick < STALL_TICKS; tick++) room.tick();
  expect(player.position.equals(hung)).toBe(true);
  for (let tick = 0; tick < 30; tick++) room.tick();
  expect(player.position.y).toBeLessThan(hung.y - 0.5);
  room.dispose(); host.dispose();
});

test('a host with no room steps as it always has: an empty tick still moves a falling player', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), player = leadPlayer(host);
  player.position.y += 3; player.motor.resetAt(player.position); player.fall.grounded = false;
  const start = player.position.y;
  for (let tick = 0; tick < 20; tick++) host.step();
  expect(player.position.y).toBeLessThan(start);
  host.dispose();
});

test('P1-E5.3-A17: during a fall\'s fade a press moves nothing, the owner block says the server leads, and the fade\'s end frees the player', () => {
  const { host, room, client, link } = stage(), player = leadPlayer(host);
  const drive = (ticks: number): void => { for (let tick = 0; tick < ticks; tick++) { client.command({ ...walking, buttons: NET_BUTTONS.jump }); client.flush(); link.pump(); room.tick(); link.pump(); } };
  drive(30);
  host.respawn.fell(player.id, player.health);
  const led = (): unknown => { const frame = client.latest; return frame === null ? null : client.owner(frame)['led']; };
  drive(30); // the walk's own momentum runs out
  expect(led()).toBe(true);
  const faded = player.position.clone();
  drive(30);
  expect(Math.hypot(player.position.x - faded.x, player.position.z - faded.z)).toBeLessThan(0.05);
  for (let tick = 0; tick < 120 && host.respawn.fading(player.id); tick++) drive(1);
  expect(host.respawn.fading(player.id)).toBe(false);
  const free = player.position.clone();
  drive(60);
  expect(led()).toBe(false);
  expect(Math.hypot(player.position.x - free.x, player.position.z - free.z)).toBeGreaterThan(1);
  room.dispose(); host.dispose();
});

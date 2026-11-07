// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { NET_POSE } from '../src/shared/engine/sim/shardRows';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E7.3c (FLIP-6): a room says a pose value once. A client that comes later is told what it missed, to it alone, right after its spawn.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

interface Seat { readonly link: DirectLoopback; readonly client: NetClient; readonly heard: string[]; readonly poses: Map<string, number> }
interface Bench { readonly host: SimHost; readonly world: SimNetWorld; readonly room: NetRoom; seat: (id: string) => Seat; run: (seats: readonly Seat[], ticks: number) => void }
function bench(): Bench {
  const host = createSimHost(SIM_LEVEL, { rapier }), world = new SimNetWorld(host);
  const room = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => { const commands = new Map<string, NetCommand>(); for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command); host.step(commands); } });
  room.open();
  return { host, world, room,
    seat: id => {
      const link = directLoopback(), client = new NetClient(link.client, () => 0), heard: string[] = [], poses = new Map<string, number>();
      client.onView(({ name, args }) => { if (!name.startsWith(NET_POSE)) return; heard.push(`${name}=${String(args[0])}`); poses.set(name, args[0] ?? 0); });
      room.join(link.server, world.playerOf(id)); client.hello(); link.pump();
      return { link, client, heard, poses };
    },
    run: (seats, ticks) => { for (let tick = 0; tick < ticks; tick++) { room.tick(); for (const seat of seats) seat.link.pump(); } } };
}
function posed(host: SimHost, name: string, value: number): string {
  const [id, body] = [...host.entities][0] ?? [];
  if (id === undefined || body === undefined) throw new Error('No creature');
  body.harnessHold = true; actRoutes(host).poseInputs.add(name); body.mem[name] = value;
  return `${NET_POSE}${id}.${name}`;
}

test('B joins after a body\'s pose was said, hears it in its first events, and A hears nothing twice', () => {
  const { host, world, room, seat, run } = bench(), lead = leadPlayer(host), key = posed(host, 'snarl', 0.75);
  const a = seat(lead.id);
  run([a], 8);
  expect(a.heard).toEqual([`${key}=0.75`]);
  const bot = host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }), b = seat(bot.id);
  let firstEvents = -1;
  b.client.onView(({ name }) => { if (name === key) firstEvents = b.client.latest === null ? 0 : 1; });
  run([a, b], 2);
  expect(firstEvents, 'it came before its first frame').toBe(0);
  run([a, b], 30);
  expect(b.heard).toEqual([`${key}=0.75`]);
  expect(a.heard, 'said to B alone').toEqual([`${key}=0.75`]);
  expect(b.poses).toEqual(a.poses);
  posed(host, 'snarl', 0.25);
  run([a, b], 4);
  expect(a.heard).toEqual([`${key}=0.75`, `${key}=0.25`]);
  expect(b.heard).toEqual([`${key}=0.75`, `${key}=0.25`]);
  expect(a.poses.get(key)).toBe(b.poses.get(key));
  world.recall('nobody', []);
  room.dispose(); host.dispose();
});

test('a rejoin hears the pose again, on its new link alone', () => {
  const { host, world, room, seat, run } = bench(), lead = leadPlayer(host), key = posed(host, 'snarl', 0.5), a = seat(lead.id);
  run([a], 8);
  const next = directLoopback(), others = seat(host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }).id);
  run([a, others], 2);
  a.link.client.close('lost');
  room.join(next.server, world.playerOf(lead.id)); a.client.rejoin(next.client); next.pump();
  for (let tick = 0; tick < 4; tick++) { room.tick(); next.pump(); others.link.pump(); }
  expect(a.heard).toEqual([`${key}=0.5`, `${key}=0.5`]);
  expect(others.heard, 'only the one it joined to').toEqual([`${key}=0.5`]);
  room.dispose(); host.dispose();
});

test('a value never said is not recalled, and a crowd of them spreads over frames', () => {
  const { host, world, room, seat, run } = bench(), lead = leadPlayer(host);
  for (let extra = 0; extra < 9; extra++) host.spawn({ ...SIM_CREATURE_RECIPE, id: `crowd:${String(extra)}`, at: { x: 4 + extra, y: 0, z: 6 } });
  const a = seat(lead.id), bodies = [...host.entities.keys()], names = Array.from({ length: 60 }, (_, at) => `in${String(at)}`);
  const out: { name: string; args: readonly number[] }[] = [];
  world.recall(bodies[0] ?? '', out);
  expect(out).toEqual([]);
  for (const [, body] of host.entities) { body.harnessHold = true; for (const name of names) { body.mem[name] = 0.5; actRoutes(host).poseInputs.add(name); } }
  run([a], 4);
  const total = a.heard.length, b = seat(host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }).id), perFrame: number[] = [];
  expect(total).toBe(bodies.length * names.length);
  for (let frame = 0; frame < 6; frame++) { const before = b.heard.length; room.tick(); room.tick(); b.link.pump(); a.link.pump(); perFrame.push(b.heard.length - before); }
  expect(perFrame[0], 'one frame takes the cap, plus at most the one body it stopped on').toBeGreaterThanOrEqual(256);
  expect(perFrame[0]).toBeLessThan(256 + names.length);
  expect(perFrame.reduce((sum, rows) => sum + rows, 0)).toBe(total);
  expect(new Set(b.heard).size).toBe(total);
  expect(b.poses).toEqual(a.poses);
  room.dispose(); host.dispose();
});

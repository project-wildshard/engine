import { afterEach, expect, test, vi } from 'vitest';
import { WebSocket as RawSocket } from 'ws';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { questBooks } from '../src/shared/engine/quest/players';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { nativeQuestPrompts } from '../src/server/game/quest/nativeComposition';
import { closeReason } from '../src/shared/engine/net/socketFrames';
import type { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb } from './fixtures/dedicated/roomBot';

// E7.7: each new row of the refusal table, on real sockets, with its answer.
const SHARD = 'driftwood-isle';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const bot = (device: string, loadMs = 0): RoomBot => { const made = new RoomBot(bench?.url ?? '', 'bench', device, device, 0, loadMs); bots.push(made); return made; };
const roomOf = (): DedicatedRoom => { const room = bench?.room(SHARD); if (room === undefined) throw new Error('No room'); return room; };
const refusals = (): unknown => bench?.world.refusals;
const closed = (url: string): Promise<string> => new Promise(resolve => { const socket = new RawSocket(url); socket.on('close', code => { resolve(closeReason(code)); }); socket.on('error', () => { resolve('no upgrade'); }); });

test('a socket off the one address is refused before the upgrade', { timeout: 30_000 }, async () => {
  bench = await roomBench();
  expect(await closed(`${bench.url}room/driftwood-isle`)).toBe('no upgrade');
  expect(refusals()).toEqual({ 'wrong-address': 1 });
});

test('a socket that never says hello is refused at 5 s, and one that never loads at 120 s', { timeout: 30_000 }, async () => {
  bench = await roomBench({ helloMs: 100, readyMs: 200 });
  expect(await closed(bench.url)).toBe('refused');
  const slow = bot('device:slow', 60_000);
  expect(await slow.ended()).toBe('refused');
  expect(bench.world.health().players, 'no body for a phone still loading').toBe(0);
  expect(refusals()).toEqual({ 'hello-timeout': 1, 'ready-timeout': 1 });
});

test('four sockets an address, and ten connects a minute', { timeout: 30_000 }, async () => {
  bench = await roomBench({ socketsPerIp: 2, connectsPerMinute: 3 });
  const first = bot('device:1'), second = bot('device:2');
  expect(await first.arrived()).toBe(true);
  expect(await second.arrived()).toBe(true);
  expect(await closed(bench.url), 'a third socket is refused before upgrade').toBe('no upgrade');
  second.drop();
  await vi.waitFor(() => { expect(bench?.world.health().players).toBeLessThanOrEqual(2); });
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect(await closed(bench.url), 'the refused attempt stores no extra history').toBe('no upgrade');
  expect(refusals()).toEqual({ connections: 2 });
});

test('a full world closes `full`, a freed seat lets the next in, and a second socket for one identity replaces the first', { timeout: 60_000 }, async () => {
  bench = await roomBench({ seats: 8, socketsPerIp: 32, connectsPerMinute: 64, holdMs: 50 });
  const seats = Array.from({ length: 8 }, (_unused, index) => bot(`device:${String(index)}`));
  await Promise.all(seats.map(row => row.arrived()));
  expect(bench.world.health().players).toBe(8);
  expect(await bot('device:9').ended()).toBe('full');
  const again = bot('device:0');
  expect(await again.arrived()).toBe(true);
  expect(await seats[0]?.ended()).toBe('replaced');
  expect(roomOf().taken).toBe(8);
  expect(bench.world.health().players, 'a rejoin is not a new seat').toBe(8);
  expect(refusals()).toEqual({ full: 1 });
  seats[7]?.drop();
  await vi.waitFor(() => { expect(roomOf().taken).toBe(7); }, { timeout: 5000 });
  expect(await bot('device:9').arrived(), 'the retry gets the freed seat').toBe(true);
});

test('`climate` changes nothing, and a buy needs the seller', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const phone = bot('device:shopper');
  expect(await phone.arrived()).toBe(true);
  const room = roomOf(), body = room.bodyOf('device:shopper'), owned = room.cell.owned.of(body?.id ?? ''), whetstone = 0;
  if (body === undefined) throw new Error('No body');
  const seller = nativeQuestPrompts(room.host).find(prompt => prompt.id === null);
  expect(actRoutes(room.host).climate, 'E7.7: no route for a client to reach the sky by').toBeNull();
  if (seller === undefined) throw new Error('No seller');
  owned.file({ grant: 'coins', name: 'coins', amount: 500 });
  const coins = owned.purse.coins, refused = (): number => room.net.stats.refused;
  phone.client.act({ kind: 'climate', seq: 0, op: 'force', name: 'storm', at: 0 });
  await vi.waitFor(() => { expect(refused()).toBe(1); }, { timeout: 2000 });
  // far from the seller, in a room with a panel nobody could have opened
  phone.client.act({ kind: 'buy', seq: 0, good: whetstone });
  await vi.waitFor(() => { expect(refused()).toBe(2); }, { timeout: 2000 });
  expect(owned.purse.coins, 'a client can no longer buy from anywhere').toBe(coins);
  body.resetPose({ x: seller.position.x, y: seller.position.y, z: seller.position.z }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  phone.client.act({ kind: 'buy', seq: 0, good: whetstone });
  await vi.waitFor(() => { expect(owned.purse.coins).toBeLessThan(coins); }, { timeout: 2000 });
  expect(refused()).toBe(2);
  // the Developer boost is never installed here, so the button does nothing
  phone.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.boost });
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect(Reflect.get(body, 'boosted')).toBe(false);
  phone.thumb = stillThumb;
  // and walking off shuts it
  const paid = owned.purse.coins;
  body.resetPose({ x: 0, y: 1.2, z: -194 }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  phone.client.act({ kind: 'buy', seq: 0, good: whetstone + 1 });
  await vi.waitFor(() => { expect(refused()).toBe(3); }, { timeout: 2000 });
  expect(owned.purse.coins).toBe(paid);
});


test('only authored discoveries enter a dedicated quest book', async () => {
  bench = await roomBench();
  const phone = bot('device:explorer');
  expect(await phone.arrived()).toBe(true);
  const room = roomOf(), body = room.bodyOf('device:explorer');
  if (body === undefined) throw new Error('No body');
  for (let index = 0; index < 1000; index++) actRoutes(room.host).seen?.(body.id, `seen:invented-${String(index)}`);
  expect(questBooks(room.host).exportOf(body.id).flags.filter(flag => flag.startsWith('seen:invented-'))).toEqual([]);
});

test('every climate operation is removed before dedicated world routing', async () => {
  bench = await roomBench(); const phone = bot('device:sky');
  expect(await phone.arrived()).toBe(true);
  const room = roomOf(), routes = actRoutes(room.host), changed: string[] = [];
  routes.time = name => { changed.push(name); }; routes.day = () => { changed.push('day'); };
  for (const op of ['force', 'time', 'day'] as const) phone.client.act({ kind: 'climate', seq: 0, op, name: 'night', at: 0.1 });
  await vi.waitFor(() => { expect(room.net.stats.refused).toBe(3); }, { timeout: 2000 });
  expect(changed).toEqual([]);
});

test('authored scene-relative discovery reaches the wire while distant positioned discovery does not', async () => {
  bench = await roomBench(); const phone = bot('device:relative'); expect(await phone.arrived()).toBe(true);
  const room = roomOf(), body = room.bodyOf('device:relative'); if (body === undefined) throw new Error('No player');
  phone.client.act({ kind: 'interact', seq: 0, id: 'seen:vista' }); phone.client.act({ kind: 'interact', seq: 0, id: 'seen:cave' });
  await vi.waitFor(() => { expect(questBooks(room.host).exportOf(body.id).flags).toContain('seen:cave'); }, { timeout: 1500 });
  expect(questBooks(room.host).exportOf(body.id).flags).not.toContain('seen:vista');
});

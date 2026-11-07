import { afterEach, expect, test, vi } from 'vitest';
import type { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { tcpPuller, type TcpPuller } from './fixtures/tcpPuller';

// E7.3b, J114: a phone in a tunnel, on the real clock and the real 30 s: a proxy stops forwarding and neither end is told. Only the silence says so.
const SHARD = 'driftwood-isle', A = 'device:a', B = 'device:b', HIT = 10;
let bench: RoomBench | undefined, puller: TcpPuller | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const bot of bots.splice(0)) bot.drop(); await puller?.close(); await bench?.close(); bench = undefined; puller = undefined; });
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
const until = (done: () => boolean, timeout = 40_000): Promise<void> => vi.waitFor(() => { expect(done()).toBe(true); }, { timeout, interval: 20 });
async function join(url: string, device: string, ledger = 0): Promise<RoomBot> {
  const bot = new RoomBot(url, 'bench', device, device, ledger); bots.push(bot);
  expect(await bot.arrived()).toBe(true);
  return bot;
}
const roomOf = (): DedicatedRoom => { const room = bench?.room(SHARD); if (room === undefined) throw new Error('No room'); return room; };
function bodyOf(room: DedicatedRoom): NonNullable<ReturnType<DedicatedRoom['bodyOf']>> {
  const body = room.bodyOf(A);
  if (body === undefined) throw new Error('No body');
  return body;
}

test('20 s under: the same body, its health less the hit, its pack. 40 s under: back where it stood', { timeout: 150_000 }, async () => {
  bench = await roomBench();
  puller = await tcpPuller(bench.url.replace(/\/$/u, ''));
  const through = `${puller.url}/`, a = await join(through, A), b = await join(bench.url, B), room = roomOf(), body = bodyOf(room), bid = body.id;
  room.cell.owned.of(bid).file({ grant: 'coins', name: 'coins', amount: 9 });
  room.cell.owned.of(bid).file({ grant: 'item', name: 'cape', amount: 1 });
  const place = { x: body.position.x + 2, y: body.position.y + 0.3, z: body.position.z };
  body.resetPose(place, 0);
  await sleep(300);
  const stood = body.position.clone(), full = body.health.attributes.health;
  // under
  const under = performance.now(), heard = b.client.entities.size;
  puller.pull();
  await until(() => room.holding === 1);
  expect((performance.now() - under) / 1000, 'J114: 3 s of silence ends the socket').toBeLessThan(4.5);
  expect(room.taken).toBe(2);
  expect(room.host.players.get(bid), 'the body stays').toBe(body);
  expect(b.client.entities.size, 'and the other phone still sees it').toBe(heard);
  await sleep(20_000 - (performance.now() - under));
  // it can be hit, and a body heals as it stands, so the blow comes last
  body.health.attributes.health = full - HIT;
  puller.restore();
  const back = await join(through, A, a.client.ledgerSerial);
  expect(a.closed === null || a.closed === 'lost' || a.closed === 'stalled').toBe(true);
  expect(room.holding).toBe(0);
  expect(bodyOf(room), 'the same body').toBe(body);
  expect(body.position.distanceTo(stood)).toBeLessThan(0.5);
  expect(body.health.attributes.health).toBeGreaterThanOrEqual(full - HIT);
  expect(body.health.attributes.health).toBeLessThan(full);
  expect(room.cell.owned.of(bid).owned.has('cape')).toBe(true);
  expect(room.cell.owned.of(bid).purse.coins).toBe(9);
  // under again, past the hold
  const then = body.position.clone(), gone = performance.now();
  puller.pull();
  await sleep(29_000);
  body.health.attributes.health = full - HIT;
  await until(() => !room.holds(A));
  const heldFor = (performance.now() - gone) / 1000;
  expect(heldFor, 'real time, not 33 s').toBeGreaterThan(29);
  expect(heldFor).toBeLessThan(31.5);
  expect(room.holds(B), 'the other phone stays').toBe(true);
  await sleep(40_000 - (performance.now() - gone));
  puller.restore();
  const third = await join(through, A, back.client.ledgerSerial);
  expect(JSON.parse(third.resume ?? '{}').at.x).toBeCloseTo(then.x, 0);
  const again = bodyOf(room);
  expect(again.position.distanceTo(then)).toBeLessThan(0.5);
  expect(again.health.attributes.health, 'the save has the hurt body').toBeLessThan(full);
  expect(room.cell.owned.of(again.id).purse.coins).toBe(9);
  expect(room.cell.owned.of(again.id).owned.has('cape')).toBe(true);
  console.info(`hold: socket closed under 4.5 s, seat freed after ${heldFor.toFixed(1)} s`);
});

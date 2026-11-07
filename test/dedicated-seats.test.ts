import { afterEach, expect, test, vi } from 'vitest';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import type { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb, type BotThumb } from './fixtures/dedicated/roomBot';

// E7.3a: two socket clients on Driftwood's real room: each falls and comes back, each kill pays only its killer, and a player gone past
// their hold comes back to a seat whose swing lands. Rooms run on the real clock, so nothing here is a lockstep.
let bench: RoomBench | undefined;
const bots: RoomBot[] = [], SHARD = 'driftwood-isle', HOLD_MS = 200;
const join = async (device: string): Promise<RoomBot> => {
  const made = new RoomBot(bench?.url ?? '', 'bench', device, device); bots.push(made);
  expect(await made.arrived()).toBe(true);
  return made;
};
const roomOf = (): DedicatedRoom => { const room = bench?.room(SHARD); if (room === undefined) throw new Error('No room'); return room; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
/** The way a body at a creature's +x faces it. */
const FACE = Math.PI / 2;
const swinging = (target: string): BotThumb => tick => ({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: FACE, pitch: 0, buttons: 0,
  ...(tick % 20 === 0 ? { attack: { targetId: target, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) });
/** Stand `device` beside a held creature it has not fought, and hand back its id. */
function beside(room: DedicatedRoom, device: string, fought: Set<string>): string {
  const [id, creature] = [...room.host.entities].find(([name, sim]) => !fought.has(name) && sim.alive) ?? [];
  const body = room.bodyOf(device);
  if (id === undefined || creature === undefined || body === undefined) throw new Error('No creature');
  fought.add(id);
  creature.harnessHold = true;
  body.resetPose({ x: creature.position.x + 1.2, y: creature.position.y + 0.2, z: creature.position.z }, FACE);
  return id;
}
/** Kill creatures until one pays: a kill may roll nothing. */
async function earn(room: DedicatedRoom, bot: RoomBot, device: string, fought: Set<string>): Promise<void> {
  const line = OWNED_ROW.coins, before = bot.coins(line);
  await vi.waitFor(async () => {
    const id = beside(room, device, fought), body = room.host.entities.get(id);
    bot.thumb = swinging(id);
    await vi.waitFor(() => { expect(body?.alive).toBe(false); }, { timeout: 12_000, interval: 20 });
    await new Promise(resolve => { setTimeout(resolve, 200); });
    expect(bot.coins(line)).toBeGreaterThan(before);
  }, { timeout: 45_000, interval: 20 });
  bot.thumb = stillThumb;
}

test('each falls and comes back, each purse is its own, and a return past the hold still swings', { timeout: 120_000 }, async () => {
  bench = await roomBench({ holdMs: HOLD_MS });
  const a = await join('device:a'), b = await join('device:b'), room = roomOf();
  expect(room.bodyOf('device:a')?.id).toBe('actor.player');
  expect(room.bodyOf('device:b')?.id).toMatch(/^p\.[a-f0-9]{20}$/u);
  // a fall: not only the lead's
  for (const device of ['device:a', 'device:b']) {
    const body = room.bodyOf(device);
    if (body === undefined) throw new Error('No body');
    await vi.waitFor(() => { expect(body.fall.grounded).toBe(true); }, { timeout: 5000 });
    body.position.set(body.position.x, -251, body.position.z); body.motor.resetAt(body.position); body.fall.grounded = false;
    await vi.waitFor(() => { expect(body.position.y).toBeGreaterThan(-200); }, { timeout: 5000, interval: 5 });
    expect(room.host.respawn.falls(body.id)).toBe(0);
  }
  // each kill pays only who struck it
  const coins = OWNED_ROW.coins, fought = new Set<string>();
  await earn(room, a, 'device:a', fought);
  await new Promise(resolve => { setTimeout(resolve, 600); });
  const paidA = a.coins(coins);
  expect(b.coins(coins)).toBe(0);
  room.bodyOf('device:a')?.resetPose({ x: 0, y: 1.2, z: -194 }, 0);
  await earn(room, b, 'device:b', fought);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  expect(a.coins(coins)).toBe(paidA);
  // gone past the hold, with the other still here
  a.drop();
  await vi.waitFor(() => { expect(room.holds('device:a')).toBe(false); }, { timeout: 5000, interval: 10 });
  expect(room.holds('device:b')).toBe(true);
  expect(room.host.parked.has('actor.player')).toBe(true);
  const back = await join('device:a');
  expect(room.bodyOf('device:a')?.id).toBe('actor.player');
  expect(room.host.parked.has('actor.player')).toBe(false);
  const third = beside(room, 'device:a', fought), target = room.host.entities.get(third), hp = target?.hp ?? 0, hits: unknown[] = [];
  back.client.onCombat(event => { if (event.kind === 'hit' && event.confirmFor !== 0) hits.push(event); });
  back.thumb = swinging(third);
  await vi.waitFor(() => { expect(target?.hp ?? hp).toBeLessThan(hp); }, { timeout: 15_000, interval: 20 });
  await vi.waitFor(() => { expect(hits.length).toBeGreaterThan(0); }, { timeout: 5000, interval: 20 });
});

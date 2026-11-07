import { afterEach, expect, test, vi } from 'vitest';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { openPglite } from './fixtures/pgliteDatabase';

// E7.4b, as far as a laptop goes: SIGTERM's path on real Postgres. Everyone is saved and told `restart`, a new gateway boots a fresh world, and each phone comes back with what it had.
const SHARD = 'driftwood-isle', closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
async function bench(saves: ReturnType<typeof playerSavesOver>): Promise<RoomBench> { const made = await roomBench({ saves }); closers.push(made.close); return made; }
async function join(on: RoomBench, device: string, ledger = 0): Promise<RoomBot> {
  const bot = new RoomBot(on.url, 'bench', device, device, ledger);
  closers.push(() => { bot.drop(); return Promise.resolve(); });
  expect(await bot.arrived()).toBe(true);
  return bot;
}

test('a drain saves both phones, and a fresh world gives them back', { timeout: 60_000 }, async () => {
  const db = await openPglite();
  closers.push(db.close);
  await migrate(db);
  const saves = playerSavesOver(db, 0, () => undefined), first = await bench(saves), a = await join(first, 'device:a'), b = await join(first, 'device:b');
  const room = first.room(SHARD), bodyA = room?.bodyOf('device:a'), bodyB = room?.bodyOf('device:b');
  if (room === undefined || bodyA === undefined || bodyB === undefined) throw new Error('No room');
  room.cell.owned.of(bodyA.id).file({ grant: 'coins', name: 'coins', amount: 11 });
  room.cell.owned.of(bodyB.id).file({ grant: 'coins', name: 'coins', amount: 22 });
  bodyB.resetPose({ x: bodyB.position.x + 3, y: bodyB.position.y + 0.2, z: bodyB.position.z }, 0);
  await new Promise(resolve => { setTimeout(resolve, 200); });
  const stood = bodyB.position.clone();
  expect(await first.world.drain()).toBe(true);
  expect([await a.ended(), await b.ended()]).toEqual(['restart', 'restart']);
  const { rows } = await db.query('select reason, seq from player_save order by player_id');
  expect(rows).toEqual([{ reason: 'restart', seq: 1 }, { reason: 'restart', seq: 1 }]);
  const second = await bench(saves), backA = await join(second, 'device:a'), backB = await join(second, 'device:b');
  expect(JSON.parse(backB.resume ?? '{}').at.x).toBeCloseTo(stood.x, 1);
  await vi.waitFor(() => { expect(backA.coins(OWNED_ROW.coins)).toBe(11); expect(backB.coins(OWNED_ROW.coins)).toBe(22); }, { timeout: 5000 });
  expect(second.room(SHARD)?.bodyOf('device:b')?.position.distanceTo(stood)).toBeLessThan(0.5);
});

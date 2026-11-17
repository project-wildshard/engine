import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { expireGuests, guestExpiryDays, startGuestExpiry } from '../src/server/host/dedicated/saves/expiry';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { grantProfile } from '../src/server/host/dedicated/saves/profile';
import { writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { openPglite } from './fixtures/pgliteDatabase';

// MMO-PLAN MP2.3 (Q33: "Guest ids expire after 7 idle days"; Q30: "unclaimed ids can expire way faster"): a guest (a `device:` id)
// nobody has seen for the idle days goes, with its saves, receipts, place and platform grants. Accounts never expire here (MP2.5
// owns deleting one). Switching it on is Jake's (it deletes every Friends-grid guest idle that long): `GUEST_EXPIRY_DAYS` unset is off.
const SHARD = 'driftwood-isle', DAY_MS = 86_400_000, NOW = Date.parse('2026-11-20T03:00:00Z');
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); vi.useRealTimers(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const save = (player: string): SaveWrite => ({ player, name: 'Ann', shard: SHARD, cell: SHARD, build: 'b1', saveVersion: 1, seq: 1, reason: 'checkpoint', doc: { coins: 3 }, receipts: [{ serial: 1, factId: `boot.${player}.coins`, grant: 'coins', name: 'coins', amount: 3 }] });
async function seen(db: Database, player: string, daysAgo: number): Promise<void> {
  await writeSave(db, 0, save(player));
  await db.query('update player set seen_at = $2 where id = $1', [player, new Date(NOW - daysAgo * DAY_MS).toISOString()]);
}
const ids = async (db: Database, table: string): Promise<string[]> => (await db.query(`select distinct ${table === 'player' ? 'id' : 'player_id'} as id from ${table} order by 1`)).rows.map(row => String((row as { id: unknown }).id));

test('a guest idle past the days goes whole; a fresher guest and every account stay', async () => {
  const db = await fresh();
  await seen(db, 'device:old', 8);
  await grantProfile(db, 0, 'device:old', { factId: 'title.founder', kind: 'title', name: 'founder' });
  await seen(db, 'device:recent', 6);
  await seen(db, 'account:plr_0123456789abcdef0123456789abcdef', 30);
  expect(await expireGuests(db, 7, NOW), 'one guest gone').toBe(1);
  for (const table of ['player', 'player_save', 'ledger_receipt', 'player_place']) {
    expect(await ids(db, table), table).toEqual(['account:plr_0123456789abcdef0123456789abcdef', 'device:recent']);
  }
  expect(await expireGuests(db, 7, NOW), 'nothing left to expire').toBe(0);
});

test('a sweep goes in batches until none is left', async () => {
  const db = await fresh();
  for (let i = 0; i < 5; i++) await seen(db, `device:g${String(i)}`, 9);
  expect(await expireGuests(db, 7, NOW, 2)).toBe(5);
  expect(await ids(db, 'player')).toEqual([]);
});

test('the switch: off unless GUEST_EXPIRY_DAYS names a whole number of days, at least 1', () => {
  expect(guestExpiryDays({})).toBeUndefined();
  expect(guestExpiryDays({ GUEST_EXPIRY_DAYS: '' })).toBeUndefined();
  expect(guestExpiryDays({ GUEST_EXPIRY_DAYS: 'off' })).toBeUndefined();
  expect(guestExpiryDays({ GUEST_EXPIRY_DAYS: '0' })).toBeUndefined();
  expect(guestExpiryDays({ GUEST_EXPIRY_DAYS: '1.5' })).toBeUndefined();
  expect(guestExpiryDays({ GUEST_EXPIRY_DAYS: '7' })).toBe(7);
});

test('switched on, the server sweeps an hour after boot and then nightly, and logs what went', async () => {
  vi.useFakeTimers();
  const scope = new Scope('guest expiry'), swept: number[] = [], lines: Record<string, unknown>[] = [];
  startGuestExpiry(scope, { days: 7, sweep: days => { swept.push(days); return Promise.resolve(2); }, log: line => { lines.push(line); } });
  await vi.advanceTimersByTimeAsync(3_599_000);
  expect(swept, 'not at boot').toEqual([]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(swept).toEqual([7]);
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(swept).toEqual([7, 7]);
  expect(lines).toContainEqual({ at: 'guests.expired', days: 7, players: 2 });
  scope.dispose();
  await vi.advanceTimersByTimeAsync(2 * DAY_MS);
  expect(swept, 'a stopped server sweeps no more').toHaveLength(2);
});

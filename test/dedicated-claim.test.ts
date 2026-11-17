import * as v from 'valibot';
import { afterEach, expect, test } from 'vitest';
import { claimSaves } from '../src/server/host/dedicated/saves/claim';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { readSave, writeSave, type SaveParse, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { openPglite } from './fixtures/pgliteDatabase';

// MMO-PLAN MP2.2d (MP2.3's first half): signing in on a device with guest progress moves that device's saves to the account, once.
// The door claims when a live join ticket seats `account:<player>` and names the device it came from (`ticket.ts`). An account that
// already has progress keeps it: a second device's guest progress is never merged over it, and stays that device's.
const SHARD = 'driftwood-isle', ACCOUNT = 'account:plr_0123456789abcdef0123456789abcdef';
const Doc = v.object({ coins: v.number() });
const parse: SaveParse<v.InferOutput<typeof Doc>> = doc => { const read = v.safeParse(Doc, doc); return read.success ? read.output : null; };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const save = (player: string, coins: number, overrides: Partial<SaveWrite> = {}): SaveWrite => ({ player, name: 'Ann', shard: SHARD, cell: SHARD, build: 'b1', saveVersion: 1, seq: 1, reason: 'checkpoint', doc: { coins }, receipts: [{ serial: 1, factId: `boot.${player}.coins`, grant: 'coins', name: 'coins', amount: coins }], ...overrides });
const coins = async (db: Database, player: string): Promise<number | null> => (await readSave(db, 0, player, SHARD, parse))?.doc?.coins ?? null;

test('a guest with coins in Driftwood signs in and keeps them, once', async () => {
  const db = await fresh();
  await writeSave(db, 0, save('device:phone', 12));
  expect(await claimSaves(db, 'device:phone', ACCOUNT), 'the first sign-in claims').toBe(true);
  expect(await coins(db, ACCOUNT), 'the account has the guest\'s coins').toBe(12);
  expect(await coins(db, 'device:phone'), 'and the guest no longer does').toBeNull();
  const moved = await db.query('select player_id, count(*)::int as n from ledger_receipt group by player_id');
  expect(moved.rows, 'the receipts went with the save').toEqual([{ player_id: ACCOUNT, n: 1 }]);
  const place = await db.query('select player_id, cell from player_place');
  expect(place.rows, 'and the place').toEqual([{ player_id: ACCOUNT, cell: SHARD }]);
  expect(await claimSaves(db, 'device:phone', ACCOUNT), 'a second sign-in on that device claims nothing').toBe(false);
  expect(await coins(db, ACCOUNT)).toBe(12);
});

test('a second device\'s guest progress is not merged over the account\'s', async () => {
  const db = await fresh();
  await writeSave(db, 0, save('device:phone', 12));
  await claimSaves(db, 'device:phone', ACCOUNT);
  await writeSave(db, 0, save('device:desk', 99));
  expect(await claimSaves(db, 'device:desk', ACCOUNT), 'the account has progress: nothing moves').toBe(false);
  expect(await coins(db, ACCOUNT)).toBe(12);
  expect(await coins(db, 'device:desk'), 'the desk keeps its own guest progress').toBe(99);
});

test('a device with nothing saved claims nothing, and the account is still made', async () => {
  const db = await fresh();
  expect(await claimSaves(db, 'device:new', ACCOUNT)).toBe(false);
  expect(await coins(db, ACCOUNT)).toBeNull();
});

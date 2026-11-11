import { afterEach, expect, test } from 'vitest';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { claimName } from '../src/server/host/dedicated/saves/names';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';
import { EMPTY_PROFILE, grantProfile, PLATFORM_SHARD, readProfile } from '../src/server/host/dedicated/saves/profile';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { openPglite } from './fixtures/pgliteDatabase';

// MMO-PLAN MP3.2 (M4, M6, O9, G25): one `profile` document on `player`, with no global coin. Done when only a ledger grant changes it.
const EPOCH = 1;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const receipts = async (db: Database, player: string): Promise<unknown> => (await db.query('select shard, serial, fact_id, grant_kind, name from ledger_receipt where player_id = $1 order by shard, serial', [player])).rows;

test('a new player has an empty profile, and a title grant files one receipt and adds the title once', async () => {
  const db = await fresh();
  await claimName(db, 'device:a', 'Ann');
  expect(await readProfile(db, 'device:a')).toEqual(EMPTY_PROFILE);
  expect(await readProfile(db, 'device:nobody'), 'no player, no profile').toBeNull();
  expect(await grantProfile(db, EPOCH, 'device:a', { factId: 'o9:founding-author', kind: 'title', name: 'Founding Author' })).toBe(true);
  expect(await grantProfile(db, EPOCH, 'device:a', { factId: 'o9:founding-author', kind: 'title', name: 'Founding Author' }), 'a replay is the same fact').toBe(false);
  expect(await grantProfile(db, EPOCH, 'device:a', { factId: 'cosmetic:1', kind: 'cosmetic', name: 'Shard Cape' })).toBe(true);
  expect(await grantProfile(db, EPOCH, 'device:a', { factId: 'achievement:1', kind: 'achievement', name: 'First Steps' })).toBe(true);
  expect(await readProfile(db, 'device:a')).toEqual({ titles: ['Founding Author'], cosmetics: ['Shard Cape'], achievements: ['First Steps'] });
  expect(await receipts(db, 'device:a')).toEqual([
    { shard: PLATFORM_SHARD, serial: 1, fact_id: 'o9:founding-author', grant_kind: 'title', name: 'Founding Author' },
    { shard: PLATFORM_SHARD, serial: 2, fact_id: 'cosmetic:1', grant_kind: 'cosmetic', name: 'Shard Cape' },
    { shard: PLATFORM_SHARD, serial: 3, fact_id: 'achievement:1', grant_kind: 'achievement', name: 'First Steps' },
  ]);
  // A second fact for a title already held is a receipt, and the profile still holds the title once.
  expect(await grantProfile(db, EPOCH + 1, 'device:a', { factId: 'o9:founding-author', kind: 'title', name: 'Founding Author' }), 'a new epoch files it again').toBe(true);
  expect((await readProfile(db, 'device:a'))?.titles).toEqual(['Founding Author']);
  await expect(grantProfile(db, EPOCH, 'device:nobody', { factId: 't', kind: 'title', name: 'X' }), 'a grant needs a player').rejects.toThrow();
});

test('nothing but a ledger grant changes the profile: no direct write, no save, no Name, no coin', async () => {
  const db = await fresh();
  await claimName(db, 'device:a', 'Ann');
  await grantProfile(db, EPOCH, 'device:a', { factId: 'o9:founding-author', kind: 'title', name: 'Founding Author' });
  const held = await readProfile(db, 'device:a');
  // A direct write, of a title or of a coin, is refused by the database itself.
  await expect(db.query(`update player set profile = '{"titles":["Cheater"],"cosmetics":[],"achievements":[]}' where id = 'device:a'`)).rejects.toThrow(/ledger grant/u);
  await expect(db.query(`update player set profile = profile || '{"coins":5}' where id = 'device:a'`)).rejects.toThrow();
  await expect(db.query(`insert into player (id, name, profile) values ('device:b', 'Bea', '{"titles":["Cheater"],"cosmetics":[],"achievements":[]}')`)).rejects.toThrow(/ledger grant/u);
  await expect(db.transaction(async sql => { await sql.query(`update player set profile = '{"titles":[],"cosmetics":[],"achievements":[]}' where id = 'device:a'`); })).rejects.toThrow(/ledger grant/u);
  // A shard's own grants never reach it: a save with coins and a fact, and a profile kind filed from a shard, are not profile grants.
  await writeSave(db, EPOCH, { player: 'device:a', name: 'Ann', shard: 'driftwood-isle', build: 'b', saveVersion: 1, seq: 1, reason: 'test', doc: {},
    receipts: [{ serial: 1, factId: 'kill:1', grant: 'coins', name: 'coins', amount: 50 }, { serial: 2, factId: 'fact:1', grant: 'fact', name: 'Founding Author', amount: 1 }] });
  await expect(writeSave(db, EPOCH, { player: 'device:a', name: 'Ann', shard: 'driftwood-isle', build: 'b', saveVersion: 1, seq: 2, reason: 'test', doc: {},
    receipts: [{ serial: 3, factId: 'mint', grant: 'title', name: 'Shard King', amount: 1 }] }), 'a shard cannot mint a title').rejects.toThrow();
  // A rename keeps it.
  await claimName(db, 'device:a', 'Bea');
  expect(await readProfile(db, 'device:a')).toEqual(held);
  expect((await db.query(`select count(*)::int as n from ledger_receipt where player_id = 'device:a' and grant_kind = 'title'`)).rows).toEqual([{ n: 1 }]);
});

test('no global coin: with the guard switched off, the profile still holds no key but titles, cosmetics and achievements', async () => {
  const db = await fresh();
  await claimName(db, 'device:a', 'Ann');
  await db.exec('alter table player disable trigger player_profile_guard');
  await expect(db.query(`update player set profile = profile || '{"coins":5}' where id = 'device:a'`)).rejects.toThrow(/player_profile_platform_only/u);
  await expect(db.query(`update player set profile = '{"titles":"Cheater","cosmetics":[],"achievements":[]}' where id = 'device:a'`)).rejects.toThrow(/player_profile_platform_only/u);
  expect(await readProfile(db, 'device:a')).toEqual(EMPTY_PROFILE);
});

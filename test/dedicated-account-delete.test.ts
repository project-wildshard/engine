import { afterEach, expect, test } from 'vitest';
import { deleteAccount, exportAccount } from '../src/server/host/dedicated/saves/account';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { grantProfile } from '../src/server/host/dedicated/saves/profile';
import { writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { openPglite } from './fixtures/pgliteDatabase';

// MMO-PLAN MP2.5 (delete and export): a signed-in player takes their data away, or deletes it. Deletion leaves anonymous ledger rows
// only: the account's receipts move to a fresh `deleted:` id that names nobody, and its saves, place, Name and profile go.
const SHARD = 'driftwood-isle', ACCOUNT = 'account:plr_0123456789abcdef0123456789abcdef', OTHER = 'account:plr_4567456789abcdef0123456789abcdef';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const save = (player: string, coins: number): SaveWrite => ({ player, name: 'Ann', shard: SHARD, cell: SHARD, build: 'b1', saveVersion: 1, seq: 1, reason: 'checkpoint', doc: { coins }, receipts: [{ serial: 1, factId: 'kill.1.coins', grant: 'coins', name: 'coins', amount: coins }] });
const rows = async (db: Database, sql: string): Promise<unknown[]> => [...(await db.query(sql)).rows];

test('export holds the account\'s Name, profile, saves, receipts and place, and nobody else\'s', async () => {
  const db = await fresh();
  await writeSave(db, 0, save(ACCOUNT, 12));
  await grantProfile(db, 0, ACCOUNT, { factId: 'title.founder', kind: 'title', name: 'founder' });
  await writeSave(db, 0, save(OTHER, 99));
  const data = await exportAccount(db, ACCOUNT);
  expect(data?.player).toMatchObject({ id: ACCOUNT, name: 'Ann', profile: { titles: ['founder'], cosmetics: [], achievements: [] } });
  expect(data?.saves).toEqual([expect.objectContaining({ epoch: 0, shard: SHARD, doc: { coins: 12 } })]);
  expect(data?.receipts.map(row => String(row['name'])).sort()).toEqual(['coins', 'founder']);
  expect(data?.places).toEqual([expect.objectContaining({ epoch: 0, cell: SHARD })]);
  expect(JSON.stringify(data), 'no other player in it').not.toContain(OTHER);
  expect(await exportAccount(db, 'account:plr_ffffffffffffffffffffffffffffffff'), 'an account with nothing here').toBeUndefined();
});

test('delete leaves the account\'s receipts under an id that names nobody, and nothing else of it', async () => {
  const db = await fresh();
  await writeSave(db, 0, save(ACCOUNT, 12));
  await grantProfile(db, 0, ACCOUNT, { factId: 'title.founder', kind: 'title', name: 'founder' });
  await writeSave(db, 0, save(OTHER, 99));
  expect(await deleteAccount(db, ACCOUNT)).toBe(true);
  expect(await rows(db, `select 1 from player where id = '${ACCOUNT}'`), 'the player row').toEqual([]);
  expect(await rows(db, `select 1 from player_save where player_id = '${ACCOUNT}'`), 'saves').toEqual([]);
  expect(await rows(db, `select 1 from player_place where player_id = '${ACCOUNT}'`), 'place').toEqual([]);
  const kept = await rows(db, `select player_id, name, amount from ledger_receipt where player_id <> '${OTHER}' order by name`) as { player_id: string; name: string }[];
  expect(kept.map(row => row.name), 'the ledger keeps both receipts').toEqual(['coins', 'founder']);
  expect(new Set(kept.map(row => row.player_id)).size, 'under one id').toBe(1);
  expect(kept[0]?.player_id).toMatch(/^deleted:[0-9a-f-]{36}$/u);
  expect(await rows(db, `select name, tag, profile from player where id = '${kept[0]?.player_id ?? ''}'`), 'which names nobody').toEqual([{ name: 'Deleted', tag: null, profile: { titles: [], cosmetics: [], achievements: [] } }]);
  expect(await rows(db, `select 1 from player_save where player_id = '${OTHER}'`), 'another account is untouched').toHaveLength(1);
  expect(await deleteAccount(db, ACCOUNT), 'deleting again finds nothing').toBe(false);
});

test('a guest id is never deleted through the account path', async () => {
  const db = await fresh();
  await writeSave(db, 0, save('device:phone', 3));
  await expect(deleteAccount(db, 'device:phone')).rejects.toThrow(/account/u);
  await expect(exportAccount(db, 'device:phone')).rejects.toThrow(/account/u);
});

// MP2.5f (review S2): chat reports outlive the account for moderation, and name nobody. The rule: a report keeps what was typed
// and shown (the evidence), while the deleted player's id, as reporter or speaker, becomes the same `deleted:` id its receipts
// moved to (so a moderator still sees one speaker's reports together), and a reported Name reads "Deleted".
const report = (db: Database, reporter: string, speaker: string, name: string): Promise<unknown> => db.query(
  "insert into chat_report (reporter, speaker, name, channel, typed, shown, shard, tick) values ($1, $2, $3, 'say', 'rude words', 'r*** words', $4, 1)", [reporter, speaker, name, SHARD]);

test('MP2.5f: a deleted account\'s chat reports keep the evidence under its deleted id, and its Name goes', async () => {
  const db = await fresh();
  await writeSave(db, 0, save(ACCOUNT, 12));
  await report(db, OTHER, ACCOUNT, 'Ann#1234');
  await report(db, ACCOUNT, OTHER, 'Bob#5678');
  await report(db, OTHER, 'device:phone', 'Cy#0001');
  expect(await deleteAccount(db, ACCOUNT)).toBe(true);
  const anonymous = String((await rows(db, "select id from player where id like 'deleted:%'") as { id: string }[])[0]?.id);
  expect(await rows(db, 'select reporter, speaker, name, typed, shown from chat_report order by id')).toEqual([
    { reporter: OTHER, speaker: anonymous, name: 'Deleted', typed: 'rude words', shown: 'r*** words' },
    { reporter: anonymous, speaker: OTHER, name: 'Bob#5678', typed: 'rude words', shown: 'r*** words' },
    { reporter: OTHER, speaker: 'device:phone', name: 'Cy#0001', typed: 'rude words', shown: 'r*** words' },
  ]);
  expect(JSON.stringify(await rows(db, 'select * from chat_report')), 'the account is named nowhere').not.toContain(ACCOUNT);
});

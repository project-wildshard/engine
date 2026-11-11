import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import * as v from 'valibot';
import { afterEach, expect, test } from 'vitest';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPg, savesUrl } from '../src/server/host/dedicated/saves/pgDatabase';
import { lastCell, readSave, writeSave, type SaveParse, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { SaveWriteQueue } from '../src/server/host/dedicated/saves/writeQueue';
import { openPglite } from './fixtures/pgliteDatabase';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';

// E7.4b, the store half: `0001-saves.sql` on real Postgres (PGlite), in-process, and through the shipped `pg` driver over TCP. The VPS's
// apt Postgres waits for its setup (J180).
const Doc = v.object({ coins: v.number() });
const parse: SaveParse<v.InferOutput<typeof Doc>> = doc => { const read = v.safeParse(Doc, doc); return read.success ? read.output : null; };
const write = (seq: number, coins: number, overrides: Partial<SaveWrite> = {}): SaveWrite => ({ player: 'device:a', name: 'Ann', shard: 'driftwood-isle', build: 'b1', saveVersion: 1, seq, reason: 'checkpoint', doc: { coins }, receipts: [], ...overrides });
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const cell = async (db: Database, text: string): Promise<unknown> => { const { rows } = await db.query(text); return rows[0]; };

test('migrations apply once, in order', async () => {
  const db = await openPglite();
  closers.push(db.close);
  expect([await migrate(db), await migrate(db)]).toEqual([['0001-saves.sql', '0002-report-delivery.sql', '0003-place.sql', '0004-names.sql', '0005-profile.sql'], []]);
  const { rows } = await db.query('select table_name from information_schema.tables where table_schema = \'public\' order by table_name');
  expect(rows).toEqual(['chat_report', 'ledger_receipt', 'player', 'player_place', 'player_save', 'schema_migrations'].map(table_name => ({ table_name })));
});

test('a write moves `doc` to `previous`, and an older write never lands on a newer one', async () => {
  const db = await fresh();
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse)).toBeNull();
  await writeSave(db, 0, write(1, 10));
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse)).toEqual({ doc: { coins: 10 }, source: 'doc', seq: 1, revision: 1 });
  await writeSave(db, 0, write(5, 50));
  await writeSave(db, 0, write(3, 30));
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse)).toEqual({ doc: { coins: 50 }, previous: { coins: 10 }, source: 'doc', seq: 5, revision: 2 });
  expect(await cell(db, 'select previous from player_save')).toEqual({ previous: { coins: 10 } });
  await writeSave(db, 0, write(6, 60, { name: 'Anne' }));
  expect(await cell(db, 'select name from player'), 'MP2.4: a save never renames; the Name is the door\'s claim').toEqual({ name: 'Ann' });
  expect(await readSave(db, 0, 'device:a', 'nalati-grasslands', parse), 'saves are per shard').toBeNull();
});

test('a receipt lands once, and goes in the transaction with its doc', async () => {
  const db = await fresh(), receipt = { serial: 1, factId: 'boot.12.0.coins', grant: 'coins', name: 'coins', amount: 5 };
  await writeSave(db, 0, write(1, 5, { receipts: [receipt] }));
  await writeSave(db, 0, write(2, 5, { receipts: [receipt, { ...receipt, serial: 2 }] }));
  await writeSave(db, 0, write(1, 5, { receipts: [{ ...receipt, serial: 3, factId: 'boot.13.0.coins' }] }));
  expect((await db.query('select serial::int, fact_id from ledger_receipt order by serial')).rows).toEqual([{ serial: 1, fact_id: 'boot.12.0.coins' }, { serial: 3, fact_id: 'boot.13.0.coins' }]);
  await expect(writeSave(db, 0, write(9, 99, { receipts: [{ ...receipt, serial: 9, factId: 'boot.14.0.coins', name: null as unknown as string }] }))).rejects.toThrow();
  expect((await readSave(db, 0, 'device:a', 'driftwood-isle', parse))?.doc, 'a receipt that fails takes its doc with it').toEqual({ coins: 5 });
  await expect(writeSave(db, 0, write(10, 100, { receipts: [{ ...receipt, serial: 3, factId: 'a.new.fact' }] })), 'a serial on another fact is a restarted book: loud, never a lost grant').rejects.toThrow(/ledger_receipt_pkey/u);
});

test('a corrupted `doc` boots from `previous`, and the next write cannot push the good copy out', async () => {
  const db = await fresh();
  await writeSave(db, 0, write(1, 10)); await writeSave(db, 0, write(2, 20));
  await db.exec('update player_save set doc = \'{"coins":"not a number"}\'');
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse)).toEqual({ doc: { coins: 10 }, source: 'previous', seq: 2, revision: 2 });
  expect(await cell(db, 'select doc, previous from player_save')).toEqual({ doc: { coins: 10 }, previous: { coins: 'not a number' } });
  await writeSave(db, 0, write(3, 30));
  expect(await cell(db, 'select doc, previous from player_save')).toEqual({ doc: { coins: 30 }, previous: { coins: 10 } });
  await db.exec('update player_save set doc = \'[]\', previous = \'[]\'');
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse), 'neither fit: a fresh start, and the row stays').toEqual({ doc: null, source: 'none', seq: 3, revision: 3 });
  expect(await cell(db, 'select count(*)::int as rows from player_save')).toEqual({ rows: 1 });
});

test('a read that hangs is an error, so a join cannot wait on it for ever', async () => {
  const db = await fresh(), asleep: Database = { ...db, query: async () => { await new Promise(() => { /* deliberately never answers */ }); return { rows: [] }; } };
  await expect(readSave(asleep, 0, 'device:a', 'driftwood-isle', parse)).rejects.toThrow(/over 3000 ms/u);
}, 15_000);

test('a new epoch parks every save and receipt: a fact can land again, and nothing old loads', async () => {
  const db = await fresh(), receipt = { serial: 1, factId: 'boot.12.0.coins', grant: 'coins', name: 'coins', amount: 5 };
  await writeSave(db, 0, write(4, 40, { receipts: [receipt] }));
  expect(await lastCell(db, 0, 'device:a')).toBe('driftwood-isle');
  expect(await lastCell(db, 1, 'device:a'), 'the new world has no place for them').toBeNull();
  expect(await readSave(db, 1, 'device:a', 'driftwood-isle', parse), 'parked under epoch 0').toBeNull();
  await writeSave(db, 1, write(1, 7, { receipts: [receipt] }));
  expect((await readSave(db, 0, 'device:a', 'driftwood-isle', parse))?.doc, 'the old one stands').toEqual({ coins: 40 });
  expect((await readSave(db, 1, 'device:a', 'driftwood-isle', parse))?.doc).toEqual({ coins: 7 });
  expect(await cell(db, 'select count(*)::int as rows from ledger_receipt')).toEqual({ rows: 2 });
  expect(await cell(db, 'select count(*)::int as rows from player')).toEqual({ rows: 1 });
  await db.exec('delete from player_save where epoch < 1');
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse)).toBeNull();
});

test('a player loads in the cell they last stood in', async () => {
  const db = await fresh();
  await writeSave(db, 0, write(1, 1));
  await new Promise(resolve => { setTimeout(resolve, 5); });
  await writeSave(db, 0, write(1, 1, { shard: 'nalati-grasslands' }));
  expect(await lastCell(db, 0, 'device:a')).toBe('nalati-grasslands');
});

test('ZS7: the place row is where a player resumes; a player with none resumes their newest save; only a doc that lands moves it', async () => {
  const db = await fresh(), saves = playerSavesOver(db, 0, () => undefined), at = { x: 1, y: 2, z: 3, yaw: 0 };
  expect(await saves.where('device:a'), 'a fresh player: the first cell').toBeNull();
  await writeSave(db, 0, write(1, 1));
  await db.exec('delete from player_place');
  expect(await saves.where('device:a'), 'saved before the place row: their newest save').toBe('driftwood-isle');
  await writeSave(db, 0, write(1, 1, { shard: 'open-plot-night-market', cell: 'open-plot-nw', doc: { coins: 1, at } }));
  expect(await saves.where('device:a'), 'by grid instance, not shard').toBe('open-plot-nw');
  expect(await cell(db, 'select cell, pose, reason from player_place')).toEqual({ cell: 'open-plot-nw', pose: at, reason: 'checkpoint' });
  await writeSave(db, 0, write(1, 9, { reason: 'stale' }));
  expect(await saves.where('device:a'), 'an older Driftwood doc is refused, and the player stays put').toBe('open-plot-nw');
  await writeSave(db, 0, write(2, 2, { reason: 'leave' }));
  expect(await cell(db, 'select cell, pose, reason from player_place')).toEqual({ cell: 'driftwood-isle', pose: null, reason: 'leave' });
  expect(await cell(db, 'select count(*)::int as rows from player_place'), 'one row a player and epoch').toEqual({ rows: 1 });
});

test('two channels, two databases, one local socket, and nothing for preview', () => {
  expect(savesUrl('production')).toBe('postgresql:///saves_production?host=/var/run/postgresql');
  expect(savesUrl('staging')).toBe('postgresql:///saves_staging?host=/var/run/postgresql');
  expect(() => savesUrl('preview')).toThrow(/No saves database/u);
});

test('the queue keeps the newest doc per player, writes each in order, and no tick waits', async () => {
  const landed: number[] = [], gates: (() => void)[] = [], queue = new SaveWriteQueue({ write: async row => { await new Promise<void>(resolve => { gates.push(resolve); }); landed.push(row.seq); } });
  queue.post(write(1, 1)); queue.post(write(2, 2)); queue.post(write(3, 3)); queue.post(write(4, 4));
  expect(queue.waiting).toBe(1);
  expect(queue.stats.coalesced).toBe(2);
  gates.shift()?.();
  await new Promise(resolve => { setImmediate(resolve); });
  gates.shift()?.();
  expect(await queue.drain(1000)).toBe(true);
  expect(landed, 'the second and third never went').toEqual([1, 4]);
  expect(queue.stats.written).toBe(2);
  queue.dispose();
});

test('a failed write goes again, keeps every receipt, and a drain says whether it finished', async () => {
  let failing = true;
  const landed: SaveWrite[] = [], faults: unknown[] = [], receipt = { serial: 1, factId: 'a', grant: 'coins', name: 'coins', amount: 1 };
  const queue = new SaveWriteQueue({ retryMs: 20, failed: (_write, error) => { faults.push(error); }, write: async row => { await Promise.resolve(); if (failing) throw new Error('Database gone'); landed.push(row); } });
  queue.post(write(1, 1, { receipts: [receipt] }));
  await new Promise(resolve => { setImmediate(resolve); });
  queue.post(write(2, 2, { receipts: [{ ...receipt, serial: 2, factId: 'b' }] }));
  expect(await queue.drain(60), 'still failing, and the drain ends anyway').toBe(false);
  expect(faults.length).toBeGreaterThan(0);
  failing = false;
  expect(await queue.drain(1000)).toBe(true);
  expect(landed.map(row => [row.seq, row.receipts.map(entry => entry.factId)])).toEqual([[2, ['a', 'b']]]);
  queue.dispose();
});

test('a slow player does not hold up another, and a failed one does not either', async () => {
  const landed: string[] = [], queue = new SaveWriteQueue({ retryMs: 5000, write: async row => { await Promise.resolve(); if (row.player === 'device:bad') throw new Error('Refused'); landed.push(row.player); } });
  queue.post(write(1, 1, { player: 'device:bad' })); queue.post(write(1, 1, { player: 'device:good' }));
  await new Promise(resolve => { setTimeout(resolve, 20); });
  expect(landed).toEqual(['device:good']);
  expect(queue.waiting).toBe(1);
  queue.dispose();
});

test('the shipped `pg` driver over TCP: migrations, writes, a corrupt doc, and a transaction that fails', async () => {
  const held = await openPglite(), server = new PGLiteSocketServer({ db: held.pglite, port: 0, host: '127.0.0.1' });
  await server.start();
  const { port } = server as unknown as { port: number }, url = new URL(`postgresql://127.0.0.1:${String(port)}/postgres`);
  url.username = 'postgres'; url.searchParams.set('sslmode', 'disable');
  const db = openPg(url.href);
  closers.push(async () => { await db.close(); await server.stop(); await held.close(); });
  expect(await migrate(db)).toEqual(['0001-saves.sql', '0002-report-delivery.sql', '0003-place.sql', '0004-names.sql', '0005-profile.sql']);
  await writeSave(db, 0, write(1, 10, { receipts: [{ serial: 1, factId: 'a', grant: 'coins', name: 'coins', amount: 2.5 }] }));
  await writeSave(db, 0, write(2, 20));
  expect(await readSave(db, 0, 'device:a', 'driftwood-isle', parse), '`pg` reads a bigint as a string').toEqual({ doc: { coins: 20 }, previous: { coins: 10 }, source: 'doc', seq: 2, revision: 2 });
  await db.exec('update player_save set doc = \'{}\'');
  expect((await readSave(db, 0, 'device:a', 'driftwood-isle', parse))?.doc).toEqual({ coins: 10 });
  await expect(db.transaction(async sql => { await sql.exec('update player set name = \'Gone\''); throw new Error('Rolled back'); })).rejects.toThrow('Rolled back');
  expect((await db.query('select name from player')).rows).toEqual([{ name: 'Ann' }]);
});

import { expect, test } from 'vitest';
import { openPglite } from './fixtures/pgliteDatabase';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';
import { doc, write } from './fixtures/dedicatedSaveSafety';

// TEST-SPEED TS5 (J255): dedicated-save-safety was 27-35 s hosted. Some cases moved to dedicated-save-safety-admission.test.ts; the helpers are in test/fixtures/dedicatedSaveSafety.ts.
test('previous recovery carries the durable grants that its document predates', async () => {
  const db = await openPglite(); await migrate(db);
  const saves = playerSavesOver(db, 0, () => undefined);
  try {
    await writeSave(db, 0, write(1, doc()));
    await writeSave(db, 0, write(2, { ...doc(), ledger: { serial: 1, rows: [] } }, [{ serial: 1, factId: 'bootA.1', grant: 'coins', name: 'coins', amount: 5 }]));
    await db.exec("update player_save set doc = '\"bad\"'::jsonb");
    const read = await saves.read('device:a', 'driftwood-isle');
    expect(read).toMatchObject({ seq: 2, recovery: [{ serial: 1, factId: 'bootA.1', grant: 'coins', amount: 5 }] });
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('a timed-out pending save refuses admission instead of returning an older row', async () => {
  const db = await openPglite(); await migrate(db);
  let unlock: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const saves = playerSavesOver({ ...db, transaction: async work => { await gate; return db.transaction(work); } }, 0, () => undefined);
  try {
    await writeSave(db, 0, write(1, doc())); saves.write(write(2, doc(20)));
    await expect(saves.read('device:a', 'driftwood-isle')).rejects.toThrow(/pending/u);
  } finally { unlock(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('chat reports retry a transient database failure and join shutdown draining', async () => {
  const db = await openPglite(); await migrate(db);
  let failures = 1;
  const saves = playerSavesOver({ ...db, query: async (text, params) => {
    if (text.startsWith('insert into chat_report') && failures-- > 0) throw new Error('Database restarting');
    const result = await db.query(text, params); return result;
  } }, 0, () => undefined);
  try {
    saves.report({ reporter: 'a', speaker: 'b', name: 'B', channel: 'room', typed: 'raw', shown: 'shown', tick: 1 }, 'shard');
    expect(await saves.drain(2000)).toBe(true);
    expect((await db.query('select typed from chat_report')).rows).toEqual([{ typed: 'raw' }]);
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('shutdown waits for a report already in flight', async () => {
  const db = await openPglite(); await migrate(db);
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saves = playerSavesOver({ ...db, query: async (text, params) => { if (text.startsWith('insert into chat_report')) await gate; return db.query(text, params); } }, 0, () => undefined);
  try {
    saves.report({ reporter: 'a', speaker: 'b', name: 'B', channel: 'room', typed: 'raw', shown: 'shown', tick: 1 }, 'shard');
    expect(await saves.drain(20)).toBe(false);
    release(); expect(await saves.drain(1000)).toBe(true);
    expect((await db.query('select count(*)::int as count from chat_report')).rows).toEqual([{ count: 1 }]);
  } finally { release(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});


test('a retry after an ambiguous report commit inserts one durable row', async () => {
  const db = await openPglite(); await migrate(db); let ambiguous = true;
  const saves = playerSavesOver({ ...db, query: async (text, params) => {
    const result = await db.query(text, params);
    if (text.startsWith('insert into chat_report') && ambiguous) { ambiguous = false; throw new Error('Connection lost after commit'); }
    return result;
  } }, 0, () => undefined);
  try {
    saves.report({ reporter: 'a', speaker: 'b', name: 'B', channel: 'room', typed: 'raw', shown: 'shown', tick: 1 }, 'shard');
    expect(await saves.drain(2000)).toBe(true);
    expect((await db.query('select count(*)::int as count from chat_report')).rows).toEqual([{ count: 1 }]);
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('unusable documents and orphaned receipts cannot create a writable fresh player', async () => {
  const db = await openPglite(); await migrate(db);
  const saves = playerSavesOver(db, 0, () => undefined);
  try {
    await writeSave(db, 0, write(1, doc(), [{ serial: 1, factId: 'kept', grant: 'coins', name: 'coins', amount: 5 }]));
    await db.exec("update player_save set doc = '\"corrupt\"'::jsonb, previous = '\"corrupt\"'::jsonb");
    await expect(saves.read('device:a', 'driftwood-isle')).rejects.toThrow(/quarantined/u);
    await db.exec('delete from player_save');
    await expect(saves.read('device:a', 'driftwood-isle')).rejects.toThrow(/receipts without a document/u);
    expect((await db.query('select count(*)::int as count from ledger_receipt')).rows).toEqual([{ count: 1 }]);
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

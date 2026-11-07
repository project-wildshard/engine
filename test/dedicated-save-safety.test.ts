import { expect, test } from 'vitest';
import { openPglite } from './fixtures/pgliteDatabase';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import type { PlayerDoc } from '../src/server/host/dedicated/playerDoc';

const doc = (x = 5): PlayerDoc => ({ at: { x, y: 1, z: 0, yaw: 0 }, health: { state: { version: 1, attributes: { health: 100, maxHealth: 100 }, effectTags: [], cause: null, previousMode: 'foot' }, sinceHurt: 0 }, book: { player: 'body', flags: [], quests: [], parts: {} }, respawn: null, seats: [], store: {}, ledger: { serial: 0, rows: [] } });
const write = (seq: number, saved: PlayerDoc, receipts: SaveWrite['receipts'] = []): SaveWrite => ({ player: 'device:a', name: 'A', shard: 'driftwood-isle', build: 'bench', saveVersion: 1, seq, reason: 'test', doc: saved, receipts });

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

test('another player can join while one player has a blocked checkpoint', async () => {
  const db = await openPglite(); await migrate(db);
  let release: () => void = () => undefined; const gate = new Promise<void>(resolve => { release = resolve; });
  const saves = playerSavesOver({ ...db, transaction: async work => { await gate; return db.transaction(work); } }, 0, () => undefined);
  try {
    saves.write(write(1, doc()));
    expect(await saves.read('device:b', 'driftwood-isle')).toMatchObject({ doc: null, seq: 0 });
    expect(saves.queue.waiting).toBe(1);
  } finally { release(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('report backlog refusal is bounded and visible without losing accepted reports', async () => {
  const db = await openPglite(); await migrate(db);
  let release: () => void = () => undefined; const gate = new Promise<void>(resolve => { release = resolve; });
  const logs: Record<string, unknown>[] = [];
  const saves = playerSavesOver({ ...db, query: async (text, params) => { if (text.startsWith('insert into chat_report')) await gate; return db.query(text, params); } }, 0, row => { logs.push(row); });
  const report = { reporter: 'a', speaker: 'b', name: 'B', channel: 'room' as const, typed: 'raw', shown: 'shown', tick: 1 };
  try {
    for (let index = 0; index < 1024; index++) expect(saves.report(report, 'shard')).toBe(true);
    expect(saves.report(report, 'shard')).toBe(false);
    expect(saves.stats?.()).toMatchObject({ reportsWaiting: 1024, reportsRefused: 1 });
    expect(logs).toContainEqual({ at: 'report.refused', reason: 'backlog' });
    expect(await saves.drain(20)).toBe(false);
    release(); expect(await saves.drain(5000)).toBe(true);
    expect((await db.query('select count(*)::int as count from chat_report')).rows).toEqual([{ count: 1024 }]);
  } finally { release(); await saves.drain(5000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('where refuses a timed-out save instead of returning an older location', { timeout: 9000 }, async () => {
  const db = await openPglite(); await migrate(db); let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saves = playerSavesOver({ ...db, transaction: async work => { await gate; return db.transaction(work); } }, 0, () => undefined);
  try {
    await writeSave(db, 0, write(1, doc())); saves.write(write(2, doc(20)));
    expect(await saves.where('device:stranger')).toBeNull();
    await expect(saves.where('device:a')).rejects.toThrow(/pending/u);
  } finally { release(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('two bad copies with no receipts still refuse fresh admission', async () => {
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined);
  try {
    await writeSave(db, 0, write(1, doc()));
    await db.exec("update player_save set doc = '\"bad\"'::jsonb, previous = '\"bad\"'::jsonb");
    await expect(saves.read('device:a', 'driftwood-isle')).rejects.toThrow(/quarantined/u);
    expect((await db.query('select count(*)::int as count from ledger_receipt')).rows).toEqual([{ count: 0 }]);
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('a hung fallback promotion times out instead of holding admission', { timeout: 9000 }, async () => {
  const db = await openPglite(); await migrate(db); let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; }); let healing: Promise<unknown> = Promise.resolve();
  const saves = playerSavesOver({ ...db, query: (text, params) => {
    if (!text.startsWith('update player_save set doc = previous')) return db.query(text, params);
    const pending = gate.then(() => db.query(text, params)); healing = pending; return pending;
  } }, 0, () => undefined);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await writeSave(db, 0, write(1, doc())); await writeSave(db, 0, { ...write(2, doc()), doc: 'damaged' });
    const result = (async (): Promise<string> => { try { await saves.read('device:a', 'driftwood-isle'); return 'resolved'; } catch (error) { return String(error); } })();
    expect(await Promise.race([result, new Promise<string>(resolve => { deadline = setTimeout(() => { resolve('hung'); }, 3500); })])).toContain('over 3000 ms');
  } finally { clearTimeout(deadline); release(); await healing; saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

import { expect, test } from 'vitest';
import { openPglite } from './fixtures/pgliteDatabase';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';
import { doc, write } from './fixtures/dedicatedSaveSafety';

// TEST-SPEED TS5 (J255): dedicated-save-safety was 27-35 s hosted. Split from dedicated-save-safety.test.ts by case; bodies unchanged.
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

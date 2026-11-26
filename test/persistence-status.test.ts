import { afterEach, expect, test } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { playerSavesOver, memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import type { PersistenceStatus } from '../src/server/host/dedicated/saves/persistenceStatus';
import type { Database } from '../src/server/host/dedicated/saves/database';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPglite } from './fixtures/pgliteDatabase';
import { openPg } from '../src/server/host/dedicated/saves/pgDatabase';
import { ownedPostgres } from '../src/scripts/online-rig-owned.mjs';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const write = (seq: number, reason = 'checkpoint'): SaveWrite => ({ player: 'fixture-player', name: 'Fixture', shard: 'fixture', build: 'fixture', saveVersion: 1, seq, reason, doc: {}, receipts: [] });
function gate(): { readonly promise: Promise<boolean>; readonly resolve: (value: boolean) => void } {
  let resolve: (value: boolean) => void = () => { throw new Error('unbound gate'); };
  const promise = new Promise<boolean>(open => { resolve = open; });
  return { promise, resolve };
}
async function database(): Promise<Database> {
  const bin = process.env['FAILMODE_PG_BIN'];
  if (bin === undefined) { const db = await openPglite(); cleanups.push(db.close); await migrate(db); return db; }
  const probe = createServer(), listening = once(probe, 'listening');
  probe.listen(0, '127.0.0.1'); await listening;
  const address = probe.address(); await probe[Symbol.asyncDispose]();
  if (address === null || typeof address === 'string') throw new Error('Missing owned database port');
  const work = mkdtempSync(resolve('tmp/codex-pagesize/native-status-'));
  const pg = (() => {
    try { return ownedPostgres({ bin, data: resolve(work, 'data'), port: address.port }); }
    catch (error) { rmSync(work, { recursive: true, force: true }); throw error; }
  })();
  const db = openPg(`postgres://postgres@127.0.0.1:${String(address.port)}/postgres`, () => undefined);
  cleanups.push(async () => { try { await db.close(); } finally { try { pg.close(); } finally { rmSync(work, { recursive: true, force: true }); } } });
  expect((await db.query("select current_setting('data_directory') as data")).rows).toEqual([{ data: pg.data }]);
  await migrate(db); return db;
}
function observe(db: Database): { readonly saves: ReturnType<typeof playerSavesOver>; readonly events: PersistenceStatus[] } {
  const saves = playerSavesOver(db, 0, () => undefined), events: PersistenceStatus[] = [];
  cleanups.push(() => { saves.queue.dispose(); saves.reports.dispose(); });
  saves.onSave?.(status => { events.push(status); });
  return { saves, events };
}

test('queued and held transaction work is not a durable confirmation', async () => {
  const db = await database(), entered = gate(), release = gate();
  const held: Database = { query: db.query, exec: db.exec, close: db.close,
    transaction: async work => db.transaction(async sql => { const result = await work(sql); entered.resolve(true); await release.promise; return result; }) };
  const { saves, events } = observe(held);
  try {
    expect(saves.write(write(1))).toBeUndefined();
    await entered.promise; expect(events).toEqual([]);
  } finally { release.resolve(true); }
  expect(await saves.drain(10000)).toBe(true);
  expect(events).toEqual([{ player: 'fixture-player', shard: 'fixture', sequence: 1, code: 'save-confirmed' }]);
  expect((await db.query('select seq::int from player_save')).rows).toEqual([{ seq: 1 }]);
});

test('a real database refusal reports failure; a later successful transaction clears it with its own sequence', async () => {
  const db = await database();
  await db.exec("alter table player_save add constraint fixture_refusal check (reason <> 'refuse-fixture')");
  const { saves, events } = observe(db), failed = gate();
  saves.onSave?.(status => { if (status.code === 'save-failed') failed.resolve(true); });
  saves.write(write(1, 'refuse-fixture'));
  await failed.promise;
  expect((await db.query('select seq from player_save')).rows).toEqual([]);
  expect(events).toEqual([{ player: 'fixture-player', shard: 'fixture', sequence: 1, code: 'save-failed' }]);
  saves.write(write(2));
  expect(await saves.drain(10000)).toBe(true);
  expect(events.at(-1)).toEqual({ player: 'fixture-player', shard: 'fixture', sequence: 2, code: 'save-confirmed' });
});

test('a completed stale write and a memory-only store never claim a new durable checkpoint', async () => {
  const { saves, events } = observe(await database());
  saves.write(write(5)); expect(await saves.drain(10000)).toBe(true);
  saves.write(write(3)); expect(await saves.drain(10000)).toBe(true);
  expect(saves.queue.stats.written).toBe(2);
  expect(events.map(event => event.sequence)).toEqual([5]);
  expect(memoryPlayerSaves().onSave).toBeUndefined();
});

test('lost commit acknowledgement stays unknown on stale retry; only a newly acknowledged document confirms', async () => {
  const db = await database(); let lose = true;
  const faulty: Database = { query: db.query, exec: db.exec, close: db.close, transaction: async work => {
    const result = await db.transaction(work);
    if (lose) { lose = false; throw new Error('fixture loses commit acknowledgement'); }
    return result;
  } };
  const { saves, events } = observe(faulty);
  saves.write(write(1)); expect(await saves.drain(10000)).toBe(true);
  expect((await db.query('select seq::int from player_save')).rows).toEqual([{ seq: 1 }]);
  expect(events.map(event => event.code)).toEqual(['save-failed']);
  saves.write(write(2)); expect(await saves.drain(10000)).toBe(true);
  expect(events.at(-1)).toEqual({ player: 'fixture-player', shard: 'fixture', sequence: 2, code: 'save-confirmed' });
});

test('observer failure cannot roll back a committed write or prevent another observer', async () => {
  const { saves, events } = observe(await database());
  saves.onSave?.(() => { throw new Error('fixture observer fails'); });
  const later: PersistenceStatus[] = [];
  saves.onSave?.(status => { later.push(status); });
  saves.write(write(1)); expect(await saves.drain(10000)).toBe(true);
  expect(saves.queue.stats.failed).toBe(0); expect(later).toEqual(events);
  expect(events[0]?.code).toBe('save-confirmed');
});

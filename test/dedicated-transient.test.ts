import { expect, test, vi } from 'vitest';
import { Redial } from '../src/client/engine/net/redial';
import { WebSocketTransport } from '../src/client/engine/net/webSocketTransport';
import { memoryPlayerSaves, playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { roomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { closeCode } from '../src/shared/engine/net/socketFrames';
import { openPglite } from './fixtures/pgliteDatabase';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';

test.each(['bad copies', 'orphaned receipts'])('quarantine closes the actual socket refused for %s', { timeout: 9000 }, async damage => {
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined), door = await gatewayDoor({ saves });
  try {
    await writeSave(db, 0, { player: 'device:quarantine', name: 'Q', shard: 'driftwood-isle', build: 'bench', saveVersion: 1, seq: 1, reason: 'test', doc: 'damaged', receipts: [{ serial: 1, factId: 'kept', grant: 'coins', name: 'coins', amount: 5 }] });
    if (damage === 'orphaned receipts') await db.exec('delete from player_save');
    expect(await door.admit('203.0.113.30', 'device:quarantine')).toBe(false);
    expect(door.closes.at(-1)).toBe(closeCode('refused'));
  } finally { await door.close(); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('a transient save failure retries the real join without a reload', { timeout: 9000 }, async () => {
  const saves = memoryPlayerSaves(); let failed = false, dials = 0;
  const bench = await roomBench({ saves: { ...saves, where: async device => { if (!failed) { failed = true; throw new Error('Database restarting'); } const last = await saves.where(device); return last; } } });
  const bot = new RoomBot(bench.url, 'bench', 'device:retry'); const transports: WebSocketTransport[] = [];
  const redial = new Redial({ client: bot.client, transport: bot.transport, onState: () => undefined, random: () => 0.5,
    dial: () => { dials++; const transport = new WebSocketTransport(bench.url); transports.push(transport); transport.onControl(control => { if (control === 'resume') transport.control('ready'); }); return transport; } });
  try {
    await vi.waitFor(() => { expect(bot.client.latest).not.toBeNull(); }, { timeout: 2500 });
    expect(bot.closed).toBe('retry'); expect(dials).toBe(1); expect(bench.world.health().players).toBe(1);
  } finally { redial.dispose(); for (const transport of transports) transport.close(); bot.drop(); await bench.close(); }
});

test('the gateway carries recovered grants into the actual room and next save', { timeout: 9000 }, async () => {
  const { exportPlayer } = await import('../src/server/host/dedicated/playerDoc');
  const { OWNED_ROW } = await import('../src/shared/game/loot/ownedRows');
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined), bench = await roomBench({ saves, newsDelayMs: 100 });
  const seed = new RoomBot(bench.url, 'bench', 'device:seed');
  let back: RoomBot | undefined;
  try {
    expect(await seed.arrived()).toBe(true);
    const room = bench.room('driftwood-isle'), body = room?.bodyOf('device:seed');
    if (room === undefined || body === undefined) throw new Error('No source room');
    const doc = exportPlayer(room.host, body, { store: {}, ledger: { serial: 0, rows: [] } });
    const write = { player: 'device:recover-door', name: 'R', shard: 'driftwood-isle', build: 'bench', saveVersion: 1, reason: 'test', receipts: [] };
    await writeSave(db, 0, { ...write, seq: 1, doc });
    await writeSave(db, 0, { ...write, seq: 2, doc: 'damaged', receipts: [{ serial: 1, factId: 'old.coins', grant: 'coins', name: 'coins', amount: 500 }] });
    back = new RoomBot(bench.url, 'bench', write.player);
    expect(await back.arrived()).toBe(true);
    expect(back.client.owned.get(OWNED_ROW.coins)).toBe(500);
    const restored = room.bodyOf(write.player); if (restored === undefined) throw new Error('No restored body');
    expect(room.book.rowOf(restored.id).serial).toBe(1);
    room.book.file({ player: restored.id, id: 'new.coins', tick: 1, grant: 'coins', name: 'coins', amount: 1, pending: false });
    back.transport.control('ready', new Uint8Array([1]).buffer);
    await vi.waitFor(() => { expect(room.holds(write.player)).toBe(false); });
    expect(await saves.drain(1000)).toBe(true);
    await vi.waitFor(async () => { expect((await db.query('select serial::int as serial from ledger_receipt where player_id = $1 order by serial', [write.player])).rows).toEqual([{ serial: 1 }, { serial: 2 }]); });
  } finally { seed.drop(); back?.drop(); await bench.close(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('an import fallback crosses the worker boundary and promotes only its checkpoint', { timeout: 9000 }, async () => {
  const { OWNED_ROW } = await import('../src/shared/game/loot/ownedRows');
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined), bench = await roomBench({ saves, newsDelayMs: 100 });
  const seed = new RoomBot(bench.url, 'bench', 'device:import'); let back: RoomBot | undefined;
  try {
    expect(await seed.arrived()).toBe(true);
    const room = bench.room('driftwood-isle'), body = room?.bodyOf('device:import'); if (room === undefined || body === undefined) throw new Error('No player');
    room.cell.owned.of(body.id).purse.add(500); room.book.file({ player: body.id, id: 'paid', tick: 1, grant: 'coins', name: 'coins', amount: 500, pending: false });
    seed.transport.control('ready', new Uint8Array([1]).buffer);
    await vi.waitFor(() => { expect(room.holds('device:import')).toBe(false); }); expect(await saves.drain(1000)).toBe(true);
    // Removing the worker seat is not a parent-side durability barrier:
    // its save message may still be crossing the real port.
    const saved = await vi.waitFor(async () => { const durable = await saves.read('device:import', 'driftwood-isle'); expect(durable.doc).not.toBeNull(); return durable; });
    const doc = saved.doc; if (doc === null) throw new Error('No checkpoint');
    const write = { player: 'device:import', name: 'I', shard: 'driftwood-isle', build: 'bench', saveVersion: 1, reason: 'test', receipts: [] };
    await writeSave(db, 0, { ...write, seq: saved.seq + 1, doc: { ...doc, book: { ...doc.book, quests: [] } } });
    back = new RoomBot(bench.url, 'bench', 'device:import'); expect(await back.arrived()).toBe(true); expect(back.client.owned.get(OWNED_ROW.coins)).toBe(500);
    await vi.waitFor(async () => { expect((await db.query('select doc from player_save where player_id = $1', [write.player])).rows).toEqual([{ doc }]); });
    // A delayed promotion must not swap a newer successful write back out.
    await writeSave(db, 0, { ...write, seq: saved.seq + 2, doc: { ...doc, at: { ...doc.at, x: doc.at.x + 1 } } });
    await saves.recover?.(write.player, write.shard, saved.seq + 1);
    expect((await saves.read(write.player, write.shard)).doc?.at.x).toBe(doc.at.x + 1);
  } finally { seed.drop(); back?.drop(); await bench.close(); await saves.drain(1000); saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

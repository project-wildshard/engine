import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc, PLAYER_DOC_VERSION } from '../src/server/host/dedicated/playerDoc';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { writeSave } from '../src/server/host/dedicated/saves/saveStore';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { directLoopback } from '../src/test/engine/netLoopback';
import { openPglite } from './fixtures/pgliteDatabase';
import { SHARD, clock, shippedInput, rooms, post, open, readBack, enter, run, opening, earn, purse, quit } from './fixtures/dedicatedDoc';

// TEST-SPEED TS5 (J255): dedicated-doc was 31-44 s hosted. Split from dedicated-doc.test.ts by case; bodies unchanged.
test('an incomplete ledger event is rejected before any room tick', async () => {
  const room = await open('ledger'), saved = quit(enter(room, 'device:ledger')), doc = readBack(saved);
  if (doc === null) throw new Error('No doc');
  expect(parseDoc({ ...doc, ledger: { serial: 1, rows: [{ serial: 1, id: 'broken' }] } }, PLAYER_DOC_VERSION)).toBeNull();
});

test.each([{ axis: 'x', value: 1e308 }, { axis: 'z', value: 1e308 }, { axis: 'x', value: 100_000 }, { axis: 'z', value: 100_000 }])('an outside-world saved $axis=$value cannot reach the next room tick', { timeout: 9000 }, async ({ axis, value }) => {
  const source = await open('place-source'), saved = quit(enter(source, 'device:place')), doc = readBack(saved);
  if (doc === null) throw new Error('No document');
  const news: RoomNews[] = [], room = await DedicatedRoom.boot({ slug: SHARD, build: '', bootId: 'place-target', input: await shippedInput(SHARD), now: () => clock, post: row => { news.push(row); } }); rooms.push(room);
  const link = directLoopback(); let closed = ''; link.server.onClose(reason => { closed = reason; });
  room.seat({ device: 'device:place', name: 'P', body: 'p.place', doc: { ...doc, at: { ...doc.at, [axis]: value } }, seq: saved.seq }, link.server, () => undefined);
  expect(() => { room.tick(); }).not.toThrow(); expect(closed).toBe('refused'); expect(room.taken).toBe(0);
});

test.each(['missing document', 'missing slot', 'import failure', 'absurd position'])('a %s tries the good previous checkpoint', { timeout: 9000 }, async damage => {
  const source = await open('fallback-source'), phone = enter(source, 'device:fallback'); earn(source, phone.device, 'paid');
  const good = quit(phone), doc = readBack(good); if (doc === null) throw new Error('No document');
  const store = { ...doc.store }, key = Object.keys(store).find(name => name.endsWith(`.${SHARD}`)); if (key === undefined) throw new Error('No purse');
  if (damage === 'missing document') delete store[key];
  if (damage === 'missing slot') { const envelope = JSON.parse(store[key] ?? '') as { keys: Record<string, unknown> }; delete envelope.keys['purse']; store[key] = JSON.stringify(envelope); }
  const receipt = { serial: doc.ledger.serial + 1, factId: 'after-previous', grant: 'coins', name: 'coins', amount: 3 };
  const bad = damage === 'import failure' ? { ...doc, book: { ...doc.book, quests: [] }, ledger: { serial: receipt.serial, rows: [...doc.ledger.rows, { serial: receipt.serial, id: receipt.factId, kind: 'ledger', grant: receipt.grant, name: receipt.name, amount: receipt.amount, tick: 1, pending: false }] } } : damage === 'absurd position' ? { ...doc, at: { ...doc.at, x: 1e308 } } : { ...doc, store };
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined);
  try {
    await writeSave(db, 0, { ...good, seq: 1 }); await writeSave(db, 0, { ...good, seq: 2, doc: bad, receipts: damage === 'import failure' ? [receipt] : good.receipts });
    const loaded = await saves.read(phone.device, SHARD), fresh = await open('fallback-target'), link = directLoopback(), client = new NetClient(link.client);
    if (damage === 'absurd position') expect(loaded.doc?.at).toEqual(doc.at);
    if (damage === 'import failure') expect(loaded.doc?.book.quests).toEqual([]);
    fresh.seat({ device: phone.device, name: 'F', body: 'p.fallback', ...loaded }, link.server, () => { client.hello('', { player: phone.device, name: 'F' }); link.pump(); });
    const coins = damage === 'import failure' ? 10 : 7;
    expect(fresh.bodyOf(phone.device)).toBeDefined(); expect(purse(fresh, phone.device)).toEqual({ coins, cape: true });
    run(fresh, [{ device: phone.device, link, client }], 1);
    saves.write(quit({ device: phone.device, link, client })); expect(await saves.drain(1000)).toBe(true);
    expect((await saves.read(phone.device, SHARD)).doc?.store[key]).toContain(String(coins));
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});


test.each(['inventory', 'owned', 'platform.ledger'])('a damaged %s slot cannot pass store admission', async slot => {
  const source = await open('slots'), phone = enter(source, 'device:slots');
  source.cell.owned.of(source.bodyOf(phone.device)?.id ?? '').purse.add(500);
  const good = quit(phone), doc = readBack(good); if (doc === null) throw new Error('No document');
  const key = Object.keys(doc.store).find(name => name.endsWith(`.${SHARD}`)); if (key === undefined) throw new Error('No purse document');
  const target = slot === 'platform.ledger' ? `${key.slice(0, -SHARD.length)}profile` : key;
  const bad = { ...doc, store: { ...doc.store, [target]: JSON.stringify({ keys: { [slot]: { v: 1, data: 'damaged' } } }) } };
  expect(parseDoc(bad, PLAYER_DOC_VERSION)).toBeNull();
});

test('a mismatched recovered fact refuses its seat without throwing or saving', async () => {
  const source = await open('fact-source'), phone = enter(source, 'device:fact');
  const baseline = quit(phone), again = enter(source, phone.device, baseline); opening(source, again);
  const paid = quit(again), fact = paid.receipts.find(row => row.grant === 'fact'), doc = readBack(baseline);
  if (fact === undefined || doc === null) throw new Error('No fact');
  const identity: unknown = JSON.parse(fact.factId); if (!Array.isArray(identity) || typeof identity[4] !== 'number') throw new Error('Bad fact identity');
  identity[4]++;
  const news: RoomNews[] = [], fresh = await DedicatedRoom.boot({ slug: SHARD, build: '', bootId: 'fact-target', input: await shippedInput(SHARD), now: () => clock, post: row => { news.push(row); } }); rooms.push(fresh);
  const link = directLoopback(); let closed = ''; link.server.onClose(reason => { closed = reason; });
  expect(() => { fresh.seat({ device: phone.device, name: 'F', body: 'p.fact', doc, seq: paid.seq, recovery: [{ ...fact, serial: 1, factId: JSON.stringify(identity) }] }, link.server, () => undefined); }).not.toThrow();
  expect(closed).toBe('refused'); expect(fresh.taken).toBe(0); fresh.drain(); expect(news.filter(row => row.kind === 'save')).toHaveLength(0);
});

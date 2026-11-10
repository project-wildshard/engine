import { afterEach, expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { questBooks, type QuestBook } from '../src/shared/engine/quest/players';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc, PLAYER_DOC_VERSION, type PlayerDoc } from '../src/server/host/dedicated/playerDoc';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { openPglite } from './fixtures/pgliteDatabase';
import { serverInput } from './fixtures/dedicated/roomBench';

// E7.4a: a save leaves a room and comes back on Driftwood's `sealed-ring`, mid-quest with coins and gear, on the lead's seat and on an
// added one, and across them.
const SHARD = 'driftwood-isle', RING = 'sealed-ring';
interface Phone { readonly device: string; readonly client: NetClient; readonly link: DirectLoopback }
let clock = 0;
// VITEST-BENCH VB16: the shipped input (product, assets, Rapier) is immutable, so it loads once per file;
// every room is still booted fresh in each case.
const inputs = new Map<string, ReturnType<typeof serverInput>>();
function shippedInput(slug: string): ReturnType<typeof serverInput> {
  let found = inputs.get(slug);
  if (found === undefined) { found = serverInput(slug); inputs.set(slug, found); }
  return found;
}
const rooms: DedicatedRoom[] = [], writes: SaveWrite[] = [];
const post = (row: RoomNews): void => { if (row.kind === 'save') writes.push(row.write); else if (row.kind === 'refused') throw new Error(row.reason); };
async function open(boot: string): Promise<DedicatedRoom> {
  const room = await DedicatedRoom.boot({ slug: SHARD, build: '', bootId: boot, input: await shippedInput(SHARD), now: () => clock, post });
  rooms.push(room);
  return room;
}
afterEach(() => { for (const room of rooms.splice(0)) room.dispose(); writes.length = 0; });
// oxlint-disable-next-line unicorn/prefer-structured-clone -- Exercise the actual persisted JSON representation.
const readBack = (saved: SaveWrite): PlayerDoc | null => parseDoc(JSON.parse(JSON.stringify(saved.doc)), saved.saveVersion);
function enter(room: DedicatedRoom, device: string, saved?: SaveWrite): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: saved === undefined ? null : readBack(saved), seq: saved?.seq ?? 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { device, client, link };
}
function run(room: DedicatedRoom, phones: readonly Phone[], ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    for (const { client, link } of phones) { client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); link.pump(); }
    clock += 1000 / 60; room.tick();
    for (const { link } of phones) link.pump();
  }
}
const stand = (room: DedicatedRoom, device: string, x: number, z: number): void => { room.bodyOf(device)?.resetPose({ x, y: room.host.groundHeightAt(x, z) + 0.05, z }, 0); };
function bookOf(room: DedicatedRoom, device: string): QuestBook {
  const body = room.bodyOf(device);
  if (body === undefined) throw new Error('No body');
  return questBooks(room.host).of(body.id);
}
const ring = (room: DedicatedRoom, device: string): QuestBook['quests'][number] | undefined => bookOf(room, device).quests.find(quest => quest.def.id === RING);
/** The opening of Driftwood's quest, and some gear: talk, then the chest, which holds a flint. */
function opening(room: DedicatedRoom, phone: Phone): void {
  run(room, [phone], 10);
  stand(room, phone.device, -22, -71.5); run(room, [phone], 3);
  phone.client.act({ kind: 'interact', seq: 0, id: 'castaway.talk' }); run(room, [phone], 4);
  stand(room, phone.device, -22, -62.9); run(room, [phone], 3);
  phone.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(room, [phone], 4);
  expect(ring(room, phone.device)?.isStarted).toBe(true);
  expect(bookOf(room, phone.device).flags.has('has:flint')).toBe(true);
}
/** Coins and gear the way a tick files them. */
function earn(room: DedicatedRoom, device: string, id: string): void {
  const body = room.bodyOf(device);
  if (body === undefined) throw new Error('No body');
  room.cell.owned.of(body.id).file({ grant: 'coins', name: 'coins', amount: 7 });
  room.cell.owned.of(body.id).file({ grant: 'item', name: 'cape', amount: 1 });
  room.book.file({ player: body.id, id, tick: 1, grant: 'coins', name: 'coins', amount: 7, pending: false });
}
function purse(room: DedicatedRoom, device: string): { coins: number; cape: boolean } {
  const owned = room.cell.owned.of(room.bodyOf(device)?.id ?? '');
  return { coins: owned.purse.coins, cape: owned.owned.has('cape') };
}
function quit(phone: Phone): SaveWrite {
  const before = writes.length;
  phone.link.server.close('left');
  const write = writes.slice(before).at(-1);
  if (write === undefined) throw new Error('No write');
  return write;
}

test('mid-quest with coins and gear, on the lead seat', { timeout: 120_000 }, async () => {
  const room = await open('a'), a = enter(room, 'a');
  expect(room.bodyOf('a')?.id).toBe('actor.player');
  opening(room, a); earn(room, 'a', 'grant.1');
  const step = ring(room, 'a')?.current?.id, saved = quit(a);
  expect(saved).toMatchObject({ saveVersion: PLAYER_DOC_VERSION, seq: 1, reason: 'leave' });
  expect(saved.receipts.map(row => row.factId)).toContain('grant.1');
  expect(saved.receipts.some(row => row.grant === 'fact'), 'a fact on its way to the store').toBe(true);
  expect(JSON.stringify(saved.doc).length, 'E7.4: the target').toBeLessThan(64 * 1024);
  expect(room.host.flags.has('has:flint'), 'the seat is clear for the next player').toBe(false);
  const fresh = await open('b'), back = enter(fresh, 'a', saved);
  run(fresh, [back], 5);
  expect(fresh.bodyOf('a')?.id).toBe('actor.player');
  expect(ring(fresh, 'a')?.isStarted).toBe(true);
  expect(ring(fresh, 'a')?.current?.id).toBe(step);
  expect(bookOf(fresh, 'a').flags.has('has:flint')).toBe(true);
  expect(purse(fresh, 'a')).toEqual({ coins: 7, cape: true });
  expect(fresh.book.rowOf('actor.player').serial).toBe(saved.receipts.length);
  expect(back.client.owned.get(OWNED_ROW.coins)).toBe(7);
  expect(back.client.quests.get(RING)?.started).toBe(true);
});

test('mid-quest with coins and gear, on an added seat, and across seats both ways', { timeout: 120_000 }, async () => {
  const room = await open('a'), lead = enter(room, 'lead'), b = enter(room, 'b');
  run(room, [lead, b], 5);
  expect(room.bodyOf('b')?.id).toBe('p.b');
  opening(room, b); earn(room, 'b', 'grant.b');
  expect(ring(room, 'lead')?.isStarted, 'J106').toBe(false);
  const step = ring(room, 'b')?.current?.id, saved = quit(b);
  // the same doc on the lead's seat of a fresh room
  const fresh = await open('b'), onLead = enter(fresh, 'b', saved);
  run(fresh, [onLead], 5);
  expect(fresh.bodyOf('b')?.id).toBe('actor.player');
  expect(ring(fresh, 'b')?.current?.id).toBe(step);
  expect(purse(fresh, 'b')).toEqual({ coins: 7, cape: true });
  const serial = fresh.book.rowOf('actor.player').serial;
  stand(fresh, 'b', -22, -71.5); run(fresh, [onLead], 3);
  onLead.client.act({ kind: 'interact', seq: 0, id: 'castaway.talk' }); run(fresh, [onLead], 4);
  expect(fresh.book.rowOf('actor.player').serial, 'the same fact on another seat is the same fact').toBe(serial);
  const movedOn = quit(onLead);
  expect(movedOn.seq, 'a read seeds seq').toBe(saved.seq + 1);
  // and back to an added seat
  const third = await open('c'), other = enter(third, 'other'), onSeat = enter(third, 'b', movedOn);
  run(third, [other, onSeat], 5);
  expect(third.bodyOf('b')?.id).toBe('p.b');
  expect(ring(third, 'b')?.current?.id).toBe(step);
  expect(bookOf(third, 'b').flags.has('has:flint')).toBe(true);
  expect(ring(third, 'other')?.isStarted, 'and nobody else has it').toBe(false);
  expect(purse(third, 'b')).toEqual({ coins: 7, cape: true });
});

test('a restart can neither drop nor double a grant', { timeout: 120_000 }, async () => {
  const room = await open('boot-one'), a = enter(room, 'a');
  opening(room, a);
  const heard: string[] = [];
  a.client.onLedger(row => { heard.push(row.id); });
  earn(room, 'a', 'grant.1');
  run(room, [a], 3);
  expect(heard).toEqual(['grant.1']);
  const saved = quit(a);
  const fresh = await open('boot-two'), link = directLoopback(), client = new NetClient(link.client), again: string[] = [];
  client.onLedger(row => { again.push(row.id); });
  // a client that holds serial 1 comes back to a world whose tick starts over
  fresh.seat({ device: 'a', name: 'a', body: 'p.a', doc: readBack(saved), seq: saved.seq }, link.server, () => { client.hello('', { player: 'a', name: 'a' }, a.client.ledgerSerial); link.pump(); });
  link.pump();
  const phone = { device: 'a', client, link };
  run(fresh, [phone], 3);
  expect(again, 'what it has had, it does not hear twice').toEqual([]);
  const serial = fresh.book.rowOf('actor.player').serial, flags = bookOf(fresh, 'a').flags.all.length;
  // the same talk and the same chest in a world that has never seen them: the fact's own store says they are paid, and the marks say they are open
  stand(fresh, 'a', -22, -71.5); run(fresh, [phone], 3);
  client.act({ kind: 'interact', seq: 0, id: 'castaway.talk' }); run(fresh, [phone], 4);
  stand(fresh, 'a', -22, -62.9); run(fresh, [phone], 3);
  client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(fresh, [phone], 4);
  expect(bookOf(fresh, 'a').flags.all.length, 'the chest stays open').toBe(flags);
  expect(fresh.book.rowOf('actor.player').serial, 'and pays nobody twice').toBe(serial);
  fresh.book.file({ player: 'actor.player', id: 'grant.2', tick: 1, grant: 'coins', name: 'coins', amount: 1, pending: false });
  run(fresh, [phone], 3);
  expect(again, 'and a grant after the restart is heard, at the next serial').toEqual(['grant.2']);
  const next = quit(phone);
  expect(next.receipts.map(row => [row.serial, row.factId])).toEqual([[serial + 1, 'grant.2']]);
});

test('a doc is the same after Postgres, and a stale write cannot land', { timeout: 120_000 }, async () => {
  const db = await openPglite();
  await migrate(db);
  const saves = playerSavesOver(db, 0, () => undefined), room = await open('a'), a = enter(room, 'a');
  opening(room, a); earn(room, 'a', 'grant.1');
  const saved = quit(a);
  saves.write(saved);
  const read = await saves.read('a', SHARD);
  expect(read.seq).toBe(saved.seq);
  expect(read.doc?.ledger.serial).toBe(saved.receipts.length);
  saves.write({ ...saved, seq: 0, doc: { ...read.doc, at: { x: 1, y: 2, z: 3, yaw: 0 } }, receipts: [] });
  expect((await saves.read('a', SHARD)).doc?.at, 'an older write never lands on a newer one').toEqual(read.doc?.at);
  const fresh = await open('b'), link = directLoopback(), client = new NetClient(link.client);
  fresh.seat({ device: 'a', name: 'a', body: 'p.a', doc: read.doc, seq: read.seq }, link.server, () => { client.hello('', { player: 'a', name: 'a' }); link.pump(); });
  run(fresh, [{ device: 'a', client, link }], 3);
  expect(ring(fresh, 'a')?.isStarted).toBe(true);
  expect(purse(fresh, 'a')).toEqual({ coins: 7, cape: true });
  saves.report({ reporter: 'a', speaker: 'b', name: 'Bee', channel: 'room', typed: 'typed', shown: 'shown', tick: 9 }, SHARD);
  await vi.waitFor(async () => { expect((await db.query('select shard, typed from chat_report')).rows).toEqual([{ shard: SHARD, typed: 'typed' }]); });
  await saves.drain(1000);
  await db.close();
});

test('an incompatible continuation refuses the seat and never writes fresh state', async () => {
  const source = await open('before'), saved = quit(enter(source, 'device:incompatible')), doc = readBack(saved);
  if (doc === null) throw new Error('No doc');
  const news: RoomNews[] = [], room = await DedicatedRoom.boot({ slug: SHARD, build: '', bootId: 'after', input: await shippedInput(SHARD), now: () => clock, post: row => { news.push(row); } });
  rooms.push(room);
  const link = directLoopback(); let reason = '';
  link.server.onClose(word => { reason = word; });
  room.seat({ device: 'device:incompatible', name: 'A', body: 'p.a', seq: saved.seq, doc: { ...doc, book: { ...doc.book, quests: [] } } }, link.server, () => undefined);
  expect(reason).toBe('refused'); expect(room.taken).toBe(0);
  room.drain(); expect(news.filter(row => row.kind === 'save')).toHaveLength(0);
});

test('previous recovery restores missing goods and facts and saves above durable serials', async () => {
  const source = await open('old'), a = enter(source, 'device:recover'), base = quit(a);
  const returned = enter(source, 'device:recover', base);
  opening(source, returned); earn(source, returned.device, 'old.coins');
  const current = quit(returned), db = await openPglite(); await migrate(db);
  const saves = playerSavesOver(db, 0, () => undefined);
  try {
    saves.write(base); expect(await saves.drain(1000)).toBe(true);
    saves.write(current); expect(await saves.drain(1000)).toBe(true);
    await db.exec("update player_save set doc = '\"corrupt\"'::jsonb");
    const loaded = await saves.read(a.device, SHARD), fresh = await open('recovered'), link = directLoopback(), client = new NetClient(link.client);
    fresh.seat({ device: a.device, name: 'A', body: 'p.recover', ...loaded }, link.server, () => { client.hello('', { player: a.device, name: 'A' }); link.pump(); });
    expect(fresh.bodyOf(a.device)).toBeDefined();
    expect(purse(fresh, a.device).coins).toBe(7);
    const serial = fresh.book.rowOf('actor.player').serial;
    expect(serial).toBe(readBack(current)?.ledger.serial);
    // A fact from the newer document must already be entitled after recovery.
    const before = serial;
    const fact = loaded.recovery?.find(row => row.grant === 'fact');
    if (fact === undefined) throw new Error('No recovered fact');
    const identity: unknown = JSON.parse(fact.factId);
    if (!Array.isArray(identity) || typeof identity[3] !== 'string') throw new Error('No recovered entity');
    expect(fresh.cell.fact(fact.name, identity[3], 'actor.player')?.status).toBe('duplicate');
    expect(fresh.book.rowOf('actor.player').serial).toBe(before);
    fresh.book.file({ player: 'actor.player', id: 'new.coins', tick: 1, grant: 'coins', name: 'coins', amount: 1, pending: false });
    const saved = quit({ device: a.device, client, link });
    expect(saved.receipts.map(row => row.serial)).toEqual([serial + 1]);
    saves.write(saved); expect(await saves.drain(1000)).toBe(true);
    expect((await db.query('select max(serial)::int as serial from ledger_receipt')).rows).toEqual([{ serial: serial + 1 }]);
  } finally { saves.queue.dispose(); await db.close(); }
});

test.each(['not json', 'truncated', 'wrong envelope', 'wrong purse'])('a %s purse falls back to the good previous checkpoint', { timeout: 9000 }, async damage => {
  const source = await open('purse'), phone = enter(source, 'device:purse');
  source.cell.owned.of(source.bodyOf(phone.device)?.id ?? '').purse.add(500);
  const good = quit(phone), doc = readBack(good); if (doc === null) throw new Error('No document');
  const key = Object.keys(doc.store).find(name => name.endsWith(`.${SHARD}`)); if (key === undefined) throw new Error('No purse document');
  const text = doc.store[key] ?? '', damaged = damage === 'not json' ? 'not json' : damage === 'truncated' ? text.slice(0, -1) : damage === 'wrong envelope' ? '{"wrong":true}' : '{"keys":{"purse":{"v":1,"data":"wrong"}}}';
  const db = await openPglite(); await migrate(db); const saves = playerSavesOver(db, 0, () => undefined);
  try {
    saves.write({ ...good, seq: 1 }); expect(await saves.drain(1000)).toBe(true);
    saves.write({ ...good, seq: 2, doc: { ...doc, store: { ...doc.store, [key]: damaged } } }); expect(await saves.drain(1000)).toBe(true);
    const loaded = await saves.read(phone.device, SHARD);
    expect(loaded.doc?.store[key]).toBe(text);
    const fresh = await open('restored'), link = directLoopback(), client = new NetClient(link.client);
    fresh.seat({ device: phone.device, name: 'P', body: 'p.purse', ...loaded }, link.server, () => { client.hello('', { player: phone.device, name: 'P' }); link.pump(); });
    expect(purse(fresh, phone.device).coins).toBe(500);
    const saved = quit({ device: phone.device, client, link }); saves.write(saved); expect(await saves.drain(1000)).toBe(true);
    expect((await saves.read(phone.device, SHARD)).doc?.store[key]).toContain('500');
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

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

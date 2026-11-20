import { afterEach, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import { decodeSavesAnswer, decodeSavesAsk, encodeSaves, framed, SOCKET_SAVES, worldReadsSaves, type SavesAnswer, type SavesAsk } from '../src/shared/engine/net/socketFrames';
import { questBooks } from '../src/shared/engine/quest/players';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { PLAYER_DOC_VERSION } from '../src/server/host/dedicated/playerDoc';
import { roomPreview } from '../src/shared/game/newGame';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { readSave, recoveryReceipts, resetSave, writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { openPglite } from './fixtures/pgliteDatabase';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// meta QA-FEEDBACK-2026-11-20-mini row 9 (IPHONE13-DRIFTWOOD DW9): on a grid room the Saves card read "QUESTS 0 DONE · EMPTY" mid-quest
// and New Game reloaded into every flag, because the room keeps the save and the page could neither read nor reset it. A seated page
// now asks the door on its own socket: `read` answers the room's copy, and `reset` lets the body go and forgets that save before the
// player is seated again. The seat is the hello's, so a player only ever touches their own save.
const HOME = 'driftwood-isle', DEVICE = 'device:fresh', OTHER = 'device:other', QUEST_FLAG = 'test:new-game-flag', CREDIT = 'dead:test-crab';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const bot = (device: string): RoomBot => { if (bench === undefined) throw new Error('No bench'); const made = new RoomBot(bench.url, 'bench', device, 'Fresh'); bots.push(made); return made; };
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

/** One `saves` word and the door's answer to it. */
function ask(who: RoomBot, word: SavesAsk): Promise<SavesAnswer | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { off(); resolve(null); }, 5000);
    const off = who.transport.onControl((control, bytes) => { if (control !== 'saves') return; clearTimeout(timer); off(); resolve(decodeSavesAnswer(bytes)); });
    who.transport.control('saves', encodeSaves(word));
  });
}
const flagsOf = (answer: SavesAnswer | null): readonly string[] | null => answer !== null && 'read' in answer ? answer.read[HOME]?.flags ?? [] : null;

test('New Game through the room: the card reads the room\'s save, the reset forgets only this player\'s, and they come back with no flags', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  bench = await roomBench({ cells: [HOME], workers: 1, saves, holdMs: 50 });
  const first = bot(DEVICE), said: boolean[] = [];
  first.transport.onControl((control, bytes) => { if (control === 'world') said.push(worldReadsSaves(bytes)); });
  expect(await first.arrived()).toBe(true);
  expect(said, 'the door says it answers `saves`').toEqual([true]);
  const room = bench.room(HOME), body = room?.bodyOf(DEVICE);
  if (room === undefined || body === undefined) throw new Error('No seat');
  const books = questBooks(room.host);
  books.claim([QUEST_FLAG]);
  books.of(body.id).flags.set(QUEST_FLAG); books.of(body.id).flags.set(CREDIT);
  // the Saves card's read: the room's copy, once its checkpoint has landed
  await vi.waitFor(async () => { expect(flagsOf(await ask(first, { read: [HOME] }))).toEqual(expect.arrayContaining([QUEST_FLAG, CREDIT])); }, { timeout: 15_000, interval: 250 });
  const read = await ask(first, { read: [HOME, 'nalati-grasslands'] });
  if (read === null || !('read' in read)) throw new Error('No read');
  expect(read.read['nalati-grasslands'], 'nothing saved there').toBeNull();
  const card = roomPreview({ id: HOME, shard: HOME }, read.read[HOME] ?? { flags: [], quests: [], keys: {} });
  expect(card.before.flags).toEqual(expect.arrayContaining([QUEST_FLAG, CREDIT]));
  expect(card.before.quests.saved, 'the card no longer reads EMPTY').toBe(true);
  // another player's save on the same shard, which this reset must not touch
  const mine = await saves.read(DEVICE, HOME);
  saves.write({ player: OTHER, name: 'Other', shard: HOME, build: 'bench', saveVersion: PLAYER_DOC_VERSION, seq: 1, reason: 'test', doc: mine.doc, receipts: [] });

  first.transport.control('saves', encodeSaves({ reset: HOME }));
  expect(await first.ended(), 'the door takes it by letting the body go').toBe('closed');
  await vi.waitFor(() => { expect(bench?.lines.filter(line => line['at'] === 'save.reset')).toEqual([{ at: 'save.reset', shard: HOME, found: true }]); }, { timeout: 15_000, interval: 50 });
  expect((await saves.read(DEVICE, HOME)).doc, 'the room forgot this player\'s save').toBeNull();
  expect((await saves.read(OTHER, HOME)).doc?.book.flags, 'and only theirs').toEqual(expect.arrayContaining([QUEST_FLAG, CREDIT]));

  const back = bot(DEVICE);
  expect(await back.arrived()).toBe(true);
  const again = room.bodyOf(DEVICE);
  if (again === undefined) throw new Error('No seat on the way back');
  expect(books.exportOf(again.id).flags, 'fresh: none of the old flags').toEqual([]);
  expect(books.of(again.id).flags.has(QUEST_FLAG)).toBe(false);
  expect(flagsOf(await ask(back, { read: [HOME] })) ?? [], 'and the card reads an empty save').toEqual([]);
  expect(bench.crashes).toEqual([]);
});

test('a `saves` word from a socket with no seat is refused, and nothing is read or reset', { timeout: 60_000 }, async () => {
  bench = await roomBench();
  const socket = new WebSocket(bench.url), opened = new Promise<void>(resolve => { socket.once('open', () => { resolve(); }); });
  await opened;
  socket.send(framed(SOCKET_SAVES, encodeSaves({ reset: HOME })));
  await vi.waitFor(() => { expect(bench?.world.refusals).toEqual({ 'saves-word': 1 }); });
  expect(bench.lines.filter(line => line['at'] === 'save.reset')).toEqual([]);
  socket.close();
});

test('the `saves` words are bounded: a junk ask or answer reads as nothing', () => {
  const bytes = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer;
  expect(decodeSavesAsk(bytes({ read: [HOME, HOME] }))).toEqual({ read: [HOME] });
  expect(decodeSavesAsk(bytes({ reset: '../etc' }))).toBeNull();
  expect(decodeSavesAsk(bytes({ read: Array.from({ length: 65 }, (_, index) => `s${String(index)}`) }))).toBeNull();
  expect(decodeSavesAsk(new TextEncoder().encode('{not json').buffer)).toBeNull();
  expect(decodeSavesAnswer(bytes({ read: { [HOME]: { flags: [1], quests: [], keys: {} } } }))).toBeNull();
  expect(decodeSavesAnswer(bytes({ reset: HOME, ok: false }))).toEqual({ reset: HOME, ok: false });
  expect(decodeSavesAnswer(bytes({ read: { [HOME]: null } }))).toEqual({ read: { [HOME]: null } });
});

test('on Postgres a reset forgets the save and moves its receipts to a player that names nobody; other shards stay', async () => {
  const db = await openPglite();
  try {
    await migrate(db);
    const write = (shard: string, serial: number): SaveWrite => ({ player: DEVICE, name: 'Fresh', shard, build: 'b1', saveVersion: 1, seq: serial, reason: 'checkpoint', doc: { serial }, receipts: [{ serial, factId: `${shard}.fact.${String(serial)}`, grant: 'coins', name: 'coins', amount: 5 }] });
    await writeSave(db, 0, write(HOME, 1)); await writeSave(db, 0, write(HOME, 2)); await writeSave(db, 0, write('nalati-grasslands', 1));
    expect(await resetSave(db, 0, DEVICE, HOME)).toBe(true);
    expect(await readSave(db, 0, DEVICE, HOME, doc => doc)).toBeNull();
    expect(await recoveryReceipts(db, 0, DEVICE, HOME, 0), 'no grant is read back into the fresh save').toEqual([]);
    expect((await readSave(db, 0, DEVICE, 'nalati-grasslands', doc => doc))?.doc).toEqual({ serial: 1 });
    const moved = await db.query('select r.serial::int, p.name from ledger_receipt r join player p on p.id = r.player_id where r.shard = $1 order by r.serial', [HOME]);
    expect(moved.rows, 'the ledger still adds up').toEqual([{ serial: 1, name: 'Reset' }, { serial: 2, name: 'Reset' }]);
    expect(await resetSave(db, 0, DEVICE, HOME), 'nothing left to forget').toBe(false);
  } finally { await db.close(); }
});

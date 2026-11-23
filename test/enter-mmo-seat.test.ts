// QA-FEEDBACK-2026-11-23-b row 19 (Jake, ~11:30 Cancún, staging: "Enter MMO should, ask the server where the fuck I am, and then like
// load the correct zone, and like not spawn me in Driftwood, and then not teleport me"). Enter MMO booted the device's hint, which
// `lastPlace` reads only while its catalogue seal matches the page's catalogue exactly: every staging placement that adds, cards or
// moves a cell voided it, so the page booted Driftwood and the door's `resume` then moved the player to their zone (GO5), a second
// loading screen. Enter MMO now asks the door first (its `where` word, on a socket with no hello) and boots that cell, and the hint
// is read by its cell alone.
import { afterEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { installCatalogueFixture } from './fixtures/bootSetup';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { decodeWhereAnswer, encodeWhere, framed, SOCKET_WHERE, SOCKET_WORLD } from '../src/shared/engine/net/socketFrames';
import { askSeat, type SeatSocket } from '../src/client/game/grid/seatAsk';
import { entryCell, SERVER_PLACED } from '../src/client/game/grid/pageEntry';
import { SaveStore } from '../src/shared/engine/saves/store';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { catalogueDocument } from '../src/shared/game/grid/catalogueDocument';
import { gridRecovery } from '../src/shared/game/grid/recovery';

await installCatalogueFixture();

const HOME = 'driftwood-isle', DUNES = 'sunscar-dunes', SAVED = 'device:in-the-dunes', FRESH = 'device:never-played';
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });

class Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
}
/** A node `ws` socket in the browser socket's shape the ask uses. */
const nodeSocket = (url: string): SeatSocket => {
  const socket = new WebSocket(url);
  const seat: SeatSocket = { binaryType: 'arraybuffer', onmessage: null, onclose: null, onerror: null,
    send: data => { socket.send(data); }, close: () => { socket.close(); } };
  socket.binaryType = 'arraybuffer';
  socket.on('message', (data: ArrayBuffer) => { seat.onmessage?.({ data }); });
  socket.on('close', () => { seat.onclose?.(); });
  socket.on('error', () => { seat.onerror?.(); });
  return seat;
};
const ask = (url: string, player: string | null): Promise<string | null> =>
  askSeat({ socket: () => Promise.resolve(url), player: () => Promise.resolve(player), open: nodeSocket, askMs: 10_000 });

test('Enter MMO asks the door first: a player saved in Signal Dunes boots Signal Dunes, and the door seats them there with no second load', { timeout: 120_000 }, async () => {
  const saves = memoryPlayerSaves();
  saves.write({ player: SAVED, name: 'Dunes', shard: DUNES, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
  bench = await roomBench({ cells: [HOME, DUNES], saves, seats: 4 });
  const assembly = new GridAssembly({ developer: true, devserver: false }), dunes = assembly.cells.find(cell => cell.slug === DUNES);
  if (dunes === undefined) throw new Error('The catalogue fixture places no Signal Dunes');

  // the door's answer, through the page's own ask
  const answer = await ask(bench.url, SAVED);
  expect(answer, 'the door names the cell the player was saved in').toBe(DUNES);
  expect(await ask(bench.url, FRESH), 'a player the door holds nothing for starts at the home').toBe(HOME);
  expect(await ask(bench.url, null), 'a device with no player asks nothing').toBeNull();

  // the page's choice: a device whose hint is gone (a placement change voided it, or another device played) still boots the Dunes
  const store = new SaveStore({ local: new Storage(), session: new Storage() });
  expect(entryCell(assembly, store, true, answer).slug, 'the first zone loaded is the player\'s').toBe(DUNES);
  expect(entryCell(assembly, store, true, null).slug, 'with no answer and no hint, the home').toBe(HOME);

  // and the door's own join seats them in that same cell: the page booted it, so no `resume` names another (no regrid, GO5)
  const joined = new RoomBot(bench.url, 'bench', SAVED, 'Dunes');
  bots.push(joined);
  expect(await joined.arrived()).toBe(true);
  expect(JSON.parse(joined.resume ?? '{}')).toMatchObject({ cell: answer, shard: DUNES });
  // seated, the ask names the cell holding the body
  expect(await ask(bench.url, SAVED)).toBe(DUNES);
  expect(bench.crashes).toEqual([]);
});

test('an older door never says `where`: the page sends no word it would refuse, and goes on with its hint', async () => {
  const sent: Uint8Array[] = [];
  const socket: SeatSocket = { binaryType: '', onmessage: null, onclose: null, onerror: null, send: data => { sent.push(data); }, close: () => undefined };
  const asked = askSeat({ socket: () => Promise.resolve('ws://door'), player: () => Promise.resolve(SAVED), open: () => socket, askMs: 1000 });
  await new Promise(resolve => { setTimeout(resolve, 0); });
  socket.onmessage?.({ data: framed(SOCKET_WORLD, new TextEncoder().encode(JSON.stringify({ cells: 2, shards: [HOME, DUNES], device: 1 })).buffer).buffer });
  expect(await asked).toBeNull();
  expect(sent).toEqual([]);
});

test('a `where` word that makes no sense hears null; the word and its answer are bounded', () => {
  expect(decodeWhereAnswer(encodeWhere({ cell: DUNES }))).toEqual({ cell: DUNES });
  expect(decodeWhereAnswer(encodeWhere({ cell: '../etc' }))).toBeNull();
  expect(decodeWhereAnswer(encodeWhere({ cell: null }))).toEqual({ cell: null });
  expect(framed(SOCKET_WHERE, encodeWhere({ player: SAVED }))[0]).toBe(14);
});

test('the hint is read by its cell alone: a placement change that voids its catalogue seal no longer boots home', () => {
  const store = new SaveStore({ local: new Storage(), session: new Storage() });
  const before = new GridAssembly({ developer: true, devserver: false }), dunes = before.cells.find(cell => cell.slug === DUNES);
  if (dunes === undefined) throw new Error('The catalogue fixture places no Signal Dunes');
  // the world's door placed this device in the Dunes (liveSession `serverPlace`), as on Jake's phone
  const recovery = gridRecovery(store);
  expect(recovery.save(before, dunes, { x: dunes.origin.x + before.pitch / 2 + 3.6, z: dunes.origin.z, yaw: 0 }, { kind: 'road' })).toBe(true);
  store.define(SERVER_PLACED).write(true);
  expect(entryCell(before, store, true).slug).toBe(DUNES);
  // a staging publish placed one more cell: the catalogue seal moves
  const grid = catalogueDocument().grid as { cells: { instance: string; slug: string; cell: [number, number] }[] };
  const taken = new Set(grid.cells.map(row => row.cell.join(','))), free = [[3, 3], [-3, 3], [3, -3], [-3, -3]].find(at => !taken.has(at.join(',')));
  if (free === undefined) throw new Error('No free spot in the fixture');
  const after = new GridAssembly({ developer: true, devserver: false }, { ...grid, cells: [...grid.cells, { instance: 'new-upload', slug: 'pine-hollow-two', cell: free }] });
  expect(recovery.lastPlace(after), 'the sealed place is void after the change').toBeNull();
  expect(entryCell(after, store, true).slug, 'Enter MMO still boots the Dunes, never Driftwood').toBe(DUNES);
  expect(entryCell(after, store, false).slug, 'a build with no world boots home (its own server restores the place)').toBe(HOME);
});

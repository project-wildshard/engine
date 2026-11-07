// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { BitWriter } from '../src/shared/engine/net/bits';
import { decodeAct, encodeAct } from '../src/shared/engine/net/messages';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { publishOwned } from '../src/shared/engine/sim/shardRows';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { directLoopback } from '../src/test/engine/netLoopback';
import { Scope } from '../src/shared/engine/app/scope';
import { WirePage } from '../src/client/game/shardfile/wirePage';
import { boardFromLines, boardLines } from '../src/shared/game/loot/ownedRows';
import { PlayerOwned } from '../src/server/game/loot/playerOwned';
import { netBuys } from '../src/shared/host/standalone/netInput';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// Flip checklist 4: the server owns what a player holds. Grants arrive as filings, purchases as acts, and a page shows lines.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

test('a purchase survives the wire', () => {
  const act = { kind: 'buy', seq: 2, good: 7 } as const;
  expect(decodeAct(new Uint8Array(encodeAct(new BitWriter(), act)))).toEqual(act);
});

test('a player\'s lines reach only that client, as they change, and a line that ends says 0', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), link = directLoopback(), client = new NetClient(link.client), lines = new Map([['coins', 5], ['item.hide', 2]]);
  publishOwned(host, 'test', (_player, out) => { for (const [name, value] of lines) out.set(name, value); });
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const frames = (): void => { room.tick(); room.tick(); link.pump(); };
  frames();
  expect(Object.fromEntries(client.owned)).toEqual({ coins: 5, 'item.hide': 2 });
  const version = client.ownedVersion;
  frames();
  expect(client.ownedVersion, 'nothing moved, nothing sent').toBe(version);
  lines.set('coins', 9); lines.delete('item.hide'); frames();
  expect(Object.fromEntries(client.owned)).toEqual({ coins: 9 });
  room.dispose(); host.dispose();
});

test('a page shows the server\'s lines on its purse, pack and gear, and writes none of it', () => {
  const page = new WirePage(), link = directLoopback(), client = new NetClient(link.client);
  const purse = { mirror: vi.fn() }, inventory = { mirror: vi.fn() }, gear = { grant: vi.fn(() => true), worn: () => false, toggleWorn: () => true };
  page.bind(client, () => undefined, () => undefined, () => false);
  page.hold({ purse, inventory, gear }, new Scope('test'));
  client.owned.set('coins', 12); client.owned.set('item.hide', 3); client.owned.set('own.sword', 1); client.ownedVersion++;
  client.latest = { tick: 2, baselineTick: -1, cell: 1, lastSeq: 0, owner: new Float64Array(0), rows: new Map(), ride: null, fresh: new Set() };
  page.frame(null, true); page.frame(null, true);
  expect(purse.mirror).toHaveBeenCalledExactlyOnceWith(12);
  expect(inventory.mirror).toHaveBeenCalledExactlyOnceWith(new Map([['hide', 3]]));
  expect(gear.grant).toHaveBeenCalledExactlyOnceWith('sword');
});

test('a player with no coins still hears their board', () => {
  const page = new WirePage(), link = directLoopback(), client = new NetClient(link.client), board = { mirror: vi.fn() }, purse = { mirror: vi.fn() };
  page.bind(client, () => undefined, () => undefined, () => false);
  page.hold({ purse, board }, new Scope('test'));
  client.latest = { tick: 2, baselineTick: -1, cell: 1, lastSeq: 0, owner: new Float64Array(0), rows: new Map(), ride: null, fresh: new Set() };
  page.frame(null, true);
  expect(board.mirror, 'nothing heard yet, nothing to show').not.toHaveBeenCalled();
  client.owned.set('board.next', 4); client.owned.set('board|0|0|species|deer', 4); client.ownedVersion++; // a coin line of 0 is no line
  page.frame(null, true);
  expect(board.mirror).toHaveBeenCalledOnce();
  expect(board.mirror).toHaveBeenCalledWith(expect.stringContaining('"serial":0,"kind":"species","target":"deer","have":3'));
  expect(purse.mirror).toHaveBeenCalledExactlyOnceWith(0);
});

test('a story\'s word plays once as its count moves, and a line says what stands', () => {
  const page = new WirePage(), link = directLoopback(), client = new NetClient(link.client), said = vi.fn<(channel: string) => void>();
  page.bind(client, () => undefined, () => undefined, () => false);
  page.hold({ said }, new Scope('test'));
  client.latest = { tick: 2, baselineTick: -1, cell: 1, lastSeq: 0, owner: new Float64Array(0), rows: new Map(), ride: null, fresh: new Set() };
  client.owned.set('said.qClue0', 1); client.owned.set('story.prop', 3); client.ownedVersion++;
  page.frame(null, true);
  client.ownedVersion++; // another line moved: this word is old
  page.frame(null, true);
  expect(said).toHaveBeenCalledExactlyOnceWith('qClue0');
  client.owned.set('said.qClue0', 2); client.ownedVersion++;
  page.frame(null, true);
  expect(said).toHaveBeenCalledTimes(2);
  expect(page.line('story.prop')).toBe(3);
  expect(page.line('nothing')).toBe(0);
});

test('a purchase lands on the exchange that judges it, and a world with none counts it refused', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), routes = actRoutes(host), buys: [string, number][] = [];
  netBuys(routes, [{ player: 'a', acts: [{ kind: 'buy', seq: 0, good: 1 }] }]);
  expect(routes.refused).toBe(1);
  routes.buy = (player, good) => { buys.push([player, good]); };
  netBuys(routes, [{ player: 'a', acts: [{ kind: 'buy', seq: 0, good: 3 }] }]);
  expect(buys).toEqual([['a', 3]]);
  host.dispose();
});

test('a filing lands in the player\'s purse and pack, and a purchase takes the price', () => {
  const owned = new PlayerOwned('owned-test');
  owned.file({ grant: 'coins', name: 'coins', amount: 30 });
  owned.file({ grant: 'item', name: 'hide', amount: 2 });
  owned.file({ grant: 'item', name: 'whetstone-1', amount: 1 });
  owned.file({ grant: 'fact', name: 'whatever', amount: 1 });
  const out = new Map<string, number>(); owned.read(out, true);
  expect(Object.fromEntries(out)).toEqual({ coins: 30, 'item.hide': 2, 'own.whetstone-1': 1 });
  expect(owned.count('hide')).toBe(2);
  expect(owned.take('hide', 3)).toBe(false);
  expect(owned.buy(0), 'no exchange, no sale').toBe(false);
  expect(owned.purse.coins).toBe(30);
});

test('a contract board goes on the wire as lines and comes back whole', () => {
  const board = { next: 4, claimed: 2, streak: 1, best: 3, slots: [{ serial: 3, kind: 'hunt', target: 'deer', have: 0 }, { serial: 2, kind: 'hunt', target: 'wolf', have: 2 }] };
  const out = new Map<string, number>();
  boardLines({ ...board, slots: board.slots.map(slot => ({ ...slot, need: 1, title: '', goal: '', reward: { items: [], bolts: 0 } })) }, out);
  expect([...out.values()].every(value => value !== 0), 'a line at 0 is a line gone').toBe(true);
  expect(JSON.parse(boardFromLines(out) ?? '')).toEqual(board);
  expect(boardFromLines(new Map([['coins', 3]]))).toBeNull();
});

test('a hand on a board lands on its owner', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), routes = actRoutes(host), hands: string[] = [];
  netBuys(routes, [{ player: 'a', acts: [{ kind: 'board', seq: 0, op: 'claim', slot: 1 }] }]);
  expect(routes.refused).toBe(1);
  routes.board = (player, op, slot) => { hands.push(`${player} ${op} ${String(slot)}`); };
  netBuys(routes, [{ player: 'a', acts: [{ kind: 'board', seq: 0, op: 'tear', slot: 2 }] }]);
  expect(hands).toEqual(['a tear 2']);
  const act = { kind: 'board', seq: 2, op: 'tear', slot: 1 } as const;
  expect(decodeAct(new Uint8Array(encodeAct(new BitWriter(), act)))).toEqual(act);
  host.dispose();
});

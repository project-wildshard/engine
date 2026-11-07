// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import { NetClient } from '../src/client/engine/net/client';
import { LedgerBook, LedgerBookSchema, type LedgerFiling } from '../src/server/engine/net/ledgerBook';
import type { NetLedger } from '../src/shared/engine/net/ledgerWire';
import { decodeEvents, encodeEvents, type InitialBits } from '../src/shared/engine/net/messages';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback } from '../src/test/engine/netLoopback';
import { ledgerFilings } from '../src/server/host/standalone/ledgerFilings';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import * as v from 'valibot';

// P1-E5.2c (M8, J105, J106): a receipt goes to its owner alone, and no retry, disconnect or lag switch can repeat one.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const coins = (player: string, id: string, amount = 5): LedgerFiling => ({ player, id, tick: 1, grant: 'coins', name: 'coins', amount, pending: false });
const none: InitialBits = () => undefined;

function room(host: SimHost, grants: LedgerFiling[], book?: LedgerBook): NetRoom {
  return new NetRoom({ world: new SimNetWorld(host, 0, () => grants.splice(0)), step: () => { host.step(); }, ...(book === undefined ? {} : { book }) });
}

test('a receipt round-trips', () => {
  const event: NetLedger = { kind: 'ledger', tick: 3, serial: 2, id: 'a.b', grant: 'coins', name: 'coins', amount: 12.5, pending: true };
  expect(decodeEvents(new Uint8Array(encodeEvents(new BitWriter(64), 3, [event], none)), none)?.events).toEqual([event]);
});

test('the book files an id once, keeps a player\'s serial running, and saves', () => {
  const book = new LedgerBook();
  expect(book.file(coins('a', 'x'))).toBe(true);
  expect(book.file(coins('a', 'x'))).toBe(false);
  expect(book.file(coins('b', 'x'))).toBe(true);
  expect(book.file(coins('a', 'y'))).toBe(true);
  expect(book.since('a', 0).map(row => row.serial)).toEqual([1, 2]);
  expect(book.since('a', 1).map(row => row.id)).toEqual(['y']);
  expect(book.since('a', 2)).toEqual([]);
  const saved = v.parse(LedgerBookSchema, structuredClone(book.snapshot())), back = new LedgerBook();
  back.restore(saved);
  expect(back.file(coins('a', 'x')), 'a restored book still knows what it paid').toBe(false);
  expect(back.file(coins('a', 'z'))).toBe(true);
  expect(back.since('a', 2).map(row => row.serial)).toEqual([3]);
  const long = 'x'.repeat(400);
  expect(back.file({ ...coins('a', long), name: long })).toBe(true);
  expect(back.file({ ...coins('a', long), name: long })).toBe(false);
  const [row] = back.since('a', 3);
  if (row === undefined) throw new Error('No receipt');
  expect(() => encodeEvents(new BitWriter(64), 3, [row], none)).not.toThrow(); // what a player's data can name never ends the server
});

test('a receipt reaches its owner and nobody else', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host), bot = host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }), grants: LedgerFiling[] = [];
  const world = room(host, grants), one = directLoopback(), two = directLoopback(), first = new NetClient(one.client), second = new NetClient(two.client);
  const inner = new SimNetWorld(host);
  world.join(one.server, inner.playerOf(lead.id)); world.join(two.server, inner.playerOf(bot.id));
  first.hello(); one.pump(); second.hello(); two.pump(); world.open(); one.pump(); two.pump();
  const heard: Record<string, string[]> = { first: [], second: [] };
  first.onLedger(row => { heard['first']?.push(row.id); }); second.onLedger(row => { heard['second']?.push(row.id); });
  grants.push(coins(lead.id, 'ours'), coins(bot.id, 'theirs'));
  for (let tick = 0; tick < 4; tick++) { first.flush(); second.flush(); one.pump(); two.pump(); world.tick(); one.pump(); two.pump(); }
  expect(heard).toEqual({ first: ['ours'], second: ['theirs'] });
  world.dispose(); host.dispose();
});

test('a lag switch delays a receipt, repeats it never; the same bytes twice are applied once', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), grants: LedgerFiling[] = [], world = room(host, grants), link = directLoopback(), client = new NetClient(link.client);
  world.join(link.server); client.hello(); link.pump(); world.open(); link.pump();
  const heard: string[] = [], seen: ArrayBuffer[] = [];
  client.onLedger(row => { heard.push(row.id); });
  link.client.onMessage((_channel, bytes) => { seen.push(bytes.slice(0)); });
  grants.push(coins(leadPlayer(host).id, 'a'));
  for (let tick = 0; tick < 120; tick++) { world.tick(); if (tick === 60) grants.push(coins(leadPlayer(host).id, 'b')); } // the switch: nothing pumped
  link.pump();
  expect(heard).toEqual(['a', 'b']);
  // and a link that hands a message over twice
  const before = heard.length;
  for (const bytes of seen) link.client.send('reliable', bytes.slice(0));
  link.server.send('reliable', seen[0]?.slice(0) ?? new ArrayBuffer(0));
  link.pump();
  expect(heard).toHaveLength(before);
  world.dispose(); host.dispose();
});

test('a client that drops hears what it missed when it comes back, once, and a grant while it is gone is not lost', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), id = leadPlayer(host).id, grants: LedgerFiling[] = [], world = room(host, grants);
  const link = directLoopback(), client = new NetClient(link.client), heard: string[] = [];
  world.join(link.server); client.hello('', { player: 'device:a', name: 'Ann' }); link.pump(); world.open(); link.pump();
  client.onLedger(row => { heard.push(row.id); });
  const run = (next: { flush: () => void }, carrier: { pump: () => void }, ticks: number): void => { for (let tick = 0; tick < ticks; tick++) { next.flush(); carrier.pump(); world.tick(); carrier.pump(); } };
  grants.push(coins(id, 'before')); run(client, link, 4);
  expect(heard).toEqual(['before']);
  link.client.close('dropped'); link.pump();
  grants.push(coins(id, 'while-gone'), coins(id, 'while-gone')); // a retry during the outage, too
  for (let tick = 0; tick < 4; tick++) world.tick();
  const back = directLoopback(), again = new NetClient(back.client), after: string[] = [];
  again.onLedger(row => { after.push(row.id); });
  world.join(back.server); again.hello('', { player: 'device:a', name: 'Ann' }, client.ledgerSerial); back.pump();
  run(again, back, 4);
  expect(after).toEqual(['while-gone']);
  expect(again.ledgerSerial).toBe(2);
  const fresh = directLoopback(), other = new NetClient(fresh.client), all: string[] = [];
  other.onLedger(row => { all.push(row.id); });
  world.join(fresh.server); other.hello(); fresh.pump(); run(other, fresh, 4);
  expect(all, 'a client with nothing is told everything still kept').toEqual(['before', 'while-gone']);
  world.dispose(); host.dispose();
});

test('filings: coins by their player, a bot\'s quest by its prefix, the lead by default, and a duplicate files nothing', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host).id; host.addPlayer('bot:1', { x: 3, y: 0, z: 0 });
  const rows = ledgerFilings(host, lead, [
    { kind: 'coins', amount: 4, actorId: 'bot:1' }, { kind: 'fact', name: 'q.done', actorId: 'bot:1:quest' }, { kind: 'fact', name: 'q.done', actorId: 'quest' }, { kind: 'fact', name: 'q.twice', actorId: 'quest' },
  ], (name, entity) => ({ id: `${name}/${entity}`, status: name === 'q.twice' ? 'duplicate' : 'granted', recorded: true }));
  expect(rows.map(row => [row.player, row.grant, row.name])).toEqual([['bot:1', 'coins', 'coins'], ['bot:1', 'fact', 'q.done'], [lead, 'fact', 'q.done']]);
  expect(rows[2]?.id).toBe('q.done/quest');
  host.dispose();
});

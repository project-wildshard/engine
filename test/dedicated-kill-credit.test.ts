// STAGING-BUGBASH SB34b (J106, J105, Q-CC36): the lead seat's quest book is the player's, not the cell's. A player who leaves
// takes its kills; the next one on the lead seat starts with none, so Brasscap's sheriff and camp bounty are theirs to earn.
import { Vector3 } from 'three';
import { afterEach, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc, type PlayerDoc } from '../src/server/host/dedicated/playerDoc';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { questBooks, type QuestBook } from '../src/shared/engine/quest/players';
import { test as holds } from '../src/shared/engine/world/interact/flags';
import { directLoopback } from '../src/test/engine/netLoopback';
import { shippedInput } from './fixtures/dedicatedDoc';

const SLUG = 'brasscap-mesa', CAMP = ['bandit.camp-1.1', 'bandit.camp-1.2', 'bandit.camp-1.3'], CLEAR = { all: CAMP.map(id => `dead:${id}`) };
let clock = 0;
const rooms: DedicatedRoom[] = [], writes: SaveWrite[] = [];
afterEach(() => { for (const room of rooms.splice(0)) room.dispose(); writes.length = 0; });
const post = (row: RoomNews): void => { if (row.kind === 'save') writes.push(row.write); else if (row.kind === 'refused') throw new Error(row.reason); };
// oxlint-disable-next-line unicorn/prefer-structured-clone -- Exercise the actual persisted JSON representation.
const readBack = (saved: SaveWrite): PlayerDoc | null => parseDoc(JSON.parse(JSON.stringify(saved.doc)), saved.saveVersion);
interface Phone { readonly device: string; readonly link: ReturnType<typeof directLoopback> }
function enter(room: DedicatedRoom, device: string, saved?: SaveWrite): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: saved === undefined ? null : readBack(saved), seq: saved?.seq ?? 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { device, link };
}
const tick = (room: DedicatedRoom, ticks: number): void => { for (let i = 0; i < ticks; i++) { clock += 1000 / 60; room.tick(); } };
function quit(phone: Phone): SaveWrite {
  const before = writes.length;
  phone.link.server.close('left');
  const write = writes.slice(before).at(-1);
  if (write === undefined) throw new Error('No write');
  return write;
}
function bookOf(room: DedicatedRoom, device: string): QuestBook {
  const body = room.bodyOf(device); if (body === undefined) throw new Error('No body');
  return questBooks(room.host).of(body.id);
}
const bounty = (book: QuestBook): boolean | undefined => book.quests.find(quest => quest.def.id === 'brasscap.camp-1.bounty')?.isComplete;
/** `device` fells every camp-1 bandit with its own blows. */
function clearCamp(room: DedicatedRoom, device: string): void {
  const source = room.bodyOf(device); if (source === undefined) throw new Error('No body');
  for (const id of CAMP) {
    const body = room.host.entities.get(id); if (body === undefined) throw new Error(`No ${id}`);
    room.host.combat.hit({ source: source.health, sourceTags: [], target: body.combatActor(), amount: 10_000, point: new Vector3(), dir: new Vector3() });
  }
  tick(room, 2);
}

test('a fresh device on the lead seat inherits none of the last lead\'s camp kills, and the leaver takes them', { timeout: 120_000 }, async () => {
  const room = await DedicatedRoom.boot({ slug: SLUG, build: '', bootId: 'kill-credit', input: await shippedInput(SLUG), now: () => clock, post });
  rooms.push(room);
  const first = enter(room, 'a'); tick(room, 5);
  expect(room.bodyOf('a')?.id).toBe('actor.player');
  clearCamp(room, 'a');
  expect(holds(bookOf(room, 'a').flags, CLEAR), 'the sheriff offers "Camp 1 is clear"').toBe(true);
  expect(bounty(bookOf(room, 'a'))).toBe(true);
  const left = quit(first); tick(room, 2);
  expect(readBack(left)?.book.flags, 'the leaver\'s doc keeps its credit').toEqual(expect.arrayContaining(CLEAR.all));
  expect(room.host.flags.has('dead:bandit.camp-1.1'), 'the world still knows the body fell').toBe(true);
  enter(room, 'b'); tick(room, 5);
  expect(room.bodyOf('b')?.id).toBe('actor.player');
  expect(holds(bookOf(room, 'b').flags, CLEAR), 'the sheriff\'s "Camp 1 is clear" choice is hidden').toBe(false);
  expect(bounty(bookOf(room, 'b')), 'brasscap.camp-1.bounty unpaid').toBe(false);
  // and back on another seat, the leaver's credit is theirs again
  const again = enter(room, 'a', left); tick(room, 5);
  expect(room.bodyOf('a')?.id).toBe('p.a');
  expect(holds(bookOf(room, 'a').flags, CLEAR)).toBe(true);
  expect(bounty(bookOf(room, 'a'))).toBe(true);
  quit(again);
});

// SB34c (QA 11-16-mini row 74): a camp that respawns is alive again to the world; the killer's credit and quests stay.
test('a respawned bandit clears the world\'s death, and the killer keeps its credit and bounty', { timeout: 120_000 }, async () => {
  const room = await DedicatedRoom.boot({ slug: SLUG, build: '', bootId: 'kill-credit-respawn', input: await shippedInput(SLUG), now: () => clock, post });
  rooms.push(room);
  const first = enter(room, 'a'); enter(room, 'b'); tick(room, 5);
  clearCamp(room, 'a');
  expect(room.host.flags.has('dead:bandit.camp-1.1')).toBe(true);
  room.host.events.emit('world.slept', { seconds: 600 }); tick(room, 3);
  expect(room.host.entities.get('bandit.camp-1.1')?.alive, 'the home refilled').toBe(true);
  expect(CAMP.map(id => room.host.flags.has(`dead:${id}`)), 'the world sees the camp alive').toEqual([false, false, false]);
  expect(holds(bookOf(room, 'a').flags, CLEAR), 'the killer keeps its credit').toBe(true);
  expect(bounty(bookOf(room, 'a')), 'and its bounty: no quest walks back').toBe(true);
  expect(holds(bookOf(room, 'b').flags, CLEAR)).toBe(false);
  quit(first);
});

// TEST-SPEED TS5 (J255): dedicated-doc was 31-44 s hosted.
import { afterEach, expect } from 'vitest';
import { NetClient } from '../../src/client/engine/net/client';
import { questBooks, type QuestBook } from '../../src/shared/engine/quest/players';
import { DedicatedRoom } from '../../src/server/host/dedicated/dedicatedRoom';
import { parseDoc, type PlayerDoc } from '../../src/server/host/dedicated/playerDoc';
import type { RoomNews } from '../../src/server/host/dedicated/cellProtocol';
import { type SaveWrite } from '../../src/server/host/dedicated/saves/saveStore';
import { directLoopback, type DirectLoopback } from '../../src/test/engine/netLoopback';
import { serverInput } from './dedicated/roomBench';

// E7.4a: a save leaves a room and comes back on Driftwood's `sealed-ring`, mid-quest with coins and gear, on the lead's seat and on an
// added one, and across them.
export const SHARD = 'driftwood-isle', RING = 'sealed-ring';
export interface Phone { readonly device: string; readonly client: NetClient; readonly link: DirectLoopback }
export let clock = 0;
// VITEST-BENCH VB16: the shipped input (product, assets, Rapier) is immutable, so it loads once per file;
// every room is still booted fresh in each case.
export const inputs = new Map<string, ReturnType<typeof serverInput>>();
export function shippedInput(slug: string): ReturnType<typeof serverInput> {
  let found = inputs.get(slug);
  if (found === undefined) { found = serverInput(slug); inputs.set(slug, found); }
  return found;
}
export const rooms: DedicatedRoom[] = [], writes: SaveWrite[] = [];
export const post = (row: RoomNews): void => { if (row.kind === 'save') writes.push(row.write); else if (row.kind === 'refused') throw new Error(row.reason); };
export async function open(boot: string): Promise<DedicatedRoom> {
  const room = await DedicatedRoom.boot({ slug: SHARD, build: '', bootId: boot, input: await shippedInput(SHARD), now: () => clock, post });
  rooms.push(room);
  return room;
}
afterEach(() => { for (const room of rooms.splice(0)) room.dispose(); writes.length = 0; });
// oxlint-disable-next-line unicorn/prefer-structured-clone -- Exercise the actual persisted JSON representation.
export const readBack = (saved: SaveWrite): PlayerDoc | null => parseDoc(JSON.parse(JSON.stringify(saved.doc)), saved.saveVersion);
export function enter(room: DedicatedRoom, device: string, saved?: SaveWrite): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: saved === undefined ? null : readBack(saved), seq: saved?.seq ?? 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { device, client, link };
}
export function run(room: DedicatedRoom, phones: readonly Phone[], ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    for (const { client, link } of phones) { client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); link.pump(); }
    clock += 1000 / 60; room.tick();
    for (const { link } of phones) link.pump();
  }
}
export const stand = (room: DedicatedRoom, device: string, x: number, z: number): void => { room.bodyOf(device)?.resetPose({ x, y: room.host.groundHeightAt(x, z) + 0.05, z }, 0); };
export function bookOf(room: DedicatedRoom, device: string): QuestBook {
  const body = room.bodyOf(device);
  if (body === undefined) throw new Error('No body');
  return questBooks(room.host).of(body.id);
}
export const ring = (room: DedicatedRoom, device: string): QuestBook['quests'][number] | undefined => bookOf(room, device).quests.find(quest => quest.def.id === RING);
/** The opening of Driftwood's quest, and some gear: talk, then the chest, which holds a flint. */
export function opening(room: DedicatedRoom, phone: Phone): void {
  run(room, [phone], 10);
  stand(room, phone.device, -22, -71.5); run(room, [phone], 3);
  phone.client.act({ kind: 'interact', seq: 0, id: 'castaway.talk' }); run(room, [phone], 4);
  stand(room, phone.device, -22, -62.9); run(room, [phone], 3);
  phone.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(room, [phone], 4);
  expect(ring(room, phone.device)?.isStarted).toBe(true);
  expect(bookOf(room, phone.device).flags.has('has:flint')).toBe(true);
}
/** Coins and gear the way a tick files them. */
export function earn(room: DedicatedRoom, device: string, id: string): void {
  const body = room.bodyOf(device);
  if (body === undefined) throw new Error('No body');
  room.cell.owned.of(body.id).file({ grant: 'coins', name: 'coins', amount: 7 });
  room.cell.owned.of(body.id).file({ grant: 'item', name: 'cape', amount: 1 });
  room.book.file({ player: body.id, id, tick: 1, grant: 'coins', name: 'coins', amount: 7, pending: false });
}
export function purse(room: DedicatedRoom, device: string): { coins: number; cape: boolean } {
  const owned = room.cell.owned.of(room.bodyOf(device)?.id ?? '');
  return { coins: owned.purse.coins, cape: owned.owned.has('cape') };
}
export function quit(phone: Phone): SaveWrite {
  const before = writes.length;
  phone.link.server.close('left');
  const write = writes.slice(before).at(-1);
  if (write === undefined) throw new Error('No write');
  return write;
}

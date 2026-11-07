// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import type { ChatChannel } from '../src/shared/engine/net/acts';
import { CHAT_RADIUS, RoomChat, type ChatReport } from '../src/server/engine/net/chat';
import type { NetChat } from '../src/shared/engine/net/chatWire';
import { BitWriter } from '../src/shared/engine/net/bits';
import { NetClient } from '../src/client/engine/net/client';
import { decodeAct, decodeEvents, encodeAct, encodeEvents, type InitialBits } from '../src/shared/engine/net/messages';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.2c (J110, M5): room and proximity chat, the server's filter and a report button's message, over DirectLoopback. The
// worker's half is in test/standalone-acts.test.ts.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const none: InitialBits = () => undefined;

interface Seat { readonly client: NetClient; readonly link: DirectLoopback; readonly heard: NetChat[] }
function stage(): { host: SimHost; room: NetRoom; near: Seat; far: Seat; me: Seat; run: (ticks?: number) => void; reports: ChatReport[] } {
  const host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host), { x, y, z } = lead.position, world = new SimNetWorld(host), reports: ChatReport[] = [];
  const room = new NetRoom({ world, step: () => { host.step(); }, reports: { file: report => { reports.push(report); } } });
  const seat = (id: string, name: string): Seat => {
    const link = directLoopback(), client = new NetClient(link.client), heard: NetChat[] = [];
    client.onChat(line => { heard.push(line); });
    room.join(link.server, world.playerOf(id)); client.hello('', { player: `device:${name}`, name }); link.pump();
    return { client, link, heard };
  };
  const me = seat(lead.id, 'Ann'), near = seat(host.addPlayer('bot:near', { x: x + CHAT_RADIUS - 5, y, z }).id, 'Ben'), far = seat(host.addPlayer('bot:far', { x: x + CHAT_RADIUS + 5, y, z }).id, 'Cy');
  room.open(); for (const entry of [me, near, far]) entry.link.pump();
  const run = (ticks = 4): void => {
    for (let tick = 0; tick < ticks; tick++) {
      for (const entry of [me, near, far]) { entry.client.flush(); entry.link.pump(); }
      room.tick(); for (const entry of [me, near, far]) entry.link.pump();
    }
  };
  run();
  return { host, room, near, far, me, run, reports };
}

test('a chat act and a line round-trip', () => {
  for (const channel of ['room', 'proximity'] as ChatChannel[]) {
    const say = { kind: 'chat' as const, seq: 4, channel, text: 'héllo' };
    expect(decodeAct(new Uint8Array(encodeAct(new BitWriter(64), say)))).toEqual(say);
    const line: NetChat = { kind: 'chat', tick: 9, line: 3, channel, from: 2, name: 'Ann', text: 'héllo' };
    expect(decodeEvents(new Uint8Array(encodeEvents(new BitWriter(64), 9, [line], none)), none)?.events).toEqual([line]);
  }
  const report = { kind: 'report' as const, seq: 1, line: 4_000_000_000 };
  expect(decodeAct(new Uint8Array(encodeAct(new BitWriter(64), report)))).toEqual(report);
});

test('a room line reaches everyone, the speaker too', () => {
  const { host, room, near, far, me, run } = stage();
  me.client.say('room', 'hello all'); run();
  for (const entry of [me, near, far]) expect(entry.heard.map(line => [line.name, line.text, line.channel])).toEqual([['Ann', 'hello all', 'room']]);
  room.dispose(); host.dispose();
});

test('a proximity line stops at its radius, measured on the server', () => {
  const { host, room, near, far, me, run } = stage();
  me.client.say('proximity', 'psst'); run();
  expect(me.heard.map(line => line.text)).toEqual(['psst']);
  expect(near.heard.map(line => line.text)).toEqual(['psst']);
  expect(far.heard).toEqual([]);
  expect(near.heard[0]?.from).toBe(near.client.welcome?.handle === undefined ? -1 : [...near.client.entities.values()].find(entity => entity.id === leadPlayer(host).id)?.handle);
  room.dispose(); host.dispose();
});

test('everyone reads the filtered line; only a report holds what was typed', () => {
  const { host, room, near, far, me, run, reports } = stage();
  me.client.say('room', 'you sh1t​ <b>fool</b>'); run();
  const shown = 'you **** <b>fool</b>';
  for (const entry of [me, near, far]) expect(entry.heard.map(line => line.text)).toEqual([shown]);
  const { line = -1 } = near.heard[0] ?? {};
  near.client.report(line); near.client.report(line); far.client.report(line); me.client.report(line); near.client.report(line + 100); run();
  expect(reports).toEqual([
    { reporter: 'device:Ben', speaker: 'device:Ann', name: 'Ann', channel: 'room', typed: 'you sh1t <b>fool</b>', shown, tick: expect.any(Number) as number },
    { reporter: 'device:Cy', speaker: 'device:Ann', name: 'Ann', channel: 'room', typed: 'you sh1t <b>fool</b>', shown, tick: expect.any(Number) as number },
  ]);
  expect(room.stats.refused, 'a second report, your own line and an unknown line are refused').toBe(3);
  room.dispose(); host.dispose();
});

test('a speaker cannot flood, a blank line says nothing, and hostile text never ends the server', () => {
  const { host, room, near, me, run } = stage();
  for (let index = 0; index < 9; index++) me.client.say('room', `line ${String(index)}`);
  me.client.say('room', ' ​\n ');
  me.client.say('room', '💥'.repeat(200));
  run();
  expect(near.heard.map(line => line.text)).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
  expect(room.stats.refused).toBe(6);
  run(300);
  me.client.say('room', 'é'.repeat(300)); run();
  expect(new TextEncoder().encode(near.heard.at(-1)?.text).length).toBeLessThanOrEqual(240);
  expect(near.client.closed).toBeNull();
  room.dispose(); host.dispose();
});

test('a reporter cannot flood either, and a line stops counting them', () => {
  const filed: ChatReport[] = [], chat = new RoomChat({ file: report => { filed.push(report); } });
  for (let line = 1; line <= 20; line++) chat.say({ player: 'p', name: 'P', body: 'b' }, 'room', `line ${String(line)}`, line * 100);
  for (let line = 1; line <= 20; line++) chat.report('r', line, 2000);
  expect(filed).toHaveLength(5);
  expect(chat.report('r', 6, 2000), 'still inside the window').toBe(false);
  expect(chat.report('r', 6, 2300), 'a window later').toBe(true);
  for (let reporter = 0; reporter < 40; reporter++) chat.report(`churn${String(reporter)}`, 7, 2400);
  expect(filed.filter(row => row.typed === 'line 7')).toHaveLength(32);
});

test('a stream of new names leaves nothing behind', () => {
  const chat = new RoomChat();
  for (let tick = 0; tick < 3000; tick++) chat.say({ player: `device:${String(tick)}`, name: 'N', body: 'b' }, 'room', 'hi', tick);
  expect(chat.held).toBeLessThanOrEqual(600);
});

test('a flood stops before its text is read', () => {
  const chat = new RoomChat(), filter = vi.spyOn(String.prototype, 'normalize');
  for (let index = 0; index < 100; index++) chat.say({ player: 'p', name: 'P', body: 'b' }, 'room', 'hi', 1);
  expect(filter.mock.calls.length).toBe(5);
});

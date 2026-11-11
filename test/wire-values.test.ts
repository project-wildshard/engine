// WIRE-STABILITY WR5: every game event form, sent the wire v1 way and read back, is the value today's v0 codec gives.
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns, type ClassColumns } from '@wildshard/wire/columns';
import { encodeEvents as encodeWire, eventsDecoder, eventTables } from '@wildshard/wire/eventStream';
import { actCodec, clientTables, commandsCodec, decodeBody, encodeBody, localCodecs, readMessage, TAG_ACT, TAG_CMDS } from '@wildshard/wire/game';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { spawnColumns } from '@wildshard/wire/spawnColumns';
import { expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import type { NetRoomAct } from '../src/shared/engine/net/acts';
import { decodeCommands, encodeCommands, quantiseCommand } from '../src/shared/engine/net/command';
import { decodeAct, decodeEvents, encodeAct, encodeEvents, type InitialBits, type NetEvent } from '../src/shared/engine/net/messages';
import { fromWireAct, fromWireCommand, fromWireEvent, toWireAct, toWireCommand, toWireEvent } from '../src/shared/engine/net/wireValues';

const COLUMNS = new Map<number, ClassColumns>(WIRE_CLASSES.map(entry => [entry.id, classColumns(entry)]));
const SPAWNS = spawnColumns(id => COLUMNS.get(id));
const player = COLUMNS.get(1);
const initialBits: InitialBits = cls => { const columns = COLUMNS.get(cls + 1); return columns === undefined ? undefined : { bits: columns.initial.map(column => column.bits), text: columns.text.length }; };

/** Every number to 9 places, so a last-ulp difference in a quantised decode does not count. */
const near = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_, inner: unknown) => typeof inner === 'number' ? Math.round(inner * 1e9) / 1e9 : inner));

const EVENTS: readonly NetEvent[] = [
  { kind: 'spawn', handle: 3, cls: 0, id: 'player:ana', initial: (player?.initial ?? []).map((_, index) => index % 2), text: (player?.text ?? []).map(() => 'Ana') },
  { kind: 'despawn', handle: 3 },
  { kind: 'hit', tick: 901, target: 0x1203, amount: 37.5, at: [12.5, -3.25, 200], head: true, killed: false, confirmFor: 4242 },
  { kind: 'hit', tick: 901, target: 9, amount: 12, at: [0, 0, 0], head: false, killed: true, confirmFor: 0, blow: true },
  { kind: 'died', tick: 902, id: 0x1203, by: 7, dir: [0, -1, 0.5], impulse: 37.5 },
  { kind: 'player-died', tick: 903, id: 4, checkpoint: true },
  { kind: 'player-died', tick: 903, id: 4, checkpoint: false, cause: { kind: 'fall', label: 'death.fall', text: 'death.fall.text' } },
  { kind: 'reward', tick: 17, coins: 7, body: 9, item: 'boar-tusk' },
  { kind: 'reward', tick: 17, coins: 2, body: 9 },
  { kind: 'view', tick: 9, name: 'hazard.ring', args: [1, 2.5, -3, 4] },
  { kind: 'view', tick: 9, name: 'strike.arc.off', args: [] },
  { kind: 'quest', tick: 5, quest: 'first-steps', started: true, step: 'find-the-well', n: 2 },
  { kind: 'quest', tick: 5, quest: 'first-steps', started: false, step: null, n: 0 },
  { kind: 'phase', tick: 6, flag: 'gate.open', on: true },
  { kind: 'travel', tick: 7, from: 0, to: 3 },
  { kind: 'mount', tick: 8, rider: 3, mount: 11, seq: 40 },
  { kind: 'dismount', tick: 8, rider: 3, mount: 11, seq: 0 },
  { kind: 'owned', tick: 10, name: 'coins', value: 12.5 },
  { kind: 'ledger', tick: 3, serial: 2, id: 'a.b', grant: 'coins', name: 'coins', amount: 12.5, pending: true },
  { kind: 'ledger', tick: 3, serial: 3, id: 'a.c', grant: 'fact', name: 'met-the-smith', amount: 0, pending: false },
  { kind: 'chat', tick: 9, line: 3, channel: 'proximity', from: 2, name: 'Ann', text: 'héllo' },
  { kind: 'chat', tick: 9, line: 4, channel: 'room', from: 0, name: '', text: 'the gate opens' },
] as NetEvent[];

test('every event form reads back through wire v1 as it does through v0', () => {
  for (const event of EVENTS) {
    const v0 = decodeEvents(new Uint8Array(encodeEvents(new BitWriter(), 1, [event], initialBits)), initialBits)?.events[0];
    const bytes = encodeWire(1, [toWireEvent(event)], SPAWNS);
    const [record] = readMessage(bytes).records;
    if (record === undefined) throw new Error('no events record');
    const read = eventsDecoder(eventTables(), SPAWNS)({ bytes, start: record.start, end: record.end });
    const [wire] = read.events;
    // Quantised values decode by the wire's own formula (min + word * step), so they agree with v0's to the last ulp.
    expect(near(wire === undefined ? null : fromWireEvent(wire)), event.kind).toEqual(near(v0));
  }
});

test('an event kind this build has no form for is left out, not guessed', () => {
  expect(fromWireEvent({ event: 'aurora', fields: {} })).toBeNull();
});

const ROOM_IDS = ['', 'boar:1', 'player:ana', 'door:west'];
const refs = (id: string): number => Math.max(0, ROOM_IDS.indexOf(id));
const ids = (handle: number): string | undefined => (handle > 0 ? ROOM_IDS[handle] : undefined);
const STEER = { keyX: 1, keyY: -0.5, stickX: 0.25, stickY: 0 };
const AIM = { origin: { x: 1.5, y: 2, z: -3 }, direction: { x: 0, y: 0.6, z: 0.8 } };
const COMMANDS: readonly NetCommand[] = [
  { seq: 1, viewTick: 2, steer: STEER, yaw: 1.25, pitch: -0.3, buttons: 5 },
  { seq: 65_535, viewTick: 0, steer: STEER, yaw: -7, pitch: 1.5, buttons: 0x1_05, attack: { aim: AIM } },
  { seq: 3, viewTick: 4, steer: STEER, yaw: 0, pitch: 0, buttons: 0, attack: { targetId: 'boar:1', aim: AIM }, heavyTarget: 'player:ana', lockTarget: 'door:west', hookTarget: 77 },
  { seq: 5, viewTick: 6, steer: STEER, yaw: 3, pitch: 0.1, buttons: 0x80, launcher: { slot: 3, ads: 0.5, fire: true } },
  { seq: 7, viewTick: 8, steer: STEER, yaw: 3, pitch: 0.1, buttons: 0, launcher: { slot: 31, ads: 1 } },
];
const ACTS: readonly NetRoomAct[] = [
  { kind: 'interact', seq: 1, id: 'door' }, { kind: 'reload', seq: 2, slot: 1 }, { kind: 'equip', seq: 3, slot: 0 },
  { kind: 'chat', seq: 4, channel: 'proximity', text: 'héllo' }, { kind: 'report', seq: 5, line: 9 },
  { kind: 'ride', seq: 6, action: 'mount' }, { kind: 'climate', seq: 7, op: 'time', name: 'dusk', at: 0.75 },
  { kind: 'buy', seq: 8, good: 4 }, { kind: 'board', seq: 9, op: 'tear', slot: 2 }, { kind: 'wear', seq: 10, id: 'hat' },
  { kind: 'pose', seq: 11, names: 'wave' },
] as NetRoomAct[];

test('every command form reads back through wire v1 as it does through v0', () => {
  const v0 = decodeCommands(new Uint8Array(encodeCommands(new BitWriter(), { ackFrame: 9, commands: COMMANDS }, refs)), ids);
  const local = localCodecs(), server = commandsCodec(clientTables().commandTable);
  const bytes = encodeBody(local.commands, TAG_CMDS, { ackFrame: 9, commands: COMMANDS.map(command => toWireCommand(command, refs)) });
  const [record] = readMessage(bytes).records;
  if (record === undefined) throw new Error('no cmds record');
  const read = decodeBody(server, { bytes, start: record.start, end: record.end });
  const commands = (read['commands'] as readonly Record<string, never>[]).map(fields => fromWireCommand(fields, ids));
  expect(near({ ackFrame: read['ackFrame'], commands })).toEqual(near(v0));
});

test('a command naming a handle the room does not know refuses, as in v0', () => {
  const fields = toWireCommand({ seq: 1, viewTick: 1, steer: STEER, yaw: 0, pitch: 0, buttons: 0, lockTarget: 'boar:1' }, () => 99);
  expect(() => fromWireCommand(fields, ids)).toThrow(RangeError);
});

test('every act form reads back through wire v1 as it does through v0', () => {
  const local = localCodecs(), server = actCodec(clientTables().actTable);
  for (const act of ACTS) {
    const v0 = decodeAct(new Uint8Array(encodeAct(new BitWriter(), act)));
    const bytes = encodeBody(local.act, TAG_ACT, toWireAct(act));
    const [record] = readMessage(bytes).records;
    if (record === undefined) throw new Error('no act record');
    expect(near(fromWireAct(decodeBody(server, { bytes, start: record.start, end: record.end }))), act.kind).toEqual(near(v0));
  }
});

test('quantiseCommand steps exactly what the wire v1 command codec delivers: every axis word, and pitch and yaw swept', () => {
  const local = localCodecs(), server = commandsCodec(clientTables().commandTable);
  const through = (command: NetCommand): NetCommand => {
    const bytes = encodeBody(local.commands, TAG_CMDS, { ackFrame: 0, commands: [toWireCommand(command, refs)] });
    const [record] = readMessage(bytes).records;
    if (record === undefined) throw new Error('no cmds record');
    const [read] = decodeBody(server, { bytes, start: record.start, end: record.end })['commands'] as readonly Record<string, never>[];
    if (read === undefined) throw new Error('no command');
    return fromWireCommand(read, ids);
  };
  // Words 1 to 255 are the axis domain, -1 to 1; word 0 (-128/127) is outside it, and admission refuses it.
  for (let word = 1; word < 256; word++) {
    const axis = (word - 128) / 127, steer = { keyX: axis, keyY: -axis, stickX: axis / 2, stickY: 0 };
    const command = { seq: 1, viewTick: 1, steer, yaw: word * 0.0245, pitch: (word / 255 - 0.5) * Math.PI * 0.999, buttons: 0, launcher: { slot: word % 32, ads: (word * 1.37 % 256) / 255 } };
    const wire = through(command), local = quantiseCommand(command);
    const v0 = decodeCommands(new Uint8Array(encodeCommands(new BitWriter(), { ackFrame: 0, commands: [command] }, refs)), ids)?.commands[0];
    expect(Math.abs((wire.launcher?.ads ?? -1) - (v0?.launcher?.ads ?? -2)), `ads ${String(word)}`).toBeLessThan(1e-12);
    expect(wire.steer, `axis word ${String(word)}`).toEqual(local.steer);
    expect(Math.abs(wire.pitch - local.pitch), `pitch ${String(word)}`).toBeLessThan(1e-12);
    expect(Math.abs(Math.cos(wire.yaw) - Math.cos(local.yaw)) + Math.abs(Math.sin(wire.yaw) - Math.sin(local.yaw)), `yaw ${String(word)}`).toBeLessThan(1e-12);
  }
});

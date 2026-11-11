// WIRE-STABILITY WR5: every game event form, sent the wire v1 way and read back, is the value today's v0 codec gives.
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns, type ClassColumns } from '@wildshard/wire/columns';
import { encodeEvents as encodeWire, eventsDecoder, eventTables } from '@wildshard/wire/eventStream';
import { readMessage } from '@wildshard/wire/game';
import { spawnColumns } from '@wildshard/wire/spawnColumns';
import { expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import { decodeEvents, encodeEvents, type InitialBits, type NetEvent } from '../src/shared/engine/net/messages';
import { fromWireEvent, toWireEvent } from '../src/shared/engine/net/wireValues';

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

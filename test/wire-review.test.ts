// WR5's Codex review (J206), each MUST as a regression: event bursts split under the wire's cap; a class this build lacks
// never blocks a frame; spawn text projects by field id; a frame after another record still applies; a server table this
// build can't project closes as `reload` instead of hanging unwelcomed.
import { encodeClassTables } from '@wildshard/wire/classTables';
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns } from '@wildshard/wire/columns';
import { encodeFrame as encodeWire } from '@wildshard/wire/frameRecord';
import { MAX_MESSAGE_BYTES } from '@wildshard/wire/framing';
import { readMessage } from '@wildshard/wire/game';
import { encodeWelcome } from '@wildshard/wire/handshake';
import { encodeRideLawTables } from '@wildshard/wire/rideTables';
import { RIDE_LAWS } from '@wildshard/wire/rides';
import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { WorldFrame, type FrameInput } from '../src/shared/engine/net/frame';
import type { NetEvent } from '../src/shared/engine/net/messages';
import { ANIMAL_CLASS, PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { NetClass } from '../src/shared/engine/net/schema';
import { snapshotOf, WireFrameReader } from '../src/shared/engine/net/wireFrames';
import { eventsMessages, localEvents, SERVER_TABLES } from '../src/shared/engine/net/wireMessages';
import { directLoopback } from '../src/test/engine/netLoopback';

const OWNER: NetClass<never> = PLAYER_CLASS, ANIMAL: NetClass<never> = ANIMAL_CLASS;
const RIDES = encodeRideLawTables(RIDE_LAWS);
const animal = WIRE_CLASSES.find(entry => entry.name === 'animal'), player = WIRE_CLASSES.find(entry => entry.name === 'player');
if (animal === undefined || player === undefined) throw new Error('classes moved');

test('a burst of events past 64 KiB goes as several messages, each under the cap, every event in order', () => {
  const events: NetEvent[] = Array.from({ length: 70 }, (_, at) => ({ kind: 'view', tick: 5, name: `burst.${String(at)}`, args: Array.from({ length: 255 }, (__, arg) => arg + at) }));
  const messages = eventsMessages(5, events);
  expect(messages.length).toBeGreaterThan(1);
  for (const message of messages) expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  const read = messages.flatMap(message => localEvents(message)?.events ?? []);
  expect(read.map(event => (event.kind === 'view' ? event.name : ''))).toEqual(events.map(event => (event.kind === 'view' ? event.name : '')));
});

/** One animal (handle 1) and one of `kite`, a class only the newer sender has (handle 2), in the sender's layout. */
function newerSender(): { tables: { classTables: Uint8Array; rideLawTables: Uint8Array }; bytes: Uint8Array } {
  const kite = { id: 7, name: 'kite', fields: [{ id: 1, name: 'x', node: { kind: 'uint' as const, bits: 8 } }] };
  const classes = [...WIRE_CLASSES, kite], columns = new Map(classes.map(entry => [entry.id, classColumns(entry)]));
  const frame = new WorldFrame(); frame.reset(10);
  const at = frame.claim(1, ANIMAL.row.length); frame.data.fill(1, at, at + ANIMAL.row.length);
  const kiteAt = frame.claim(2, 1); frame.data[kiteAt] = 9;
  const input = { frame, cell: 0, lastSeq: 0, ownerClass: OWNER, owner: new Float64Array(OWNER.owner.length), visible: new Set([1, 2]), baseline: null, classOf: () => ANIMAL } as FrameInput;
  const bytes = encodeWire({ ...snapshotOf(input), classOf: handle => columns.get(handle === 2 ? 7 : 2) });
  return { tables: { classTables: encodeClassTables(classes), rideLawTables: RIDES }, bytes };
}
const spanOf = (bytes: Uint8Array, index = 0): { bytes: Uint8Array; start: number; end: number } => {
  const record = readMessage(bytes).records[index];
  if (record === undefined) throw new Error('no record');
  return { bytes, start: record.start, end: record.end };
};

test('a class this build lacks decodes by its sender id and is left out of the projection, never blocking the frame', () => {
  const { tables, bytes } = newerSender();
  const reader = new WireFrameReader(tables, handle => (handle === 2 ? 7 : 2), OWNER);
  const decoded = reader.read(spanOf(bytes));
  expect(decoded).not.toBeNull();
  expect([...(decoded?.rows.keys() ?? [])]).toEqual([1]);
});

test('a frame after another record in one message still applies', () => {
  const { tables, bytes } = newerSender(), events = eventsMessages(10, [{ kind: 'phase', tick: 10, flag: 'gate', on: true }])[0];
  if (events === undefined) throw new Error('no events');
  const both = new Uint8Array(events.length + bytes.length); both.set(events); both.set(bytes, events.length);
  const decoded = new WireFrameReader(tables, handle => (handle === 2 ? 7 : 2), OWNER).read(spanOf(both, 1));
  expect(decoded?.tick).toBe(10);
});

test('spawn text projects by field id: a sender with an extra text field first still names the boar a boar', () => {
  const extra = { ...animal, fields: [{ id: 99, name: 'extra', node: { kind: 'text' as const, maxBytes: 255 }, send: 'initial' as const }, ...animal.fields] };
  const classes = WIRE_CLASSES.map(entry => (entry === animal ? extra : entry));
  const reader = new WireFrameReader({ classTables: encodeClassTables(classes), rideLawTables: RIDES }, () => 2, OWNER);
  // The sender's text order is extra (99), kind (19), variant (20), rarity (21); this build's is kind, variant, rarity.
  expect(reader.text(2, ['shiny', 'boar', 'brown', 'common'])).toEqual(['boar', 'brown', 'common']);
});

test('a welcome whose tables this build cannot project closes as `reload`, never hanging unwelcomed', () => {
  const lacking = { ...player, fields: player.fields.filter(field => field.name !== 'px') };
  const classTables = encodeClassTables(WIRE_CLASSES.map(entry => (entry === player ? lacking : entry)));
  const link = directLoopback(), client = new NetClient(link.client);
  const welcome = encodeWelcome({ minor: 0, build: '', handle: 1, player: 'p', tick: 1, cell: 0, simHz: 60, frameHz: 30, capabilities: [], requiredCapabilities: [], tableHash: 1, tables: { ...SERVER_TABLES.tables, classTables } });
  link.server.send('reliable', welcome.buffer); link.pump();
  expect(client.welcome).toBeNull();
  expect(client.closed).toBe('reload');
});

// WIRE-STABILITY WR5 (5.1, 5.3): the game's messages on wire v1, in the game's own values. Hello and welcome are cold
// records carrying each side's tables; cmds, act and events are hot records in the sender's layout, read through the
// sender's tables. `wireValues.ts` and `wireFrames.ts` do the value and frame halves.
import { encodeClassTables } from '@wildshard/wire/classTables';
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns, type ClassColumns } from '@wildshard/wire/columns';
import { encodeEvents, eventsDecoder, eventTables } from '@wildshard/wire/eventStream';
import { actCodec, clientTables, commandsCodec, decodeBody, encodeBody, localCodecs, readMessage, TAG_ACT, TAG_CMDS, TAG_EVENTS, type BodyCodec } from '@wildshard/wire/game';
import { encodeHello, encodeWelcome, tableHash, type Hello, type Welcome } from '@wildshard/wire/handshake';
import { WIRE_MINOR } from '@wildshard/wire/major';
import { encodeRideLawTables } from '@wildshard/wire/rideTables';
import { RIDE_LAWS } from '@wildshard/wire/rides';
import { spawnColumns } from '@wildshard/wire/spawnColumns';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { NetRoomAct } from './acts';
import type { NetEvent, NetWelcome } from './messages';
import { fromWireAct, fromWireCommand, fromWireEvent, toWireAct, toWireCommand, toWireEvent, type WireIds, type WireRefs } from './wireValues';

/** Where a record body lies in a message. */
export type Span = Parameters<typeof decodeBody>[1];

const LOCAL_COLUMNS: ReadonlyMap<number, ClassColumns> = new Map(WIRE_CLASSES.map(entry => [entry.id, classColumns(entry)]));
/** This build's spawn columns: a server writes spawns in its own layout. */
const LOCAL_SPAWNS = spawnColumns(id => LOCAL_COLUMNS.get(id));
const LOCAL = localCodecs();

/** The server's table blocks (5.3), and their hash. */
export interface ServerTables { readonly tables: { readonly classTables: Uint8Array; readonly eventTables: Uint8Array; readonly rideLawTables: Uint8Array }; readonly hash: number }
/** The server's table blocks and their hash, once per build. */
export const SERVER_TABLES: ServerTables = (() => {
  const tables = { classTables: encodeClassTables(WIRE_CLASSES), eventTables: eventTables(), rideLawTables: encodeRideLawTables(RIDE_LAWS) };
  return { tables, hash: tableHash([tables.classTables, tables.eventTables, tables.rideLawTables]) };
})();

/** A client's first message: the bootstrap, then its hello with its command and act tables (5.1). */
export function helloMessage(hello: Pick<Hello, 'build' | 'player' | 'name' | 'ledger'>): Uint8Array<ArrayBuffer> {
  return encodeHello({ ...hello, minor: WIRE_MINOR, capabilities: [], ...clientTables() });
}

/** The server's welcome; `tables` false on a travel to a socket that already holds this hash (5.3). */
export function welcomeMessage(welcome: Omit<NetWelcome, 'schemaHash'>, build: string, required: readonly number[] = [], tables = true): Uint8Array<ArrayBuffer> {
  const out: Welcome = { ...welcome, minor: WIRE_MINOR, build, capabilities: [], requiredCapabilities: required, tableHash: SERVER_TABLES.hash, ...(tables ? { tables: SERVER_TABLES.tables } : {}) };
  return encodeWelcome(out);
}

/** An events message from the server, spawns in its own layout. */
export function eventsMessage(tick: number, events: readonly NetEvent[]): Uint8Array<ArrayBuffer> {
  return encodeEvents(tick, events.map(toWireEvent), LOCAL_SPAWNS);
}

/** A client's command bundle, targets as handles. */
export function commandsMessage(ackFrame: number, commands: readonly NetCommand[], refs: WireRefs): Uint8Array<ArrayBuffer> {
  return encodeBody(LOCAL.commands, TAG_CMDS, { ackFrame, commands: commands.map(command => toWireCommand(command, refs)) });
}

/** A client's act. */
export function actMessage(act: NetRoomAct): Uint8Array<ArrayBuffer> {
  return encodeBody(LOCAL.act, TAG_ACT, toWireAct(act));
}

/** What a server reads one client's records with: that client's own tables, compiled once at its hello. */
export class WireClientReader {
  private readonly commands: BodyCodec;
  private readonly acts: BodyCodec;
  constructor(hello: Pick<Hello, 'commandTable' | 'actTable'>) { this.commands = commandsCodec(hello.commandTable); this.acts = actCodec(hello.actTable); }
  /** A cmds record; throws on a malformed body or an unknown handle (the room counts it refused). */
  commandsOf(span: Span, ids: WireIds): { readonly ackFrame: number; readonly commands: readonly NetCommand[] } {
    const fields = decodeBody(this.commands, span), list = fields['commands'];
    const commands = Array.isArray(list) ? list.map(item => fromWireCommand(item as never, ids)) : [];
    return { ackFrame: typeof fields['ackFrame'] === 'number' ? fields['ackFrame'] : 0, commands };
  }
  /** An act record, before admission. */
  actOf(span: Span): NetRoomAct { return fromWireAct(decodeBody(this.acts, span)); }
}

/** What a client reads one server's events with: that server's event tables and spawn columns. */
export function eventsReader(tables: Uint8Array, senderColumns: (id: number) => ClassColumns | undefined): (span: Span) => { readonly tick: number; readonly events: readonly NetEvent[] } {
  const read = eventsDecoder(tables, spawnColumns(senderColumns));
  return span => {
    const { tick, events } = read(span);
    return { tick, events: events.map(fromWireEvent).filter((event): event is NetEvent => event !== null) };
  };
}

/** The record tags a message holds, or [] when its framing is malformed: for tests, bots and the doctor. */
export function recordTags(bytes: Uint8Array): number[] {
  try { return readMessage(bytes).records.map(record => record.tag); } catch { return []; }
}

const LOCAL_EVENTS = eventsReader(eventTables(), id => LOCAL_COLUMNS.get(id));
/** An events message from a server of this very build, read with this build's own tables; null if it holds none. */
export function localEvents(bytes: Uint8Array): { readonly tick: number; readonly events: readonly NetEvent[] } | null {
  try {
    const record = readMessage(bytes).records.find(entry => entry.tag === TAG_EVENTS);
    return record === undefined ? null : LOCAL_EVENTS({ bytes, start: record.start, end: record.end });
  } catch { return null; }
}

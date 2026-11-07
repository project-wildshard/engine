// P1-E5.2 (E5-REPLICATION §4.2–4.3): the small messages around `frame` and `cmds`. Every message starts with its id byte.
import { CLIMATE_OPS, type NetRoomAct } from './acts';
import { BitReader, bitsToFloat, floatToBits, NetDecodeError, type BitWriter } from './bits';
import type { NetIdentity } from './identity';
import { readChat, writeChat, type NetChat } from './chatWire';
import { readLedger, writeLedger, type NetLedger } from './ledgerWire';
import type { QuestProgress } from '../quest/progress';
import type { DeathCause } from '../combat/pipeline';

export const MSG_HELLO = 1;
export const MSG_CMDS = 2;
export const MSG_ACT = 3;
export const MSG_WELCOME = 4;
export const MSG_FRAME = 5;
export const MSG_EVENTS = 6;
/** The id byte of any message, or 0 for an empty one. */
export function messageId(bytes: Uint8Array): number { return bytes[0] ?? 0; }

/** Run a decoder at the trust boundary: malformed bytes give null, never an exception. */
function guarded<T>(bytes: Uint8Array, id: number, read: (reader: BitReader) => T): T | null {
  try {
    const reader = new BitReader(bytes);
    if (reader.read(8) !== id) return null;
    const out = read(reader);
    reader.end();
    return out;
  } catch (error) { if (error instanceof NetDecodeError) return null; throw error; }
}

/**
 * `hello`: what the client was built from, a mismatch of either refused (J54), and who it is (J111). `ledger` is the last
 * receipt serial it has, so a client that comes back hears only what it missed (M8).
 */
export interface NetHello extends NetIdentity { readonly schemaHash: number; readonly build: string; readonly ledger: number }
export function encodeHello(writer: BitWriter, hello: NetHello): ArrayBuffer {
  writer.write(MSG_HELLO, 8); writer.write(hello.schemaHash, 32); writer.writeText(hello.build);
  writer.writeText(hello.player); writer.writeText(hello.name); writer.write(hello.ledger, 32);
  return writer.finish();
}
export function decodeHello(bytes: Uint8Array): NetHello | null {
  return guarded(bytes, MSG_HELLO, reader => ({ schemaHash: reader.read(32), build: reader.readText(), player: reader.readText(), name: reader.readText(), ledger: reader.read(32) }));
}

/** `welcome`: your player's handle and id, the server's tick and rates (sim 60, frame 30, J40). A frame's rows leave its own player out, so nothing else names it. */
export interface NetWelcome { readonly handle: number; readonly player: string; readonly tick: number; readonly cell: number; readonly schemaHash: number; readonly simHz: number; readonly frameHz: number }
export function encodeWelcome(writer: BitWriter, welcome: NetWelcome): ArrayBuffer {
  writer.write(MSG_WELCOME, 8); writer.write(welcome.handle, 16); writer.writeText(welcome.player); writer.write(welcome.tick, 32); writer.write(welcome.cell, 16);
  writer.write(welcome.schemaHash, 32); writer.write(welcome.simHz, 8); writer.write(welcome.frameHz, 8);
  return writer.finish();
}
export function decodeWelcome(bytes: Uint8Array): NetWelcome | null {
  return guarded(bytes, MSG_WELCOME, reader => ({ handle: reader.read(16), player: reader.readText(), tick: reader.read(32), cell: reader.read(16), schemaHash: reader.read(32), simHz: reader.read(8), frameHz: reader.read(8) }));
}

/** An entity entering a client's relevance: its identity and initial fields, once (§3.4). */
export interface NetSpawn { readonly kind: 'spawn'; readonly handle: number; readonly cls: number; readonly id: string; readonly initial: readonly number[]; readonly text: readonly string[] }
/** The server retired an entity, so its handle's slot may be reused under a new generation. */
export interface NetDespawn { readonly kind: 'despawn'; readonly handle: number }
/** A cell-local vector. */
export type NetVector = readonly [number, number, number];
/** The server settled a hit (J47): impact FX, hit-stop and damage numbers play from this. `confirmFor` is the seq of the command that swung or fired this very blow, or 0. */
export interface NetHit { readonly kind: 'hit'; readonly tick: number; readonly target: number; readonly amount: number; readonly at: NetVector; readonly head: boolean; readonly killed: boolean; readonly confirmFor: number }
/** An entity died (J33): `by` is the killer's handle or 0; each client throws its own ragdoll along `dir` from `impulse`. */
export interface NetDied { readonly kind: 'died'; readonly tick: number; readonly id: number; readonly by: number; readonly dir: NetVector; readonly impulse: number }
/** The owner's settled health lifecycle, after its checkpoint answered; creature ragdolls use `died` separately. */
export interface NetPlayerDied { readonly kind: 'player-died'; readonly tick: number; readonly id: number; readonly checkpoint: boolean; readonly cause?: DeathCause }
/** J105: this client's own roll on a body paid out. Goes to its owner and nobody else. */
export interface NetReward { readonly kind: 'reward'; readonly tick: number; readonly coins: number; readonly body: number }
/** A fight told its views something: a tell, a ring, a glow. A client's room draws them in order, and nothing here decides. */
export interface NetView { readonly kind: 'view'; readonly tick: number; readonly name: string; readonly args: readonly number[] }
/** The events a settled fight sends. */
export type NetCombatEvent = NetHit | NetDied | NetReward;
/** A quest moved for this client's own player (P1-E3.3), or it joined: quest state is per player and goes only to its owner. */
export interface NetQuest extends QuestProgress { readonly kind: 'quest'; readonly tick: number }
/** One reliable event. E3 and E4 add `ledger` and the rest as their views need them. */
/** A flag that shapes this client's own world rose or fell (J106): its gates and keys are its alone. */
export interface NetPhase { readonly kind: 'phase'; readonly tick: number; readonly flag: string; readonly on: boolean }
/** This client's player crossed (P1-E3.9): every id, handle and row it holds belongs to the cell it left, and a `welcome` for `to` follows. Cells are frames: 0 is the highway. */
export interface NetTravel { readonly kind: 'travel'; readonly tick: number; readonly from: number; readonly to: number }
/** A player got on or off a ride (J48, §4.3). The ride itself is not predicted: a client's rider waits for this. `seq` is the command it stood at, 0 for anyone else's. */
interface NetRideChange<Kind extends string> { readonly kind: Kind; readonly tick: number; readonly rider: number; readonly mount: number; readonly seq: number }
export type NetRide = NetRideChange<'mount'> | NetRideChange<'dismount'>;
/** One line of what this client's own player holds in this world, a purse's coins or a pack's count, as it changed. 0 is gone. */
export interface NetOwned { readonly kind: 'owned'; readonly tick: number; readonly name: string; readonly value: number }
export type NetEvent = NetSpawn | NetDespawn | NetCombatEvent | NetPlayerDied | NetView | NetQuest | NetPhase | NetTravel | NetLedger | NetChat | NetRide | NetOwned;
/** The events' and commands' wire form, in NET_SCHEMA_HASH: a change here must refuse a stale client like a field table's does (J54). */
export const NET_EVENT_FORMS = 'view:s,u8,f32n;hit:h16,f32,p48,b,b,u16;died:h16,h16,d24,f32;player-died:h16,b,b,?s,?s,b,?s;quest:s,b,b,s,u16;phase:s,b;reward:u32,h16;travel:u16,u16;ledger:u32,u32,s,u2,s,f32,b;chat:u32,u32,b,h16,s,s;buttons:u8,b,u8;lockTarget:h16;hookTarget:u16;ride:u8;fresh:b;mount:h16,h16,u16;dismount:h16,h16,u16;rideWords:b,u8,f32;climate:b,s,f32;buy:u16;board:b,u16;wear:s;pose:s;owned:s,f32';
/** The spawn's column widths, which only the receiver's class table knows. */
export type InitialBits = (cls: number) => { readonly bits: readonly number[]; readonly text: number } | undefined;

const EVENT_SPAWN = 1, EVENT_DESPAWN = 2, EVENT_HIT = 3, EVENT_DIED = 4, EVENT_QUEST = 5, EVENT_PHASE = 6, EVENT_REWARD = 7, EVENT_TRAVEL = 8, EVENT_LEDGER = 9, EVENT_CHAT = 10, EVENT_MOUNT = 11, EVENT_DISMOUNT = 12, EVENT_OWNED = 13, EVENT_VIEW = 14, EVENT_PLAYER_DIED = 15;
/** Cell-local metres, as a field table declares them (§3.5). */
const METRES = 260, METRE_TOP = 0xffff, UNIT_TOP = 0xff;
const clampTo = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));
function writeScaled(writer: BitWriter, value: number, limit: number, bits: number, top: number): void { writer.write(Math.round((clampTo(value, limit) + limit) / (2 * limit) * top), bits); }
const readScaled = (reader: BitReader, limit: number, bits: number, top: number): number => reader.read(bits) / top * 2 * limit - limit;
const writeVector = (writer: BitWriter, value: NetVector, limit: number, bits: number, top: number): void => { for (const axis of value) writeScaled(writer, axis, limit, bits, top); };
const readVector = (reader: BitReader, limit: number, bits: number, top: number): NetVector => [readScaled(reader, limit, bits, top), readScaled(reader, limit, bits, top), readScaled(reader, limit, bits, top)];
function writeCombat(writer: BitWriter, event: NetCombatEvent): void {
  if (event.kind === 'reward') { writer.write(EVENT_REWARD, 8); writer.write(event.tick, 32); writer.write(event.coins, 32); writer.write(event.body, 16); return; }
  writer.write(event.kind === 'hit' ? EVENT_HIT : EVENT_DIED, 8); writer.write(event.tick, 32);
  if (event.kind === 'hit') {
    writer.write(event.target, 16); writer.write(floatToBits(event.amount), 32); writeVector(writer, event.at, METRES, 16, METRE_TOP);
    writer.writeBool(event.head); writer.writeBool(event.killed); writer.write(event.confirmFor, 16);
  } else { writer.write(event.id, 16); writer.write(event.by, 16); writeVector(writer, event.dir, 1, 8, UNIT_TOP); writer.write(floatToBits(event.impulse), 32); }
}
function readHit(reader: BitReader): NetHit {
  return { kind: 'hit', tick: reader.read(32), target: reader.read(16), amount: bitsToFloat(reader.read(32)), at: readVector(reader, METRES, 16, METRE_TOP),
    head: reader.readBool(), killed: reader.readBool(), confirmFor: reader.read(16) };
}
function readDied(reader: BitReader): NetDied {
  return { kind: 'died', tick: reader.read(32), id: reader.read(16), by: reader.read(16), dir: readVector(reader, 1, 8, UNIT_TOP), impulse: bitsToFloat(reader.read(32)) };
}
/** Encode an `events` message; `bits` gives the spawn fields' declared widths. */
export function encodeEvents(writer: BitWriter, tick: number, events: readonly NetEvent[], bits: InitialBits): ArrayBuffer {
  writer.write(MSG_EVENTS, 8); writer.write(tick, 32); writer.write(events.length, 16);
  for (const event of events) {
    if (event.kind === 'despawn') { writer.write(EVENT_DESPAWN, 8); writer.write(event.handle, 16); continue; }
    if (event.kind === 'hit' || event.kind === 'died' || event.kind === 'reward') { writeCombat(writer, event); continue; }
    if (event.kind === 'player-died') {
      writer.write(EVENT_PLAYER_DIED, 8); writer.write(event.tick, 32); writer.write(event.id, 16); writer.writeBool(event.checkpoint); writer.writeBool(event.cause !== undefined);
      if (event.cause !== undefined) { writer.writeText(event.cause.kind); writer.writeText(event.cause.label); writer.writeBool(event.cause.text !== undefined); if (event.cause.text !== undefined) writer.writeText(event.cause.text); }
      continue;
    }
    if (event.kind === 'ledger') { writer.write(EVENT_LEDGER, 8); writeLedger(writer, event); continue; }
    if (event.kind === 'chat') { writer.write(EVENT_CHAT, 8); writeChat(writer, event); continue; }
    if (event.kind === 'mount' || event.kind === 'dismount') { writer.write(event.kind === 'mount' ? EVENT_MOUNT : EVENT_DISMOUNT, 8); writer.write(event.tick, 32); writer.write(event.rider, 16); writer.write(event.mount, 16); writer.write(event.seq, 16); continue; }
    if (event.kind === 'view') { writer.write(EVENT_VIEW, 8); writer.write(event.tick, 32); writer.writeText(event.name); writer.write(event.args.length, 8); for (const arg of event.args) writer.write(floatToBits(arg), 32); continue; }
    if (event.kind === 'owned') { writer.write(EVENT_OWNED, 8); writer.write(event.tick, 32); writer.writeText(event.name); writer.write(floatToBits(event.value), 32); continue; }
    if (event.kind === 'travel') { writer.write(EVENT_TRAVEL, 8); writer.write(event.tick, 32); writer.write(event.from, 16); writer.write(event.to, 16); continue; }
    if (event.kind === 'phase') { writer.write(EVENT_PHASE, 8); writer.write(event.tick, 32); writer.writeText(event.flag); writer.writeBool(event.on); continue; }
    if (event.kind === 'quest') { writer.write(EVENT_QUEST, 8); writer.write(event.tick, 32); writer.writeText(event.quest); writer.writeBool(event.started); writer.writeBool(event.step !== null); writer.writeText(event.step ?? ''); writer.write(event.n, 16); continue; }
    writer.write(EVENT_SPAWN, 8); writer.write(event.handle, 16); writer.write(event.cls, 8); writer.writeText(event.id);
    bits(event.cls)?.bits.forEach((width, index) => { writer.write(event.initial[index] ?? 0, width); });
    for (const text of event.text) writer.writeText(text);
  }
  return writer.finish();
}
/** Decode an `events` message. An unknown class or event kind refuses the whole message. */
export function decodeEvents(bytes: Uint8Array, bits: InitialBits): { readonly tick: number; readonly events: readonly NetEvent[] } | null {
  return guarded(bytes, MSG_EVENTS, reader => {
    const tick = reader.read(32), count = reader.read(16), events: NetEvent[] = [];
    for (let index = 0; index < count; index++) {
      const kind = reader.read(8);
      if (kind === EVENT_DESPAWN) { events.push({ kind: 'despawn', handle: reader.read(16) }); continue; }
      if (kind === EVENT_HIT) { events.push(readHit(reader)); continue; }
      if (kind === EVENT_DIED) { events.push(readDied(reader)); continue; }
      if (kind === EVENT_PLAYER_DIED) {
        const at = reader.read(32), id = reader.read(16), checkpoint = reader.readBool();
        let cause: DeathCause | undefined;
        if (reader.readBool()) { const name = reader.readText(), label = reader.readText(); cause = { kind: name, label, ...(reader.readBool() ? { text: reader.readText() } : {}) }; }
        events.push({ kind: 'player-died', tick: at, id, checkpoint, ...(cause === undefined ? {} : { cause }) }); continue;
      }
      if (kind === EVENT_REWARD) { events.push({ kind: 'reward', tick: reader.read(32), coins: reader.read(32), body: reader.read(16) }); continue; }
      if (kind === EVENT_LEDGER) { events.push(readLedger(reader)); continue; }
      if (kind === EVENT_CHAT) { events.push(readChat(reader)); continue; }
      if (kind === EVENT_MOUNT || kind === EVENT_DISMOUNT) { events.push({ kind: kind === EVENT_MOUNT ? 'mount' : 'dismount', tick: reader.read(32), rider: reader.read(16), mount: reader.read(16), seq: reader.read(16) }); continue; }
      if (kind === EVENT_VIEW) { const at = reader.read(32), name = reader.readText(), args = Array.from({ length: reader.read(8) }, () => bitsToFloat(reader.read(32))); events.push({ kind: 'view', tick: at, name, args }); continue; }
      if (kind === EVENT_OWNED) { const at = reader.read(32), name = reader.readText(); events.push({ kind: 'owned', tick: at, name, value: bitsToFloat(reader.read(32)) }); continue; }
      if (kind === EVENT_TRAVEL) { events.push({ kind: 'travel', tick: reader.read(32), from: reader.read(16), to: reader.read(16) }); continue; }
      if (kind === EVENT_PHASE) { const at = reader.read(32), flag = reader.readText(); events.push({ kind: 'phase', tick: at, flag, on: reader.readBool() }); continue; }
      if (kind === EVENT_QUEST) {
        const at = reader.read(32), quest = reader.readText(), started = reader.readBool(), held = reader.readBool(), step = reader.readText();
        events.push({ kind: 'quest', tick: at, quest, started, step: held ? step : null, n: reader.read(16) }); continue;
      }
      if (kind !== EVENT_SPAWN) throw new NetDecodeError('Unknown event');
      const handle = reader.read(16), cls = reader.read(8), id = reader.readText(), widths = bits(cls);
      if (widths === undefined) throw new NetDecodeError('Unknown class');
      const initial = widths.bits.map(width => reader.read(width)), text = Array.from({ length: widths.text }, () => reader.readText());
      events.push({ kind: 'spawn', handle, cls, id, initial, text });
    }
    return { tick, events };
  });
}

const ACT_INTERACT = 1, ACT_RELOAD = 2, ACT_EQUIP = 3, ACT_CHAT = 4, ACT_REPORT = 5, ACT_RIDE = 6, ACT_CLIMATE = 7, ACT_BUY = 8, ACT_BOARD = 9, ACT_WEAR = 10, ACT_POSE = 11;
/** The ride acts, by their wire index. */
const RIDE_ACTIONS = ['offer', 'mount', 'dismount'] as const;
/** Encode an `act` message. */
export function encodeAct(writer: BitWriter, act: NetRoomAct): ArrayBuffer {
  writer.write(MSG_ACT, 8); writer.write(act.seq, 16);
  if (act.kind === 'interact') { writer.write(ACT_INTERACT, 8); writer.writeText(act.id); }
  else if (act.kind === 'reload') { writer.write(ACT_RELOAD, 8); writer.write(act.slot, 8); }
  else if (act.kind === 'equip') { writer.write(ACT_EQUIP, 8); writer.write(act.slot, 8); }
  else if (act.kind === 'ride') { writer.write(ACT_RIDE, 8); writer.write(RIDE_ACTIONS.indexOf(act.action), 8); }
  else if (act.kind === 'wear') { writer.write(ACT_WEAR, 8); writer.writeText(act.id); }
  else if (act.kind === 'board') { writer.write(ACT_BOARD, 8); writer.writeBool(act.op === 'tear'); writer.write(act.slot, 16); }
  else if (act.kind === 'buy') { writer.write(ACT_BUY, 8); writer.write(act.good, 16); }
  else if (act.kind === 'pose') { writer.write(ACT_POSE, 8); writer.writeText(act.names); }
  else if (act.kind === 'climate') { writer.write(ACT_CLIMATE, 8); writer.write(CLIMATE_OPS.indexOf(act.op), 8); writer.writeText(act.name); writer.write(floatToBits(act.at), 32); }
  else if (act.kind === 'chat') { writer.write(ACT_CHAT, 8); writer.writeBool(act.channel === 'proximity'); writer.writeText(act.text); }
  else { writer.write(ACT_REPORT, 8); writer.write(act.line, 32); }
  return writer.finish();
}
/** Decode an `act` message. */
export function decodeAct(bytes: Uint8Array): NetRoomAct | null {
  return guarded(bytes, MSG_ACT, (reader): NetRoomAct => {
    const seq = reader.read(16), kind = reader.read(8);
    if (kind === ACT_INTERACT) return { kind: 'interact', seq, id: reader.readText() };
    if (kind === ACT_RELOAD) return { kind: 'reload', seq, slot: reader.read(8) };
    if (kind === ACT_EQUIP) return { kind: 'equip', seq, slot: reader.read(8) };
    if (kind === ACT_RIDE) { const action = RIDE_ACTIONS[reader.read(8)]; if (action === undefined) throw new NetDecodeError('Unknown ride act'); return { kind: 'ride', seq, action }; }
    if (kind === ACT_WEAR) return { kind: 'wear', seq, id: reader.readText() };
    if (kind === ACT_BOARD) return { kind: 'board', seq, op: reader.readBool() ? 'tear' : 'claim', slot: reader.read(16) };
    if (kind === ACT_BUY) return { kind: 'buy', seq, good: reader.read(16) };
    if (kind === ACT_POSE) return { kind: 'pose', seq, names: reader.readText() };
    if (kind === ACT_CLIMATE) { const op = CLIMATE_OPS[reader.read(8)]; if (op === undefined) throw new NetDecodeError('Unknown climate act'); return { kind: 'climate', seq, op, name: reader.readText(), at: bitsToFloat(reader.read(32)) }; }
    if (kind === ACT_CHAT) return { kind: 'chat', seq, channel: reader.readBool() ? 'proximity' : 'room', text: reader.readText() };
    if (kind === ACT_REPORT) return { kind: 'report', seq, line: reader.read(32) };
    throw new NetDecodeError('Unknown act');
  });
}

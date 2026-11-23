import type { NetChannel } from './transport';

// E7.1: what one WebSocket carries. `WebSocket` keeps message boundaries, so a frame is one prefix byte and its payload. Both
// channels share TCP, so nothing is lost on the wire: "unreliable" only means the sender may skip it. Keepalive lives here
// because a browser cannot send protocol pings, and `resume`, `ready` and `countdown` stay outside the game protocol, so
// `NET_SCHEMA_HASH` does not move.

/** The prefix byte of every message on a game socket. */
export const SOCKET_RELIABLE = 0, SOCKET_UNRELIABLE = 1, SOCKET_PING = 2, SOCKET_PONG = 3, SOCKET_RESUME = 4, SOCKET_READY = 5, SOCKET_COUNTDOWN = 6, SOCKET_PLAYTEST=7, SOCKET_VOICE = 8, SOCKET_WORLD = 9, SOCKET_DEVICE = 10, SOCKET_ENTER = 11, SOCKET_ARRIVE = 12, SOCKET_SAVES = 13, SOCKET_WHERE = 14;
/** The messages outside the game protocol: the server's word on where to load, the client's that it has, and the server's that a new build is coming (J174). */
export type SocketControl = 'resume' | 'ready' | 'countdown' | 'playtest' | 'voice' | 'world' | 'device' | 'enter' | 'arrive' | 'saves' | 'where';
/** GO4: the door's first word on every socket, before any hello: how many grid cells it hosts and, since opus-route2, the shard each
 *  one runs, and nothing else (D7 keeps `/health` off the rooms address, so a page learns this here). A one-shard page joins only a
 *  world that names its shard. A build from before it ignores the prefix. */
export interface WorldWord { readonly cells: number; readonly shards: readonly string[];
  /** DEVICE-TELEMETRY DT3: 1 when this door reads the client's `device` word (deviceWord.ts). An older door never says it, and closes
   *  `refused` on a prefix it does not know, so a client sends the word only after hearing this. */
  readonly device?: 1;
  /** Bounded optional per-client observations; each extension has its own decoder. Later words omit device. */
  readonly status?: Readonly<Record<string, unknown>>;
  /** FM4 deploy-blocked (J174): in the first word, the seconds left before a deploy's move, while one is due. A page on the title hears
   *  it on its own socket before any hello (an older door never says it; an older client ignores it). */
  readonly moving?: { readonly inS: number };
  /** QA-FEEDBACK-2026-11-20-mini row 9: 1 when this door answers a seated page's `saves` word (its saves here, New Game). An older
   *  door never says it, and closes `refused` on a prefix it does not know, so a page asks only after hearing this. */
  readonly saves?: 1;
  /** QA 11-23-b row 19: 1 when this door answers a title's `where` word before any hello (`WhereAsk`). An older door never says it, and
   *  closes `refused` on a prefix it does not know, so a page asks only after hearing this. */
  readonly where?: 1;
  /** SHARD-COMPAT NB2 (J494, Jake 2026-11-22: "the page should always run the server revision"): each cell's upload hash, for a
   *  slug whose rooms run an upload (`gridCells.ts` `placedHash`), so a page that baked other bytes follows them (`roomsRevision.ts`).
   *  An older door never says it; an older page ignores it. */
  readonly revisions?: Readonly<Record<string, string>> }
/** J218: a voice word is JSON in a few hundred bytes; an SDP travels in pieces of this many characters, under the room's 1024-byte cap. */
export const VOICE_PIECE_CHARS = 400;
/** The server sends no frame while this much is waiting (E7.1). Delta-against-ack heals, and the next frame is just bigger. */
export const FRAME_SKIP_BYTES: number = 16 * 1024;
/** The server closes `stalled` past this: reliable messages are never skipped, so a client this far behind cannot catch up. */
export const STALL_CLOSE_BYTES: number = 256 * 1024;
/** The client skips a command flush while this much is waiting. A skipped bundle costs a correction, not a crash. */
export const COMMAND_SKIP_BYTES: number = 4 * 1024;
/** The client's keepalive, and how long the server goes without a byte before it closes `stalled`. */
export const PING_MS = 1000, SILENCE_MS = 3000;
/** The fewest milliseconds between pings a server answers: a ping is outside the room's message credit. */
export const PING_FLOOR_MS = 250;

const CLOSE_CODES: Readonly<Record<string, number>> = { reload: 4000, refused: 4001, full: 4002, replaced: 4003, stalled: 4004, restart: 4005, retry: 4006 };
/** A close nobody chose: the link died, or a code this build has no word for. */
export const SOCKET_LOST = 'lost';
/** A plain end, from either side: nobody was sent away. */
const CLOSE_NORMAL = 1000;

/** The close code that carries one of `NetRoom`'s reason strings. Anything else is a plain end. */
export function closeCode(reason: string): number { return CLOSE_CODES[reason] ?? CLOSE_NORMAL; }
/** The string a close code carries. */
export function closeReason(code: number): string {
  if (code === CLOSE_NORMAL) return 'closed';
  for (const [reason, value] of Object.entries(CLOSE_CODES)) if (value === code) return reason;
  return SOCKET_LOST;
}
/** The prefix of a game message on `channel`. */
export const channelPrefix = (channel: NetChannel): number => channel === 'reliable' ? SOCKET_RELIABLE : SOCKET_UNRELIABLE;
/** The prefix of a control message. */
export const controlPrefix = (control: SocketControl): number => control === 'resume' ? SOCKET_RESUME : control === 'ready' ? SOCKET_READY : control==='playtest'?SOCKET_PLAYTEST:control === 'voice' ? SOCKET_VOICE : control === 'world' ? SOCKET_WORLD : control === 'device' ? SOCKET_DEVICE : control === 'enter' ? SOCKET_ENTER : control === 'arrive' ? SOCKET_ARRIVE : control === 'saves' ? SOCKET_SAVES : control === 'where' ? SOCKET_WHERE : SOCKET_COUNTDOWN;
/**
 * ZONE-ENTRY ZE9a (J352): the client's word at a gate's 0, `{ cell }`, the cell it goes into. The road takes it only from a seat standing
 * in that cell's buffer, never into its own home, and freezes the body; it answers a word it won't take on the same prefix with the
 * cell and `refused`, and leaves the body free.
 */
export interface EnterWord { readonly cell: string; readonly refused?: string }
/** A cell instance as the grid names it: lower-case words joined by hyphens. */
const ENTER_CELL = /^[a-z0-9][a-z0-9-]{0,63}$/u, ENTER_BYTES = 256;
/** An `enter` word. */
export function encodeEnter(word: EnterWord): ArrayBuffer { return new TextEncoder().encode(JSON.stringify(word)).buffer; }
/** What an `enter` word says, or null for one that makes no sense (untrusted: bounded, and the cell must look like a cell's name). */
export function decodeEnter(bytes: ArrayBuffer): EnterWord | null {
  if (bytes.byteLength > ENTER_BYTES) return null;
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof said !== 'object' || said === null || !('cell' in said) || typeof said.cell !== 'string' || !ENTER_CELL.test(said.cell)) return null;
    return 'refused' in said && typeof said.refused === 'string' ? { cell: said.cell, refused: said.refused.slice(0, 64) } : { cell: said.cell };
  } catch { return null; }
}
/**
 * ZE9b: the door's answer to an `enter` it took: the cell, and where in its own frame the traveller stands once in (the entryway's
 * centre line, `ARRIVAL_DEPTH` in, facing into the cell). The page loads the cell, places the traveller there and says `ready`.
 */
export interface ArriveWord { readonly cell: string; readonly at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number } }
/** An `arrive` word. */
export function encodeArrive(word: ArriveWord): ArrayBuffer { return new TextEncoder().encode(JSON.stringify(word)).buffer; }
/** What an `arrive` word says, or null for one that makes no sense. */
export function decodeArrive(bytes: ArrayBuffer): ArriveWord | null {
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof said !== 'object' || said === null || !('cell' in said) || typeof said.cell !== 'string' || !('at' in said) || typeof said.at !== 'object' || said.at === null) return null;
    const { at } = said, pose = { x: 'x' in at ? at.x : Number.NaN, y: 'y' in at ? at.y : Number.NaN, z: 'z' in at ? at.z : Number.NaN, yaw: 'yaw' in at ? at.yaw : Number.NaN };
    return Object.values(pose).every(value => typeof value === 'number' && Number.isFinite(value)) ? { cell: said.cell, at: pose as ArriveWord['at'] } : null;
  } catch { return null; }
}
/**
 * QA-FEEDBACK-2026-11-20-mini row 9: a grid page's saves live in the room, which the page can neither read nor reset itself. A seated
 * page asks the door on its own socket, so the seat it asks for is always the one its hello was admitted as: `read` names shards and
 * the door answers this player's save on each; `reset` asks for New Game on one shard. The door takes a reset by letting the body go
 * (the link closes plainly) and forgets that save before this player is seated again; it answers only a refusal.
 */
export type SavesAsk = { readonly read: readonly string[] } | { readonly reset: string };
/** One shard's save as the room holds it: the player's own flags, their quests' state, and their store's document on that shard. */
export interface RoomSave { readonly flags: readonly string[]; readonly quests: readonly { readonly started: boolean; readonly currentId: string | null }[]; readonly keys: Readonly<Record<string, unknown>> }
/** The door's answer: each shard asked, with null where it holds nothing (or can't read it now); or a reset it refused. */
export type SavesAnswer = { readonly read: Readonly<Record<string, RoomSave | null>> } | { readonly reset: string; readonly ok: false };
/** A shard's slug, as a save names it. */
const SAVES_SLUG = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u, SAVES_ASK_BYTES = 4096, SAVES_SLUGS = 64, SAVES_ANSWER_BYTES = 512 * 1024;
const savesSlug = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && SAVES_SLUG.test(value);
/** A `saves` word, either way. */
export function encodeSaves(word: SavesAsk | SavesAnswer): ArrayBuffer { return new TextEncoder().encode(JSON.stringify(word)).buffer; }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** What a page asks, or null for a word that makes no sense (untrusted: bounded, and every shard must look like a slug). */
export function decodeSavesAsk(bytes: ArrayBuffer): SavesAsk | null {
  if (bytes.byteLength > SAVES_ASK_BYTES) return null;
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!record(said)) return null;
    if ('reset' in said) return savesSlug(said['reset']) ? { reset: said['reset'] } : null;
    const read = said['read'];
    if (!Array.isArray(read) || read.length > SAVES_SLUGS) return null;
    const slugs: unknown[] = read;
    return slugs.every(savesSlug) ? { read: [...new Set(slugs)] } : null;
  } catch { return null; }
}
function roomSave(value: unknown): RoomSave | null | undefined {
  if (value === null) return null;
  if (!record(value) || !Array.isArray(value['flags']) || !Array.isArray(value['quests']) || !record(value['keys'])) return undefined;
  const flags: unknown[] = value['flags'], quests: unknown[] = value['quests'];
  if (!flags.every(flag => typeof flag === 'string')) return undefined;
  const rows: { started: boolean; currentId: string | null }[] = [];
  for (const row of quests) {
    if (!record(row) || typeof row['started'] !== 'boolean' || (row['currentId'] !== null && typeof row['currentId'] !== 'string')) return undefined;
    rows.push({ started: row['started'], currentId: row['currentId'] });
  }
  return { flags, quests: rows, keys: value['keys'] };
}
/** What the door answered, or null for a word that makes no sense. */
export function decodeSavesAnswer(bytes: ArrayBuffer): SavesAnswer | null {
  if (bytes.byteLength > SAVES_ANSWER_BYTES) return null;
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!record(said)) return null;
    if ('reset' in said) return savesSlug(said['reset']) && said['ok'] === false ? { reset: said['reset'], ok: false } : null;
    const read = said['read'];
    if (!record(read)) return null;
    const out: Record<string, RoomSave | null> = {};
    for (const [slug, value] of Object.entries(read)) { const save = roomSave(value); if (!savesSlug(slug) || save === undefined) return null; out[slug] = save; }
    return { read: out };
  } catch { return null; }
}
/**
 * QA 11-23-b row 19 (Jake ~11:30 Cancún: "Enter MMO should, ask the server where [...] I am, and then like load the correct zone"): a
 * title's word on a socket of its own, before any hello. `player` is what its hello would carry (the device id, or a join ticket). The
 * door answers the cell it would seat that player in now and closes nothing; the page closes once it has heard. Nothing is seated.
 */
export interface WhereAsk { readonly player: string }
/** The door's answer: the grid cell (instance), or null for a player it would not admit. */
export interface WhereAnswer { readonly cell: string | null }
const WHERE_ASK_BYTES = 1024, WHERE_ANSWER_BYTES = 256;
/** A `where` word, either way. */
export function encodeWhere(word: WhereAsk | WhereAnswer): ArrayBuffer { return new TextEncoder().encode(JSON.stringify(word)).buffer; }
/** What a page asks, or null for a word that makes no sense (untrusted: bounded, a string the door's hello schema would read). */
export function decodeWhereAsk(bytes: ArrayBuffer): WhereAsk | null {
  if (bytes.byteLength > WHERE_ASK_BYTES) return null;
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return record(said) && typeof said['player'] === 'string' && said['player'].length > 0 && said['player'].length <= 512 ? { player: said['player'] } : null;
  } catch { return null; }
}
/** What the door answered, or null for a word that makes no sense (a cell must look like a cell's name). */
export function decodeWhereAnswer(bytes: ArrayBuffer): WhereAnswer | null {
  if (bytes.byteLength > WHERE_ANSWER_BYTES) return null;
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!record(said)) return null;
    const cell = said['cell'];
    return cell === null ? { cell: null } : typeof cell === 'string' && /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(cell) && cell.length <= 64 ? { cell } : null;
  } catch { return null; }
}
/** Whether a door's first word says it answers `saves` (an older door's word never does). */
export function worldReadsSaves(bytes: ArrayBuffer): boolean {
  try { const said: unknown = JSON.parse(new TextDecoder().decode(bytes)); return record(said) && said['saves'] === 1; } catch { return false; }
}
/** J174: seconds until everyone moves, and the build they move to, which a client preloads. */
export interface Countdown { readonly seconds: number; readonly build: string }
/** A `countdown` word. */
export function encodeCountdown(seconds: number, build: string): ArrayBuffer { return new TextEncoder().encode(JSON.stringify({ seconds, build } satisfies Countdown)).buffer; }
/** What a `countdown` word says, or null for one that makes no sense. */
export function decodeCountdown(bytes: ArrayBuffer): Countdown | null {
  try {
    const said: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof said === 'object' && said !== null && 'seconds' in said && typeof said.seconds === 'number' && 'build' in said && typeof said.build === 'string' ? { seconds: said.seconds, build: said.build } : null;
  } catch { return null; }
}
/** `prefix` and `bytes` as one message. */
export function framed(prefix: number, bytes: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength + 1);
  out[0] = prefix; out.set(new Uint8Array(bytes), 1);
  return out;
}
const PING_BYTES = 13, PONG_BYTES = 13, FLOAT_AT = 9;
/** A ping: the client's own clock, and the round trip it last measured, so the server can report it too. */
export function encodePing(clock: number, rttMs: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(PING_BYTES), view = new DataView(out.buffer);
  out[0] = SOCKET_PING; view.setFloat64(1, clock); view.setFloat32(FLOAT_AT, rttMs);
  return out;
}
/** What a ping says, or null for one that is the wrong size. */
export function decodePing(view: DataView): { readonly clock: number; readonly rttMs: number } | null {
  return view.byteLength === PING_BYTES ? { clock: view.getFloat64(1), rttMs: view.getFloat32(FLOAT_AT) } : null;
}
/** A pong: the ping's clock back, and the share of frames the server skipped for this client. */
export function encodePong(clock: number, lossPct: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(PONG_BYTES), view = new DataView(out.buffer);
  out[0] = SOCKET_PONG; view.setFloat64(1, clock); view.setFloat32(FLOAT_AT, lossPct);
  return out;
}
/** What a pong says, or null for one that is the wrong size. */
export function decodePong(view: DataView): { readonly clock: number; readonly lossPct: number } | null {
  return view.byteLength === PONG_BYTES ? { clock: view.getFloat64(1), lossPct: view.getFloat32(FLOAT_AT) } : null;
}

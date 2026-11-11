import type { NetChannel } from './transport';

// E7.1: what one WebSocket carries. `WebSocket` keeps message boundaries, so a frame is one prefix byte and its payload. Both
// channels share TCP, so nothing is lost on the wire: "unreliable" only means the sender may skip it. Keepalive lives here
// because a browser cannot send protocol pings, and `resume`, `ready` and `countdown` stay outside the game protocol, so
// `NET_SCHEMA_HASH` does not move.

/** The prefix byte of every message on a game socket. */
export const SOCKET_RELIABLE = 0, SOCKET_UNRELIABLE = 1, SOCKET_PING = 2, SOCKET_PONG = 3, SOCKET_RESUME = 4, SOCKET_READY = 5, SOCKET_COUNTDOWN = 6, SOCKET_PLAYTEST=7, SOCKET_VOICE = 8, SOCKET_WORLD = 9;
/** The messages outside the game protocol: the server's word on where to load, the client's that it has, and the server's that a new build is coming (J174). */
export type SocketControl = 'resume' | 'ready' | 'countdown' | 'playtest' | 'voice' | 'world';
/** GO4: the door's first word on every socket, before any hello: how many grid cells it hosts, and nothing else (D7 keeps `/health`
 *  off the rooms address, so a page learns this here). A build from before it ignores the prefix. */
export interface WorldWord { readonly cells: number }
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
export const controlPrefix = (control: SocketControl): number => control === 'resume' ? SOCKET_RESUME : control === 'ready' ? SOCKET_READY : control==='playtest'?SOCKET_PLAYTEST:control === 'voice' ? SOCKET_VOICE : control === 'world' ? SOCKET_WORLD : SOCKET_COUNTDOWN;
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

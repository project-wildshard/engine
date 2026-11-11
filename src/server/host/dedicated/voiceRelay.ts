import * as v from 'valibot';
import type { SocketControl } from '@wildshard/engine/net/socketFrames';

// J218: voice chat's signalling, on the door's main thread. Audio never comes here: it goes peer to peer (or through TURN),
// and this only tells the players in one cell who is on voice and carries their WebRTC offers, answers and ICE candidates,
// in pieces, from one to another. Nothing is kept or logged but who is on voice now.

/** The most players on voice in one cell: a mesh sends one stream to each peer, and a phone's uplink runs out past this. */
export const VOICE_PER_CELL = 8;
/** A piece of an SDP or a candidate, in characters, and the most pieces one message takes. */
const MAX_PIECE_CHARS = 600, MAX_PIECES = 64;
const PeerId = v.pipe(v.string(), v.regex(/^[a-z0-9]{1,16}$/u));
/** What a client says. */
const VoiceSaySchema = v.variant('k', [
  v.strictObject({ k: v.literal('join') }),
  v.strictObject({ k: v.literal('leave') }),
  v.strictObject({ k: v.literal('sig'), to: PeerId, m: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2 ** 31)),
    i: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_PIECES - 1)), n: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_PIECES)),
    d: v.pipe(v.string(), v.maxLength(MAX_PIECE_CHARS)) }),
]);
/** One ICE server, as `RTCPeerConnection` takes it. */
export interface VoiceIceServer { readonly urls: string | readonly string[]; readonly username?: string; readonly credential?: string }
/** What the server says. */
export type VoiceHeard =
  | { readonly k: 'you'; readonly id: string }
  | { readonly k: 'roster'; readonly peers: readonly { readonly id: string; readonly name: string; readonly body?: string }[] }
  | { readonly k: 'hi'; readonly ice: readonly VoiceIceServer[]; readonly peers: readonly string[] }
  | { readonly k: 'full' }
  | { readonly k: 'sig'; readonly from: string; readonly m: number; readonly i: number; readonly n: number; readonly d: string };
/** The part of a socket the relay uses. */
export interface VoiceSocket {
  readonly control: (control: SocketControl, bytes: ArrayBuffer) => void;
  readonly onControl: (listener: (control: SocketControl, bytes: ArrayBuffer) => void) => () => void;
  readonly onClose: (listener: (reason: string) => void) => () => void;
}
interface Seat { readonly id: string; readonly cell: string; readonly name: string; readonly body: string | undefined; readonly end: VoiceSocket; joined: boolean; joining: boolean; joins: number }
/** Public STUN only: two phones behind carrier NAT may not meet without TURN. */
export const STUN_ONLY: readonly VoiceIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

const encoder = new TextEncoder(), decoder = new TextDecoder();
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => (byte % 36).toString(36)).join('');
}

/** Who is on voice in each cell, and the signalling between them. */
export class VoiceRelay {
  private readonly seats = new Map<string, Seat>();
  private readonly ice: () => Promise<readonly VoiceIceServer[]>;
  constructor(ice: () => Promise<readonly VoiceIceServer[]> = () => Promise.resolve(STUN_ONLY)) { this.ice = ice; }
  /** A seated socket: it may join voice in `cell` until it closes. `body` is its player row's id, the one every page already
   *  hears on the wire, so a page can put a voice to a body (VOICE-POLISH V7: proximity; V8: the ring over a head). */
  attach(end: VoiceSocket, cell: string, name: string, body?: string): void {
    const seat: Seat = { id: newId(), cell, name, body, end, joined: false, joining: false, joins: 0 };
    this.seats.set(seat.id, seat);
    const off = end.onControl((control, bytes) => { if (control === 'voice') this.heard(seat, bytes); });
    end.onClose(() => { off(); this.seats.delete(seat.id); if (seat.joined) { seat.joined = false; this.roster(cell); } });
    this.say(seat, { k: 'you', id: seat.id });
    this.say(seat, this.rosterOf(cell));
  }
  /** Players on voice, in every cell. */
  get talking(): number { let count = 0; for (const seat of this.seats.values()) if (seat.joined) count++; return count; }
  private heard(seat: Seat, bytes: ArrayBuffer): void {
    // A piece past its own count can't be put back together: it would only sit in a peer's memory.

    let raw: unknown;
    try { raw = JSON.parse(decoder.decode(bytes)); } catch { return; }
    const said = v.safeParse(VoiceSaySchema, raw);
    if (!said.success || !this.seats.has(seat.id) || (said.output.k === 'sig' && said.output.i >= said.output.n)) return;
    const word = said.output;
    if (word.k === 'join') { void this.join(seat); return; }
    if (word.k === 'leave') { seat.joins++; if (seat.joined) { seat.joined = false; this.roster(seat.cell); } return; }
    const to = this.seats.get(word.to);
    if (!seat.joined || to === undefined || !to.joined || to.cell !== seat.cell || to === seat) return;
    this.say(to, { k: 'sig', from: seat.id, m: word.m, i: word.i, n: word.n, d: word.d });
  }
  private async join(seat: Seat): Promise<void> {
    if (seat.joined || seat.joining) return;
    // A join waiting on its ICE servers holds its place, so eight joining at once can't all count the same seven.
    let count = 0;
    for (const other of this.seats.values()) if ((other.joined || other.joining) && other.cell === seat.cell) count++;
    if (count >= VOICE_PER_CELL) { this.say(seat, { k: 'full' }); return; }
    const ticket = ++seat.joins;
    seat.joining = true;
    let ice: readonly VoiceIceServer[];
    try { ice = await this.ice(); } catch { ice = STUN_ONLY; } finally { seat.joining = false; }
    // Closed, left or joined again while the ICE servers were on their way: that later word wins.
    if (!this.seats.has(seat.id) || seat.joins !== ticket || seat.joined) return;
    const peers = [...this.seats.values()].filter(other => other.joined && other.cell === seat.cell).map(other => other.id);
    seat.joined = true;
    this.say(seat, { k: 'hi', ice, peers });
    this.roster(seat.cell);
  }
  private rosterOf(cell: string): VoiceHeard {
    return { k: 'roster', peers: [...this.seats.values()].filter(seat => seat.joined && seat.cell === cell).map(seat => (seat.body === undefined ? { id: seat.id, name: seat.name } : { id: seat.id, name: seat.name, body: seat.body })) };
  }
  /** Everyone in the cell hears who is on voice, joined or not, so the prompt can say who to join. */
  private roster(cell: string): void {
    const word = this.rosterOf(cell);
    for (const seat of this.seats.values()) if (seat.cell === cell) this.say(seat, word);
  }
  private say(seat: Seat, word: VoiceHeard): void { seat.end.control('voice', encoder.encode(JSON.stringify(word)).buffer); }
}

/** Cloudflare Realtime TURN: credentials minted with the key's API token, shared by everyone while they last. */
export function cloudflareTurn(keyId: string, token: string, options: { readonly fetch?: typeof fetch; readonly now?: () => number; readonly ttlSeconds?: number } = {}): () => Promise<readonly VoiceIceServer[]> {
  const get = options.fetch ?? fetch, now = options.now ?? Date.now, ttl = options.ttlSeconds ?? 86_400;
  let held: { readonly at: number; readonly ice: readonly VoiceIceServer[] } | null = null, asking: Promise<readonly VoiceIceServer[]> | null = null;
  return () => {
    // Half the credential's life: a client handed them late still has hours of TURN.
    if (held !== null && now() - held.at < ttl * 500) return Promise.resolve(held.ice);
    asking ??= (async () => {
      try {
        const response = await get(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl }), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`TURN credentials ${String(response.status)}`);
        const ice = [...STUN_ONLY, ...parseTurnServers(await response.json())];
        held = { at: now(), ice };
        return ice;
      } finally { asking = null; }
    })();
    return asking;
  };
}
const IceServerSchema = v.object({ urls: v.union([v.string(), v.array(v.string())]), username: v.optional(v.string()), credential: v.optional(v.string()) });
/** Cloudflare answers `{ iceServers: [...] }` or, from the older endpoint, `{ iceServers: {...} }`. */
export function parseTurnServers(body: unknown): readonly VoiceIceServer[] {
  const said = v.parse(v.object({ iceServers: v.union([IceServerSchema, v.array(IceServerSchema)]) }), body).iceServers;
  return (Array.isArray(said) ? said : [said]).map(server => {
    const out: { urls: string | readonly string[]; username?: string; credential?: string } = { urls: server.urls };
    if (server.username !== undefined) out.username = server.username;
    if (server.credential !== undefined) out.credential = server.credential;
    return out;
  });
}

import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { CLIENT_FLOOD_DEBT, CLIENT_MESSAGES_PER_TICK, MAX_CLIENT_MESSAGES, MAX_CLIENT_MESSAGE_BYTES } from '@wildshard/engine/net/room';
import { channelPrefix, closeCode, closeReason, controlPrefix, decodePing, encodePong, FRAME_SKIP_BYTES, framed, PING_FLOOR_MS, SILENCE_MS, SOCKET_PING, SOCKET_PLAYTEST, SOCKET_READY, SOCKET_RELIABLE, SOCKET_UNRELIABLE, STALL_CLOSE_BYTES, type SocketControl } from '@wildshard/engine/net/socketFrames';
import type { NetChannel, Transport, TransportStats } from '@wildshard/engine/net/transport';
import type { RawData, ServerOptions, WebSocket } from 'ws';

/** Seconds a closing socket gets to answer: one that has stopped reading never will. */
const CLOSE_GRACE_MS = 1000;
/** How often a socket's silence is read. */
const SILENCE_CHECK_MS = 500;
/** What every game socket's server is built with: the room reads no longer message, and no message is worth deflating. */
export const SOCKET_SERVER_OPTIONS: ServerOptions & { readonly closeTimeout: number } = { perMessageDeflate: false, autoPong: false, maxPayload: MAX_CLIENT_MESSAGE_BYTES + 1, closeTimeout: CLOSE_GRACE_MS };

/** How a socket's end is built. */
export interface SocketTransportOptions { readonly now?: () => number; readonly silenceMs?: number }

const bytesOf = (data: RawData): Buffer | null => Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : null;

/**
 * E7.1: the server's end of a game socket, over `ws`. Before each send it reads what is waiting: past `FRAME_SKIP_BYTES` a frame
 * is skipped, and past `STALL_CLOSE_BYTES` the client is closed `stalled`, because nothing else bounds a reliable message. So no
 * client can stall a tick. `heardAt` is the last byte from the client: a seat's hold counts from there (J114).
 */
export class SocketTransport implements Transport {
  /** When the last byte arrived, on `now`'s clock. */
  heardAt: number;
  /** Frames skipped for this client, and what was waiting at the moment it closed `stalled`. */
  skippedFrames = 0; stalledAt = 0;
  private readonly socket: WebSocket;
  private readonly now: () => number;
  private readonly messages = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
  private readonly controls = new Set<(control: SocketControl, bytes: ArrayBuffer) => void>();
  private readonly closes = new Set<(reason: string) => void>();
  private readonly scope = new Scope('dedicated.socket');
  private ended = false;
  private endReason = 'closed';
  private frames = 0;
  private rttMs = 0;
  private pongAt = -PING_FLOOR_MS;
  private sentBytes = 0;
  private recvBytes = 0;
  private credit = MAX_CLIENT_MESSAGES;
  private creditedAt: number;
  constructor(socket: WebSocket, options: SocketTransportOptions = {}) {
    this.socket = socket; this.now = options.now ?? diagnosticNow; this.heardAt = this.now();
    this.creditedAt = this.heardAt;
    const silenceMs = options.silenceMs ?? SILENCE_MS;
    this.scope.interval(SILENCE_CHECK_MS, () => { if (this.now() - this.heardAt >= silenceMs) this.close('stalled'); });
    socket.on('message', (data, isBinary) => { this.receive(data, isBinary); });
    socket.on('ping', bytes => { this.recvBytes += bytes.byteLength; if (this.takeCredit()) socket.pong(bytes); });
    socket.on('pong', bytes => { this.recvBytes += bytes.byteLength; this.takeCredit(); });
    socket.on('close', code => { this.end(closeReason(code)); });
    // A message past `maxPayload` lands here. It must be heard, or `ws` throws it at the process and the world goes with it.
    socket.on('error', () => { this.close('refused'); });
  }
  /** Bytes waiting for this client. */
  get isOpen(): boolean { return !this.ended; }
  get buffered(): number { return this.socket.bufferedAmount; }
  get stats(): TransportStats {
    const sent = this.frames + this.skippedFrames;
    return { rttMs: this.rttMs, lossPct: sent === 0 ? 0 : this.skippedFrames / sent * 100, sentBytes: this.sentBytes, recvBytes: this.recvBytes };
  }
  send(channel: NetChannel, bytes: ArrayBuffer): void {
    if (this.ended) return;
    const { buffered } = this;
    if (buffered > STALL_CLOSE_BYTES) { this.stalledAt = buffered; this.close('stalled'); return; }
    if (channel === 'unreliable') {
      if (buffered > FRAME_SKIP_BYTES) { this.skippedFrames++; return; }
      this.frames++;
    }
    this.write(framed(channelPrefix(channel), bytes));
  }
  /** Say a message outside the game protocol. */
  control(control: SocketControl, bytes: ArrayBuffer = new ArrayBuffer(0)): void { if (!this.ended) this.write(framed(controlPrefix(control), bytes)); }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  /** Subscribe to the client's control messages; returns the unsubscribe. */
  onControl(listener: (control: SocketControl, bytes: ArrayBuffer) => void): () => void { this.controls.add(listener); return () => { this.controls.delete(listener); }; }
  onClose(listener: (reason: string) => void): () => void { if (this.ended) { listener(this.endReason); return () => undefined; } this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void {
    if (this.ended) return;
    this.socket.close(closeCode(reason));
    this.end(reason);
  }
  private write(bytes: Uint8Array): void { this.sentBytes += bytes.byteLength; this.socket.send(bytes, { binary: true }); }
  /** Protocol controls share the app budget, but cannot extend the app's silence deadline. */
  private takeCredit(): boolean {
    if (this.ended) return false;
    const now = this.now();
    this.credit = Math.min(MAX_CLIENT_MESSAGES, this.credit + Math.max(0, now - this.creditedAt) * CLIENT_MESSAGES_PER_TICK * 60 / 1000) - 1;
    this.creditedAt = now;
    if (this.credit < 0) { if (this.credit <= CLIENT_FLOOD_DEBT) this.close('refused'); return false; }
    return true;
  }
  private receive(data: RawData, isBinary: boolean): void {
    if (this.ended) return;
    const bytes = bytesOf(data);
    if (!isBinary || bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_CLIENT_MESSAGE_BYTES + 1) { this.close('refused'); return; }
    this.recvBytes += bytes.byteLength;
    if (!this.takeCredit()) return;
    this.heardAt = this.now();
    const prefix = bytes[0], { buffer: body } = new Uint8Array(bytes.subarray(1));
    if (prefix === SOCKET_RELIABLE || prefix === SOCKET_UNRELIABLE) { const channel = prefix === SOCKET_RELIABLE ? 'reliable' : 'unreliable'; for (const listener of this.messages) listener(channel, body); }
    else if (prefix === SOCKET_PING) this.ping(bytes);
    else if (prefix === SOCKET_READY) for (const listener of this.controls) listener('ready', body);
    else if (prefix === SOCKET_PLAYTEST) for (const listener of this.controls) listener('playtest', body);
    else this.close('refused');
  }
  private ping(bytes: Buffer): void {
    const ping = decodePing(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)), now = this.now();
    if (ping === null || now - this.pongAt < PING_FLOOR_MS) return;
    this.pongAt = now; this.rttMs = ping.rttMs;
    this.write(encodePong(ping.clock, this.stats.lossPct));
  }
  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true; this.endReason = reason;
    this.scope.dispose();
    for (const listener of this.closes) listener(reason);
    this.closes.clear();
  }
}

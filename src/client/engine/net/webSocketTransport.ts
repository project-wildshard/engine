import { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { channelPrefix, closeCode, closeReason, COMMAND_SKIP_BYTES, controlPrefix, decodePong, encodePing, framed, PING_MS, SOCKET_COUNTDOWN, SOCKET_PLAYTEST, SOCKET_PONG, SOCKET_RELIABLE, SOCKET_RESUME, SOCKET_UNRELIABLE, type SocketControl } from '../../../shared/engine/net/socketFrames';
import type { NetChannel, Transport, TransportStats } from '../../../shared/engine/net/transport';

/** The code a browser reports for a link that died with no close frame. */
const ABNORMAL_CLOSE = 1006;

/** How a transport is built. Everything here has a real default, and a test passes its own. */
export interface WebSocketOptions {
  readonly now?: () => number;
  /** The constructor to dial with. */
  readonly socket?: new (url: string) => WebSocket;
}

/** A socket's close event has no type on `Scope.listen`, which knows only the page's events. */
const codeOf = (event: Event): number => 'code' in event && typeof event.code === 'number' ? event.code : ABNORMAL_CLOSE;

/**
 * E7.1: the client's end of a game socket, over the browser's `WebSocket`. What is said before the socket opens waits for it,
 * so `NetClient.hello` can run at once. `lossPct` is the share of frames the server says it skipped for this client.
 */
export class WebSocketTransport implements Transport {
  /** Command flushes skipped because the socket was behind, and before it opened. */
  skippedCommands = 0;
  private readonly socket: WebSocket;
  private readonly now: () => number;
  private readonly messages = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
  private readonly controls = new Set<(control: SocketControl, bytes: ArrayBuffer) => void>();
  private readonly closes = new Set<(reason: string) => void>();
  private readonly waiting: Uint8Array<ArrayBuffer>[] = [];
  private readonly scope = new Scope('net.socket');
  private ended = false;
  private rttMs = 0;
  private lossPct = 0;
  private sentBytes = 0;
  private recvBytes = 0;
  constructor(url: string, options: WebSocketOptions = {}) {
    this.now = options.now ?? diagnosticNow;
    this.socket = new (options.socket ?? WebSocket)(url);
    this.socket.binaryType = 'arraybuffer';
    this.scope.listen(this.socket, 'open', () => { this.opened(); });
    this.scope.listen(this.socket, 'message', (event: MessageEvent<unknown>) => { if (event.data instanceof ArrayBuffer) this.receive(event.data); });
    this.scope.listen(this.socket, 'close', event => { this.end(closeReason(codeOf(event))); });
  }
  /** The socket has opened, and has not ended. */
  get open(): boolean { return !this.ended && this.socket.readyState === WebSocket.OPEN; }
  get stats(): TransportStats { return { rttMs: this.rttMs, lossPct: this.lossPct, sentBytes: this.sentBytes, recvBytes: this.recvBytes }; }
  send(channel: NetChannel, bytes: ArrayBuffer): void {
    if (this.ended) return;
    if (channel === 'unreliable' && !this.roomForCommands()) { this.skippedCommands++; return; }
    this.write(framed(channelPrefix(channel), bytes));
  }
  /** Say a message outside the game protocol. */
  control(control: SocketControl, bytes: ArrayBuffer = new ArrayBuffer(0)): void { if (!this.ended) this.write(framed(controlPrefix(control), bytes)); }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  /** Subscribe to the server's control messages; returns the unsubscribe. */
  onControl(listener: (control: SocketControl, bytes: ArrayBuffer) => void): () => void { this.controls.add(listener); return () => { this.controls.delete(listener); }; }
  onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void {
    if (this.ended) return;
    this.socket.close(closeCode(reason));
    this.end(reason);
  }
  private roomForCommands(): boolean { return this.socket.readyState === WebSocket.OPEN && this.socket.bufferedAmount <= COMMAND_SKIP_BYTES; }
  private write(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.socket.readyState === WebSocket.CONNECTING) { this.waiting.push(bytes); return; }
    this.sentBytes += bytes.byteLength; this.socket.send(bytes);
  }
  private opened(): void {
    for (const bytes of this.waiting.splice(0)) this.write(bytes);
    this.ping();
    this.scope.interval(PING_MS, () => { this.ping(); });
  }
  private ping(): void { if (this.socket.readyState === WebSocket.OPEN) this.write(encodePing(this.now(), this.rttMs)); }
  private receive(data: ArrayBuffer): void {
    this.recvBytes += data.byteLength;
    if (data.byteLength === 0) return;
    const view = new DataView(data), prefix = view.getUint8(0), body = data.slice(1);
    if (prefix === SOCKET_RELIABLE || prefix === SOCKET_UNRELIABLE) { const channel = prefix === SOCKET_RELIABLE ? 'reliable' : 'unreliable'; for (const listener of this.messages) listener(channel, body); }
    else if (prefix === SOCKET_PONG) { const pong = decodePong(view); if (pong !== null) { this.rttMs = this.now() - pong.clock; this.lossPct = pong.lossPct; } }
    else if (prefix === SOCKET_RESUME || prefix === SOCKET_COUNTDOWN || prefix===SOCKET_PLAYTEST) for (const listener of this.controls) listener(prefix === SOCKET_RESUME ? 'resume' : prefix===SOCKET_PLAYTEST?'playtest':'countdown', body);
  }
  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.scope.dispose();
    for (const listener of this.closes) listener(reason);
    this.closes.clear();
  }
}

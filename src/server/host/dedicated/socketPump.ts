import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { NetChannel, Transport, TransportStats } from '@wildshard/engine/net/transport';
import type { SocketTransport } from './socketTransport';

/** A link's end that holds nothing: the player quit. */
export const LEFT = 'left';
/** The byte a `ready` carries to say so. */
export const LEAVE_FLAG = 1;
/** What crosses between a socket's thread and its room's. */
type Pumped = { readonly channel: NetChannel; readonly bytes: ArrayBuffer } | { readonly close: string; readonly silentMs: number };
const pumped = (value: unknown): Pumped | null => typeof value === 'object' && value !== null && ('close' in value || 'bytes' in value) ? value as Pumped : null;

/**
 * J182: the socket lives on the main thread and its cell in a worker, and this is all that joins them. `end` keeps backpressure, the
 * silence check and the keepalive, because those need the socket; the room hears the same bytes it would on any Transport. The port
 * closes with the socket, and what the room says after that goes nowhere.
 */
export function pumpSocket(end: SocketTransport, port: MessagePort, now: () => number = diagnosticNow): void {
  const off = end.onMessage((channel, bytes) => { port.postMessage({ channel, bytes }, [bytes]); });
  // E7.3: a clean quit from the menu: `ready` again, with a flag. The body goes at once.
  const quit = end.onControl((control, bytes) => { if (control === 'ready' && new Uint8Array(bytes)[0] === LEAVE_FLAG) end.close(LEFT); });
  const closed = end.onClose(reason => { off(); quit(); port.postMessage({ close: reason, silentMs: now() - end.heardAt }); port.close(); });
  port.onmessage = (event: MessageEvent<unknown>): void => {
    const message = pumped(event.data);
    if (message === null) return;
    if ('close' in message) { off(); quit(); closed(); end.close(message.close); port.close(); } else end.send(message.channel, message.bytes);
  };
}

/** The room's end of a pumped socket. `deliver` is how a `hello` the gateway read reaches the room, and `silentMs` is how long the link had been quiet when it closed, so a hold counts from the last byte (J114). */
export class SeatTransport implements Transport {
  /** How long the client had been silent when the link closed. */
  silentMs = 0;
  private readonly port: MessagePort;
  private readonly messages = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
  private readonly closes = new Set<(reason: string) => void>();
  private sentBytes = 0;
  private recvBytes = 0;
  private open = true;
  constructor(port: MessagePort) {
    this.port = port;
    port.onmessage = (event: MessageEvent<unknown>): void => {
      const message = pumped(event.data);
      if (message === null) return;
      if ('close' in message) { this.silentMs = message.silentMs; this.ended(message.close); } else this.deliver(message.channel, message.bytes);
    };
  }
  get stats(): TransportStats { return { rttMs: 0, lossPct: 0, sentBytes: this.sentBytes, recvBytes: this.recvBytes }; }
  /** Hand the room a message as if the socket had just said it. */
  deliver(channel: NetChannel, bytes: ArrayBuffer): void {
    this.recvBytes += bytes.byteLength;
    for (const listener of this.messages) listener(channel, bytes);
  }
  send(channel: NetChannel, bytes: ArrayBuffer): void {
    if (!this.open) return;
    this.sentBytes += bytes.byteLength;
    this.port.postMessage({ channel, bytes }, [bytes]);
  }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void {
    if (!this.open) return;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A MessagePort has no origin.
    this.port.postMessage({ close: reason, silentMs: 0 });
    this.ended(reason);
  }
  private ended(reason: string): void {
    if (!this.open) return;
    this.open = false;
    this.port.close();
    for (const listener of this.closes) listener(reason);
    this.closes.clear();
  }
}

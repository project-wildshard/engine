import type { NetChannel, Transport, TransportStats } from '@wildshard/engine/net/transport';

interface Envelope { readonly channel: NetChannel; readonly bytes: ArrayBuffer }
const isEnvelope = (value: unknown): value is Envelope => typeof value === 'object' && value !== null && 'bytes' in value && value.bytes instanceof ArrayBuffer
  && 'channel' in value && (value.channel === 'reliable' || value.channel === 'unreliable');
const closeReason = (value: unknown): string | null => typeof value === 'object' && value !== null && 'close' in value && typeof value.close === 'string' ? value.close : null;

/**
 * P1-E5.2 (E5-REPLICATION §4.1): the game Transport over a MessagePort. `postMessage(bytes, [bytes])` transfers rather than
 * copies, with no SharedArrayBuffer and no COOP/COEP (J59 Q8). A port delivers in order and never drops, so both channels
 * are trivially reliable; the wire is still the real bytes, so what is counted here is the MMO number.
 */
export class WorkerLoopback implements Transport {
  private readonly port: MessagePort;
  private readonly messages = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
  private readonly closes = new Set<(reason: string) => void>();
  private sentBytes = 0;
  private recvBytes = 0;
  private open = true;
  /** Posts that were not a message at all: a page's, or anything else with this port. */
  refused = 0;
  constructor(port: MessagePort) {
    this.port = port;
    port.onmessage = (event: MessageEvent<unknown>): void => {
      const { data } = event, reason = closeReason(data);
      if (reason !== null) { this.ended(reason); return; }
      if (!isEnvelope(data)) { this.refused++; return; }
      this.recvBytes += data.bytes.byteLength;
      for (const listener of this.messages) listener(data.channel, data.bytes);
    };
  }
  get stats(): TransportStats { return { rttMs: 0, lossPct: 0, sentBytes: this.sentBytes, recvBytes: this.recvBytes }; }
  send(channel: NetChannel, bytes: ArrayBuffer): void {
    if (!this.open) return;
    this.sentBytes += bytes.byteLength;
    this.port.postMessage({ channel, bytes }, [bytes]);
  }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void {
    if (!this.open) return;
    this.port.postMessage({ close: reason }, []);
    this.ended(reason);
  }
  private ended(reason: string): void {
    if (!this.open) return;
    this.open = false;
    this.port.close();
    for (const listener of this.closes) listener(reason);
  }
}

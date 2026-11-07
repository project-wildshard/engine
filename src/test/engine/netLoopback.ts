import type { NetChannel, Transport, TransportStats } from '../../shared/engine/net/transport';

// P1-E5.2 (J49, E5-REPLICATION §4.1): test-only transports. They live under src/test/engine/ so that
// wildshard/no-production-test-import refuses them in production: a main-thread server can never ship.

class QueueEnd implements Transport {
  sentBytes = 0; recvBytes = 0;
  peer: QueueEnd | null = null;
  readonly inbox: { channel: NetChannel; bytes: ArrayBuffer }[] = [];
  private readonly messages = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
  private readonly closes = new Set<(reason: string) => void>();
  get stats(): TransportStats { return { rttMs: 0, lossPct: 0, sentBytes: this.sentBytes, recvBytes: this.recvBytes }; }
  send(channel: NetChannel, bytes: ArrayBuffer): void { this.sentBytes += bytes.byteLength; this.peer?.inbox.push({ channel, bytes }); }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
  onClose(listener: (reason: string) => void): () => void { this.closes.add(listener); return () => { this.closes.delete(listener); }; }
  close(reason = 'closed'): void { const { peer } = this; this.ended(reason); peer?.ended(reason); }
  deliver(): void {
    for (const { channel, bytes } of this.inbox.splice(0)) { this.recvBytes += bytes.byteLength; for (const listener of this.messages) listener(channel, bytes); }
  }
  private ended(reason: string): void { for (const listener of this.closes) listener(reason); this.closes.clear(); }
}

/** Two connected ends on one thread. `pump` delivers everything queued, in both directions. */
export interface DirectLoopback { readonly client: Transport; readonly server: Transport; pump: () => void }
/** A same-thread loopback: Node unit tests and the bot gates. */
export function directLoopback(): DirectLoopback {
  const client = new QueueEnd(), server = new QueueEnd();
  client.peer = server; server.peer = client;
  return { client, server, pump: () => { while (client.inbox.length > 0 || server.inbox.length > 0) { client.deliver(); server.deliver(); } } };
}

/** The link a ConditionedTransport simulates. */
export interface LinkConditions { readonly latencyMs: number; readonly jitterMs: number; readonly lossPct: number; readonly reorderPct: number; readonly random: () => number }

/** Wraps a transport with latency, jitter, loss and reordering on its sends (Unreal's PktLag / PktLoss), on a clock the test
 * advances. Reliable sends are delayed but never lost and stay in order, as a real reliable channel would be. */
export class ConditionedTransport implements Transport {
  private readonly inner: Transport;
  private readonly link: LinkConditions;
  private readonly queue: { at: number; channel: NetChannel; bytes: ArrayBuffer }[] = [];
  private now = 0;
  private reliableAt = 0;
  private lost = 0; private sent = 0;
  constructor(inner: Transport, link: LinkConditions) { this.inner = inner; this.link = link; }
  get stats(): TransportStats { return { ...this.inner.stats, rttMs: this.link.latencyMs * 2, lossPct: this.sent === 0 ? 0 : this.lost / this.sent * 100 }; }
  send(channel: NetChannel, bytes: ArrayBuffer): void {
    const { latencyMs, jitterMs, lossPct, reorderPct, random } = this.link;
    this.sent++;
    if (channel === 'unreliable' && random() * 100 < lossPct) { this.lost++; return; }
    const reordered = channel === 'unreliable' && random() * 100 < reorderPct ? latencyMs : 0;
    let at = this.now + latencyMs + (random() * 2 - 1) * jitterMs + reordered;
    if (channel === 'reliable') { at = Math.max(at, this.reliableAt); this.reliableAt = at; }
    this.queue.push({ at, channel, bytes });
  }
  onMessage(listener: (channel: NetChannel, bytes: ArrayBuffer) => void): () => void { return this.inner.onMessage(listener); }
  onClose(listener: (reason: string) => void): () => void { return this.inner.onClose(listener); }
  close(reason?: string): void { this.inner.close(reason); }
  /** Move the link's clock forward, releasing what is due, earliest first. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.queue.filter(entry => entry.at <= this.now).sort((a, b) => a.at - b.at);
    for (const entry of due) { this.queue.splice(this.queue.indexOf(entry), 1); this.inner.send(entry.channel, entry.bytes); }
  }
}

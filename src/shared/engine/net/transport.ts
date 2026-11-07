// P1-E5.2 (E5-REPLICATION §4.1): the one seam between the game protocol and whatever carries it. The worker loopback
// implements it now and a WebSocket implements it later, with no change to game code. It carries bytes, never objects,
// so the loopback exercises the real codec and the real byte counts.

/** `reliable` is ordered and never lost; `unreliable` may be lost or reordered. */
export type NetChannel = 'unreliable' | 'reliable';
/** What a transport has measured. */
export interface TransportStats { readonly rttMs: number; readonly lossPct: number; readonly sentBytes: number; readonly recvBytes: number }
/** One end of a connection. */
export interface Transport {
  /** Ownership of `bytes` passes to the transport. */
  send: (channel: NetChannel, bytes: ArrayBuffer) => void;
  /** Subscribe to incoming messages; returns the unsubscribe. */
  onMessage: (listener: (channel: NetChannel, bytes: ArrayBuffer) => void) => () => void;
  /** Subscribe to the connection ending; returns the unsubscribe. */
  onClose: (listener: (reason: string) => void) => () => void;
  readonly stats: TransportStats;
  close: (reason?: string) => void;
}

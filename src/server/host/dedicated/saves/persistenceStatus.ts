/** Internal per-player observations, never a wire payload or an account/session verdict. */
export interface PersistenceStatus {
  readonly player: string;
  readonly shard: string;
  readonly sequence: number;
  readonly code: 'save-confirmed' | 'save-failed';
}
/** A diagnostic observer cannot turn a committed transaction into a failed write. */
export class PersistenceFeed {
  private readonly listeners = new Set<(status: PersistenceStatus) => void>();
  listen(listener: (status: PersistenceStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(status: PersistenceStatus): void {
    for (const listener of this.listeners) {
      try { listener(status); } catch { /* Observer failure changes no persistence result. */ }
    }
  }
}

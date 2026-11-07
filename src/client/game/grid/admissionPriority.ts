interface Waiting { readonly key: string; readonly resolve: () => void; readonly reject: (error: Error) => void }

/** Let actual world admission pass speculative product reads at their next IO boundary.
 * In-flight reads finish and older world construction drains; no transport or parser cap changes. */
export class GridAdmissionPriority {
  private readonly critical = new Map<string, number>();
  private readonly waiting = new Set<Waiting>();
  private closed = false;
  /** Hold priority through world preparation, including any previously started serialized world. */
  hold(key: string): () => void {
    if (this.closed) throw new Error('Grid admission priority disposed');
    this.critical.set(key, (this.critical.get(key) ?? 0) + 1); this.wake();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.critical.get(key) ?? 1) - 1;
      if (left === 0) this.critical.delete(key); else this.critical.set(key, left);
      this.wake();
    };
  }
  private wake(): void {
    for (const row of this.waiting) if (this.critical.size === 0 || this.critical.has(row.key)) {
      this.waiting.delete(row); row.resolve();
    }
  }
  /** Pause only before IO; never hold a shared validator, parser or cache worker slot while waiting. */
  async read<T>(key: string, work: () => Promise<T>): Promise<T> {
    while (!this.closed && this.critical.size > 0 && !this.critical.has(key)) {
      await new Promise<void>((resolve, reject) => { this.waiting.add({ key, resolve, reject }); });
    }
    if (this.closed) throw new Error('Grid admission priority disposed');
    return work();
  }
  /** Reject unstarted reads; their existing owners retain responsibility for in-flight work. */
  dispose(): void {
    this.closed = true;
    for (const row of this.waiting) row.reject(new Error('Grid admission priority disposed'));
    this.waiting.clear(); this.critical.clear();
  }
}

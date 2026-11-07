import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { SaveReceipt, SaveWrite } from './saveStore';

/** Writes at once: the pool's size. */
const WRITES_AT_ONCE = 4;
/** How long a failed write rests before it goes again. */
const RETRY_MS = 1000;
/** Write times kept for the p95. */
const TIMES_KEPT = 512;

/** How a queue is built. */
export interface SaveQueueOptions {
  readonly write: (write: SaveWrite) => Promise<void>;
  /** A write failed, and will go again. */
  readonly failed?: (write: SaveWrite, error: unknown) => void;
  readonly retryMs?: number;
}
const keyOf = (write: SaveWrite): string => `${write.player}\0${write.shard}`;
/** Everything `older` said that `newer` must still say. Receipts never coalesce away: each is a grant. */
function merged(older: SaveWrite, newer: SaveWrite): SaveWrite {
  const keep = newer.seq >= older.seq ? newer : older, receipts = new Map<number, SaveReceipt>();
  for (const row of [...older.receipts, ...newer.receipts]) receipts.set(row.serial, row);
  return { ...keep, receipts: [...receipts.values()].sort((a, b) => a.serial - b.serial) };
}

/**
 * E7.4: the main thread's saves. A room posts docs and no tick ever waits: this keeps only the newest per player and shard, writes
 * one at a time for each, oldest key first, and a failed write stays queued, merged with whatever came after it. `drain` is SIGTERM.
 */
export class SaveWriteQueue {
  /** Writes that landed, docs replaced by a newer one before they went, and failures. */
  readonly stats = { written: 0, coalesced: 0, failed: 0 };
  private readonly options: SaveQueueOptions;
  private readonly scope = new Scope('dedicated.saves.queue');
  private readonly pending = new Map<string, SaveWrite>();
  private readonly flying = new Set<string>();
  private readonly resting = new Set<string>();
  private readonly times: number[] = [];
  private readonly empties = new Set<() => void>();
  constructor(options: SaveQueueOptions) { this.options = options; }
  /** Docs waiting or on their way. */
  get waiting(): number { return new Set([...this.pending.keys(), ...this.flying]).size; }
  /** The p95 of recent write times, in ms: E7.8's number. */
  get p95(): number { const sorted = [...this.times].sort((a, b) => a - b); return sorted[Math.floor(sorted.length * 0.95)] ?? 0; }
  /** Queue a player's doc. */
  post(write: SaveWrite): void {
    const key = keyOf(write), older = this.pending.get(key);
    if (older !== undefined) this.stats.coalesced++;
    this.pending.set(key, older === undefined ? write : merged(older, write));
    this.pump();
  }
  /** Resolves true once nothing is waiting, or false at `ms`: a drain must end, and what it could not write is a checkpoint behind. */
  async drain(ms: number, player?: string, shard?: string): Promise<boolean> {
    const waiting = (): boolean => [...this.pending.keys(), ...this.flying].some(key => player === undefined || (shard === undefined ? key.startsWith(`${player}\0`) : key === `${player}\0${shard}`));
    if (!waiting()) return true;
    const scope = new Scope('dedicated.saves.drain');
    const finished = await new Promise<boolean>(resolve => {
      const check = (): void => { if (!waiting()) { this.empties.delete(check); resolve(true); } };
      scope.timeout(ms, () => { this.empties.delete(check); resolve(false); });
      this.empties.add(check);
    });
    scope.dispose();
    return finished;
  }
  dispose(): void { this.scope.dispose(); }
  private pump(): void {
    for (const empty of this.empties) empty();
    for (const [key, write] of this.pending) {
      if (this.flying.size >= WRITES_AT_ONCE) return;
      if (this.flying.has(key) || this.resting.has(key)) continue;
      this.pending.delete(key); this.flying.add(key);
      void this.fly(key, write);
    }
  }
  private async fly(key: string, write: SaveWrite): Promise<void> {
    const started = diagnosticNow();
    try {
      await this.options.write(write);
      this.stats.written++;
      this.times.push(diagnosticNow() - started);
      if (this.times.length > TIMES_KEPT) this.times.shift();
    } catch (error) {
      this.stats.failed++;
      this.options.failed?.(write, error);
      const newer = this.pending.get(key);
      this.pending.set(key, newer === undefined ? write : merged(write, newer));
      this.resting.add(key);
      this.scope.timeout(this.options.retryMs ?? RETRY_MS, () => { this.resting.delete(key); this.pump(); });
    }
    this.flying.delete(key);
    this.pump();
  }
}

import type { SaveStorage } from '../../../shared/engine/saves/store';

/** One storage change on its way to the page. `value` null removes the key. */
export interface ForwardedWrite { readonly seq: number; readonly key: string; readonly value: string | null }

/**
 * P1-E5.2 (E5-REPLICATION §6.3.3): a worker has no localStorage, so the server's SaveStore runs on this. It is pre-filled
 * with the page's documents and answers reads at once; each write goes to the page, which applies it to the real storage
 * and acks. A write is durable only once acked, so `settled` is what a durable grant waits on. That is the MMO shape: a
 * server's store is never the client's.
 */
export class ForwardedStorage implements SaveStorage {
  private readonly items: Map<string, string>;
  private readonly forward: (write: ForwardedWrite) => void;
  private readonly waiting = new Set<number>();
  private readonly settling: (() => void)[] = [];
  private refused = false;
  private seq = 0;
  constructor(initial: Readonly<Record<string, string>>, forward: (write: ForwardedWrite) => void) { this.items = new Map(Object.entries(initial)); this.forward = forward; }
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); this.send(key, value); }
  removeItem(key: string): void { this.items.delete(key); this.send(key, null); }
  /** The page answered write `seq`; `ok` false means the real storage refused it (quota, private mode). */
  acked(seq: number, ok: boolean): void {
    this.waiting.delete(seq);
    if (!ok) this.refused = true;
    if (this.waiting.size === 0) for (const settle of this.settling.splice(0)) settle();
  }
  /** Resolves when no write is unanswered: true if every one since the last call reached the real storage. */
  async settled(): Promise<boolean> {
    if (this.waiting.size > 0) await new Promise<void>(resolve => { this.settling.push(resolve); });
    const clean = !this.refused;
    this.refused = false;
    return clean;
  }
  private send(key: string, value: string | null): void {
    const seq = ++this.seq;
    this.waiting.add(seq);
    this.forward({ seq, key, value });
  }
}

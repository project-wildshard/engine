type ReadResult = PromiseSettledResult<Uint8Array>;
interface ReadSlot { readonly result: Promise<ReadResult>; readonly settle: (result: ReadResult) => void }
// Concurrent scene and fixed-draw phases share the same six transport slots.
const queued = new Set<() => void>();
let running = 0;
function pump(): void {
  for (;;) {
    if (running >= 6) return;
    const start = queued.values().next().value;
    if (start === undefined) return;
    queued.delete(start); start();
  }
}

/** Verified transport for one preparation phase. Six reads run independently of
 * ordered decode/publication; a settled read immediately starts the next file.
 * Finished bytes are held only until taken, and closing drains started work. */
export class PreparationReads<T> {
  private readonly results = new Map<number, ReadSlot>();
  private next = 0;
  private stopped = false;
  constructor(private readonly rows: readonly T[], private readonly load: (row: T) => Promise<Uint8Array>, private readonly active: () => boolean) {
    for (let index = 0; index < rows.length; index++) {
      let settle = (_result: ReadResult): void => undefined;
      const result = new Promise<ReadResult>(resolve => { settle = resolve; });
      this.results.set(index, { result, settle });
    }
    queued.add(this.start); pump();
  }
  private stop(reason: unknown): void {
    this.stopped = true; queued.delete(this.start);
    for (; this.next < this.rows.length; this.next++) this.results.get(this.next)?.settle({ status: 'rejected', reason });
  }
  private readonly start = (): void => {
    if (!this.active()) this.stop(new Error('Preparation read owner is disposed or retiring'));
    if (this.stopped || this.next >= this.rows.length) return;
    const index = this.next++, row = this.rows[index], slot = this.results.get(index);
    if (row === undefined || slot === undefined) throw new Error('Missing preparation read row');
    running++;
    void (async (): Promise<void> => {
      try { slot.settle({ status: 'fulfilled', value: await this.load(row) }); }
      catch (reason: unknown) { slot.settle({ status: 'rejected', reason }); this.stop(reason); }
      finally { running--; pump(); }
    })();
    // Put this phase at the back so an overlapping phase gets the next slot.
    if (!this.stopped && this.next < this.rows.length) queued.add(this.start);
  };
  async take(index: number): Promise<Uint8Array> {
    const slot = this.results.get(index);
    if (slot === undefined) throw new Error('Missing preparation read');
    const result = await slot.result;
    this.results.delete(index);
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }
  async close(): Promise<void> {
    this.stop(new Error('Preparation reads closed'));
    await Promise.all([...this.results.values()].map(slot => slot.result));
    this.results.clear();
  }
}

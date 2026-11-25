import { loadWindow, type LoadLease, type LoadWindow } from '@wildshard/engine/boot/loadWindow';

type ReadResult = PromiseSettledResult<Uint8Array>;
interface ReadSlot { readonly result: Promise<ReadResult>; readonly settle: (result: ReadResult) => void; lease?: LoadLease }
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
 * ordered decode/publication; a settled read starts the next file once the boot's
 * byte window (EM23, `loadWindow`) has room. Finished bytes are charged to the
 * window until taken (`take`), or until `done` when the taker holds them through
 * its decode (`take(index, true)`); closing drains started work. */
export class PreparationReads<T> {
  private readonly results = new Map<number, ReadSlot>();
  private next = 0;
  private stopped = false;
  /** reads of this phase still on the network or in verification: with none, the window always admits one (progress) */
  private reading = 0;
  private admitting = false;
  /** `size` (optional): a row's byte length before it is read, so the window admits it exactly; without it a read reserves
   *  the largest part seen so far until its bytes arrive. `window`: the page's (a test passes its own). */
  private readonly rows: readonly T[];
  private readonly load: (row: T) => Promise<Uint8Array>;
  private readonly active: () => boolean;
  private readonly size: ((row: T) => number) | undefined;
  private readonly window: LoadWindow;
  constructor(rows: readonly T[], load: (row: T) => Promise<Uint8Array>, active: () => boolean,
    size?: (row: T) => number, window: LoadWindow = loadWindow) {
    this.rows = rows; this.load = load; this.active = active; this.size = size; this.window = window;
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
    if (this.admitting) return; // re-queued once the window admits its waiting read
    const upcoming = this.rows[this.next], bytes = upcoming === undefined ? 0 : this.size?.(upcoming) ?? 0, alone = (): boolean => this.reading === 0;
    // A read that fits starts in this task, as before the window; one that must wait holds its slot while the window
    // decides, so a waiting phase never lets another take its turn's transport out of order.
    const now = this.window.tryAdmit(bytes, alone);
    if (now !== null) { running++; this.begin(now); return; }
    running++; this.admitting = true;
    void this.window.admit(bytes, alone).then((lease: LoadLease) => {
      this.admitting = false;
      if (!this.active()) this.stop(new Error('Preparation read owner is disposed or retiring'));
      if (this.stopped || this.next >= this.rows.length) { lease.release(); running--; pump(); return undefined; }
      this.begin(lease); pump();
      return undefined;
    });
  };
  /** Start the next row's read under its admitted lease (its transport slot already counted in `running`). */
  private begin(lease: LoadLease): void {
    const index = this.next++, row = this.rows[index], slot = this.results.get(index);
    if (row === undefined || slot === undefined) { lease.release(); throw new Error('Missing preparation read row'); }
    slot.lease = lease; this.reading++;
    void (async (): Promise<void> => {
      try { const value = await this.load(row); lease.charge(value.byteLength); slot.settle({ status: 'fulfilled', value }); }
      catch (reason: unknown) { lease.release(); slot.settle({ status: 'rejected', reason }); this.stop(reason); }
      finally { this.reading--; running--; pump(); }
    })();
    // Put this phase at the back so an overlapping phase gets the next slot.
    if (!this.stopped && this.next < this.rows.length) queued.add(this.start);
  }
  /** `hold`: the bytes stay charged to the window until `done(index)` (the taker's decode and upload). */
  async take(index: number, hold = false): Promise<Uint8Array> {
    const slot = this.results.get(index);
    if (slot === undefined) throw new Error('Missing preparation read');
    const result = await slot.result;
    if (!hold || result.status === 'rejected') { slot.lease?.release(); this.results.delete(index); }
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }
  /** The taker of a held read has decoded and uploaded it. */
  done(index: number): void { this.results.get(index)?.lease?.release(); this.results.delete(index); }
  async close(): Promise<void> {
    this.stop(new Error('Preparation reads closed'));
    await Promise.all([...this.results.values()].map(slot => slot.result));
    for (const slot of this.results.values()) slot.lease?.release();
    this.results.clear();
  }
}

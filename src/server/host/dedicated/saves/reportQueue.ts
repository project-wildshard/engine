// oxlint-disable-next-line import/no-nodejs-modules -- Stable delivery identity across ambiguous database retries.
import { randomUUID } from 'node:crypto';
import { Scope } from '@wildshard/engine/app/scope';
import type { ChatReport } from '@wildshard/engine/net/chat';

const MAX_REPORTS = 1024, RETRY_MS = 1000;
/** One accepted report retains its identity until the database acknowledges it. */
export interface ReportWrite { readonly id: string; readonly report: ChatReport; readonly shard: string }
/** A bounded retryable report sink; accepted reports participate in shutdown draining. */
export class ReportWriteQueue {
  readonly stats = { written: 0, failed: 0, refused: 0 };
  private readonly pending: ReportWrite[] = [];
  private readonly scope = new Scope('dedicated.reports');
  private readonly waiters = new Set<() => void>();
  private flying = false;
  private resting = false;
  constructor(private readonly write: (row: ReportWrite) => Promise<void>, private readonly failed: (error: unknown) => void) {}
  get waiting(): number { return this.pending.length; }
  /** False means the bounded backlog refused this report, and no durability is claimed. */
  post(report: ChatReport, shard: string): boolean {
    if (this.pending.length >= MAX_REPORTS) { this.stats.refused++; return false; }
    this.pending.push({ id: randomUUID(), report, shard }); this.pump(); return true;
  }
  async drain(ms: number): Promise<boolean> {
    if (this.waiting === 0) return true;
    const scope = new Scope('dedicated.reports.drain');
    const done = await new Promise<boolean>(resolve => {
      const check = (): void => { if (this.waiting === 0) { this.waiters.delete(check); resolve(true); } };
      scope.timeout(ms, () => { this.waiters.delete(check); resolve(false); });
      this.waiters.add(check);
    });
    scope.dispose(); return done;
  }
  dispose(): void { this.scope.dispose(); }
  private pump(): void {
    if (this.flying || this.resting) return;
    const row = this.pending[0];
    if (row === undefined) { for (const waiter of this.waiters) waiter(); return; }
    this.flying = true; void this.fly(row);
  }
  private async fly(row: ReportWrite): Promise<void> {
    try { await this.write(row); this.pending.shift(); this.stats.written++; }
    catch (error) {
      this.stats.failed++; this.failed(error); this.resting = true;
      this.scope.timeout(RETRY_MS, () => { this.resting = false; this.pump(); });
    }
    this.flying = false; this.pump();
  }
}

import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';

/** GC6: the shortest wait before an optional read the budget refused is tried again while no room was freed (ms) */
export const BUDGET_RETRY_MS = 3000;

/**
 * GC6: optional reads the shared budget refused (a neighbour's radial product, a near view), each tried again only once the
 * budget changed and either freed room (its playing cost fell below the refusal's) or BUDGET_RETRY_MS passed. Keyed on the
 * revision alone, a page at its envelope re-read three neighbours' whole products and near bakes 4 to 12 times each while
 * the first walk into Nalati prepared its entry on the road (Jake's 2992x1434@2): every claim anywhere moved the revision.
 */
export class BudgetDeferrals {
  private readonly rows = new Map<string, { readonly revision: number; readonly playing: number; readonly at: number }>();
  constructor(private readonly allocator: Pick<ResidencyAllocator, 'revision' | 'cost'>, private readonly retryMs: number = BUDGET_RETRY_MS) {}
  /** record a refusal now */
  defer(id: string): void { this.rows.set(id, { revision: this.allocator.revision, playing: this.allocator.cost().playing, at: diagnosticNow() }); }
  /** true while a refused read should not start again */
  waiting(id: string): boolean {
    const row = this.rows.get(id);
    if (row === undefined) return false;
    if (row.revision === this.allocator.revision) return true;
    return diagnosticNow() - row.at < this.retryMs && this.allocator.cost().playing >= row.playing;
  }
  delete(id: string): void { this.rows.delete(id); }
  clear(): void { this.rows.clear(); }
  keys(): IterableIterator<string> { return this.rows.keys(); }
}

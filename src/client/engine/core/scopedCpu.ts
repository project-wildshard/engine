import type { Scope } from '../../../shared/engine/app/scope';

/** One completed drawn frame's scoped CPU; fixed-step repetitions accumulate into that same frame. */
export interface ScopedCpuSample { id: string; ms: number; calls: number; limitMicros?: number; overMicros?: number }
interface Owner extends ScopedCpuSample { scope: Scope; pendingMs: number; pendingCalls: number }

/** Native composition assigns scope ownership; content IDs and system flags cannot select a CPU allowance. */
export class ScopedCpuMeter {
  enabled = false;
  private readonly owners: Owner[] = [];
  private complete = 0;
  private budgetedOwners = 0;
  get active(): boolean { return this.enabled || this.budgetedOwners > 0; }
  /** Bind before content installs. Nested residents take precedence over their containing page owner. */
  bind(scope: Scope, id: string): void {
    if (scope.disposed || id.length === 0 || this.owners.some(owner => owner.scope === scope)) throw new Error('CPU owner requires a unique live scope');
    const owner: Owner = { scope, id, pendingMs: 0, pendingCalls: 0, ms: 0, calls: 0 };
    this.owners.push(owner);
    scope.onDispose(() => {
      const index = this.owners.indexOf(owner);
      if (index === -1) return;
      this.owners.splice(index, 1);
      if (owner.limitMicros !== undefined) this.budgetedOwners--;
    });
  }
  /** Set the native owner's CPU allowance before registering its systems. */
  setLimit(scope: Scope, micros: number): void {
    const owner = this.owner(scope);
    if (owner === null || scope.disposed || !Number.isSafeInteger(micros) || micros <= 0) {
      throw new Error('CPU allowance requires a live bound owner and a positive integer budget');
    }
    if (owner.limitMicros === undefined) this.budgetedOwners++;
    owner.limitMicros = micros;
  }
  /** Resolve once when a native content callback registers; shell systems never acquire this ticket. */
  ticket(scope: Scope): ScopedCpuSample | null {
    return this.owner(scope);
  }
  shouldMeasure(ticket: ScopedCpuSample | null): boolean {
    return ticket !== null && (this.enabled || ticket.limitMicros !== undefined);
  }
  private owner(scope: Scope): Owner | null {
    let found: Owner | null = null;
    for (const owner of this.owners) if (scope.belongsTo(owner.scope) && (found === null || owner.scope.belongsTo(found.scope))) found = owner;
    return found;
  }
  /** No arrays, maps or tickets allocate during the measured frame. */
  begin(): void {
    if (!this.active) return;
    for (const owner of this.owners) { owner.pendingMs = 0; owner.pendingCalls = 0; }
  }
  /** Count even a throwing callback; the usual fault handler retains its original behavior. */
  record(ticket: ScopedCpuSample | null, ms: number): void {
    if (!this.shouldMeasure(ticket)) return;
    // Tickets cannot be fabricated by data: identity must match a live, native scope binding.
    for (const owner of this.owners) if (owner === ticket) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Invalid CPU measurement');
      owner.pendingMs += ms; owner.pendingCalls++; return;
    }
  }
  /** Publish only after drawing completes, so samplers never read a partially accumulated frame. */
  end(): void {
    if (!this.active) return;
    for (const owner of this.owners) { owner.ms = owner.pendingMs; owner.calls = owner.pendingCalls; }
    this.complete++;
  }
  /** Allocation is restricted to an external diagnostic read, never the production frame loop. */
  snapshot(): { enabled: boolean; frame: number; owners: ScopedCpuSample[] } {
    return { enabled: this.active, frame: this.complete, owners: this.owners.map(({ id, ms, calls, limitMicros }) => ({ id, ms, calls,
      ...(limitMicros === undefined ? {} : { limitMicros, overMicros: Math.max(0, Math.ceil(ms * 1_000 - limitMicros)) }) })) };
  }
}

import type { Scope } from '@wildshard/engine/app/scope';
import { buildHeld, buildUrgent, frameBudgetSpent, frameDue, presenting } from '@wildshard/engine/core/framePacing';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { buildYield, WORK_SLICE_MS } from '@wildshard/engine/core/workSlice';

// Loading work shares a 50 ms wall slice across parallel home builders.
let loadingAt: number | undefined;

function requireOwner(owner: Scope): void {
  if (owner.disposed || owner.disposing) throw new Error('build stopped: its scope has closed');
}

/** A completion checkpoint, not a read/decode pause. Callers await only a
 * returned promise: cheap live rows remain synchronous under the shared budget.
 * Loading browsers share 50 ms slices; Node keeps the original task turn.
 * A queued yield keeps buildYield's
 * delivery-time frame check and refuses a retired or retiring owner. */
export function constructionCheckpoint(owner: Scope, ownerBudgetMs: number = WORK_SLICE_MS): Promise<void> | undefined {
  requireOwner(owner);
  const live = presenting();
  if (!live && typeof document !== 'undefined') {
    const now = diagnosticNow();
    loadingAt ??= now;
    if (now - loadingAt < 50) return undefined;
    loadingAt = now;
    return buildYield(owner).then(() => { requireOwner(owner); loadingAt = diagnosticNow(); return undefined; });
  }
  loadingAt = undefined;
  if (live && (buildHeld() || buildUrgent() || !frameDue()) && !frameBudgetSpent(Math.min(WORK_SLICE_MS, ownerBudgetMs))) return undefined;
  return buildYield(owner).then(() => { requireOwner(owner); return undefined; });
}

/** The end of one scene placement row. Play and Node keep the original build turn after every row. A loading browser
 * shares the 50 ms construction slice instead: one timer turn per row paid the 4 ms nested-timer clamp each time (Nine's
 * props: 310 turns, 1.36 s idle with no named wait, NB6's boot refusal on the hosted nightly, FS30). */
export function placementRowCheckpoint(owner: Scope): Promise<void> | undefined {
  requireOwner(owner);
  return presenting() || typeof document === 'undefined' ? buildYield(owner) : constructionCheckpoint(owner);
}

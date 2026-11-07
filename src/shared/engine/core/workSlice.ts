/**
 * Cooperative slicing for long builds that can run while the game is drawing (op-hitch23, E435 frame floor).
 *
 * A grid cell admits its world on the road, in play, so every synchronous stretch of a builder lands between two drawn
 * frames. A 60 Hz frame leaves about 16.7 ms: the game's own update and render take ~4–7 ms on the desktop, so a build
 * stretch above ~8 ms costs a frame. Builders check `slice.due()` inside their loops and `await slice.yield()` when it
 * is; the yield is a fresh timer task, or, in play with a frame due (`framePacing.ts`), a wait until the engine loop has drawn
 * it: Blink may run timer tasks back to back before its rendering update.
 *
 *   const slice = workSlice();
 *   for (const item of items) { work(item); if (slice.due()) await slice.yield(); }
 */
import { pageScope, resourceScope } from '../app/resources';
import type { Scope } from '../app/scope';
import { diagnosticNow } from './clock';
import { frameBudgetSpent, heldBudget, nextDrawnFrame, paceYield, presenting } from './framePacing';

/** The longest synchronous stretch a sliced builder runs before it lets a frame through (ms). */
export const WORK_SLICE_MS = 8;

/** Local elapsed slices during loading; live CPU work shares the drawn frame's budget. */
export interface WorkSlice {
  /** Whether the local loading slice or shared live frame has spent its budget. */
  readonly due: () => boolean;
  /** end the stretch: resolves on a fresh macrotask (the browser may paint first) and restarts the clock */
  readonly yield: () => Promise<void>;
  /** `yield()` when due, else nothing (await it inside a loop: `await slice.check()`) */
  readonly check: () => Promise<void> | undefined;
}

/** Resolve on a fresh timer task, where the browser may draw a due frame first. Not a MessageChannel: Blink dispatches
 *  queued port messages in one task until its own yield threshold, which merged 8 ms slices into ~100 ms tasks with no
 *  frame between them (measured, Nine Dragon's cell entry). Nested timers clamp to 4 ms: idle time, not frame time. */
export function yieldTask(owner?: Scope): Promise<void> {
  const scope = owner ?? resourceScope();
  return new Promise<void>(resolve => {
    let done = false, forget = (): void => undefined;
    const finish = (): void => { if (done) return; done = true; forget(); resolve(); };
    // Disposal clears the timer. Settle its promise too so the caller can reach its cancellation fence.
    forget = scope.capture('disposers', finish);
    if (!done) scope.timeout(0, finish);
  });
}

// Live construction checks the shared budget at every hop. A message turn therefore cannot
// batch unchecked work, unlike an unpaced message loop; it avoids spending that budget on
// the browser's nested-timer clamp. The drawn-frame barrier still ends every spent slice.
function buildTurn(owner: Scope): Promise<void> {
  if (!presenting() || typeof globalThis.MessageChannel !== 'function') return yieldTask(owner);
  return new Promise<void>(resolve => {
    const channel = new MessageChannel(), turn = owner.child('build-turn');
    let delivered = false;
    turn.onDispose(() => { channel.port1.close(); channel.port2.close(); if (!delivered) resolve(); });
    turn.listen(channel.port1, 'message', () => { delivered = true; turn.dispose(); owner.run(resolve); }, { once: true });
    channel.port1.start(); channel.port2.postMessage(0);
  });
}

/**
 * A world build's pause between its pieces (op-hitch45, E435 frame floor): a fresh task of `owner`, or, in play with a
 * frame due (`framePacing.ts`), a wait until the engine loop has drawn it. A plain timer
 * hop is not enough there: WebKit drew no frame across Nine Dragon's ~15 back-to-back `timeout(0)` build tasks (a 233 ms
 * frame on the iOS Simulator). Pacing off, it is exactly the timer task. Rejects when `owner` has closed (before or after
 * the pause): an unloaded cell stops building. Live cheap pieces use message tasks within the existing shared budget;
 * the loading screen, unpaced mode and Node retain timer tasks.
 */
export async function buildYield(owner: Scope, budgetMs: number = WORK_SLICE_MS): Promise<void> {
  const live = (): void => { if (owner.disposed || owner.disposing) throw new Error('build stopped: its scope has closed'); };
  live();
  await paceYield(() => buildTurn(owner), owner, budgetMs);
  live();
}

/**
 * A slice clock for one sliced build (`budgetMs` defaults to `WORK_SLICE_MS`). `owner` holds its yield timers: by default
 * the ambient owner at each yield; a page-lifetime memo that keeps painting after the build that asked for it (a creature
 * coat) passes the page scope, so a left level's closed scope never strands it mid-yield.
 */
export function workSlice(budgetMs: number = WORK_SLICE_MS, owner?: Scope): WorkSlice {
  let start = diagnosticNow();
  const slice: WorkSlice = {
    // in play the budget is also the frame's (op-hitch44): every build running at once shares it, so a second build's
    // stretch never follows the first one's before the frame they both owe is drawn
    // A read/decode may have awaited several draws since this slice started.
    // Only work since the current drawn frame spends a live CPU slice.
    due: () => { const now = diagnosticNow(); return presenting(now) ? frameBudgetSpent(budgetMs, now) : now - start >= heldBudget(budgetMs); },
    // in play with a frame due, the stretch ends only once the loop has drawn it (op-hitch26: timer tasks ran back to back)
    yield: async () => {
      const scope = owner ?? resourceScope();
      if (scope.disposed || scope.disposing) throw new Error('build stopped: its scope has closed');
      await paceYield(() => buildTurn(scope), scope, budgetMs);
      if (scope.disposed || scope.disposing) throw new Error('build stopped: its scope has closed');
      start = diagnosticNow();
    },
    check: () => (slice.due() ? slice.yield() : undefined),
  };
  return slice;
}

/**
 * A value an async API already holds (a cached asset read), handed back as its promise (OP, grid entry hitches): on
 * its microtask, unless a presenting page's shared build budget is spent (`frameBudgetSpent`), then after the next drawn
 * frame. A runtime hook that awaits cached reads one after another otherwise ran its whole chain in one task: every
 * await of an already-present asset resumed in a microtask, so no frame was drawn between them. Not presenting (loading
 * screens, Node, pacing off) it is exactly `Promise.resolve`. The wait is the page's (never a retired owner's) and is
 * capped by `nextDrawnFrame`, so it cannot strand its caller.
 */
export function pacedResolve<T>(value: T): Promise<T> {
  if (!frameBudgetSpent(WORK_SLICE_MS)) return Promise.resolve(value);
  return nextDrawnFrame(pageScope).then(() => value);
}

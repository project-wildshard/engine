/**
 * The script memory bank a page reserves, and when (entry.ts). Each reserve can cost JSC a full GC (e472f34069), so the bank
 * is spent where a reserve is cheapest to pay for.
 *
 * STAGING-BUGBASH SB47 (opus-sb49): a grid page reserved the full-ALL route's demand for its cell activations in play (35
 * fixed and 9 virgin memories) under the loader: 1.1-2.0 s of Application modules on headless WebKit iPhone at 4x CPU and
 * 0.4 s in the iOS Simulator, before its one home cell was built. Under the loader a grid page builds one cell, as a
 * standalone page builds its one world (NB4: Nine's standalone page took 1 of its bank by control), so it reserves the
 * standalone bank there; the rest of the grid bank tops up after control, a reserve an idle turn. A reserve the bank lacks
 * allocates in place, as before.
 */
export interface ScriptMemoryBank {
  /** fixed memories of 1..4 pages */
  readonly counts: readonly [number, number, number, number];
  /** virgin growable memories */
  readonly virgin: readonly { readonly initial: number; readonly maximum: number; readonly count: number }[];
}

/** A standalone page's one world (and a grid page's home cell under the loader). */
export const PAGE_SCRIPT_MEMORY: ScriptMemoryBank = { counts: [4, 0, 1, 0], virgin: [{ initial: 1, maximum: 2, count: 1 }, { initial: 1, maximum: 64, count: 1 }] };
/** A grid page's full-ALL route: its cell activations in play. */
export const GRID_SCRIPT_MEMORY: ScriptMemoryBank = { counts: [35, 0, 1, 0], virgin: [{ initial: 1, maximum: 2, count: 5 }, { initial: 1, maximum: 64, count: 4 }] };

/** What the page reserves under the loader, and what it tops up to after control (null: nothing more). */
export function scriptMemoryPlan(grid: boolean): { readonly boot: ScriptMemoryBank; readonly play: ScriptMemoryBank | null } {
  return { boot: PAGE_SCRIPT_MEMORY, play: grid ? GRID_SCRIPT_MEMORY : null };
}

/** meta IPHONE13-DRIFTWOOD DW2/DW3 (mini-driftwood13, 2026-11-19): on the iPhone 13 the grid top-up after control is the dock's
 *  first-seconds stall. A ScriptProfiler sample of Driftwood's first 8 s of play put half the main thread (about 2.5 s) in
 *  `new WebAssembly.Memory` from this top-up, 190 to 540 ms tasks between frames while update and render stayed under 20 ms.
 *  The device slot `debug.scriptMemoryTopUp` (true or false) keeps or skips it; skipped, a cell activation that finds the
 *  bank short allocates in place, as a miss always has. Unset, it is off at phone Low and on everywhere else: in five
 *  alternating iPhone 13 pairs on Driftwood's dock at the 30 cap (main dfd92543e, 2026-11-19) off was better every time, 26
 *  fps and p95 62 to 65 ms against 23 fps and p95 100 ms, and 59 frames over 50 ms against 88. It changes no pixels. */
export const SCRIPT_MEMORY_TOP_UP_SLOT = 'debug.scriptMemoryTopUp';
export const SCRIPT_MEMORY_TOP_UP_DEFAULT = true;
/** The slot's value: a boolean wins; unset, off at phone Low (`phoneLow`), else SCRIPT_MEMORY_TOP_UP_DEFAULT. */
export function scriptMemoryTopUp(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? false : SCRIPT_MEMORY_TOP_UP_DEFAULT;
}

type Prepare = (counts: readonly number[], yieldTask: () => Promise<void>, virgin?: ScriptMemoryBank['virgin']) => Promise<void>;
/**
 * Reserve the boot bank now (`yieldTask` between reserves), and once `afterControl` runs its callback, top up to the play
 * bank with `idle` between reserves (false: the owner ended, nothing more is reserved). Resolves with the boot bank.
 */
export async function reserveScriptMemory(grid: boolean, ports: { readonly prepare: Prepare; readonly yieldTask: () => Promise<void>;
  readonly afterControl: (run: () => void) => void; readonly idle: () => Promise<boolean>; readonly topUp?: boolean }): Promise<void> {
  const plan = scriptMemoryPlan(grid), play = plan.play;
  await ports.prepare(plan.boot.counts, ports.yieldTask, plan.boot.virgin);
  if (play === null || ports.topUp === false) return;
  ports.afterControl(() => {
    const paced = async (): Promise<void> => { if (!await ports.idle()) throw new Error('Script memory top-up ended'); };
    // optional: a top-up that ends (the page left play) or fails leaves the bank as it is, and a miss allocates in place
    void (async () => { if (await ports.idle()) await ports.prepare(play.counts, paced, play.virgin); })().catch(() => undefined);
  });
}

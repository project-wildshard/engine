/** The phone spawn view finishes linking under loading; undrawn programs stay deferred. */
import type { Game } from '@wildshard/engine/core/Game';
import { liveWarmPacing, precompileLevel } from '@wildshard/engine/render/precompile';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { waitEntryWork } from './entryReadiness';

/** FC2: counted offscreen draws of the spawn view (the real formats, nothing presented) before spawn is ready. A live
 *  frame used to be the probe (20 quiet drawn frames under the loader); one draw links what the view draws, so three
 *  settle it. Since NF18 every program is a classic one linked by precompile, so the window counts draws only. */
const QUIET_DRAWS = 3;
/** Compile the spawn view and observe three drawn frames before reveal, however long linking takes. */
export async function settleEntryPrograms(game: Game): Promise<{ ms: number; draws: number; stalled: string | null }> {
  const start = diagnosticNow(), scope = game.levelScope;
  let draws = 0;
  await waitEntryWork(scope, async current => {
    // QA3 (G837): WebKit's live pacing, as every in-play warm-up has: a few programs issued a frame and each link polled
    // with backoff. Without it the step issued the whole spawn view, then asked its links' status; each ask is a
    // synchronous GPU-process round trip behind every queued compile, so one frame waited for them all (68 s on an iPhone).
    await precompileLevel(game, undefined, { sliceMs: 12, current, owner: scope, drawnOnly: true, warmPost: true, ...liveWarmPacing() });
    while (draws < QUIET_DRAWS && current()) {
      game.offscreenDraw(); draws++;
      await new Promise<void>(resolve => { scope.raf(() => { resolve(); }); });
    }
    if (!current()) throw new Error('Spawn program warm-up owner left');
  });
  const result = { ms: diagnosticNow() - start, draws, stalled: null };
  performance.mark('wildshard.entry.programs-settled', { detail: result });
  return result;
}

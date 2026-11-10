import { pageScope } from '../../../shared/engine/app/resources';

/** iOS Simulator, 2026-11-09: WebKit stops painting a page as soon as a navigation starts in the same turn, so the load
 * failure screen's RELOAD showed no cover at all. Every reload the player asked for navigates one painted frame after the
 * RELOADING cover went up (src/client/engine/ui/reloadCover.ts); a page that gets no frames (hidden) goes after
 * LEAVE_FRAME_MS anyway. Its own module, with no imports but the page scope, so the service-worker boot
 * (src/client/engine/boot/sw.ts `adopt`) routes its navigation through it without pulling the cover into its graph. */
const LEAVE_FRAME_MS = 100;
export function leaveAfterPaint(go: () => void): void {
  // a page whose scope is gone runs no frames or timers: it is leaving already, so the navigation goes now
  if (pageScope.disposed || pageScope.disposing) { go(); return; }
  let gone = false;
  const once = (): void => { if (gone) return; gone = true; go(); };
  pageScope.raf(() => { pageScope.timeout(0, once); });
  pageScope.timeout(LEAVE_FRAME_MS, once);
}

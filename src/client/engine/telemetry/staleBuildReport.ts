import { takeStaleBuildNote, type StaleBuildNote } from '../saves/staleBuildNote';
import { saveStorage } from '../saves/slots';
import { captureBrowserError, engineScreenTags, staleBuildReport } from './browserErrors';

/** STALE-BUILD SB6: report an earlier page's stale-build note (browserErrors.ts staleBuildReport), if there is one; the note is gone after this. */
export function reportStaleBuild(take: () => StaleBuildNote | null = takeStaleBuildNote, capture: typeof captureBrowserError = captureBrowserError): void {
  try {
    const note = take();
    if (note === null) return;
    const { error, tags } = staleBuildReport(note);
    capture(error, tags);
  } catch { /* telemetry never disrupts the boot */ }
}

/** a claim this long before this document started is the reload that started it (lastEnd.ts SELF_RELOAD_MS) */
const SELF_RELOAD_MS = 3000;
/** S18: the session `boot.selfReload` claim as this document found it. Read it at boot: an online boot's settle clears it
 *  within seconds (browserChunkRecovery.ts settleRefusedBuild). */
export function selfReloadClaim(read: () => string | null = () => saveStorage('session').getItem('boot.selfReload')): string | null {
  try { return read(); } catch { return null; }
}
/** SENTRY-TRIAGE S18: index.html's 12 s self-reload (RL3) stamps session `boot.selfReload` with the time, then reloads; it has
 *  no Sentry, so the page it reloaded into reports it. Only that page: a claim older than this document is an earlier one's.
 *  `read` is selfReloadClaim's reading at boot; chunk recovery's and GpuRecovery's claims are '1', never a time. stuck.ts's
 *  retry stamps a time too, but marks its reload (lastEnd.ts markReload), which index.html's script never does: the caller
 *  passes no claim for a marked reload (bootTrace.ts). */
export function reportSelfReload(read: () => string | null, startedAt: number = performance.timeOrigin, capture: typeof captureBrowserError = captureBrowserError): void {
  try {
    const at = Number(read());
    if (!Number.isFinite(at) || at < 1e12 || at > startedAt + 50 || startedAt - at >= SELF_RELOAD_MS) return;
    capture(new Error("the page's entry never arrived; index.html reloaded it after 12 s"), engineScreenTags('self-reload', 'boot', 'loading'));
  } catch { /* telemetry never disrupts the boot */ }
}

import { takeStaleBuildNote, type StaleBuildNote } from '../saves/staleBuildNote';
import { captureBrowserError, staleBuildReport } from './browserErrors';

/** STALE-BUILD SB6: report an earlier page's stale-build note (browserErrors.ts staleBuildReport), if there is one; the note is gone after this. */
export function reportStaleBuild(take: () => StaleBuildNote | null = takeStaleBuildNote, capture: typeof captureBrowserError = captureBrowserError): void {
  try {
    const note = take();
    if (note === null) return;
    const { error, tags } = staleBuildReport(note);
    capture(error, tags);
  } catch { /* telemetry never disrupts the boot */ }
}

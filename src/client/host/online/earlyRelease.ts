import type { ReleaseToDial } from './release';

/**
 * TEMPLATE-E2E TR-4b (T1 K): a world build's release read, begun at the boot's data step (clientWorker.ts
 * `readOnlineReleaseEarly`) beside the load, so a missing file shows its page (release-5xx and the rest, FM5) within
 * seconds of the tap. Read only at the server step, a 503 said so after the whole load (19.6 s of local SwiftShader,
 * about 49 s hosted), and a load stalled before that step never said so. `startOnline` takes the read over; one read per
 * release address, and any later dial on the page reads afresh.
 */
const begun = new Map<string, Promise<ReleaseToDial>>();

/** Start the read for `at` now, unless one is already under way. Its rejection is owned by `takeRelease`. */
export function beginRelease(at: string, read: () => Promise<ReleaseToDial>): void {
  if (begun.has(at)) return;
  const reading = read();
  void reading.catch(() => undefined);
  begun.set(at, reading);
}

/** The read begun for `at` (once), or a new one. */
export function takeRelease(at: string, read: () => Promise<ReleaseToDial>): Promise<ReleaseToDial> {
  const reading = begun.get(at);
  begun.delete(at);
  return reading ?? read();
}

// FM3b: a runner's optimism never substitutes for captured evidence.
/** @typedef {import('./failmode-cases.mjs').Case} Case */
/** @typedef {{outcome: import('./failmode-cases.mjs').Outcome, reason?: string, seen?: {ids: string, ms: number, copy: string, leak: string|null}|null, injection?: unknown, recovery?: string, shot?: string}} Result */
/** @param {Case} item @param {Result} result @param {number} elapsed @returns {Result} */
export function qualifyResult(item, result, elapsed) {
  if (result.outcome !== 'pass') return result;
  const seen = result.seen;
  const failures = [
    !Number.isFinite(elapsed) || elapsed < 0 || elapsed > item.deadlineMs ? 'case deadline exceeded' : null,
    seen === undefined || seen === null || !seen.ids.split(/\s+/u).includes(item.screen) ? 'no matching captured screen' : null,
    seen === undefined || seen === null || !Number.isFinite(seen.ms) || seen.ms < 0 || seen.copy.trim() === '' || seen.leak !== null ? 'invalid captured primary copy or appearance time' : null,
    result.injection === null || typeof result.injection !== 'object' || Object.keys(result.injection).length === 0 ? 'no observed injection evidence' : null,
    result.shot === undefined || !/^[a-z0-9_-]+\.png$/u.test(result.shot) ? 'no captured screenshot' : null,
    result.recovery === undefined || result.recovery.trim() === '' ? 'no observed recovery or terminal state' : null,
  ].filter(value => value !== null);
  return failures.length === 0 ? result : { ...result, outcome: 'harness-fail', reason: failures.join('; ') };
}
/** QA-FEEDBACK 2026-11-19 row 8: how long a boot case waits for its screen. A page reads its release file again only when it dials,
 *  after the world has loaded, and hosted SwiftShader takes past 30 s to get there; the world's own entry gets 150 s (`intoWorld`). */
export const BOOT_SCREEN_MS = 150_000;
/** A boot case's screen, polled until it shows, the page is in the world without it (a real miss, called at once), or the deadline.
 *  `screen` waits a beat itself and does any per-beat step (the Name box) first.
 *  @template T @param {{ screen: () => Promise<T | null>, inWorld: () => Promise<boolean>, now?: () => number }} probe @param {number} deadlineMs
 *  @returns {Promise<{ seen: T } | { seen: null, why: 'in the world' | 'deadline' }>} */
export async function bootScreenWait(probe, deadlineMs) {
  const now = probe.now ?? Date.now, until = now() + deadlineMs;
  while (now() < until) {
    const seen = await probe.screen();
    if (seen !== null) return { seen };
    if (await probe.inWorld()) return { seen: null, why: 'in the world' };
  }
  return { seen: null, why: 'deadline' };
}

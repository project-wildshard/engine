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

/**
 * The page's side of `setBuildHeld` (G580 T5): Developer pages time each held interval
 * (`wildshard.prepare:grid:held.<n>`, beside the preparation spans the crossing readers collect), so a reading shows when
 * the held budgets applied. Public mode reads no clock. Kept out of `framePacing.ts` (P1-E1) so the pacing law reaches no
 * Developer switch or DOM on a headless host.
 */
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { isDev } from './devMode';
import { buildHeld, setBuildHeld } from '../../../shared/engine/core/framePacing';

let heldSince = Number.NEGATIVE_INFINITY, heldIntervals = 0;
function noteHeldInterval(on: boolean): void {
  if (!isDev()) return;
  const now = diagnosticNow();
  if (on) { heldSince = now; return; }
  if (Number.isFinite(heldSince)) performance.measure(`wildshard.prepare:grid:held.${String(heldIntervals++)}`, { start: heldSince, end: now });
  heldSince = Number.NEGATIVE_INFINITY;
}

/** `setBuildHeld`, timing the held interval on Developer pages. */
export function setBuildHeldTimed(on: boolean): void {
  if (on !== buildHeld()) noteHeldInterval(on);
  setBuildHeld(on);
}

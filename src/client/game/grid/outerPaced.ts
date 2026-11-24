/**
 * meta DRIFTWOOD-FPS DF8 (mini-driftwood13g): the outer ring's start, paced. The reveal's longest update on the iPhone 13
 * (44 to 64 ms, about 2 s after the wake lock on Driftwood) was the grid session's fixed step starting the outer ring
 * once the background opened: the outer road's read started all ~40 of its blocks' ~80 fetches in that one task (32 to
 * 41 ms of their synchronous starts), beside every far neighbour's declaration (11 to 12 ms). With the device slot
 * `debug.outerStartPaced` on, the outer road reads OUTER_BLOCK_READS blocks at a time (compiledStrips.ts), and the far
 * declarations go one a fixed step (session.ts). What is read, and when it is all in, is unchanged.
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';

export const OUTER_START_PACED_SLOT = 'debug.outerStartPaced';
export const OUTER_START_PACED_DEFAULT = false;
/** Unset at phone Low: on. Three alternating cooled iPhone 13 pairs on Driftwood at the 30 cap (2026-11-20): off, the reveal's
 *  longest update was 48 to 60 ms, 31 to 38 of it the outer road's start; on, 38 or 39 ms (a gull guide install, the
 *  animals), the outer start in no update over 30 ms. Dock frames over 50 ms in 30 s: 4, 3 and 6 on against 6, 14 and 6 off. */
export const OUTER_START_PACED_PHONE_LOW = true;

/** The slot's value: a boolean wins; unset, OUTER_START_PACED_PHONE_LOW at phone Low, else OUTER_START_PACED_DEFAULT. */
export function outerStartPaced(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? OUTER_START_PACED_PHONE_LOW : OUTER_START_PACED_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the outer ring's start is paced; read once per page. */
export function outerStartPacedOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(OUTER_START_PACED_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = outerStartPaced(saved, phoneLow);
  return picked;
}

/**
 * meta DRIFTWOOD-FPS DW3 (mini-dw3, 2026-11-23): the streamed ground cover at phone Low. On the iPhone 13 at phone Low
 * (main 075d23671, DW1's route, cap 30) the west path, the altar and the walk back draw 525 to 606k cover triangles in
 * 12 to 13 draws, three quarters of their 0.82 to 0.95M (the leg census): far ferns 102k, far hibiscus 82k, near bushes
 * 74k, near hibiscus 67k, far bushes 66k, near tufts 61k, near daisies 54k, near ferns 49k, far tufts 36k. Those legs
 * sit at 38 to 43 ms p95. Two device slots, both phone Low only and read once per page (unset: the authored cover):
 *   - `debug.coverReachLow` (0.5 to 1): scales the phone's reach (`reachK`), so every kind's near and far edge come in;
 *   - `debug.coverKeepLow` (0.3 to 1): the share of a kind's plants that hand over to a far model, at most the authored
 *     `keep` (the tufts already keep 0.6: the rest shrink away at their near edge, as the tufts' do).
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';

export const COVER_REACH_LOW_SLOT = 'debug.coverReachLow';
export const COVER_KEEP_LOW_SLOT = 'debug.coverKeepLow';
/** Unset at phone Low: the authored reach and keep, until cooled iPhone 13 pairs and a J430 board decide (DW3). */
export const COVER_REACH_PHONE_LOW = 1;
export const COVER_KEEP_PHONE_LOW = 1;

const clamp = (saved: unknown, lo: number, fallback: number): number =>
  typeof saved === 'number' && Number.isFinite(saved) ? Math.min(1, Math.max(lo, saved)) : fallback;
/** The factors for a saved pair: a number in range wins (clamped); unset, the phone Low defaults at phone Low, else 1. */
export function coverLow(saved: { reach: unknown; keep: unknown }, phoneLow: boolean): { reach: number; keep: number } {
  if (!phoneLow) return { reach: 1, keep: 1 };
  return { reach: clamp(saved.reach, 0.5, COVER_REACH_PHONE_LOW), keep: clamp(saved.keep, 0.3, COVER_KEEP_PHONE_LOW) };
}
let picked: { reach: number; keep: number } | undefined;
/** This page's factors; read once. */
export function coverLowOn(): { reach: number; keep: number } {
  if (picked !== undefined) return picked;
  let reach: unknown = null, keep: unknown = null, phoneLow = false;
  try { reach = jsonSlot(COVER_REACH_LOW_SLOT, 'device').read(); keep = jsonSlot(COVER_KEEP_LOW_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  picked = coverLow({ reach, keep }, phoneLow);
  return picked;
}
/** Tests: set or forget the page's pick. */
export function resetCoverLow(value?: { reach: number; keep: number }): void { picked = value; }

/**
 * meta DRIFTWOOD-FPS DF8 (mini-df8, 2026-11-21): the device slot `debug.programReuse` keeps compiled programs in use where
 * the page would otherwise link a byte-identical one again. Nothing drawn changes: every reused program has the GL source
 * the new link would have had.
 * - The client build's three transform (vite/threeHeldShaderStages.ts): a live custom-shader program holds the shader
 *   stages it was keyed by, so a revisited cell's rebuilt graph materials (and their kit batches) find the programs the
 *   grid's keeper pinned (render/programRetention.ts) instead of linking twins.
 * - The far ring's batches (game/grid/farBatch.ts) keep one material per group across rebuilds, so a ring change does not
 *   free the group's program and link it again at the next draw.
 * Off by default (three and the far ring run as before); on at phone Low (DF8, mini-dwfps2).
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';

export const PROGRAM_REUSE_SLOT = 'debug.programReuse';
export const PROGRAM_REUSE_DEFAULT = false;
/** Unset at phone Low: on (meta DRIFTWOOD-FPS DF8, mini-dwfps2, 2026-11-23). With programReuse, programFold and
 *  bootRoadPrograms on, the calibrated stand-in (headless Chromium, phone Low, cap 30, CPU 2.0x, the driftwood-fps route)
 *  links no program after control and holds fewer programs (meta project/evidence/driftwood-fps/df8-phone-low-defaults-2026-11-23.md). */
export const PROGRAM_REUSE_PHONE_LOW = true;
/** Unset on desktop: on (meta DRIFTWOOD-FPS DF14, mini-dwfps, 2026-11-23). With the three DF8 program slots on, desktop High's
 *  driftwood-fps quick route linked 2 programs after control, not 73, and lost its village long frames (97 and 71 ms). */
export const PROGRAM_REUSE_DESKTOP = true;

/** The slot's value: a boolean (or a capture's `true`/`on`/1) wins; unset, PROGRAM_REUSE_PHONE_LOW at phone Low, PROGRAM_REUSE_DESKTOP on desktop, else PROGRAM_REUSE_DEFAULT. */
export function programReuse(saved: unknown, phoneLow = false, desktop = false): boolean {
  if (typeof saved === 'boolean') return saved;
  if (saved === 'true' || saved === 'on' || saved === 1) return true;
  if (saved === 'false' || saved === 'off' || saved === 0) return false;
  return phoneLow ? PROGRAM_REUSE_PHONE_LOW : desktop ? PROGRAM_REUSE_DESKTOP : PROGRAM_REUSE_DEFAULT;
}

let picked: boolean | undefined;
/** Whether this page reuses programs; read once per page. */
export function programReuseOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(PROGRAM_REUSE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = programReuse(saved, phoneLow, TIER === 'desktop');
  return picked;
}

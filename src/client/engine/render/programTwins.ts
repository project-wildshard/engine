/**
 * meta DRIFTWOOD-FPS DF8 (mini-dwfps2, 2026-11-23): the device slot `debug.programTwins` leaves out program variants the
 * grid page builds but never draws, and draws define-only twins with one program, so fewer programs exist at phone Low.
 * - **The page's warm rigs on the grid** (game/session/finish.ts): on a grid page every row draws in a region's creature
 *   manager (in a cell, and on the road the home region's, `LiveGridSession.roadAnimals`), whose own warm rigs carry the
 *   region's look (`regionalWorld.ts` ZE2d). The page's rigs, outside every region, built a no-look twin of each creature
 *   program (and a no-shadow-cascade one), which nothing on the grid draws.
 * - **Family stand-ins** (render/families/registry.ts `familyCompileJobs`): only for a family material a plain mesh on the
 *   page draws. A creature's materials draw only on its skinned rig (warmed from its clone), and an unplaced default surface
 *   carries no region look, so its no-look stand-in matched no draw.
 * - **Side-blind programs** (vite/threeSideBlindPrograms.ts, through the renderer's `wsSideBlindPrograms`): shadow depth
 *   and unlit programs, whose shaders read neither the material's side nor the geometry's normals, key without them.
 * Off by default; on at phone Low.
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';

export const PROGRAM_TWINS_SLOT = 'debug.programTwins';
export const PROGRAM_TWINS_DEFAULT = false;
/** Unset at phone Low: on (meta DRIFTWOOD-FPS DF8, mini-dwfps2, 2026-11-23). */
export const PROGRAM_TWINS_PHONE_LOW = true;

/** The slot's value: a boolean (or a capture's `true`/`on`/1) wins; unset, PROGRAM_TWINS_PHONE_LOW at phone Low, else PROGRAM_TWINS_DEFAULT. */
export function programTwins(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  if (saved === 'true' || saved === 'on' || saved === 1) return true;
  if (saved === 'false' || saved === 'off' || saved === 0) return false;
  return phoneLow ? PROGRAM_TWINS_PHONE_LOW : PROGRAM_TWINS_DEFAULT;
}

let picked: boolean | undefined;
/** Whether this page leaves out and folds program twins; read once per page. */
export function programTwinsOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(PROGRAM_TWINS_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = programTwins(saved, phoneLow);
  return picked;
}
/** Tests only: read the slot again. */
export function resetProgramTwins(): void { picked = undefined; }

/**
 * meta IPHONE13-DRIFTWOOD DW12 (mini-dw12b, 2026-11-21): the road's construction holds less at once.
 *
 * On Driftwood after control the WebKit peak (WebContent + GPU process) is the outer road's construction, not its upload
 * (DW12's paced upload moved nothing). Measured in headless WebKit around `outer()`: WebContent climbs ~240 MB through the
 * build and falls back ~1 s after it lands. The deck's solid parts (17.5 MB at Driftwood's outer ring) stayed alive until
 * the curtain was built, the merge's 17.5 MB of channels were copied again into the clip's 24.6 MB, and the clip kept
 * every old channel until the last was copied.
 *
 * With `lean` on (`PlatformRoadInput.lean`, device slot `debug.roadBuildLean`): the seams' parts list is let go once the
 * deck's list holds them, the merge drops each part as soon as it is copied (`solidGeometryDrainSteps`), each channel is
 * allocated once at the clip's exact count (`meshBytesSteps` `clipped`) and the clip writes its cut vertices into that
 * room (`clipToBinsSteps`), so no channel is copied twice. The deck, the curtain and their cull plans are the same bytes
 * (road-build-lean.test.ts).
 *
 * Off by default: three alternating pairs of the SB38a WebKit probe (402x874 @3, phone tier + Low, local dev --staging
 * Driftwood, 30 s still after control) did not move the WebContent + GPU peak: off 1,571 / 1,508 / 1,586 MB, on 1,514 /
 * 1,560 / 1,521 (the first boot of each pair ran 52 to 65 MB higher, either arm). Knockouts on the same build put the
 * outer road at ~330 MB of the peak and its tile capture (`roadTileBacking.ts` `captureInWorker`, its copies and the
 * worker's compaction and archive writes) at ~120 to 170 MB of that: the next cut (mini-dw12b, 2026-11-21).
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';

export const ROAD_BUILD_LEAN_SLOT = 'debug.roadBuildLean';
/** Unset: this default. */
export const ROAD_BUILD_LEAN_DEFAULT = false;
/** The slot's value: a boolean (or `false`/`off`/0 from a capture) wins; unset, ROAD_BUILD_LEAN_DEFAULT. */
export function roadBuildLean(saved: unknown): boolean {
  if (saved === false || saved === 'false' || saved === 'off' || saved === 0) return false;
  if (saved === true) return true;
  return ROAD_BUILD_LEAN_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the road builds lean; read once per page. */
export function roadBuildLeanOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null;
  try { saved = jsonSlot(ROAD_BUILD_LEAN_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  picked = roadBuildLean(saved);
  return picked;
}

import { jsonSlot } from '../saves/slots';
import type { Tier } from '../core/tier';
import type { EngineTierKnobs } from './tiers';

/**
 * meta IPHONE13-REAL-TEST IP34 (mini-nine-fps13, 2026-11-19): the phone tier's size-based LOD knobs at the drawing density in
 * force. `slabLodAngle` (NB8), `slabFarAngle` (NB23) and `placedLodScale` (NB5) were tuned at 2 drawing pixels per CSS pixel:
 * a dropped slab triangle is a speck under ~0.7 device pixels, a far slab level moves a corner a few device pixels, a placed
 * copy switches level at about the desktop's projected size. Phone Low draws 1 pixel per CSS pixel, so one drawing pixel
 * spans twice the angle: the same pixel error allows twice the angles and switches placed levels at half the distance.
 *
 * Nine at phone Low (iPhone 13 viewport, DPR 1, WebKit on an M5 Pro, Metal trace) drew 0.66 M triangles at spawn for 5.1 ms
 * of GPU a frame, vertex-bound (half the pixels saved 0.85 ms; its paifang gate's slabs at ~80 m cost 1.6 ms, 30 %). On:
 * spawn 5.09 -> 4.71 ms (0.56 M triangles), the south street 5.39 -> 4.99; slab scale 3: 4.40 and 4.45 (0.51 M).
 *
 * The device slot `debug.densityLod` picks it: true or false, or a number, the slab angles' scale itself (a device probe of a
 * coarser slab cut; the placed scale stays at the density's, since at 3 Nine's mahjong sitters 8 m away took their table
 * level); with none, DENSITY_LOD_DEFAULT. Read at the level's boot
 * (`bootstrap.ts`, after the level's tier row): a density changed in play keeps the boot's knobs until the next boot.
 */
export const DENSITY_LOD_SLOT = 'debug.densityLod';
/** Off until the iPhone 13 pairs (IP34's device check) decide phone Low's default. */
export const DENSITY_LOD_DEFAULT = false;
/** the drawing density the phone knobs were tuned at (`tiers.ts` phone `dpr`) */
export const TUNED_DENSITY = 2;

/** The slot's pick: true / false, or a scale (a finite number of at least 1); else the default. */
export function densityLodOn(): boolean | number {
  let saved: unknown = null;
  try { saved = jsonSlot(DENSITY_LOD_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 1) return saved;
  return typeof saved === 'boolean' ? saved : DENSITY_LOD_DEFAULT;
}

type DensityKnobs = Pick<EngineTierKnobs, 'slabLodAngle' | 'slabFarAngle' | 'placedLodScale'>;

/** Scale `config`'s size-based LOD knobs from TUNED_DENSITY to `density` (phone tier only, and only below the tuned
 *  density); a numeric `on` is the slab angles' scale. */
export function applyDensityLod(config: DensityKnobs, tier: Tier, density: number, on: boolean | number = densityLodOn()): void {
  if (on === false || tier !== 'phone' || !(density > 0) || density >= TUNED_DENSITY) return;
  const k = TUNED_DENSITY / density, slab = typeof on === 'number' ? on : k;
  config.slabLodAngle *= slab;
  config.slabFarAngle *= slab;
  config.placedLodScale /= k;
}

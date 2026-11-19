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
 * level); with none, DENSITY_LOD_DEFAULT at phone Low's density 1, off at any other. Read at the level's boot
 * (`bootstrap.ts`, after the level's tier row): a density changed in play keeps the boot's knobs until the next boot.
 */
export const DENSITY_LOD_SLOT = 'debug.densityLod';
/** Phone Low's default: slab angles x3, placed levels at the density. IP34's device pairs (iPhone 13, staging v0.1.50 with
 *  this module overridden, 2026-11-19): Nine at 3 reached control in 18.7-21.4 s and walked at 30.6-32.1 fps (p95 43-45 ms,
 *  gpu~ p95 under 12 ms) in all three boots; off took 34.8-38.7 s and walked at 18.9-20.8 fps in its paired boots. No tab
 *  losses. */
export const DENSITY_LOD_DEFAULT: boolean | number = 3;
/** the drawing density the phone knobs were tuned at (`tiers.ts` phone `dpr`) */
export const TUNED_DENSITY = 2;

/** The slot's pick: true / false, or a scale (a finite number of at least 1); else the default at phone Low's density 1,
 *  off at any other. @param density the drawing density in force */
export function densityLodOn(density = 1): boolean | number {
  let saved: unknown = null;
  try { saved = jsonSlot(DENSITY_LOD_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  if (typeof saved === 'number' && Number.isFinite(saved) && saved >= 1) return saved;
  if (typeof saved === 'boolean') return saved;
  return density <= 1 ? DENSITY_LOD_DEFAULT : false;
}

type DensityKnobs = Pick<EngineTierKnobs, 'slabLodAngle' | 'slabFarAngle' | 'placedLodScale'>;

/** Scale `config`'s size-based LOD knobs from TUNED_DENSITY to `density` (phone tier only, and only below the tuned
 *  density); a numeric `on` is the slab angles' scale. */
export function applyDensityLod(config: DensityKnobs, tier: Tier, density: number, on: boolean | number = densityLodOn(density)): void {
  if (on === false || tier !== 'phone' || !(density > 0) || density >= TUNED_DENSITY) return;
  const k = TUNED_DENSITY / density, slab = typeof on === 'number' ? on : k;
  config.slabLodAngle *= slab;
  config.slabFarAngle *= slab;
  config.placedLodScale /= k;
}

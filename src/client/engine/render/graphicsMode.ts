import { jsonSlot } from '../saves/slots';
/**
 * MOBILE-GRAPHICS MG2 (Jake, 2026-11-10: "we have two things for mobile. We have mobile low graphics and mobile high graphics";
 * "For now, with low, you can just do… instead of 2 times and 3 times, you do 1 time and 1 time"). A phone's graphics are Low
 * or High, saved per device:
 *
 *   High  today's phone tier: the drawing buffer at min(devicePixelRatio, the tier's cap, 2)
 *   Low   the same tier at 1 drawing pixel per CSS pixel (nothing else changes, for now)
 *
 * Desktop has no Low / High. The pick applies live through the same path as the Developer pixel picks (devPixels.ts, which
 * wins over it, and Game's next drawn frame). This replaces, for Low only, "Render scale stays 2x on the phone" (E70, E142).
 */

export type GraphicsMode = 'low' | 'high';
/** Low's drawing pixels per CSS pixel */
export const LOW_PIXEL_RATIO = 1;
/** the page hears this when a pick that sizes the drawing buffer changes (Game applies it in its next drawn frame) */
export const PIXELS_EVENT = 'ws:pixels';

const slot = jsonSlot('graphics', 'device');

/** The saved pick; High when there is none (today's phone). */
export function savedGraphicsMode(): GraphicsMode {
  try { return slot.read() === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}

/** Save a pick and tell the page. */
export function saveGraphicsMode(mode: GraphicsMode): void {
  try { slot.write(mode); } catch { /* storage blocked: this page only */ }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PIXELS_EVENT));
}

/** The mode in force on a phone. */
export function graphicsMode(): GraphicsMode { return savedGraphicsMode(); }

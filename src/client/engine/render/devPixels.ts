import { isDev } from '../core/devMode';
import { jsonSlot } from '../saves/slots';
import { graphicsMode, LOW_PIXEL_RATIO, PIXELS_EVENT } from './graphicsMode';
/**
 * QA row 25 (Jake, 2026-11-10, Low Power Mode at 19-23 fps, GPU bound: "when developer mode is on, allow me to switch between 2x
 * and 1x pixel density. Allow me to switch between 3x screen, 2x screen, 1x screen. So that's 6 permutations, and I can just try
 * all 6 permutations"). A Developer-only override of the drawing buffer's pixel ratio, kept on this device:
 *
 *   screen   3× / 2× / 1×   the device-pixel-ratio cap: the renderer draws at min(devicePixelRatio, screen)
 *   density  2× / 1×        the render scale on top: 2× = 1 (full), 1× = ¾
 *
 * So ratio = min(devicePixelRatio, screen) × (density 2× ? 1 : 0.75). On a 3× phone the six give 3, 2, 1, 2.25, 1.5 and 0.75:
 * six different drawing buffers (a ½ scale would make 2× screen at 1× density the same buffer as 1× screen at 2×). Off (no
 * override) is the default, and Developer mode off ignores a saved pick: the tier's own cap applies, as before.
 */

export type DevScreen = 3 | 2 | 1;
export type DevDensity = 2 | 1;
export interface DevPixels { readonly screen: DevScreen; readonly density: DevDensity }
/** the render scale each density stands for */
export const DENSITY_SCALE: Readonly<Record<DevDensity, number>> = { 2: 1, 1: 0.75 };

const slot = jsonSlot('devPixels', 'device');

/** The saved pick, or null when there is none (whatever Developer mode is). */
export function savedDevPixels(): DevPixels | null {
  let raw: unknown;
  try { raw = slot.read(); } catch { return null; }
  if (raw === null || typeof raw !== 'object') return null;
  const { screen, density } = raw as { screen?: unknown; density?: unknown };
  return (screen === 3 || screen === 2 || screen === 1) && (density === 2 || density === 1) ? { screen, density } : null;
}

/** Save a pick (null: back to the tier's own) and tell the page. */
export function saveDevPixels(pick: DevPixels | null): void {
  try { slot.write(pick === null ? null : { screen: pick.screen, density: pick.density }); } catch { /* storage blocked: this page only */ }
  document.dispatchEvent(new CustomEvent(PIXELS_EVENT));
}

/** The pick in force: the saved one, in Developer mode only. */
export function activeDevPixels(): DevPixels | null { return isDev() ? savedDevPixels() : null; }

/** The ratio a pick draws at on a screen of `device` pixels per CSS pixel. */
export function devPixelRatio(device: number, pick: DevPixels): number { return Math.min(device, pick.screen) * DENSITY_SCALE[pick.density]; }

/** The drawing buffer's pixel ratio: the Developer pick when there is one; else, on a phone (`phone`: the phone tier with no
 *  explicit render scale), its Low graphics (MG2, graphicsMode.ts); else the tier's cap, the production rule as it was. */
export function drawingPixelRatio(device: number, tierCap: number, phone = false): number {
  const pick = activeDevPixels();
  if (pick !== null) return devPixelRatio(device, pick);
  return phone && graphicsMode() === 'low' ? Math.min(device, LOW_PIXEL_RATIO) : Math.min(device, tierCap);
}

/** What a ratio makes of a CSS size: the drawing buffer's size and pixel count (three.js floors each side). */
export function drawingBuffer(width: number, height: number, ratio: number): { readonly width: number; readonly height: number; readonly pixels: number } {
  const w = Math.floor(width * ratio), h = Math.floor(height * ratio);
  return { width: w, height: h, pixels: w * h };
}

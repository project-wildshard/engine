import { jsonSlot } from '../saves/slots';
import { TIER } from './tier';
/**
 * DRIFTWOOD-FPS DF14, J495 (Jake, 2026-11-23): "For desktops we don't want to change the presets of low & high, we want three
 * presets for desktop, low, medium, high and you can do whatever you want on those." A desktop's Low is the phone tier (Settings
 * ▸ Quality), High the desktop tier as it ships, and Medium the desktop tier with what a half-speed desktop CPU cannot pay for
 * at 120 fps taken out:
 *
 *   ao        off   n8ao's pass is never built (its two pre-passes and its blur: ~1.3 ms of a 2× frame, ~2.8 of its p95)
 *   shadows   one   the staggered sun cascades redraw one map a frame (shadowCadence.ts cascadeRedrawsOneMap; High keeps
 *                   near every frame, middle every 2nd, far every 4th)
 *
 * It rides the device's `graphics` slot (a phone's Low / High pick, which a desktop never reads) as `'medium'`, and like the
 * desktop's render scale and anti-aliasing it is read at boot: a change applies on the next load.
 */

export type DesktopPreset = 'low' | 'medium' | 'high';
/** the device slot Medium is saved in: graphicsMode.ts's (a phone reads anything but 'low' as High) */
const slot = jsonSlot('graphics', 'device');

/** Whether a saved `graphics` value picks Medium on this tier (pure: the tier and the value). */
export function mediumOn(tier: 'phone' | 'desktop', saved: unknown): boolean { return tier === 'desktop' && saved === 'medium'; }

let atBoot: boolean | undefined;
/** Whether this page runs desktop Medium: read once, at the first ask (the composer and the sky build at boot). */
export function desktopMedium(): boolean {
  if (atBoot === undefined) {
    let saved: unknown = null;
    try { saved = slot.read(); } catch { /* storage blocked: High */ }
    atBoot = mediumOn(TIER, saved);
  }
  return atBoot;
}

/** Save Medium or High on a desktop (the next load builds with it). */
export function saveDesktopMedium(medium: boolean): void {
  try { slot.write(medium ? 'medium' : 'high'); } catch { /* storage blocked: this page only */ }
}
/** The saved desktop pick: Medium when the slot says so, else High (Low is the tier itself, Settings ▸ Quality). */
export function savedDesktopMedium(): boolean {
  try { return slot.read() === 'medium'; } catch { return false; }
}
/** Tests only. */
export function resetDesktopMedium(): void { atBoot = undefined; }

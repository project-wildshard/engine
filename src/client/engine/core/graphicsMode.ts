import { jsonSlot, saveStorage } from '../saves/slots';
import { lowPowerReading } from '../boot/lowPower';
import { engineString } from '../../../shared/engine/strings';
/**
 * MOBILE-GRAPHICS MG2 (Jake, 2026-11-10: "we have two things for mobile. We have mobile low graphics and mobile high graphics";
 * "For now, with low, you can just do… instead of 2 times and 3 times, you do 1 time and 1 time"). A phone's graphics are Low
 * or High, saved per device:
 *
 *   High  today's phone tier: the drawing buffer at min(devicePixelRatio, the tier's cap, 2)
 *   Low   1 drawing pixel per CSS pixel, smaller textures and light-mask targets prepared at load
 *
 * MG3 (Jake: "You can block the toggle from low to high graphics behind low power mode"): while the page reads Low Power Mode as
 * likely (boot/lowPower.ts, the idle title's rAF cadence), a phone runs Low and High is refused (lowPowerRefusal); the
 * saved pick is kept, and comes back the moment the reading says otherwise (Game re-reads it as the page comes back into view).
 *
 * Desktop has no Low / High. The pick applies live through the same path as the Developer pixel picks (devPixels.ts, which
 * wins over it, and Game's next drawn frame). This replaces, for Low only, "Render scale stays 2x on the phone" (E70, E142).
 */

export type GraphicsMode = 'low' | 'high';
/** Low's drawing pixels per CSS pixel */
export const LOW_PIXEL_RATIO = 1;
/** Long edge of shard textures prepared for phone Low. */
export const LOW_TEXTURE_EDGE = 512;
/** Edge of a repeat-wrapped layered (array) texture prepared for phone Low: at 1 drawing pixel per CSS pixel a 2-3 m
 * paint repeat at 256 texels still out-resolves a wall at arm's length (MG10: Nine's 9-layer paint array 12.6 -> 3.1 MB). */
export const LOW_LAYER_EDGE = 256;
/** the page hears this when a pick that sizes the drawing buffer changes (Game applies it in its next drawn frame) */
export const PIXELS_EVENT = 'ws:pixels';

const slot = jsonSlot('graphics', 'device');

/** The saved pick; High when there is none (today's phone). */
export function savedGraphicsMode(): GraphicsMode {
  try { return slot.read() === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}

/** MG3: the words a refused High says ("Low Power Mode is on. Turn it off (Settings ▸ Battery) to use High graphics.") */
export function lowPowerRefusal(): string { return engineString('s_low_power_refusal'); }

/** MG3: the title reading (boot/lowPower.ts keeps it as the session's `boot.lowPower`) that frames faster than Low Power Mode
 *  allows have since outrun: that reading no longer holds; a newer one does */
let outrun: string | null = null;
const titleReading = (): string | null => { try { return saveStorage('session').getItem('boot.lowPower'); } catch { return null; } };
/** MG3: a window of this page's own frames ran faster than 30 Hz (Game, as the page comes back into view): Low Power is off, so
 *  the title's older "likely" no longer holds High back. A busy page cannot prove the opposite: only the idle title says
 *  "likely" (boot/lowPower.ts). */
export function noteFastFrames(): void {
  const was = lowPowerOn();
  outrun = titleReading();
  if (was && !lowPowerOn() && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PIXELS_EVENT));
}
/** MG3: whether Low Power Mode looks on (the idle title read rAF capped near 30 Hz this tab, and nothing faster since) */
export function lowPowerOn(): boolean { return lowPowerReading()?.verdict === 'likely' && (outrun === null || outrun !== titleReading()); }
/** Tests only. */
export function resetFastFrames(): void { outrun = null; }

/** Save a pick and tell the page. High under Low Power Mode is refused (false); the saved pick stays as it was. */
export function saveGraphicsMode(mode: GraphicsMode): boolean {
  if (mode === 'high' && lowPowerOn()) return false;
  try { slot.write(mode); } catch { /* storage blocked: this page only */ }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PIXELS_EVENT));
  return true;
}

/** The mode in force on a phone: Low while Low Power Mode looks on, else the saved pick. */
export function graphicsMode(): GraphicsMode { return lowPowerOn() ? 'low' : savedGraphicsMode(); }

export const FAR_BATCH_SLOT = 'debug.farBatch';
const farBatchSlot = jsonSlot(FAR_BATCH_SLOT, 'device');
/** DF10 defaults far batching on at phone Low. A saved boolean wins. */
export function farBatch(saved: unknown): boolean { return saved !== false; }
export function farBatchAtLow(): boolean {
  let saved: unknown = null;
  try { saved = farBatchSlot.read(); } catch { /* storage blocked: the default */ }
  return graphicsMode() === 'low' && farBatch(saved);
}

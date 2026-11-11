import { graphicsMode, PIXELS_EVENT, saveGraphicsMode, type GraphicsMode } from './graphicsMode';
import { jsonSlot } from '../saves/slots';
/**
 * MOBILE-GRAPHICS MG8. Jake, 2026-11-10 ~22:45 Cancún: "I don't need a high setting to be even more expensive than what it was
 * yesterday… All these options you have need to be toggles that I can turn on and off". ~23:45: one "Pixel density" control,
 * 1× · 1.25× · 1.5× · 2× ("I don't want to see that 3x… 9 times the pixels"), no "Auto" anywhere ("I don't like auto"), and
 * anti-aliasing On / Off.
 *
 * Every cost knob is a phone control in Settings ▸ Graphics (ui/graphicsBlock.ts), live, saved on the device, always a real value:
 *
 *   density   1× / 1.25× / 1.5× / 2×   drawing pixels per CSS pixel (never past the screen's own; the browser stretches to it)
 *   shadows   on / off                 the sun's shadow cascades (off: cleared once, then never drawn)
 *   bloom     on / off                 bloom in the colour chain (the phone's shipped chain has none, G945)
 *   rays      on / off                 god rays in the colour chain (Driftwood's phone tier has none, E189)
 *   aa        on / off                 the level's FXAA (Driftwood ships it on)
 *
 * Low and High are presets: pressing one sets every control. High is yesterday's game exactly (2×, shadows on, the level's
 * bloom / rays / AA: on Driftwood bloom off, rays off, AA on; cost 1.00, never more). Low takes from it: 1× and no sun
 * shadows (LOW). A control never touched since a preset reads that preset's value; the label is read off the values.
 * Replaces MG2's 1× / 2× and folds in the boot-time render scale and AA prefs (tier.ts) and QA 25's screen × density
 * (devPixels.ts, now a Developer-only override with no menu: Jake sees one pixel control).
 */

export type FlagKnob = 'shadows' | 'bloom' | 'rays' | 'aa';
export const DENSITIES = [1, 1.25, 1.5, 2] as const;
export type Density = typeof DENSITIES[number];
/** yesterday's phone: 2 drawing pixels per CSS pixel (render/tiers.ts phone dpr, E70) */
export const HIGH_DENSITY: Density = 2;
/** what Low takes from yesterday's game; every other control keeps its shipped value */
export const LOW = { density: 1, shadows: false } as const;

const flagSlot = (id: FlagKnob): ReturnType<typeof jsonSlot> => jsonSlot(`gfx.knob.${id}`, 'device');
const densitySlot = jsonSlot('gfx.knob.density', 'device');
const FLAGS: readonly FlagKnob[] = ['shadows', 'bloom', 'rays', 'aa'];
const read = (slot: ReturnType<typeof jsonSlot>): unknown => { try { return slot.read(); } catch { return null; } };
const write = (slot: ReturnType<typeof jsonSlot>, v: string | number | boolean | null): void => { try { slot.write(v); } catch { /* storage blocked: this page only */ } };
const tell = (): void => { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PIXELS_EVENT)); };
const isDensity = (v: unknown): v is Density => DENSITIES.some((d) => d === v);

/** A flag's value in force: its saved value, else the last preset's (Low's starting point for shadows, else `shipped`). */
export function flagOn(id: FlagKnob, mode: GraphicsMode, shipped: boolean): boolean {
  const v = read(flagSlot(id));
  if (typeof v === 'boolean') return v;
  return id === 'shadows' && mode === 'low' ? LOW.shadows : shipped;
}
export function saveFlag(id: FlagKnob, on: boolean): void { write(flagSlot(id), on); tell(); }

/** Pixel density in force: the saved value, else the last preset's (Low 1×, High 2×). */
export function densityIn(mode: GraphicsMode): Density { const v = read(densitySlot); return isDensity(v) ? v : mode === 'low' ? LOW.density : HIGH_DENSITY; }
export function saveDensity(v: Density): void { write(densitySlot, v); tell(); }

/** A preset pressed: every control back to that preset's value. */
export function resetKnobs(): void { for (const id of FLAGS) write(flagSlot(id), null); write(densitySlot, null); tell(); }

const worldToggleSlot = jsonSlot('gfx.worldToggle', 'device');
/** the page hears this when Settings ▸ Graphics ▸ In-world toggle changes (the toggle shows or goes live) */
export const PROTO_EVENT = 'ws:gfx-world-toggle';
/** MG9: whether the in-world toggle shows on every entry (off: on a first play only) */
export function worldToggleOn(): boolean { return read(worldToggleSlot) === true; }
export function saveWorldToggle(on: boolean): void {
  write(worldToggleSlot, on);
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(PROTO_EVENT));
}

/** The Low / High card's line for each mode. */
export function modeLine(mode: GraphicsMode): string {
  return mode === 'low' ? 'Low: 1× pixel density, no sun shadows. Lighter on the battery.' : 'High: 2× pixel density and sun shadows, as the game ships.';
}

/** What the level in play ships (Game.buildComposer): High's bloom, rays and anti-aliasing. */
export interface ShippedLook { readonly bloom: boolean; readonly rays: boolean; readonly aa: boolean }
let shipped: ShippedLook = { bloom: false, rays: false, aa: true };
export function noteShipped(next: ShippedLook): void { shipped = next; }
export function shippedLook(): ShippedLook { return shipped; }

/**
 * Jake, 2026-11-10 ~23:05 Cancún: "Low and high are just defaults for all the toggles in graphics"; Custom "is just there to
 * illustrate what the graphic settings are right now". The label is never saved: it is read off the controls' values. High when
 * every value is High's, Low when every one is Low's, else Custom (and a hand-set match shows High or Low again).
 */
export interface GfxValues { readonly density: number; readonly shadows: boolean; readonly bloom: boolean; readonly rays: boolean; readonly aa: boolean }
export type PresetLabel = GraphicsMode | 'custom';
/** a preset's value for every control (High: yesterday's game; Low: 1× and no sun shadows, the rest as shipped) */
export function presetValues(mode: GraphicsMode, look: ShippedLook = shipped): GfxValues {
  return { density: mode === 'low' ? LOW.density : HIGH_DENSITY, shadows: mode === 'low' ? LOW.shadows : true, bloom: look.bloom, rays: look.rays, aa: look.aa };
}
/** every control's value now */
export function currentValues(look: ShippedLook = shipped): GfxValues {
  const mode = graphicsMode();
  return { density: densityIn(mode), shadows: flagOn('shadows', mode, true), bloom: flagOn('bloom', mode, look.bloom), rays: flagOn('rays', mode, look.rays), aa: flagOn('aa', mode, look.aa) };
}
const same = (a: GfxValues, b: GfxValues): boolean => a.density === b.density && a.shadows === b.shadows && a.bloom === b.bloom && a.rays === b.rays && a.aa === b.aa;
/** Low, High or Custom, read off the values */
export function presetLabel(look: ShippedLook = shipped): PresetLabel {
  const now = currentValues(look);
  if (same(now, presetValues('high', look))) return 'high';
  if (same(now, presetValues('low', look))) return 'low';
  return 'custom';
}
/** Press Low or High: every control takes that preset's value. False when refused (High under Low Power Mode, MG3). */
export function applyPreset(mode: GraphicsMode): boolean {
  if (!saveGraphicsMode(mode)) return false;
  resetKnobs();
  return true;
}

/**
 * MG12 (Jake, 2026-11-10 ~23:15 Cancún): the phone's frame cap. 30 fps under Low Power Mode, on High and on Custom; 60 fps only
 * on exactly the Low preset with Low Power Mode off. "That's only for the front end": the render loop's cap (tier.ts
 * frameCapFps), never the sim step or a server tick.
 */
export function frameCapFor(label: PresetLabel, lowPower: boolean): 30 | 60 { return label === 'low' && !lowPower ? 60 : 30; }

/** The frame readout under the controls (Game provides it: fps, frame time, draws); empty before a world draws. */
let readout: () => string = () => '';
export function setFrameReadout(fn: () => string): () => void { readout = fn; return () => { if (readout === fn) readout = () => ''; }; }
export function frameReadout(): string { return readout(); }

/**
 * Settings ▸ Debug ▸ Look ▸ "Look light" (meta TEMPLATE-E2E-PLAN LF1-4): whether a look's optional light and post settings
 * (`look.light`, `look.grade.bloom`; `render/lookLight.ts`) draw. Default on for the desktop tier since TEMPLATES-CLEANROOM
 * B2 (was off until Jake picked; Jake's 2026-11-13 cleanroom port asks for the look as authored); read at load, so a pick
 * reloads the page.
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';

/** the saved slot's key */
export const LOOK_LIGHT_SLOT = 'debug.lookLight';

/**
 * The row's saved value: on unless saved 'off' (TEMPLATES-CLEANROOM B2: a look's declared light is how its author asked
 * it to look, so it draws by default; no storage: on).
 */
export function lookLightSaved(): boolean {
  try { return jsonSlot(LOOK_LIGHT_SLOT, 'device').read() !== 'off'; } catch { return true; }
}
/**
 * Whether the settings draw on this page: the row on. TEMPLATES-CLEANROOM M4.9: the phone tier draws them too, gated per
 * field (`lookLightManifest`: no bloom or AO, at most 4 lamps, half the motes), not all or nothing; `tier` stays for callers.
 */
export function lookLightOn(_tier: string = TIER): boolean { return lookLightSaved(); }
/** Save the row's value (the page reloads to apply it). */
export function setLookLight(on: boolean): void { jsonSlot(LOOK_LIGHT_SLOT, 'device').write(on ? 'on' : 'off'); }

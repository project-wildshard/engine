/**
 * Settings ▸ Debug ▸ Look ▸ "Look light" (meta TEMPLATE-E2E-PLAN LF1-4): whether a look's optional light and post settings
 * (`look.light`, `look.grade.bloom`; `render/lookLight.ts`) draw. Default off until Jake picks; read at load, so a pick
 * reloads the page.
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';

/** the saved slot's key */
export const LOOK_LIGHT_SLOT = 'debug.lookLight';

/** The row's saved value: 'on' or 'off' (anything else, or no storage: off). */
export function lookLightSaved(): boolean {
  try { return jsonSlot(LOOK_LIGHT_SLOT, 'device').read() === 'on'; } catch { return false; }
}
/**
 * Whether the settings draw on this page: the row on, and the desktop tier. The phone tier draws none of them until
 * Jake picks (its 30 fps lock and program set stay as they are).
 */
export function lookLightOn(tier: string = TIER): boolean { return tier !== 'phone' && lookLightSaved(); }
/** Save the row's value (the page reloads to apply it). */
export function setLookLight(on: boolean): void { jsonSlot(LOOK_LIGHT_SLOT, 'device').write(on ? 'on' : 'off'); }

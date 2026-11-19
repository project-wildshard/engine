/** MEMORY-STRUCTURE STR31: idle HUD cards release their composited backing on a phone.
 *
 * A quest reward caption or talk card waits at opacity 0 between showings, and WebKit keeps the backing it painted
 * (Template at control holds six reward captions and a talk card: about 12 MB of GPU IOSurface [K], meta
 * engine-memory/gpu-staircase-2026-11-18.md). With the switch on, `html[data-ws-idle-hud]` makes quest.css hide each card
 * once its fade has ended; showing it makes it visible at once. The device switch `debug.releaseIdleHud` defaults off
 * and is read on phone graphics only; the old path (the card held at opacity 0) stays for one release.
 */
import type { Scope } from '../../../shared/engine/app/scope';
import { jsonSlot } from '../saves/slots';

export const IDLE_HUD_SLOT = 'debug.releaseIdleHud';
/** The attribute quest.css keys the release on. */
export const IDLE_HUD_ATTRIBUTE = 'data-ws-idle-hud';

/** Is the release on: a phone, and the device switch set to true. */
export function idleHudRelease(phone: boolean): boolean {
  if (!phone) return false;
  try { return jsonSlot(IDLE_HUD_SLOT, 'device').read() === true; } catch { return false; }
}

/** Mark the document while `scope` lives, when the release is on. */
export function installIdleHudRelease(scope: Scope, phone: boolean, root: HTMLElement = document.documentElement): void {
  if (!idleHudRelease(phone)) return;
  root.setAttribute(IDLE_HUD_ATTRIBUTE, '');
  scope.onDispose(() => { root.removeAttribute(IDLE_HUD_ATTRIBUTE); });
}

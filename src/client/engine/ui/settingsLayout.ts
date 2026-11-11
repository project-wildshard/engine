import { jsonSlot } from '../saves/slots';
import { engineString } from '../../../shared/engine/strings';
/**
 * QA 49 (Jake, 2026-11-10: "that button should be settings, shouldn't be pause… a settings menu with a bunch of tabs at the
 * top… lots of variants, lots of in-game prototypes"): which Settings layout the in-game menu draws, picked in
 * Settings ▸ Debug ▸ Tools ▸ Settings layout (no URL switches: lint/url-params.json, Jake 2026-09-25). `today` is the
 * shipped single column; `a`–`e` are the prototypes in settingsTabs.ts. Saved per device; a pick re-lays the open menu live.
 *
 *   settingsLayout()          // 'today' | 'a' | 'b' | 'c' | 'd' | 'e'
 *   setSettingsLayout('a')    // saves, renames the HUD button, tells the menu (LAYOUT_EVENT)
 */
export const SETTINGS_LAYOUTS = ['today', 'a', 'b', 'c', 'd', 'e'] as const;
export type SettingsLayout = typeof SETTINGS_LAYOUTS[number];
/** the page hears this when the layout pick changes */
export const LAYOUT_EVENT = 'ws:settingsLayout';
const slot = jsonSlot('debug.settingsLayout', 'device');
const LAYOUT_WORDS = { today: 's_sv_today', a: 's_sv_a', b: 's_sv_b', c: 's_sv_c', d: 's_sv_d', e: 's_sv_e' } as const;
export const layoutChoiceText = (layout: SettingsLayout): string => engineString(LAYOUT_WORDS[layout]);
const listeners = new Set<() => void>();
/** hear every pick (the Debug row repaints itself); returns the unsubscribe */
export function onSettingsLayout(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function settingsLayout(): SettingsLayout {
  try { const saved = slot.read(); return SETTINGS_LAYOUTS.find((layout) => layout === saved) ?? 'today'; } catch { return 'today'; }
}
export function setSettingsLayout(layout: SettingsLayout): void {
  try { slot.write(layout); } catch { /* storage blocked: this page only */ }
  paintSettingsButton();
  for (const fn of listeners) fn();
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
}

/** a cog, drawn in the 64-box like the Bag's glyphs (icons.ts): the teeth are a dashed ring */
export const GEAR_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" stroke-width="9" stroke-dasharray="8.25 8.25"/><path fill="currentColor" fill-rule="evenodd" d="M14 32a18 18 0 1 0 36 0a18 18 0 1 0 -36 0Z M24 32a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z"/></svg>';

/** The touch HUD's top-left button: PAUSE today, a cog and SETTINGS in every prototype layout. */
export function paintSettingsButton(): void {
  if (typeof document === 'undefined') return;
  const on = settingsLayout() !== 'today';
  for (const button of document.querySelectorAll<HTMLElement>('.ws-touch-pause')) {
    if (button.classList.contains('ws-touch-gear') === on) continue;
    button.classList.toggle('ws-touch-gear', on);
    if (on) { button.innerHTML = GEAR_SVG; const word = document.createElement('span'); word.textContent = engineString('s_sv_settings'); button.append(word); }
    else button.textContent = engineString('s_sv_pause');
    button.setAttribute('aria-label', engineString(on ? 's_sv_settings' : 's_sv_pause'));
  }
}

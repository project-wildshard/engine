import type { Scope } from '../../../shared/engine/app/scope';
/**
 * Settings ▸ Graphics's controls (J245, Jake 2026-11-10: "Settings, let's do A, like the bag"; QA 48: every graphics control
 * lives in the Graphics tab as a toggle). The tab renders whatever is registered here, by section and then `order`, so the
 * Low / High lane (MOBILE-GRAPHICS MG8+, opus-gfxtoggle) adds or replaces controls without touching the menu:
 *
 *   registerGraphicsControl({ id: 'shadows', section: 'effects', order: 10, build: (scope) => row })   // returns the disposer
 *
 *   section   'main'      the top of the tab, no heading: Low / High (built in, `mode`), the frame-time readout, screen, scale
 *             'effects'   "Effects": shadows, bloom, sun rays, edge smoothing
 *             'advanced'  "Advanced": the boot-time picks (built in: quality, render scale, anti-aliasing, the reload row)
 *             'setup'     the foot: Replay first-time setup (built in, `firstPlay`)
 *   id        a registration with a built-in's id (`mode`, `tier`, `scale`, `aa`, `reload`, `firstPlay`) replaces that built-in
 *   build     makes the row once per menu, under the menu's scope (listeners on it go when the menu goes); use the
 *             gmenu.css rows: `.ws-gmenu-switch` (a toggle), `.ws-gmenu-row` + `.ws-gmenu-seg` (a picker)
 *   refresh   runs every time the menu opens on Settings, before the row shows (re-read live values here)
 *   when      shown only while this holds (re-read on every open); a hidden control takes no room
 *
 * Engine or game code may register (the game through `@wildshard/engine/ui/graphicsControls`); a registration made after
 * the menu was built appears on its next open.
 */
export type GraphicsSection = 'main' | 'effects' | 'advanced' | 'setup';
export const GRAPHICS_SECTIONS: readonly GraphicsSection[] = ['main', 'effects', 'advanced', 'setup'];
export interface GraphicsControl {
  readonly id: string;
  readonly section: GraphicsSection;
  readonly order: number;
  readonly build: (scope: Scope) => HTMLElement;
  readonly refresh?: () => void;
  readonly when?: () => boolean;
}

const registered = new Map<string, GraphicsControl>();
const listeners = new Set<() => void>();
const changed = (): void => { for (const listener of listeners) listener(); };

/** Add a control to Settings ▸ Graphics (or replace the one with the same id); returns the disposer. */
export function registerGraphicsControl(control: GraphicsControl): () => void {
  registered.set(control.id, control); changed();
  return () => { if (registered.get(control.id) === control) { registered.delete(control.id); changed(); } };
}
/** The registered controls (built-ins are merged in by the tab: settingsTabs.ts). */
export function graphicsControls(): readonly GraphicsControl[] { return [...registered.values()]; }
/** Hear registrations come and go; returns the unsubscribe. */
export function onGraphicsControls(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

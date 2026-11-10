import type { Scope } from '../../../shared/engine/app/scope';
import { isDev, onDev } from '../core/devMode';
import { perfDockAlert, perfDockSection } from './perfDock';

/** The game supplies a label only for hidden levels; the engine owns visibility and lifetime. A14: a line in the frame meter's
 *  panel (`perfDock.ts`), never a banner over the world. */
export function mountDeveloperBanner(scope: Scope, label: string | undefined): void {
  if (label === undefined) return;
  const banner = document.createElement('div');
  banner.className = 'ws-game-developer';
  banner.textContent = label;
  const sync = (on: boolean): void => { banner.hidden = !on; };
  sync(isDev());
  scope.onDispose(onDev(sync));
  perfDockSection(banner, scope, 0);
}

/**
 * A red Developer-only alert (G168): the game supplies the line (a disabled script's module and cause); players never see it,
 * and a Developer switch shows / hides it live. Returns the setter; a new line replaces the last. A14: it is the first section
 * of the frame meter's panel, and while it shows the fps pill carries a red "!" (it was a full-width strip over the minimap).
 */
export function mountDeveloperAlert(scope: Scope): (text: string) => void {
  const strip = document.createElement('div'), line = document.createElement('span');
  strip.className = 'ws-game-dev-alert'; strip.hidden = true; strip.setAttribute('role', 'status');
  strip.append(line);
  let shown = false;
  const sync = (on: boolean): void => { strip.hidden = !on || !shown; perfDockAlert(strip, scope, !strip.hidden); };
  scope.onDispose(onDev(sync));
  perfDockSection(strip, scope, -10);
  return (text) => { line.textContent = text; shown = true; sync(isDev()); };
}

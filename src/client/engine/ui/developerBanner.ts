import type { Scope } from '../../../shared/engine/app/scope';
import { isDev, onDev } from '../core/devMode';
import { mountUi } from './ownership';

/** The game supplies a label only for hidden levels; the engine owns visibility and lifetime. */
export function mountDeveloperBanner(root: HTMLElement, scope: Scope, label: string | undefined): void {
  if (label === undefined) return;
  const banner = document.createElement('div');
  banner.className = 'ws-game-developer';
  banner.textContent = label;
  const sync = (on: boolean): void => { banner.hidden = !on; };
  sync(isDev());
  scope.onDispose(onDev(sync));
  mountUi(banner, scope, root);
}

/**
 * A red Developer-only alert strip under the top bar (G168): the game supplies the line (a disabled script's module and
 * cause); players never see it, and a Developer switch shows / hides it live. Returns the setter; a new line replaces the last.
 */
export function mountDeveloperAlert(root: HTMLElement, scope: Scope): (text: string) => void {
  const strip = document.createElement('div'), line = document.createElement('span');
  strip.className = 'ws-game-dev-alert'; strip.hidden = true; strip.setAttribute('role', 'status');
  strip.append(line);
  let shown = false;
  const sync = (on: boolean): void => { strip.hidden = !on || !shown; };
  scope.onDispose(onDev(sync));
  mountUi(strip, scope, root);
  return (text) => { line.textContent = text; shown = true; sync(isDev()); };
}

import type { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { currentOwner } from '../../../shared/engine/app/ownership';

/** Construction may run before the level becomes active; use its explicit boot owner. */
export function uiScope(name: string, parent: Scope = currentOwner() ?? app.levelScope ?? app.engineScope): Scope {
  return parent.child(`ui.${name}`);
}
/** DOM lifetime belongs to the widget, including widgets in parked resident HUDs. */
export function mountUi(el: HTMLElement, scope: Scope, parent: HTMLElement = document.getElementById('hud') ?? document.body, before?: ChildNode | null): void {
  if (scope.disposed) return;
  app.ui.hud.widget('band.1', el, 0, scope, parent);
  before?.before(el);
}

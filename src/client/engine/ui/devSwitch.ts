import { listenTap } from '../input/dom';
import { uiScope } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import { getSetting, onSetting, setSetting } from './Settings';
import { withOwner } from '../../../shared/engine/app/ownership';
import type { Scope } from '../../../shared/engine/app/scope';
/**
 * Settings ▸ DEVELOPER (E140, the user's 1c): the one visible switch for developer mode (src/client/engine/core/devMode.ts), in the pause
 * menu's Settings (src/client/engine/ui/Menu.ts) and the title's (src/client/engine/ui/BootSettings.ts). Styled by gmenu.css like every other switch.
 * (The compact DEV pill on the title and in the menu header is gone — E318, Jake: cut; this is the one switch.)
 */
import { isDev, onDev, setDev } from '../core/devMode';

export function devSwitchRows(): HTMLElement[] {
  const scope = uiScope('devSwitch');
  const label = document.createElement('div');
  label.className = 'ws-gmenu-label';
  label.textContent = engineString('s_3fb7b39416f1');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ws-gmenu-switch';
  b.setAttribute('role', 'switch');
  b.innerHTML = engineString('s_008ede743530');
  const sync = (on: boolean): void => { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); };
  sync(isDev()); scope.onDispose(onDev(sync));
  // A tap must repaint its own switch even if a page subscriber is rebuilt during notification.
  // Native click also covers touch activation and keyboard activation, without double-toggling.
  listenTap(scope, b, () => { setDev(!isDev()); sync(isDev()); });
  const note = document.createElement('div');
  note.className = 'ws-gmenu-note';
  note.textContent = engineString('s_f427cd6641a5');
  return [label, b, note, holdLoadingSwitch(scope)];
}

/** One persisted Developer choice, shared by Settings and the live loader. */
export function holdLoadingSwitch(scope: Scope): HTMLButtonElement {
  const hold = document.createElement('button');
  hold.type = 'button'; hold.className = 'ws-gmenu-switch'; hold.setAttribute('role', 'switch');
  hold.innerHTML = engineString('s_d652c0be6be8', [engineString('s_loading_hold')]);
  const paintHold = (): void => {
    hold.hidden = !isDev();
    hold.classList.toggle('on', getSetting('holdLoading'));
    hold.setAttribute('aria-checked', String(getSetting('holdLoading')));
  };
  paintHold(); withOwner(scope, () => { scope.onDispose(onDev(paintHold)); scope.onDispose(onSetting('holdLoading', paintHold)); });
  listenTap(scope, hold, () => { if (isDev()) setSetting('holdLoading', !getSetting('holdLoading')); });
  return hold;
}

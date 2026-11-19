// @vitest-environment happy-dom
// QA-FEEDBACK 11-19 row 14, J449 (Jake, iPhone home-screen app): switching apps and coming back opened the Settings
// (pause) menu. "We're an MMO now ... we don't want to pop open the settings menu when you go back to the app." The window
// blur of an app switch paused into Settings (KP4), and so did the hide (GpuRecovery's ws:background). A hidden-then-visible
// page goes straight back into play; Settings opens only when the player opens it.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installBrowserScopeEnvironment } from '../app/view/scopeEnvironment';
import { HUD } from './HUD';
import type { GameMenu } from './Menu';
import type { WeaponUi } from '../../../shared/engine/combat/Equipment';

let hud: HUD, opened: string[];
beforeEach(() => {
  vi.useFakeTimers();
  installBrowserScopeEnvironment();
  document.body.innerHTML = '<div id="hud"></div>';
  hud = new HUD({ pointerLock: false, weaponUi: { name: 'Sword', icon: 'sword' as WeaponUi['icon'], touch: 'melee', lockOn: false, melee: true, tracers: false, swapIcon: '' }, maxBolts: 0 });
  opened = [];
  const menu = { isOpen: false, inPractice: false, open: (tab: string) => { opened.push(tab); menu.isOpen = true; }, close: () => { menu.isOpen = false; } };
  hud.menu = menu satisfies Partial<GameMenu> as GameMenu;
  hud.entered = true;
});
afterEach(() => { Reflect.get(hud, 'scope')?.dispose?.(); vi.useRealTimers(); vi.restoreAllMocks(); });

const away = (): void => {
  window.dispatchEvent(new Event('blur'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pagehide'));
  vi.advanceTimersByTime(1000);
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  vi.advanceTimersByTime(1000);
};

test('an app switch and back opens no pause or Settings menu', () => {
  away();
  expect(opened).toEqual([]);
  expect(hud.paused).toBe(false);
});

test('a focus change to another window opens no menu either', () => {
  window.dispatchEvent(new Event('blur'));
  vi.advanceTimersByTime(1000);
  expect(opened).toEqual([]);
});

test('the player still opens Settings themselves', () => {
  away();
  document.dispatchEvent(new Event('ws:pause'));
  expect(opened).toEqual(['settings']);
});

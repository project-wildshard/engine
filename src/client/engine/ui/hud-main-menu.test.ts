// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { HUD } from './HUD';

function invoke(name: 'exitToMenu' | 'exitToExplore', hud: object): void {
  const method: unknown = Reflect.get(HUD.prototype, name);
  if (typeof method !== 'function') throw new Error('Missing HUD exit method');
  Reflect.apply(method, hud, []);
}

function fixture() {
  const receiver = { entered: true, intro: undefined, root: document.createElement('div'),
    _menu: { close: vi.fn<(silent: boolean) => void>() },
    onEnter: vi.fn<() => void>(), showIntro: vi.fn<() => void>(),
    onExitToMenu: vi.fn<() => void>(), onExplore: vi.fn<() => void>(),
    onExitToMain: undefined as (() => void) | undefined };
  return receiver;
}

test('main-menu exit delegates once without rebuilding a title over the retired world', () => {
  const hud = fixture(), leave = vi.fn<() => void>(); hud.onExitToMain = leave;
  invoke('exitToMenu', hud);
  expect(hud.entered).toBe(false); expect(hud._menu.close).not.toHaveBeenCalled();
  expect(leave).toHaveBeenCalledOnce(); expect(hud.showIntro).not.toHaveBeenCalled();
  expect(hud.onExitToMenu).not.toHaveBeenCalled(); expect(hud.onEnter).not.toHaveBeenCalled();
  invoke('exitToMenu', hud); expect(leave).toHaveBeenCalledOnce();
});

test('practice returns to Explore without retiring the session', () => {
  const hud = fixture(), leave = vi.fn<() => void>(); hud.onExitToMain = leave;
  invoke('exitToExplore', hud);
  expect(hud.onExitToMenu).toHaveBeenCalledOnce(); expect(hud.onExplore).toHaveBeenCalledOnce();
  expect(leave).not.toHaveBeenCalled(); expect(hud.showIntro).not.toHaveBeenCalled();
});

test('hosts without a main-title port retain their local intro', () => {
  const hud = fixture(); invoke('exitToMenu', hud);
  expect(hud.onExitToMenu).toHaveBeenCalledOnce(); expect(hud.showIntro).toHaveBeenCalledWith(hud.onEnter);
});


test('a throwing menu cleanup cannot strand a fresh-page exit', () => {
  const hud = fixture(), leave = vi.fn<() => void>(); hud.onExitToMain = leave;
  hud._menu.close.mockImplementation(() => {throw new Error('Old menu scope teardown refused');});
  invoke('exitToMenu', hud);
  expect(leave).toHaveBeenCalledOnce(); expect(hud._menu.close).not.toHaveBeenCalled();
  expect(hud.onExitToMenu).not.toHaveBeenCalled();
});

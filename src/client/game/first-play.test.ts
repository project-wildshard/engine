// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { finishFirstPlay, firstPlayDone, firstPlayPending, resetFirstPlay, startFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { graphicsMode, saveGraphicsMode } from '@wildshard/engine/render/graphicsMode';
import { installFirstPlay } from './firstPlay';

const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); resetFirstPlay(); saveGraphicsMode('high'); document.body.replaceChildren(); });
const tap = (el: Element | null): void => { el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

test('MG5: the first play shows its card once the player has control; the toggle switches Low and High; DONE marks the device', () => {
  const scope = new Scope('first-play'); scopes.push(scope);
  const root = document.createElement('div'); document.body.append(root);
  resetFirstPlay(); startFirstPlay();
  expect(firstPlayDone()).toBe(false); expect(firstPlayPending()).toBe(true);
  withOwner(scope, () => { installFirstPlay(scope, root); });
  expect(root.querySelector('.ws-firstplay')).toBeNull(); // not before control
  document.dispatchEvent(new Event('ws:control-ready'));
  const card = root.querySelector('.ws-firstplay');
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain('Low Power Mode');
  tap(card?.querySelector('[data-v="low"]') ?? null);
  expect(graphicsMode()).toBe('low');
  expect(card?.querySelector('[data-v="low"]')?.getAttribute('aria-pressed')).toBe('true');
  tap(card?.querySelector('[data-v="high"]') ?? null);
  expect(graphicsMode()).toBe('high');
  tap(card?.querySelector('.ws-firstplay-done') ?? null);
  expect(root.querySelector('.ws-firstplay')).toBeNull();
  expect(firstPlayDone()).toBe(true); expect(firstPlayPending()).toBe(false);
});

test('MG5 / MG6: no card unless the title started a first play; Replay arms the next one', () => {
  const scope = new Scope('first-play-later'); scopes.push(scope);
  const root = document.createElement('div'); document.body.append(root);
  finishFirstPlay(); // a device that had its first play: the title starts none, so nothing is pending
  withOwner(scope, () => { installFirstPlay(scope, root); });
  document.dispatchEvent(new Event('ws:control-ready'));
  expect(root.querySelector('.ws-firstplay')).toBeNull();
  expect(firstPlayDone()).toBe(true);
  resetFirstPlay(); // Settings > Replay first-time setup
  expect(firstPlayDone()).toBe(false);
});

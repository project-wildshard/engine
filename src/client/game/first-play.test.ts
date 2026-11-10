// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { dropFirstPlay, finishFirstPlay, firstPlayDone, firstPlayPending, resetFirstPlay, startFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { graphicsMode, saveGraphicsMode } from '@wildshard/engine/render/graphicsMode';
import { installFirstPlay } from './firstPlay';

const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); resetFirstPlay(); saveGraphicsMode('high'); document.body.replaceChildren(); });
const tap = (el: Element | null): void => { el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

test('MG5: the first play shows its card once the player has control; the toggle switches Low and High; DONE marks the device', () => {
  const scope = new Scope('first-play'); scopes.push(scope);
  const root = document.createElement('div'); document.body.append(root);
  resetFirstPlay(); expect(startFirstPlay('dw')).toBe(true);
  expect(firstPlayDone()).toBe(false); expect(firstPlayPending('dw')).toBe(true); expect(firstPlayPending('nine')).toBe(false);
  withOwner(scope, () => { installFirstPlay(scope, root, 'dw'); });
  expect(root.querySelector('.ws-firstplay')).toBeNull(); // not before control
  document.dispatchEvent(new Event('ws:control-ready'));
  const card = root.querySelector('.ws-firstplay');
  expect(card).not.toBeNull();
  expect(firstPlayPending('dw')).toBe(false); // spent on showing
  expect(card?.textContent).toContain('Low Power Mode');
  tap(card?.querySelector('[data-v="low"]') ?? null);
  expect(graphicsMode()).toBe('low');
  expect(card?.querySelector('[data-v="low"]')?.getAttribute('aria-pressed')).toBe('true');
  tap(card?.querySelector('[data-v="high"]') ?? null);
  expect(graphicsMode()).toBe('high');
  tap(card?.querySelector('.ws-firstplay-done') ?? null);
  expect(root.querySelector('.ws-firstplay')).toBeNull();
  expect(firstPlayDone()).toBe(true);
});

test('MG5 / MG6: no card unless the title started a first play; Replay arms the next one', () => {
  const scope = new Scope('first-play-later'); scopes.push(scope);
  const root = document.createElement('div'); document.body.append(root);
  finishFirstPlay(); // a device that had its first play: the title starts none, so nothing is pending
  withOwner(scope, () => { installFirstPlay(scope, root, 'dw'); });
  document.dispatchEvent(new Event('ws:control-ready'));
  expect(root.querySelector('.ws-firstplay')).toBeNull();
  expect(firstPlayDone()).toBe(true);
  // a shard already in control: the title arming a first play shows the card at once; another shard's intent never does
  expect(startFirstPlay('nine')).toBe(true);
  expect(root.querySelector('.ws-firstplay')).toBeNull();
  dropFirstPlay(); expect(firstPlayPending('nine')).toBe(false);
  expect(startFirstPlay('dw')).toBe(true);
  expect(root.querySelector('.ws-firstplay')).not.toBeNull();
  // a stale intent (over ten minutes) is no first play
  expect(firstPlayPending('dw', Date.now() + 11 * 60_000)).toBe(false);
  resetFirstPlay(); // Settings > Replay first-time setup
  expect(firstPlayDone()).toBe(false);
});

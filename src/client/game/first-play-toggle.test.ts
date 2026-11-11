// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { finishFirstPlay, firstPlayDone, resetFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { graphicsMode, saveGraphicsMode } from '@wildshard/engine/core/graphicsMode';
import { presetLabel, resetKnobs, saveFlag, saveWorldToggle } from '@wildshard/engine/core/graphicsQuality';
import { installFirstPlay, PEAK_OPACITY, REST_OPACITY, FADE_MS } from './firstPlay';

const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); saveWorldToggle(false); resetKnobs(); resetFirstPlay(); saveGraphicsMode('high'); document.body.replaceChildren(); });
const tap = (el: Element | null): void => { el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); }; // a real tap's click (detail 1) follows its pointerup and is not answered twice
const mount = (): HTMLElement => {
  const scope = new Scope('gfx-toggle-test'); scopes.push(scope);
  const root = document.createElement('div'); document.body.append(root);
  withOwner(scope, () => { installFirstPlay(scope, root, 'dw'); });
  document.dispatchEvent(new Event('ws:control-ready'));
  return root;
};

test('MG9 A (Jake approved, ~23:20): Settings\' In-world toggle shows it on a later entry; a tap peaks it and it fades back to rest over FADE_MS', () => {
  finishFirstPlay(); saveWorldToggle(true);
  const root = mount(), box = root.querySelector<HTMLElement>('.ws-firstplay-va');
  expect(box).not.toBeNull();
  tap(box?.querySelector('[data-v="low"]') ?? null);
  expect(graphicsMode()).toBe('low');
  expect(box?.style.opacity).toBe(String(REST_OPACITY));
  expect(box?.style.transition).toBe(`opacity ${String(FADE_MS)}ms linear`);
  expect(PEAK_OPACITY).toBe(0.9); expect(REST_OPACITY).toBe(0.33); expect(FADE_MS).toBe(10_000);
  tap(box?.querySelector('.ws-firstplay-vdone') ?? null);
  expect(root.querySelector('.ws-firstplay-v')).toBeNull();
  expect(firstPlayDone()).toBe(true);
});

test('MG9: In-world toggle off takes it down without marking the device; off and no first play shows nothing', () => {
  finishFirstPlay(); resetFirstPlay(); finishFirstPlay();
  const root = mount();
  expect(root.querySelector('.ws-firstplay-va')).toBeNull();
  saveWorldToggle(true);
  expect(root.querySelector('.ws-firstplay-va')).not.toBeNull();
  saveWorldToggle(false);
  expect(root.querySelector('.ws-firstplay-va')).toBeNull();
});

test('rule 6: the in-world toggle follows Low · High · Custom: on Custom it says so and lights neither; Low or High applies that preset', () => {
  finishFirstPlay(); saveWorldToggle(true);
  const root = mount(), box = root.querySelector<HTMLElement>('.ws-firstplay-va');
  saveFlag('bloom', true); // one control off High's value: Custom
  document.dispatchEvent(new CustomEvent('ws:pixels'));
  expect(box?.dataset['mode']).toBe('custom');
  expect(box?.textContent).toContain('Custom');
  expect(box?.querySelector('[aria-pressed="true"]')).toBeNull();
  tap(box?.querySelector('[data-v="high"]') ?? null);
  expect(presetLabel()).toBe('high');
  expect(box?.dataset['mode']).toBe('high');
  expect(box?.querySelector('[data-v="high"]')?.getAttribute('aria-pressed')).toBe('true');
});

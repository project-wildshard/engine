// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { setDev } from '../core/devMode';
import { BOOST_TAP_MS, hoverTap, hoverTaps, mountBoostLook, mountBoostTag, pressHover, type HoverPort } from './hoverBoost';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); setDev(false); });

/** A rider whose toggles land at once, as a page with no link does, counting every toggle it was asked for. */
function rider(hover = false): HoverPort & { hoverToggles: number; boostToggles: number } {
  const state = { hover, hoverBoost: false, hoverToggles: 0, boostToggles: 0,
    setHover(on: boolean): void { if (on !== state.hover) { state.hover = on; state.hoverToggles++; } },
    setBoost(on: boolean): void { if (on !== state.hoverBoost) { state.hoverBoost = on; state.boostToggles++; } } };
  return state;
}

test('QA row 42: a single tap toggles the board at once, every time, with no wait for a second tap', () => {
  const taps = hoverTaps();
  expect(hoverTap(taps, 1000, false, true)).toEqual({ hover: true, boost: false });
  expect(hoverTap(taps, 1000 + BOOST_TAP_MS + 1, true, true)).toEqual({ hover: true, boost: false });
  expect(hoverTap(taps, 5000, false, true)).toEqual({ hover: true, boost: false });
});

test('QA row 42: a second tap inside 300 ms toggles boost and leaves the rider on the board', () => {
  // standing: tap 1 steps on, tap 2 leaves the board alone and latches boost
  const standing = hoverTaps();
  expect(hoverTap(standing, 0, false, true)).toEqual({ hover: true, boost: false });
  expect(hoverTap(standing, 180, true, true)).toEqual({ hover: false, boost: true });
  // riding: tap 1 has stepped off, tap 2 steps back on as it toggles boost
  const riding = hoverTaps();
  expect(hoverTap(riding, 0, true, true)).toEqual({ hover: true, boost: false });
  expect(hoverTap(riding, BOOST_TAP_MS, false, true)).toEqual({ hover: true, boost: true });
  // a third tap starts a new pair: it is a plain tap
  expect(hoverTap(riding, BOOST_TAP_MS + 50, true, true)).toEqual({ hover: true, boost: false });
});

test('QA row 42: with Developer mode off a double tap is two ordinary taps (boost stays Developer-only)', () => {
  const taps = hoverTaps();
  expect(hoverTap(taps, 0, false, false)).toEqual({ hover: true, boost: false });
  expect(hoverTap(taps, 100, true, false)).toEqual({ hover: true, boost: false });
});

test('QA row 42: pressHover double taps boost on and off while riding, and single taps still mount and dismount', () => {
  setDev(true);
  const p = rider(), taps = hoverTaps();
  pressHover(p, taps, 0); expect([p.hover, p.hoverBoost]).toEqual([true, false]);
  pressHover(p, taps, 150); expect([p.hover, p.hoverBoost]).toEqual([true, true]);
  pressHover(p, taps, 2000); pressHover(p, taps, 2200); expect([p.hover, p.hoverBoost]).toEqual([true, false]);
  pressHover(p, taps, 4000); expect([p.hover, p.hoverBoost]).toEqual([false, false]);
  pressHover(p, taps, 6000); expect([p.hover, p.hoverBoost]).toEqual([true, false]);
  setDev(false);
  pressHover(p, taps, 8000); pressHover(p, taps, 8100); expect([p.hover, p.hoverBoost]).toEqual([true, false]);
  expect(p.boostToggles).toBe(2);
});

test('QA row 42: a link that has not stepped the first toggle yet cancels it rather than doubling it', () => {
  setDev(true);
  // an online page: setHover only queues a board press, and `hover` reads the predicted state, not yet stepped
  let pressed = false, boost = false;
  const p: HoverPort = { hover: true, get hoverBoost() { return boost; }, setHover: () => { pressed = !pressed; }, setBoost: (on) => { boost = on; } };
  const taps = hoverTaps();
  pressHover(p, taps, 0); pressHover(p, taps, 40);
  expect(pressed).toBe(false);
  expect(boost).toBe(true);
});

test('QA row 42: the HOVER tab turns amber only while boost moves the board', () => {
  const scope = new Scope('boost-look'); owners.push(scope);
  const button = document.createElement('button'), p = rider(true);
  mountBoostLook(button, p, app.events, scope);
  expect(button.classList.contains('boost')).toBe(false);
  p.setBoost(true); app.events.emit('player.boost', true); app.events.flush('input');
  expect(button.classList.contains('boost')).toBe(false); // Developer mode is off: the latch moves nothing
  setDev(true);
  expect(button.classList.contains('boost')).toBe(true);
  p.setHover(false); app.events.emit('player.hover', false); app.events.flush('input');
  expect(button.classList.contains('boost')).toBe(false);
  p.setHover(true); app.events.emit('player.hover', true); app.events.flush('input');
  expect(button.classList.contains('boost')).toBe(true);
  scope.dispose();
  expect(button.classList.contains('boost')).toBe(false);
});

test('QA 11-15 row 9: the HOVER tab says BOOST only while boost is on, and the word is gone while it is off', () => {
  const scope = new Scope('boost-word'); owners.push(scope);
  const button = document.createElement('button'), p = rider(true);
  button.innerHTML = '<svg></svg><span>Hover</span>';
  mountBoostLook(button, p, app.events, scope);
  const word = (): HTMLElement | null => button.querySelector<HTMLElement>('.ws-touch-boost-word');
  const shown = (): boolean => word()?.hidden === false;
  setDev(true);
  expect(shown()).toBe(false);
  p.setBoost(true); app.events.emit('player.boost', true); app.events.flush('input');
  expect(shown()).toBe(true);
  expect(word()?.textContent).toBe('Boost');
  expect(button.textContent).toBe('HoverBoost');
  p.setBoost(false); app.events.emit('player.boost', false); app.events.flush('input');
  expect(shown()).toBe(false);
  scope.dispose();
  expect(word()).toBeNull();
});

test('QA 11-15 row 9: a keyboard page with no HOVER tab shows BOOST on the left edge only while boost is on', () => {
  const scope = new Scope('boost-tag'); owners.push(scope);
  const hud = document.createElement('div'), p = rider(true);
  mountBoostTag(hud, p, app.events, scope);
  const tag = (): HTMLElement | null => hud.querySelector<HTMLElement>('.ws-touch-boost-tag');
  setDev(true);
  expect(tag()?.hidden).toBe(true);
  p.setBoost(true); app.events.emit('player.boost', true); app.events.flush('input');
  expect(tag()?.hidden).toBe(false);
  expect(tag()?.textContent).toBe('Boost');
  p.setHover(false); app.events.emit('player.hover', false); app.events.flush('input');
  expect(tag()?.hidden, 'off the board, boost moves nothing').toBe(true);
  scope.dispose();
  expect(tag()).toBeNull();
});

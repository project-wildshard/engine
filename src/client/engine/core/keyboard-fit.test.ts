// @vitest-environment happy-dom
// MOBILE-KEYBOARD MK1+MK3 (meta, J297; Jake, 2026-11-12 17:44 Cancún, iPhone 17 Pro chatting on Driftwood): "if you can detect
// when the keyboard is open, then you can like move the whole chat to be just above the keyboard … You gotta like fit the rest
// of the game in the remaining pixels." iOS Safari never shrinks the layout viewport (innerHeight) for its keyboard: only
// visualViewport does, and it may pan the page (offsetTop). The numbers below are an iPhone 17 Pro in Safari, portrait.
import { afterEach, expect, test } from 'vitest';
import { KEYBOARD_MIN_PX, keyboardFit, syncKeyboardView, viewportHeight } from './viewport';

const PHONE = 812; // innerHeight of a 402×874 pt iPhone 17 Pro page under the status bar

test('no keyboard: the game keeps the whole page', () => {
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: PHONE, viewTop: 0, scale: 1, reserve: 0 })).toEqual({ open: false, top: 0, bottom: PHONE, gameHeight: PHONE });
  // the URL bar or a small inset is not a keyboard
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: PHONE - KEYBOARD_MIN_PX + 1, viewTop: 0, scale: 1, reserve: 0 }).open).toBe(false);
});

test('keyboard open: the game fits the visible pixels above it, less the docked chat', () => {
  // Jake's screenshot: the keyboard with its accessory bar takes ~367 pt; the visible part is 445 pt tall
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: 445, viewTop: 0, scale: 1, reserve: 0 })).toEqual({ open: true, top: 0, bottom: 445, gameHeight: 445 });
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: 445, viewTop: 0, scale: 1, reserve: 150 })).toEqual({ open: true, top: 0, bottom: 445, gameHeight: 295 });
});

test('a panned page: the visible part starts at offsetTop', () => {
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: 445.4, viewTop: 120.2, scale: 1, reserve: 150 })).toEqual({ open: true, top: 120, bottom: 566, gameHeight: 296 });
});

test('the game never shrinks below a sliver, and pinch zoom is not a keyboard', () => {
  expect(keyboardFit({ layoutHeight: 390, viewHeight: 120, viewTop: 0, scale: 1, reserve: 150 }).gameHeight).toBe(80);
  expect(keyboardFit({ layoutHeight: PHONE, viewHeight: 300, viewTop: 40, scale: 2, reserve: 0 }).open).toBe(false);
});

const root = document.documentElement;
/** The chat input with focus: only then can a short visual viewport be a keyboard. */
const typeIn = (): HTMLInputElement => { const field = document.createElement('input'); document.body.append(field); field.focus(); return field; };
afterEach(() => {
  document.body.replaceChildren();
  delete root.dataset['wsKeyboard']; delete root.dataset['wsKbReserve'];
  for (const name of ['--ws-vh', '--ws-kb-top', '--ws-kb-bottom']) root.style.removeProperty(name);
});

test('the page marks follow the keyboard, and viewportHeight is the fitted game height while it is up', () => {
  const view = { height: PHONE, offsetTop: 0, scale: 1 };
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: PHONE });
  let resized = 0;
  const count = (): void => { resized++; };
  window.addEventListener('resize', count);
  expect(syncKeyboardView(view)).toBe(false);
  expect(root.dataset['wsKeyboard']).toBeUndefined();
  expect(viewportHeight()).toBe(PHONE);

  // a short visual viewport with no field in focus (a desktop window losing height) is not a keyboard
  view.height = 445;
  expect(syncKeyboardView(view)).toBe(false);
  expect(root.dataset['wsKeyboard']).toBeUndefined();

  typeIn(); root.dataset['wsKbReserve'] = '150';
  expect(syncKeyboardView(view)).toBe(true);
  expect(root.dataset['wsKeyboard']).toBe('');
  expect(root.style.getPropertyValue('--ws-kb-top')).toBe('0px');
  expect(root.style.getPropertyValue('--ws-kb-bottom')).toBe('445px');
  expect(root.style.getPropertyValue('--ws-vh')).toBe('295px');
  expect(viewportHeight()).toBe(295);
  expect(resized).toBe(1); // the game's resize runs once (Game.fitSize reads viewportHeight)
  expect(syncKeyboardView(view)).toBe(false); // nothing changed, no second resize
  expect(resized).toBe(1);
  view.offsetTop = 20; // Safari pans as the caret moves: the band moves, the game's height doesn't, no resize
  expect(syncKeyboardView(view)).toBe(true);
  expect(root.style.getPropertyValue('--ws-kb-top')).toBe('20px');
  expect(resized).toBe(1);
  view.offsetTop = 0;
  syncKeyboardView(view);

  view.height = PHONE; // Done on the accessory bar, or the input blurred
  expect(syncKeyboardView(view)).toBe(true);
  expect(root.dataset['wsKeyboard']).toBeUndefined();
  expect(root.style.getPropertyValue('--ws-vh')).toBe(`${String(PHONE)}px`);
  expect(viewportHeight()).toBe(PHONE);
  window.removeEventListener('resize', count);
});

test('iOS 26 shrinks innerHeight with the keyboard: still a keyboard, measured against the full page', () => {
  // the iOS 26 Simulator (iPhone 17 Pro, Safari): innerHeight 714 → 501, visualViewport 377 tall, page scrolled 213
  const view = { height: 714, offsetTop: 0, scale: 1 };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 402 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 714 });
  root.dataset['wsKbReserve'] = '156';
  syncKeyboardView(view);
  typeIn();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 501 });
  view.height = 377; view.offsetTop = 213;
  expect(syncKeyboardView(view)).toBe(true);
  expect(root.dataset['wsKeyboard']).toBe('');
  expect(root.style.getPropertyValue('--ws-kb-top')).toBe('213px');
  expect(root.style.getPropertyValue('--ws-kb-bottom')).toBe('590px');
  expect(viewportHeight()).toBe(221);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 714 });
  view.height = 714; view.offsetTop = 0;
  expect(syncKeyboardView(view)).toBe(true);
  expect(root.dataset['wsKeyboard']).toBeUndefined();
});

// MK5 (meta MOBILE-KEYBOARD; the real game in the iOS 26 Simulator, iPhone 17 Pro, 2026-11-12): after Done the focus leaves at
// once, while innerHeight is still the keyboard's 503; iOS restores it to 714 ~450 ms later with only a visualViewport resize
// and scroll, never a window resize. The game had fitted 503 on close and stayed there: a short canvas over a dark band.
test('MK5: the game re-fits when iOS gives innerHeight back after the keyboard closes, with no window resize', () => {
  const view = { height: 714, offsetTop: 0, scale: 1 };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 402 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 714 });
  root.dataset['wsKbReserve'] = '156';
  syncKeyboardView(view);
  const fits: number[] = [];
  const game = (): void => { fits.push(viewportHeight()); };
  window.addEventListener('resize', game);
  try {
    const field = typeIn();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 503 });
    view.height = 377; view.offsetTop = 211;
    syncKeyboardView(view);
    expect(fits).toEqual([221]);
    field.blur(); // Done: the keyboard is still animating away, innerHeight still short
    syncKeyboardView(view);
    expect(root.dataset['wsKeyboard']).toBeUndefined();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 714 });
    view.height = 714; view.offsetTop = 0;
    syncKeyboardView(view); // the visualViewport resize: the only event iOS sends
    expect(fits.at(-1)).toBe(714);
    expect(root.style.getPropertyValue('--ws-vh')).toBe('714px');
    // a window resize the game hears itself (a rotation, a desktop window) is not told twice
    const before = fits.length;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    syncKeyboardView(view, true);
    expect(fits.length).toBe(before);
  } finally { window.removeEventListener('resize', game); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 714 }); }
});

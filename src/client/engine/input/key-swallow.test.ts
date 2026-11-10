// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { InputService } from './InputService';
import { Scope } from '../../../shared/engine/app/scope';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); document.body.replaceChildren(); });

function fixture(playing = true): { input: InputService; scope: Scope } {
  const scope = new Scope('key-swallow'); owners.push(scope);
  const input = new InputService(() => 10);
  input.register({ id: 'onFoot', actions: ['move.left', 'dodge', 'use', 'attack', 'pause', 'help'],
    keys: { 'move.left': ['KeyA', 'ArrowLeft'], dodge: ['KeyV', 'AltLeft'], use: ['KeyE'], attack: ['KeyF'], pause: ['Escape'], help: ['F1'] } }, scope);
  input.install(scope);
  input.playing = () => playing;
  input.push('onFoot', scope);
  return { input, scope };
}
function press(target: EventTarget, code: string, init: KeyboardEventInit = {}, type: 'keydown' | 'keyup' = 'keydown'): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

test('KP3 (Jake 2026-11-09, "intercept that shit and suppress the default"): the game\'s keys and Alt chords never reach the browser in play', () => {
  const { input } = fixture();
  // Alt+← is Back and Alt+F / Alt+E open Chrome's menu on Windows and Linux; the game owns all three
  for (const code of ['ArrowLeft', 'KeyF', 'KeyE', 'AltLeft', 'F1']) expect(press(document.body, code, { altKey: true }).defaultPrevented, code).toBe(true);
  // an Alt chord is taken even when its letter isn't bound (Alt+D: the address bar; Alt+H: Chrome's help menu)
  for (const code of ['KeyD', 'KeyH', 'Home']) expect(press(document.body, code, { altKey: true }).defaultPrevented, `Alt+${code}`).toBe(true);
  expect(press(document.body, 'AltRight').defaultPrevented).toBe(true);
  expect(press(document.body, 'AltLeft', {}, 'keyup').defaultPrevented).toBe(true);
  // a held key's auto-repeat is taken too, though it presses nothing new
  expect(press(document.body, 'ArrowLeft', { altKey: true, repeat: true }).defaultPrevented).toBe(true);
  expect(input.held('move.left')).toBe(true);
  // keys the game doesn't own, and Escape (the browser's way out of lock and fullscreen), stay the browser's
  for (const code of ['KeyK', 'Escape', 'F5', 'F12']) expect(press(document.body, code).defaultPrevented, code).toBe(false);
  // Alt+F4 and a rebound reload / devtools key stay the system's and the browser's
  expect(press(document.body, 'F4', { altKey: true }).defaultPrevented).toBe(false);
  input.bindings.assign('onFoot', 'help', ['F12']);
  expect(press(document.body, 'F12').defaultPrevented).toBe(false);
  input.bindings.reset();
});

test('on the title, in a menu or under an overlay, only the old three (Space, Alt, Tab) are taken', () => {
  fixture(false);
  for (const code of ['ArrowLeft', 'KeyF', 'KeyE', 'F1', 'AltRight']) expect(press(document.body, code).defaultPrevented, code).toBe(false);
  expect(press(document.body, 'KeyF', { altKey: true }).defaultPrevented).toBe(false);
  for (const code of ['KeyW', 'KeyT', 'KeyN']) expect(press(document.body, code, { metaKey: true }).defaultPrevented, code).toBe(false);
  for (const code of ['Space', 'AltLeft', 'Tab']) expect(press(document.body, code).defaultPrevented, code).toBe(true);
});

test('⌘R and Ctrl+R still reload; ⌘W / ⌘T / ⌘N are taken (they reach a page only in Chrome fullscreen)', () => {
  fixture();
  expect(press(document.body, 'KeyR', { metaKey: true }).defaultPrevented).toBe(false);
  expect(press(document.body, 'KeyR', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press(document.body, 'KeyL', { metaKey: true }).defaultPrevented).toBe(false);
  for (const code of ['KeyW', 'KeyT', 'KeyN']) {
    expect(press(document.body, code, { metaKey: true }).defaultPrevented, `⌘${code}`).toBe(true);
    expect(press(document.body, code, { ctrlKey: true }).defaultPrevented, `Ctrl+${code}`).toBe(true);
  }
});

test('chat, the Name box and a focused button keep their keys', () => {
  fixture();
  const field = document.createElement('input'), area = document.createElement('textarea'), button = document.createElement('button');
  document.body.append(field, area, button);
  for (const target of [field, area]) {
    for (const code of ['KeyA', 'KeyE', 'ArrowLeft', 'KeyW']) expect(press(target, code).defaultPrevented, code).toBe(false);
    expect(press(target, 'KeyW', { metaKey: true }).defaultPrevented).toBe(false);
  }
  // a focused button keeps Enter and its letters; Space and Tab were taken there before KP3 and still are
  expect(press(button, 'KeyE').defaultPrevented).toBe(false);
  expect(press(button, 'ArrowLeft').defaultPrevented).toBe(false);
});

test('FM4: a failure card keeps Tab, Space and Enter for its buttons, and a key held before it opened still lets go', () => {
  const { input } = fixture();
  input.register({ id: 'jumper', actions: ['jump'], keys: { jump: ['Space'] } }, owners[0] ?? new Scope('x'));
  input.push('jumper', owners[0] ?? new Scope('x'));
  press(document.body, 'Space');
  expect(input.held('jump')).toBe(true);
  const card = document.createElement('div'), button = document.createElement('button');
  card.setAttribute('role', 'alertdialog'); card.append(button); document.body.append(card);
  for (const code of ['Tab', 'Space', 'Enter']) expect(press(button, code).defaultPrevented, code).toBe(false);
  // the release lands on the card's button, and still reaches the game
  expect(press(button, 'Space', {}, 'keyup').defaultPrevented).toBe(false);
  expect(input.held('jump')).toBe(false);
  card.remove();
});

test('QA row 43: Escape in a field still pauses, unless the field owns Escape (the open chat closes on it instead)', () => {
  const { input } = fixture();
  const name = document.createElement('input'), chat = document.createElement('input');
  chat.dataset['wsOwnEscape'] = '';
  document.body.append(name, chat);
  press(name, 'Escape');
  expect(input.pressed('pause')).toBe(true);
  input.consume('pause');
  press(name, 'Escape', {}, 'keyup');
  press(chat, 'Escape');
  expect(input.pressed('pause')).toBe(false);
});

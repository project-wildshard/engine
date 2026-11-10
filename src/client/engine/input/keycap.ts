import { engineString } from '../../../shared/engine/strings';
import { keyPlatform } from './platform';

const SYMBOLS: Readonly<Record<string, string>> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Shift: 'Shift', ShiftLeft: 'Shift', ShiftRight: 'Shift', Alt: 'Alt', AltLeft: 'Alt', AltRight: 'R Alt', CapsLock: 'Caps', Backspace: 'Bksp',
  Control: 'Ctrl', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', Meta: 'Win', MetaLeft: 'Win', MetaRight: 'R Win',
};
/** KP1: a Mac keyboard says ⌥ Option, ⌘ Cmd and ⌃ Ctrl, the words printed on its keys */
const MAC: Readonly<Record<string, string>> = {
  Alt: '⌥ Option', AltLeft: '⌥ Option', AltRight: 'R ⌥ Option', Control: '⌃ Ctrl', ControlLeft: '⌃ Ctrl', ControlRight: 'R ⌃ Ctrl',
  Meta: '⌘ Cmd', MetaLeft: '⌘ Cmd', MetaRight: 'R ⌘ Cmd',
};
/** a Linux keyboard's logo key is Super */
const LINUX: Readonly<Record<string, string>> = { Meta: 'Super', MetaLeft: 'Super', MetaRight: 'R Super' };
/** A logical key → its keycap in the player's platform's words ("KeyW" → W, "Mouse2" → RMB, "AltLeft" → ⌥ Option on a Mac). */
export function keycap(key: string): string {
  const mouse = /^Mouse(\d)$/u.exec(key)?.[1];
  if (mouse !== undefined) return mouse === '0' ? engineString('s_key_lmb') : mouse === '1' ? engineString('s_key_mmb') : mouse === '2' ? engineString('s_key_rmb') : engineString('s_key_mouse', [Number(mouse) + 1]);
  const platform = keyPlatform();
  return (platform === 'mac' ? MAC[key] : platform === 'linux' ? LINUX[key] : undefined) ?? SYMBOLS[key] ?? key.replace(/^Key|^Digit/u, '').replace(/^Numpad/u, 'Num ');
}
/** The modifier a page's browser shortcuts ride on: ⌘ on a Mac, Ctrl+ elsewhere ("⌘W", "Ctrl+W"). */
export function shortcut(letter: string): string { return keyPlatform() === 'mac' ? `⌘${letter}` : `Ctrl+${letter}`; }

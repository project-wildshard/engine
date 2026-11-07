import { engineString } from '../../../shared/engine/strings';

const SYMBOLS: Readonly<Record<string, string>> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Shift: 'Shift', ShiftLeft: 'Shift', ShiftRight: 'Shift', Alt: 'Alt', AltLeft: 'Alt', AltRight: 'R Alt', CapsLock: 'Caps', Backspace: 'Bksp',
};
/** A logical key → its keycap ("KeyW" → W, "Mouse2" → RMB, "ArrowUp" → ↑). */
export function keycap(key: string): string {
  const mouse = /^Mouse(\d)$/u.exec(key)?.[1];
  if (mouse !== undefined) return mouse === '0' ? engineString('s_key_lmb') : mouse === '1' ? engineString('s_key_mmb') : mouse === '2' ? engineString('s_key_rmb') : engineString('s_key_mouse', [Number(mouse) + 1]);
  return SYMBOLS[key] ?? key.replace(/^Key|^Digit/u, '').replace(/^Numpad/u, 'Num ');
}

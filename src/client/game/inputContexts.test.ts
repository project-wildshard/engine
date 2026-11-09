import { expect, test } from 'vitest';
import { INPUT_CONTEXTS } from './inputContexts';

const MODIFIERS = /^(?:Control|Meta)(?:Left|Right)?$/u;
/** a held binding plus another bound key = a browser shortcut (Ctrl+W closes a Windows tab) */
const RESERVED_WITH_ALT = new Set(['F4']);

test('KP2 (Jake 2026-11-09, "you can\'t have a closed tab"): no default binding is ⌘, Ctrl or a browser-reserved chord', () => {
  const offenders: string[] = [];
  for (const context of INPUT_CONTEXTS) {
    const codes = Object.values(context.keys ?? {}).flat();
    for (const [action, bound] of Object.entries(context.keys ?? {})) {
      for (const code of bound ?? []) {
        if (MODIFIERS.test(code)) offenders.push(`${context.id}.${action}: ${code} (⌘/Ctrl chords with W, T, N close or open tabs)`);
        if (RESERVED_WITH_ALT.has(code) && codes.some((other) => other?.startsWith('Alt') === true)) offenders.push(`${context.id}.${action}: ${code} with Alt is Alt+F4`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('dodge keeps V and Alt/Option: the muscle memory stays, and the hint names both', () => {
  expect(INPUT_CONTEXTS.find((context) => context.id === 'onFoot')?.keys?.dodge).toEqual(['KeyV', 'AltLeft']);
});

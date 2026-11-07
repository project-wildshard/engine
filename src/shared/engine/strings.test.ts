import { expect, test } from 'vitest';
import { ENGINE_STRINGS, engineString, installEngineStrings, type EngineStringKey } from './strings';

/** Complete predecessor formatting operation, retaining native coercion/order. */
function original(text: string, args: readonly unknown[] = []): string {
  return text.replaceAll(/⟦(\d+)⟧/gu, (_match, index: string) => String(args[Number(index)]));
}
function key(value: string): value is EngineStringKey { return Object.hasOwn(ENGINE_STRINGS, value); }

test('every shipped engine label retains its original complete text and placeholder values', () => {
  installEngineStrings(ENGINE_STRINGS);
  let checked = 0;
  for (const candidate of Object.keys(ENGINE_STRINGS)) {
    if (!key(candidate)) throw new Error('Unknown actual string key');
    const text = ENGINE_STRINGS[candidate];
    expect(engineString(candidate)).toBe(original(text));
    expect(engineString(candidate, [0, -0, undefined, null, .125, 'text'])).toBe(original(text, [0, -0, undefined, null, .125, 'text']));
    checked++;
  }
  expect(checked).toBe(Object.keys(ENGINE_STRINGS).length);
});

test('live overrides preserve Unicode, malformed placeholders, repeated reads and native coercion failures', () => {
  const name: EngineStringKey = 's_update_confirm', failure = new Error('original argument coercion');
  try {
    for (const text of ['plain label', '', 'emoji 🌊', 'literal ⟦x⟧', 'open ⟦', '⟦0⟧/⟦00⟧/⟦1⟧/⟦99⟧', '⟦0⟧⟦0⟧', '$& ⟦1⟧']) {
      installEngineStrings({ [name]: text });
      const before: string[] = [], after: string[] = [];
      const args = (log: string[]): readonly unknown[] => [{ toString: () => { log.push('string'); return '$& 🌊'; } }, null];
      expect(engineString(name, args(after))).toBe(original(text, args(before))); expect(after).toEqual(before);
    }
    installEngineStrings({ [name]: 'plain' });
    const bad = { toString: (): string => { throw failure; } };
    expect(engineString(name, [bad])).toBe(original('plain', [bad]));
    installEngineStrings({ [name]: '⟦0⟧' });
    expect(() => engineString(name, [bad])).toThrow(failure); expect(() => original('⟦0⟧', [bad])).toThrow(failure);
    const before: string[] = [], after: string[] = [];
    const args = (log: string[]): readonly unknown[] => {
      const values: unknown[] = [];
      Object.defineProperty(values, 0, { get: () => { log.push('get'); installEngineStrings({ [name]: 'replacement' }); return 'value'; } });
      return values;
    };
    installEngineStrings({ [name]: '⟦0⟧ ⟦0⟧' });
    expect(engineString(name, args(after))).toBe(original('⟦0⟧ ⟦0⟧', args(before))); expect(after).toEqual(before);
    expect(engineString(name)).toBe('replacement');
  } finally { installEngineStrings({ [name]: ENGINE_STRINGS[name] }); }
});

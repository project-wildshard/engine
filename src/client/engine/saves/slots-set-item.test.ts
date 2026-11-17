// MEMORY-GATES MG10 (J410): saveStorage's setItem parses its text and leaves the validation to the slot's write (it parsed it
// with jsonSchema as well, so every boot-trace write validated its record twice)
import { afterEach, expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { jsonSchema, saveStorage } from './slots';

afterEach(() => { vi.restoreAllMocks(); });
function isLazy(schema: unknown): schema is { getter: (input: unknown) => unknown } {
  return typeof schema === 'object' && schema !== null && typeof Reflect.get(schema, 'getter') === 'function';
}

test('setItem round-trips JSON through the slot and validates it once', () => {
  const storage = saveStorage('device'), record = { stage: 'firstFrame', setup: 40, checkpoints: [{ atMs: 1, facts: { a: null, b: 'x' } }] };
  // the lazy schema's getter runs once for each value it validates: one validation's worth, not two
  const lazy: unknown = jsonSchema;
  if (!isLazy(lazy)) throw new Error('Expected the lazy JSON schema');
  const getter = vi.spyOn(lazy, 'getter');
  expect(v.safeParse(jsonSchema, record).success).toBe(true);
  const once = getter.mock.calls.length; getter.mockClear();
  storage.setItem('boot.trace', JSON.stringify(record));
  expect(once).toBeGreaterThan(0); expect(getter).toHaveBeenCalledTimes(once);
  expect(JSON.parse(storage.getItem('boot.trace') ?? 'null')).toEqual(record);
});

test('setItem still refuses what is not a finite JSON value', () => {
  const storage = saveStorage('device');
  expect(() => { storage.setItem('boot.trace', '{"setup": 1e999}'); }).toThrow();
  expect(() => { storage.setItem('boot.trace', '{not json'); }).toThrow();
});

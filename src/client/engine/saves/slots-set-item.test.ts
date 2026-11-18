// MEMORY-GATES MG10 (J410): saveStorage's setItem parses its text and leaves the validation to the slot's write (it parsed it
// with jsonSchema as well, so every boot-trace write validated its record twice)
import { afterEach, expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { jsonRecord, jsonSchema, plainJson, saveStorage } from './slots';

afterEach(() => { vi.restoreAllMocks(); });
function isLazy(schema: unknown): schema is { getter: (input: unknown) => unknown } {
  return typeof schema === 'object' && schema !== null && typeof Reflect.get(schema, 'getter') === 'function';
}

test('setItem round-trips JSON through the slot without running the schema on plain JSON', () => {
  const storage = saveStorage('device'), record = { stage: 'firstFrame', setup: 40, checkpoints: [{ atMs: 1, facts: { a: null, b: 'x' } }] };
  // MG10 (J410): the slot's allocation-free check (`plainJson`) stands for the lazy schema, whose union built issue garbage
  const lazy: unknown = jsonSchema;
  if (!isLazy(lazy)) throw new Error('Expected the lazy JSON schema');
  const getter = vi.spyOn(lazy, 'getter');
  expect(v.safeParse(jsonSchema, record).success).toBe(true);
  expect(getter.mock.calls.length).toBeGreaterThan(0); getter.mockClear();
  storage.setItem('boot.trace', JSON.stringify(record));
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.parse(storage.getItem('boot.trace') ?? 'null')).toEqual(record);
});

test('setItem still refuses what is not a finite JSON value', () => {
  const storage = saveStorage('device');
  expect(() => { storage.setItem('boot.trace', '{"setup": 1e999}'); }).toThrow();
  expect(() => { storage.setItem('boot.trace', '{not json'); }).toThrow();
});

test('plainJson accepts only what jsonSchema passes unchanged', () => {
  class Point { x = 1; }
  const holes: unknown[] = [1]; holes[2] = 3;
  const own = JSON.parse('{"__proto__": 1}') as unknown;
  const accepted: unknown[] = [null, 'a', '', true, false, 0, -0, 1.5, -2e300, [], {}, [1, 'b', null, [true]], { a: { b: [{ c: 'd' }] }, e: null },
    Object.assign(Object.create(null) as object, { k: 1 })];
  for (const value of accepted) {
    expect(plainJson(value)).toBe(true);
    const parsed = v.safeParse(jsonSchema, value);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(JSON.stringify(parsed.output)).toBe(JSON.stringify(value));
  }
  // refused here and left to the schema: not JSON, or a value the schema would change
  for (const value of [undefined, Number.NaN, Infinity, -Infinity, 1n, () => 1, Symbol('s'), new Date(0), new Point(), holes, [undefined],
    { a: undefined }, { a: Infinity }, own, { constructor: 1 }, { prototype: 2 }, new Map(), Object.create({ inherited: 1 }) as object]) {
    expect(plainJson(value)).toBe(false);
  }
  expect(v.safeParse(jsonRecord, [1]).success).toBe(true); // the record schema takes an array; the slot's record check does not
});

import { expect, test } from 'vitest';
import { isJsonData, jsonDataHeapBytes } from '@wildshard/format/json';
import { jsonResidentBytes } from './productCost';

/** Retain the prior independent accounting pass for admitted ordinary data. */
function original(input: unknown): number {
  let heap = 0; const pending: unknown[] = [input];
  const count = (item: unknown): void => {
    if (typeof item === 'string') heap += 24 + item.length * 2;
    else if (typeof item === 'object' && item !== null) pending.push(item);
    else heap += 8;
  };
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) { const items: readonly unknown[] = value; heap += 40 + items.length * 8; for (const item of items) count(item); }
    else if (typeof value === 'object' && value !== null) {
      const fields = value as Readonly<Record<string, unknown>>, keys = Object.keys(value); heap += 64 + keys.length * 16;
      for (const key of keys) { heap += 24 + key.length * 2; count(fields[key]); }
    } else count(value);
  }
  return heap;
}
test('fixed scalar, UTF16, container, slot and key charges stay exact', () => {
  expect(jsonResidentBytes(null)).toBe(8); expect(jsonResidentBytes('Å🌴')).toBe(30);
  expect(jsonResidentBytes([])).toBe(40); expect(jsonResidentBytes({})).toBe(64);
  expect(jsonResidentBytes([0, 'A', null])).toBe(106); expect(jsonResidentBytes({ a: [] })).toBe(146);
});
test('complete scalar, string, container, repeated-reference and native edge costs match the old pass', () => {
  const shared = { colour: [0.125, 0.25, 0.5], height: 0 }, bare: Record<string, unknown> = { value: 17 }; Object.setPrototypeOf(bare, null);
  const row = { heights: Array.from({ length: 257 }, (_, i) => i / 257), colours: Array.from({ length: 257 }, () => [0.125, 0.25, 0.5]), roadHeight: 0 };
  const cases: unknown[] = [null, true, false, 0, -1, 0.125, '', 'Å🌴', [], {}, bare, { a: shared, b: shared },
    { kind: 'declared', profiles: { north: row, east: row, south: row, west: row }, observations: { north: { entryWidth: 8 } } }];
  for (const input of cases) { expect(isJsonData(input)).toBe(true); expect(jsonDataHeapBytes(input)).toBe(original(input)); expect(jsonResidentBytes(input)).toBe(original(input)); }
  shared.height = 8; shared.colour.push(1); expect(jsonResidentBytes({ a: shared, b: shared })).toBe(original({ a: shared, b: shared }));
});
test('every descriptor, scalar, prototype and cycle refusal remains, without reading getters', () => {
  let gets = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { gets++; return 1; } });
  const hidden = Object.defineProperty({}, 'value', { enumerable: false, value: 1 }), symbol = { [Symbol('hidden')]: 1 };
  const hole = [1, 2]; Reflect.deleteProperty(hole, '0');
  const extra = [1]; Object.defineProperty(extra, 'extra', { enumerable: true, value: 1 });
  const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
  const invalid: unknown[] = [undefined, Number.NaN, Infinity, -Infinity, -0, Symbol('value'), 1n, () => 1, new Date(0), new Uint8Array(2), getter, hidden, symbol, hole, extra, cycle];
  for (const input of invalid) { expect(isJsonData(input)).toBe(false); expect(jsonDataHeapBytes(input)).toBeUndefined(); expect(() => jsonResidentBytes(input)).toThrow('bounded plain JSON'); }
  expect(gets).toBe(0);
});
test('the ordinary depth and occurrence-node ceilings remain exact', () => {
  let value: unknown = 0; for (let i = 0; i < 64; i++) value = [value];
  expect(jsonDataHeapBytes(value)).toBe(original(value)); expect(jsonDataHeapBytes([value])).toBeUndefined();
  const admitted = Array.from({ length: 99999 }, () => 0), refused = [...admitted, 0];
  expect(jsonResidentBytes(admitted)).toBe(original(admitted)); expect(jsonDataHeapBytes(refused)).toBeUndefined();
  expect(() => jsonResidentBytes(refused)).toThrow('bounded plain JSON');
});

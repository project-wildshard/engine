import { expect, test } from 'vitest';
import { nextFarReady } from './slabLibrary';

// Staging v0.1.50 on the iPhone 13 (mini-phone-13b, 2026-11-19): iOS 18.6 Safari threw "undefined is not a function" at
// `for (const [id, chunk] of farHeld)` in askFar, from the slab tree worker's onmessage, and the error card paused the game
// on 2 of 4 Nine boots. The walk that picks the next far job must not need the Map's iterator.
const ready = { order: new Uint32Array(3), xyz: new Float32Array(9), turned: false, sentTurned: false };

test('the next far job is the first held chunk whose tree is in, in held order', () => {
  const held = new Map<number, Partial<typeof ready>>([[4, {}], [7, ready], [9, ready]]);
  expect(nextFarReady(held)).toBe(7);
  held.delete(7);
  expect(nextFarReady(held)).toBe(9);
  held.delete(9);
  expect(nextFarReady(held)).toBeUndefined();
  expect(nextFarReady(new Map())).toBeUndefined();
});

test('it walks a held map whose iterator is gone (the shape iOS Safari threw on)', () => {
  const held = new Map<number, Partial<typeof ready>>([[1, { order: new Uint32Array(3) }], [2, ready]]);
  // the bad shape: `for…of` over this map throws, as Safari's did
  Object.defineProperty(held, Symbol.iterator, { value: undefined });
  Object.defineProperty(held, 'entries', { value: undefined });
  expect(() => { for (const entry of held) void entry; }).toThrow(TypeError);
  expect(nextFarReady(held)).toBe(2);
});

import {expect, test} from 'vitest';
import {decodeParsedPages, encodeParsedPages, parseJsonPages} from './parsedPages';

test('paged native parsing retains every scalar, property, array and numerical bit', async () => {
  const json = String.raw`{"__proto__":{"safe":true},"constructor":7,"rows":[{},[],null,false,-0,1e400,-1e400,0.004753960503472321],"10":1,"2":2,"unicode":"森林 🐟\ud800"}`;
  const bytes = new TextEncoder().encode(json), before = bytes.slice();
  const transfer = parseJsonPages(bytes);
  if (!(transfer instanceof Uint8Array)) throw new Error('Paged parser missing binary transfer');
  let pauses = 0;
  const actual = await decodeParsedPages(transfer, () => {pauses++; return Promise.resolve();});
  expect(actual).toEqual(JSON.parse(json));
  expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
  const original: unknown = JSON.parse(json);
  if (typeof actual !== 'object' || actual === null || typeof original !== 'object' || original === null) throw new Error('Missing parsed object');
  expect(Object.keys(actual)).toEqual(Object.keys(original));
  expect(bytes).toEqual(before); expect(pauses).toBeGreaterThan(1);
});

test('large trees and long keys/strings cross bounded steps without publishing partial output', async () => {
  const source = {['key'.repeat(5000)]: '森林\\\"🐟'.repeat(2000), rows: Array.from({length: 1000}, (_, i) => ({i, name: `row-${i}`, children: [i, null, false]}))};
  const encoded = encodeParsedPages(source);
  let pauses = 0;
  expect(await decodeParsedPages(encoded, () => {pauses++; return Promise.resolve();})).toEqual(source);
  // one pause a step of at most 32 tokens or 16 KiB, and one at the end: 10,010 tokens here (the long key and string go in
  // 4,096-unit parts), so 313 steps, and two more where a step of long parts reaches 16 KiB first
  expect(pauses).toBeGreaterThanOrEqual(Math.ceil(10_010 / 32) + 1); expect(pauses).toBeLessThanOrEqual(Math.ceil(10_010 / 32) + 4);
  await expect(decodeParsedPages(encoded, () => Promise.reject(new Error('owner ended')))).rejects.toThrow('owner ended');
});

test('a string that is not well formed and a pair at a part boundary cross unchanged', async () => {
  const lone = 'a\uD800b'.repeat(3000), pair = `${'x'.repeat(4095)}🐟${'y'.repeat(5000)}`;
  expect(await decodeParsedPages(encodeParsedPages([lone, pair, '']), () => Promise.resolve())).toEqual([lone, pair, '']);
});

test('truncated, oversized, invalid and extra transfers refuse without partial trees', async () => {
  const encoded = encodeParsedPages({a: [1, 2, 3]});
  const raw = (...bytes: number[]): Uint8Array => Uint8Array.from([0x57, ...bytes]);
  for (const bytes of [new Uint8Array(), encoded.subarray(1), encoded.subarray(0, 3), encoded.subarray(0, -1),
    raw(6, 6), raw(1, 1, 0, 0, 0, 8), raw(1, 1, 0, 0, 0, 6, 6), raw(3, 0, 1, 0, 0, 0, 120), raw(3, 2, 0, 0, 0, 0),
    raw(3, 0, 1, 0, 0, 0, 120, 6), raw(9), raw(2, 255, 255, 255, 255, 6), raw(5, 0, 0, 0, 0, 0, 0, 248, 127),
    raw(3, 1, 1, 0, 0, 0, 0xff), raw(5, 0, 0), raw(9, 0, 0, 0, 0)]) {
    await expect(decodeParsedPages(bytes, () => Promise.resolve())).rejects.toThrow();
  }
  expect(await decodeParsedPages(raw(5, 0, 0, 0, 0, 0, 0, 240, 127), () => Promise.resolve())).toBe(Infinity);
});

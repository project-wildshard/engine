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

test('large trees and long keys/strings cross bounded pages without publishing partial output', async () => {
  const source = {['key'.repeat(5000)]: '森林\\\"🐟'.repeat(2000), rows: Array.from({length: 1000}, (_, i) => ({i, name: `row-${i}`, children: [i, null, false]}))};
  const encoded = encodeParsedPages(source), view = new DataView(encoded.buffer);
  let pages = 0;
  for (let at = 0; at < encoded.length;) {
    const length = view.getUint32(at, true); expect(length).toBeLessThanOrEqual(16_384);
    const tokens: unknown = JSON.parse(new TextDecoder().decode(encoded.subarray(at + 4, at + 4 + length)));
    if (!Array.isArray(tokens)) throw new Error('Missing token page');
    expect(tokens.length).toBeLessThanOrEqual(32); at += 4 + length; pages++;
  }
  let pauses = 0;
  expect(await decodeParsedPages(encoded, () => {pauses++; return Promise.resolve();})).toEqual(source);
  expect(pauses).toBe(pages + 1); expect(pages).toBeGreaterThan(200);
  await expect(decodeParsedPages(encoded, () => Promise.reject(new Error('owner ended')))).rejects.toThrow('owner ended');
});

test('truncated, oversized, invalid and extra transfers refuse without partial trees', async () => {
  const encoded = encodeParsedPages({a: [1, 2, 3]});
  const malformed = (text: string): Uint8Array => {
    const body = new TextEncoder().encode(text), output = new Uint8Array(4 + body.length);
    new DataView(output.buffer).setUint32(0, body.length, true); output.set(body, 4); return output;
  };
  for (const bytes of [encoded.subarray(0, 3), encoded.subarray(0, -1),
    malformed('[["a",2],["v",null]]'), malformed('[["v",null],["v",false]]'),
    malformed('[["o",1],["v",true]]'), malformed('[["s","unfinished",false]]'),
    malformed('[["n",""]]'), malformed('[["s","x",false],["v",null]]'), malformed('[]')]) {
    await expect(decodeParsedPages(bytes, () => Promise.resolve())).rejects.toThrow();
  }
  const oversized = new Uint8Array(4); new DataView(oversized.buffer).setUint32(0, 16_385, true);
  await expect(decodeParsedPages(oversized, () => Promise.resolve())).rejects.toThrow('Invalid parsed page');
});

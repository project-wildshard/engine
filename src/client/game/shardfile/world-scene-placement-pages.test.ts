import { expect, test, vi } from 'vitest';
import { WorldScenePlacementPages } from './worldScenePlacementPages';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const row = { id: 'first', model: 'rock', draw: 'instanced', poses: [] };

test('complete native parsing finishes during read-ahead before the admission cursor requests the page', async () => {
  const text = JSON.stringify({ version: 1, rows: [row] }), bytes = new TextEncoder().encode(text);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    const pages = new WorldScenePlacementPages({ file: () => Promise.resolve(bytes) }, ['page']);
    await Promise.resolve(); await Promise.resolve();
    expect(parse).toHaveBeenCalledExactlyOnceWith(text);
    expect((await pages.read('page', bytes)).rows).toEqual([row]);
    expect(parse).toHaveBeenCalledTimes(1);
  } finally { parse.mockRestore(); }
});

test('page reads start together and complete native results are reused at the ordered cursor', async () => {
  const calls: string[] = [], bytes = encode({ version: 1, rows: [row] });
  const pages = new WorldScenePlacementPages({ file: name => { calls.push(name); return Promise.resolve(bytes); } }, ['a', 'b', 'a']);
  expect(calls).toEqual(['a', 'b']);
  const first = await pages.read('a', bytes);
  expect(first.rows).toEqual([row]);
  expect(await pages.read('a', bytes)).toBe(first);
  expect(await pages.read('b', bytes)).toEqual(first);
  await expect(pages.read('a', bytes.slice())).rejects.toThrow('owner changed');
  pages.clear();
  await expect(pages.read('a', bytes)).rejects.toThrow('Missing prepared');
});

test('read-ahead retains whole-page and transport refusals until requested, with no unhandled rejection', async () => {
  const bad = encode({ version: 1, rows: [row, { ...row, id: 'unselected', poses: [{ x: Infinity }] }] });
  const failure = new Error('native transport');
  const pages = new WorldScenePlacementPages({ file: name => name === 'bad' ? Promise.resolve(bad) : Promise.reject(failure) }, ['bad', 'failed']);
  await Promise.resolve(); await Promise.resolve();
  await expect(pages.read('bad', bad)).rejects.toThrow();
  await expect(pages.read('failed', bad)).rejects.toBe(failure);
});

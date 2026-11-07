import { expect, test } from 'vitest';
import { preflightShardfile } from '@wildshard/format/preflight';
import { preflightProduct } from './productPreflight';

test('live preflight yields within a large tree and retains the complete final wire fence', async () => {
  const input = { files: [{ hash: 'a'.repeat(64), compressed: -1 }], rows: Array.from({ length: 2000 }, (_, id) => ({ id, words: [1, 2, 3] })) };
  let pauses = 0;
  expect(() => preflightShardfile(input)).toThrow('nonnegative safe integers');
  await expect(preflightProduct(input, () => { pauses++; return Promise.resolve(); })).rejects.toThrow('nonnegative safe integers');
  expect(pauses).toBeGreaterThan(100);
  input.files[0] = { hash: 'a'.repeat(64), compressed: 12 };
  expect(() => preflightShardfile(input)).not.toThrow();
  await expect(preflightProduct(input, () => Promise.resolve())).resolves.toBeUndefined();
});

test.each([
  { rows: [{ min: [-Number.MAX_SAFE_INTEGER, 0, 0], max: [1, 1, 1] }] },
  { rows: [{ x0: 2, x1: 1, z0: 0, z1: 1 }] },
  { number: -0 }, { number: Infinity },
])('live preflight preserves the original bounds/plain-data refusal', async input => {
  let original = '';
  try { preflightShardfile(input); } catch (error) { original = error instanceof Error ? error.message : String(error); }
  expect(original).not.toBe('');
  await expect(preflightProduct(input, () => Promise.resolve())).rejects.toThrow(original);
});

test('live preflight propagates retirement and never reads an authored accessor', async () => {
  const input = { rows: Array.from({ length: 2000 }, (_, id) => ({ id })) };
  await expect(preflightProduct(input, () => Promise.reject(new Error('owner left')))).rejects.toThrow('owner left');
  let reads = 0;
  const bad = { rows: [{ get value(): number { reads++; return 1; } }] };
  await expect(preflightProduct(bad, () => Promise.resolve())).rejects.toThrow('bounded plain JSON');
  expect(reads).toBe(0);
});

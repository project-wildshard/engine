import {expect, test} from 'vitest';
import {NEAR_GRAIN_SIZE, nearGrainBytes} from './nearGrain';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

test('near grain returns the same bytes each call with independent output ownership', async () => {
  const first = nearGrainBytes(), second = nearGrainBytes();
  expect(NEAR_GRAIN_SIZE).toBe(128);
  expect(first).toHaveLength(NEAR_GRAIN_SIZE * NEAR_GRAIN_SIZE);
  const want = await sha256(first);
  expect(second).toEqual(first);
  expect(second.buffer).not.toBe(first.buffer);
  first.fill(0);
  expect(await sha256(second)).toBe(want);
});

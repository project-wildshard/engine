import { expect, test } from 'vitest';
import { sha256 } from './moduleHash';

const independent = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(word => word.toString(16).padStart(2, '0')).join('');

test.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
])('matches SHA-256 known vector %j', (input, hash) => {
  expect(sha256(new TextEncoder().encode(input))).toBe(hash);
});

test('matches the independent hash across block and padding boundaries', async () => {
  await Promise.all([1, 7, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1023, 1024, 104343].map(async length => {
    const backing = Uint8Array.from({ length: length + 23 }, (_, i) => (i * 73 + (i >>> 3)) & 255);
    const input = backing.subarray(11, length + 11), original = backing.slice();
    expect(sha256(input)).toBe(await independent(input));
    expect(backing).toEqual(original);
  }));
});

test('hashes changed bytes again without sharing scratch between calls', async () => {
  const input = new Uint8Array(256).fill(137), original = sha256(input);
  expect(sha256(new Uint8Array(64).fill(21))).toBe(await independent(new Uint8Array(64).fill(21)));
  input[131] = 138;
  expect(sha256(input)).toBe(await independent(input));
  expect(sha256(input)).not.toBe(original);
  input[131] = 137;
  expect(sha256(input)).toBe(original);
});

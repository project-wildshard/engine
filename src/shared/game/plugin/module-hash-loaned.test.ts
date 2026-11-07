import { expect, test } from 'vitest';
import { loanedSha256, sha256 } from './moduleHash';

// T10: a loaned byte source is verified once; any other source (a copy, a re-pointed view) is hashed again
test('loaned bytes hash once per byte source and agree with sha256', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 251), copy = Uint8Array.from(bytes);
  const hash = sha256(bytes);
  expect(loanedSha256(bytes)).toBe(hash);
  expect(loanedSha256(bytes)).toBe(hash);
  expect(loanedSha256(copy)).toBe(hash);
  const view = bytes.subarray(1);
  expect(loanedSha256(view)).toBe(sha256(view));
  expect(loanedSha256(view)).not.toBe(hash);
});

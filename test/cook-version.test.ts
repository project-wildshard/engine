import { expect, test, vi } from 'vitest';
import { checkCookVersion } from '../src/scripts/cookVersion';

const previous = {cookVersion: '1.0.0', cookHash: 'a'.repeat(64), formatVersion: '0.1.0.6', goldenDigest: 'd'.repeat(64)};
const moved = {...previous, cookHash: 'b'.repeat(64)};
const golden = () => Promise.resolve(previous.goldenDigest);

test('a changed cook hash refuses a stale record and requires a version bump or declaration', async () => {
  await expect(checkCookVersion(previous, moved, previous, golden)).rejects.toThrow('Cook inputs moved');
  await expect(checkCookVersion(moved, moved, previous, golden)).rejects.toThrow('version bump or same-output');
  await expect(checkCookVersion({...moved, cookVersion: '1.0.1'}, moved, previous, golden)).resolves.toBeUndefined();
});

test('same output compares the fresh golden cook to the prior digest', async () => {
  const declaration = {...moved, sameOutputFrom: previous.cookHash};
  const compare = vi.fn(golden);
  await expect(checkCookVersion(declaration, moved, previous, compare)).resolves.toBeUndefined();
  expect(compare).toHaveBeenCalledOnce();
  await expect(checkCookVersion(declaration, moved, previous, () => Promise.resolve('changed'))).rejects.toThrow('Golden cook differs');
});

test('a format change demands a cook version bump even when the golden stays equal', async () => {
  const changed = {...moved, formatVersion: '0.1.0.7', sameOutputFrom: previous.cookHash};
  await expect(checkCookVersion(changed, changed, previous, golden)).rejects.toThrow('shard format change');
});

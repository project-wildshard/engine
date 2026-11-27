import { expect, test, vi } from 'vitest';
import { checkCookVersion, rebasedCookVersion } from '../src/scripts/cookVersion';
import { cookHash } from '../src/scripts/cookHash';

test('the encoder cache is hashed without feeding the cook record back into the hash', () => {
  const {files} = cookHash();
  expect(files).toContain('src/cook/game/encodeCache.ts');
  expect(files).not.toContain('src/cook/game/cook-version.json');
});

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

test('rebasing a same-output declaration proves the merged cook against its new parent', async () => {
  const replayed = {...moved, sameOutputFrom: previous.cookHash};
  const parent = {...previous, cookVersion: '1.0.1', cookHash: 'c'.repeat(64), goldenDigest: 'e'.repeat(64)};
  const merged = {cookHash: 'f'.repeat(64), formatVersion: parent.formatVersion};
  await expect(rebasedCookVersion(previous, replayed, parent, merged, () => Promise.resolve(parent.goldenDigest)))
    .resolves.toEqual({...parent, ...merged, sameOutputFrom: parent.cookHash});
  await expect(rebasedCookVersion(previous, replayed, parent, merged, golden)).rejects.toThrow('golden digest can change only');
});

test('rebasing keeps an explicit unused bump and refuses one already issued', async () => {
  const replayed = {...moved, cookVersion: '1.0.2'};
  const parent = {...previous, cookVersion: '1.0.1', cookHash: 'c'.repeat(64)};
  const merged = {cookHash: 'f'.repeat(64), formatVersion: parent.formatVersion};
  await expect(rebasedCookVersion(previous, replayed, parent, merged, golden))
    .resolves.toEqual({...replayed, ...merged});
  await expect(rebasedCookVersion(previous, replayed, {...parent, cookVersion: replayed.cookVersion}, merged, golden))
    .rejects.toThrow('would reuse an issued version');
});

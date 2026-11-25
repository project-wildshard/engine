import { expect, test } from 'vitest';
import { SHARDFILE_FLOOR, SHARDFILE_VERSION } from '@wildshard/format/version';
import { admittedFormat } from '../src/client/game/shardfile/folder';

// FORMAT-PRUNE FP7 (J486 replaces WR11's N and N-1, J505 build-ahead): the client reads shard-format's floor up to its
// own version, and a refusal names the file's version and the window.

test('FP7: a file two additive counters old is in the window; one newer than the client is refused naming both', () => {
  const [major, minor, breaking, additive] = SHARDFILE_VERSION.split('.').map(Number);
  const older = [major, minor, breaking, Math.max(0, (additive ?? 0) - 2)].join('.');
  const newer = [major, minor, breaking, (additive ?? 0) + 1].join('.');
  expect(admittedFormat({ formatVersion: older })).toBe(older);
  expect(admittedFormat({ formatVersion: SHARDFILE_FLOOR })).toBe(SHARDFILE_FLOOR);
  expect(admittedFormat({ formatVersion: SHARDFILE_VERSION })).toBe(SHARDFILE_VERSION);
  // Before CP14 the version sat in `version` beside the layout marker 2.
  expect(admittedFormat({ formatVersion: 2, version: older })).toBe(older);
  // FORMAT-PRUNE FP24 (J508): the two-part 0.1 and 0.1.0.0 are below the 0.1.0.1 floor now.
  expect(SHARDFILE_FLOOR).toBe('0.1.0.1');
  for (const gone of ['0.1', '0.1.0.0']) expect(() => admittedFormat({ formatVersion: 2, version: gone })).toThrow(`Shardfile format ${gone} is outside this client's ${SHARDFILE_FLOOR}`);
  expect(() => admittedFormat({ formatVersion: newer })).toThrow(`Shardfile format ${newer} is outside this client's ${SHARDFILE_FLOOR} to ${SHARDFILE_VERSION}: newer than this client, update it`);
  expect(() => admittedFormat({ formatVersion: `${String(major)}.${String((minor ?? 0) + 1)}.0.0` })).toThrow(/is outside this client's .*newer than this client/u);
});

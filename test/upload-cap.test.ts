// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the tracked source for hand copies.
import {spawnSync} from 'node:child_process';
import {expect, test} from 'vitest';

// MW7 (EG-8): the cook's shardfile cap is shard-format's `./uploadCaps`, the one the API imports. BUG-3 was a hand copy
// that drifted (the cook refused Pine's 300 MB head while the API took 450).
test('no engine source keeps its own copy of the 450 MB cap', () => {
  const grep = spawnSync('git', ['grep', '-l', '-E', '\\b450_?000_?000\\b', '--', 'src', 'scripts', 'test'], {encoding: 'utf8'});
  expect(grep.status === 0 || grep.status === 1).toBe(true); // 1 is git grep's "no match".
  const copies = grep.stdout.split('\n').filter((path): boolean => path !== '' && path !== 'test/upload-cap.test.ts');
  expect(copies).toEqual([]);
}, 30_000);

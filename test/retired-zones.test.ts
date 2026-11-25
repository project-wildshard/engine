// Meta ZONE-SNAPSHOTS ZS7 (J507): Ink Cel Valley and Pastel Plain left the tests, and the API's prune deleted their uploads
// (11-25). Nothing in the tests, scripts or sources names them again; the lift record of original tests at fixed
// revisions (test/engine-lift-disposition.json) is history and keeps them.
import {execFileSync} from 'node:child_process';
import {expect, test} from 'vitest';

test('no test, script or source names a retired zone', () => {
  let found = '';
  try {
    found = execFileSync('git', ['grep', '-lE', 'ink-cel-valley|pastel-plain', '--', 'test', 'scripts', 'src', ':!test/engine-lift-disposition.json', ':!test/retired-zones.test.ts'], {encoding: 'utf8'});
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if ((error as {status?: number}).status !== 1) throw error;
  }
  expect(found.split('\n').filter(Boolean)).toEqual([]);
});

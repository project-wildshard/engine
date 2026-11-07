import { expect,test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual Bash admission against isolated process/device fixtures.
import { spawnSync } from 'node:child_process';

test('browser admission fails within its cap without launching a child', () => {
  const result = spawnSync('python3',['scripts/test_browser_lane.py'],{ encoding: 'utf8',timeout: 15000 });
  expect(result.status,result.stderr).toBe(0);
},20000);

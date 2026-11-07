// oxlint-disable-next-line import/no-nodejs-modules -- Run the maintained archive/refusal controls in normal CI.
import {spawnSync} from 'node:child_process';
import {expect, test} from 'vitest';

test('prebuilt release preserves the whole artifact and refuses corrupt or foreign input', () => {
  const result=spawnSync('python3',['scripts/test_prebuilt_output.py'],{encoding:'utf8',timeout:10_000});
  expect(result.error).toBeUndefined();
  expect(result.status,result.stdout+result.stderr).toBe(0);
});

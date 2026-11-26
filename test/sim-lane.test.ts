import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual Bash handover against an isolated simctl fixture.
import { spawnSync } from 'node:child_process';

test('Simulator handover waits for Safari and propagates startup failures', () => {
  const result = spawnSync('python3', ['src/scripts/test_sim_lane.py',
    'SimulatorReadinessTests.test_cold_boot_prepares_only_the_owned_runtime_before_native_boot',
    'SimulatorReadinessTests.test_bootstatus_failure_propagates_and_releases_new_device',
    'ParallelResultTests.test_failure_error_and_skip_remain_visible'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
}, 25000);

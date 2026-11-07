import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual Bash handover against an isolated simctl fixture.
import { spawnSync } from 'node:child_process';

test('Simulator handover waits for Safari and propagates startup failures', () => {
  const result = spawnSync('python3', ['scripts/test_sim_lane.py', 'SimulatorReadinessTests', 'ParallelResultTests'], { encoding: 'utf8', timeout: 20000 });
  expect(result.status, result.stderr).toBe(0);
}, 25000);

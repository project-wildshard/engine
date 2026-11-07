import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the one-shot native diagnostic without touching a Simulator.
import { spawnSync } from 'node:child_process';

test('Transport witnesses cannot substitute for owned Safari frames', () => {
  const result = spawnSync('python3', ['scripts/test_sim_lane.py', 'SimulatorTransportTests'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
}, 15000);

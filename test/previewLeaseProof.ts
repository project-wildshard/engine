import { expect } from 'vitest';
import { runCommitJobs } from '../src/scripts/precommit-jobs.mjs';

// Each partition can check four sequential launch scenarios. Each launcher
// has a 35-second fixture deadline, with separate short admission checks.
const PARTITION_DEADLINE = 180_000;
export const PREVIEW_LEASE_TEST_TIMEOUT = PARTITION_DEADLINE + 5_000;

export async function checkPreviewLeasePartition(partition: number, signal: AbortSignal): Promise<void> {
  const [result] = await runCommitJobs(process.cwd(), [{
    name: `preview leases ${partition}/3`,
    command: ['python3', 'src/scripts/test_serve_ports.py', '--partition', `${partition}/3`],
  }], performance.now() + PARTITION_DEADLINE, process.env, signal);
  if (result === undefined) throw new Error(`Missing preview lease partition ${partition}/3 result`);
  expect(result.code, result.output).toBe(0);
}

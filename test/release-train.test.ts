import { describe, expect, test } from 'vitest';
import { nextAdmission, provesTrainCi } from '../scripts/release-train-proof.mjs';

const build = 'a'.repeat(40);
const release = 'v0.1.65';
const ci = 44917975773;
const alias = { build, channel: 'staging', serial: 131, deployment: { id: 'candidate-worker' } };
const candidate = {
  build, release, kind: 'candidate', status: 'pass', hold: false, roomsSerial: 131, deploymentId: 'candidate-worker',
};

describe('early staging publish', () => {
  test('admits the signed alias and candidate before the live tour completes', () => {
    expect(nextAdmission(build, release, ci, alias, candidate)).toEqual({
      staging_build: build, staging_qualification: JSON.stringify({ build, serial: 131, j475: { releaseCi: ci } }),
    });
  });

  test.each([
    { ...alias, build: 'b'.repeat(40) },
    { ...alias, channel: 'production' },
    { ...alias, serial: 130 },
    { ...alias, deployment: { id: 'other-worker' } },
    undefined,
  ])('refuses a missing or mismatched alias', current => {
    expect(nextAdmission(build, release, ci, current, candidate)).toBeUndefined();
  });

  test.each([
    { ...candidate, release: 'v0.1.64' },
    { ...candidate, roomsSerial: 129 },
    { ...candidate, status: 'hold', hold: true },
    { ...candidate, kind: 'live' },
    undefined,
  ])('refuses a missing, live or held candidate proof', current => {
    expect(nextAdmission(build, release, ci, alias, current)).toBeUndefined();
  });

  test('requires a hosted release CI receipt', () => {
    expect(nextAdmission(build, release, 0, alias, candidate)).toBeUndefined();
  });
});

test('train CI proves the exact build after running packed tests and the required jobs', () => {
  const green = { conclusion: 'success', status: 'completed' };
  const jobs = [
    ...['boundaries', 'nine-ring1-build', 'memory-client-build'].map(name => ({ name, ...green })),
    { name: 'tests (1)', ...green, steps: [{ name: "Run this job's packed share", ...green }] },
  ];
  const run = { headSha: build, databaseId: ci, ...green, jobs };
  expect(provesTrainCi(run, build)).toBe(true);
  expect(provesTrainCi(run, 'b'.repeat(40))).toBe(false);
  expect(provesTrainCi({ ...run, conclusion: 'failure' }, build)).toBe(false);
  expect(provesTrainCi({ ...run, jobs: jobs.slice(1) }, build)).toBe(false);
  expect(provesTrainCi({ ...run, jobs: jobs.slice(0, -1) }, build)).toBe(false);
});

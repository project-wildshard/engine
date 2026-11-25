import { describe, expect, test } from 'vitest';
import { attributionGap, fullCommitArgs, nextAdmission, provesNpmNext, releaseCiAdmission, provesReleaseReuse, provesTrainCi, retryRead, watchTrainRun } from '../scripts/release-train-proof.mjs';
import { createTempRepo } from '../src/test/helpers/git';

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


test('FR6: the train takes a reused release run only for a release-only build over the proved cut', () => {
  const repo = createTempRepo();
  try {
    const manifest = (version: string) => JSON.stringify({ name: '@wildshard/engine', version });
    const cut = repo.commit({ 'package.json': manifest('0.1.36'), 'CHANGELOG.md': '## v0.1.36\n' }, 'cut');
    const head = repo.commit({ 'package.json': manifest('0.1.37'), 'CHANGELOG.md': '## v0.1.37\n\n- New\n\n## v0.1.36\n' }, 'release');
    const green = { conclusion: 'success', status: 'completed' }, skipped = { conclusion: 'skipped', status: 'completed' };
    const jobs = [...Array.from({ length: 9 }, (_, at) => ({ name: `tests (${at + 1})`, ...green })), { name: 'memory-client-build', ...skipped }];
    const run = { headSha: head, databaseId: ci, ...green, jobs };
    expect(provesTrainCi(run, head)).toBe(false);
    expect(provesReleaseReuse(run, head, 'v0.1.37', cut, repo.dir)).toBe(true);
    expect(provesReleaseReuse(run, head, 'v0.1.38', cut, repo.dir)).toBe(false);
    expect(provesReleaseReuse(run, head, 'v0.1.37', head, repo.dir)).toBe(false);
    expect(provesReleaseReuse({ ...run, conclusion: 'failure' }, head, 'v0.1.37', cut, repo.dir)).toBe(false);
    expect(provesReleaseReuse({ ...run, jobs: [{ name: 'tests (1)', conclusion: 'failure', status: 'completed' }] }, head, 'v0.1.37', cut, repo.dir)).toBe(false);
    const code = repo.commit({ 'src/x.ts': 'export {};\n' }, 'code');
    expect(provesReleaseReuse({ ...run, headSha: code }, code, 'v0.1.37', head, repo.dir)).toBe(false);
  } finally { repo.cleanup(); }
});

describe('hosted run readback', () => {
  const publishJob = { name: 'publish', status: 'completed', conclusion: 'success' };
  const published = {
    databaseId: 45065429703, status: 'completed', conclusion: 'success', headSha: 'b'.repeat(40),
    headBranch: 'main', event: 'workflow_dispatch', workflowName: 'npm-publish', displayTitle: `npm next ${build}`,
    jobs: [publishJob],
  };
  const brokenWatch = async () => { throw new Error('HTTP 404'); };
  const cleanWatch = async () => {};

  test('a broken watcher recovers from the exact completed publish run', async () => {
    const run = await watchTrainRun(published.databaseId, brokenWatch, id => {
      expect(id).toBe(published.databaseId);
      return published;
    });
    expect(provesNpmNext(run, build)).toBe(true);
  });

  test.each([
    { ...published, databaseId: 1 },
    { ...published, status: 'in_progress' },
    { ...published, conclusion: 'failure' },
    { ...published, conclusion: 'cancelled' },
  ])('requires the exact completed success even if the watcher exits cleanly', async run => {
    for (const watch of [brokenWatch, cleanWatch]) {
      await expect(watchTrainRun(published.databaseId, watch, () => run)).rejects.toThrow('did not prove success');
    }
  });

  test('holds when the watcher fails and the exact verdict is unavailable', async () => {
    await expect(watchTrainRun(published.databaseId, brokenWatch, () => {
      throw new Error('readback unavailable');
    })).rejects.toThrow('readback unavailable');
  });

  test.each([
    { ...published, displayTitle: `npm next ${'b'.repeat(40)}` },
    { ...published, displayTitle: 'npm latest v0.1.65' },
    { ...published, workflowName: 'ci' },
    { ...published, headBranch: 'plan/other' },
    { ...published, event: 'push' },
    { ...published, jobs: [{ ...publishJob, conclusion: 'skipped' }] },
  ])('refuses another build, workflow, trigger or skipped publish job', run => {
    expect(provesNpmNext(run, build)).toBe(false);
  });
});

describe('attribution before local QA', () => {
  test('a new cut needs ASSISTED_BY before the train spends its local QA; a prepared branch or a human release does not', () => {
    expect(attributionGap({}, false)).toContain('set ASSISTED_BY');
    expect(attributionGap({ ASSISTED_BY: ' ' }, false)).toContain('set ASSISTED_BY');
    expect(attributionGap({ ASSISTED_BY: 'Claude:claude-opus-5-5' }, false)).toBeUndefined();
    expect(attributionGap({}, true)).toBeUndefined();
    expect(attributionGap({ SKIP_ATTRIB: '1' }, false)).toBeUndefined();
  });
});

// Meta QA 11-25 row 7: one failed `gh run` read held v0.1.91's train at 15:48 UTC; a read now gets three tries.
describe('retryRead', () => {
  test('a passing hiccup is read again, not a hold', () => {
    let calls = 0; const pauses: number[] = [];
    expect(retryRead(() => { calls++; if (calls < 3) throw new Error('gh run'); return 'ok'; }, { pause: ms => { pauses.push(ms); } })).toBe('ok');
    expect(calls).toBe(3);
    expect(pauses).toEqual([5000, 5000]);
  });
  test('a failure on every try still holds', () => {
    let calls = 0;
    expect(() => retryRead(() => { calls++; throw new Error('gh run'); }, { pause: () => undefined })).toThrow('gh run');
    expect(calls).toBe(3);
  });
});

describe('fullCommitArgs', () => {
  test('refuses a short --commit, which gh would match to no run', () => {
    const full = 'a'.repeat(40);
    expect(fullCommitArgs(['run', 'list', '--commit', full])).toEqual(['run', 'list', '--commit', full]);
    expect(() => fullCommitArgs(['run', 'list', '--commit', 'bed86d8fb352'])).toThrow('full 40-character SHA');
    expect(() => fullCommitArgs(['run', 'list', '--commit'])).toThrow('full 40-character SHA');
    expect(fullCommitArgs(['run', 'view', '123'])).toEqual(['run', 'view', '123']);
  });
});

describe('releaseCiAdmission', () => {
  test('admits npm next on the exact release CI, the shape npm-publish.yml reads as J475', () => {
    const build = 'b'.repeat(40);
    const input = releaseCiAdmission(build, 45698418187);
    expect(input.staging_build).toBe(build);
    expect(JSON.parse(input.staging_qualification)).toEqual({ build, j475: { releaseCi: 45698418187 } });
    expect(() => releaseCiAdmission('889b423bed', 1)).toThrow('full build SHA');
    expect(() => releaseCiAdmission(build, 0)).toThrow('release CI run');
  });
});

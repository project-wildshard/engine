// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the nightly promotion CLI against test-owned Git history.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Test-owned gh transport and downloaded verdict.
import { chmodSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the real CLI and fixture paths.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { nextTag } from '../src/scripts/nightly-tag.mjs';
import { browsers, phases, plan, testGroups, type Verdict } from '../src/scripts/nightly-model.ts';
import { createTempRepo } from '../src/test/helpers/git.ts';

test('a green nightly takes the next patch of the highest version, in version order', () => {
  expect(nextTag(['v0.1.9', 'v0.1.10', 'v0.1.2'])).toBe('v0.1.11');
  expect(nextTag(['v1.0.0', 'v0.9.9'])).toBe('v1.0.1');
});

test('the first nightly is v0.1.0, and a tag that is no version is ignored', () => {
  expect(nextTag([])).toBe('v0.1.0');
  expect(nextTag(['nightly', 'pins'])).toBe('v0.1.0');
});


test('a green nightly prints the release cut and never writes or pushes a version tag', () => {
  const repo = createTempRepo();
  try {
    const sha = repo.commit({
      'test/pins/shardfiles.json': JSON.stringify({ shards: [{ slug: 'fixture', hash: 'a'.repeat(64) }] }),
      'test/pins/ring-2-tests.json': JSON.stringify(Array.from({ length: testGroups }, (_, group) => `test/fixture-${group}.test.ts`)),
      'bin/gh': '#!/usr/bin/env node\nconsole.log(JSON.stringify({ id: 17, head_sha: process.env.FIXTURE_SHA, status: "completed", conclusion: "success" }));\n',
    }, 'Nightly source');
    chmodSync(join(repo.dir, 'bin/gh'), 0o755);
    const remote = join(dirname(repo.dir), 'origin.git');
    repo.git(['init', '--quiet', '--bare', remote]);
    repo.git(['remote', 'add', 'origin', remote]);
    repo.git(['push', '--quiet', 'origin', 'main']);
    const expected = plan(repo.dir);
    const report: Verdict = { ...expected, ok: true, tag: 'eligible', run: '17', failures: [], baseline: null, newFailures: [], resolved: [],
      tests: Array.from({ length: testGroups }, (_, group) => ({ group, ok: true, files: 1, assertions: 1 })),
      rows: expected.heads.flatMap(head => browsers.flatMap(browser => phases.map(phase => ({ ...head, browser, phase, ok: true })))) };
    const file = join(repo.dir, 'verdict.json');
    writeFileSync(file, JSON.stringify(report));
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../src/scripts/nightly-tag.mjs'), `--report=${file}`], { cwd: repo.dir, encoding: 'utf8', timeout: 10000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), PATH: `${join(repo.dir, 'bin')}:${process.env['PATH'] ?? ''}`, FIXTURE_SHA: sha } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`release.sh v0.1.0 --prepare --from ${sha}`);
    expect(repo.git(['tag', '--list'])).toBe('');
    expect(repo.git(['ls-remote', '--tags', 'origin'])).toBe('');
    expect(repo.git(['rev-parse', 'HEAD'])).toBe(sha);
  } finally { repo.cleanup(); }
});

// FAST-RELEASE FR6 (meta docs/plans/FAST-RELEASE-PLAN.md): a release branch whose head only stamps the version and adds
// notes reuses main's code proof of its cut instead of rerunning the whole suite. These tests keep the duplicate CI from
// coming back: the selector's answer, the reader list it runs, and every ci.yml job following that answer.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { RELEASE_READER_TESTS, selectCI } from '../scripts/ci-selection.mjs';
import { vitestFile } from '../scripts/push-selection.mjs';
import { createTempRepo, type TempRepo } from '../src/test/helpers/git';

const REPO = 'project-wildshard/engine';
const green = { status: 'completed', conclusion: 'success' };
const packed = (ran: boolean) => ({ name: "Run this job's packed share", ...green, conclusion: ran ? 'success' : 'skipped' });
const ring = (ran: boolean) => ({ name: 'Cook, attach, and play the same bytes', ...green, conclusion: ran ? 'success' : 'skipped' });
const jobs = (ran: boolean) => [
  ...Array.from({ length: 9 }, (_, at) => ({ name: `tests (${at + 1})`, ...green, steps: [packed(ran)] })),
  { name: 'boundaries', ...green, steps: [ring(ran)] },
];
const notes = (version: string, older = '## v0.1.36 (2026-11-23)\n\n- Older\n') =>
  `# Engine changelog\n\n## v${version} (2026-11-24)\n\n- New\n\n${older}`;

// Inside a git hook GIT_DIR points at the outer repo; the selector's own git calls must read the fixture.
const saved: Record<string, string | undefined> = {};
let repo: TempRepo, cut: string;
beforeAll(() => {
  for (const key of Object.keys(process.env).filter(name => name.startsWith('GIT_'))) { saved[key] = process.env[key]; delete process.env[key]; }
  repo = createTempRepo();
  cut = repo.commit({
    'package.json': JSON.stringify({ name: '@wildshard/engine', version: '0.1.36', scripts: { check: 'check' } }),
    'CHANGELOG.md': '# Engine changelog\n\n## v0.1.36 (2026-11-23)\n\n- Older\n',
    'src/engine.ts': 'export const engine = 1;\n',
  }, 'main cut');
});
afterAll(() => { repo.cleanup(); Object.assign(process.env, saved); });
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; repo.git(['checkout', '--quiet', '--detach', cut]); });

/** A release commit on top of the cut, as `release.sh --prepare` writes it (or with extra files when asked). */
function release(version = '0.1.37', extra: Record<string, string> = {}, changelog = notes(version)) {
  repo.git(['checkout', '--quiet', '--detach', cut]);
  return repo.commit({
    'package.json': JSON.stringify({ name: '@wildshard/engine', version, scripts: { check: 'check' } }),
    'CHANGELOG.md': changelog, ...extra,
  }, `chore(release): v${version}`);
}

/** The Actions API: main runs by head SHA and the main history the ordinary path walks. */
function actions(mainRuns: { id: number, head_sha: string, proves: boolean, conclusion?: string }[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    const runs = mainRuns.map(run => ({ id: run.id, head_sha: run.head_sha, head_branch: 'main', event: 'push', ...green,
      conclusion: run.conclusion ?? 'success', head_repository: { full_name: REPO } }));
    const byJobs = /actions\/runs\/(\d+)\/jobs/u.exec(url);
    const body = byJobs ? { jobs: jobs(mainRuns.find(run => run.id === Number(byJobs[1]))?.proves ?? false) }
      : { workflow_runs: runs.filter(run => !url.includes('head_sha=') || url.includes(`head_sha=${run.head_sha}&`)) };
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
  return calls;
}

const env = (sha: string, version = '0.1.37') => ({
  GITHUB_EVENT_NAME: 'push', GITHUB_SHA: sha, GITHUB_REPOSITORY: REPO, GH_TOKEN: 'fixture', GITHUB_API_URL: 'https://api.invalid',
  GITHUB_REF: `refs/heads/release/v${version}`,
});

test('a release-only head reuses the code-proving main run at its cut and runs only the release readers', async () => {
  const head = release();
  actions([{ id: 41, head_sha: cut, proves: true }]);
  const result = await selectCI(env(head), repo.dir);
  expect(result).toEqual({ docs: true, base: cut, tests: [...RELEASE_READER_TESTS], reason: expect.stringMatching(/^Release v0\.1\.37 .*main CI run 41/u) });
});

test('anything short of proof runs the full suite', async () => {
  const head = release();
  // The cut's main run passed but proved no code (a docs-only verdict), or failed.
  actions([{ id: 42, head_sha: cut, proves: false }]);
  expect((await selectCI(env(head), repo.dir)).docs).toBe(false);
  actions([{ id: 43, head_sha: cut, proves: true, conclusion: 'failure' }]);
  expect((await selectCI(env(head), repo.dir)).docs).toBe(false);
  // The branch names another version than the stamp; or the push is not to a release branch.
  actions([{ id: 44, head_sha: cut, proves: true }]);
  expect((await selectCI(env(head, '0.1.38'), repo.dir)).docs).toBe(false);
  expect((await selectCI({ ...env(head), GITHUB_REF: 'refs/heads/main' }, repo.dir)).docs).toBe(false);
  // A --pick that carries code, a package.json change beyond the version, or notes that drop a line.
  for (const other of [
    release('0.1.37', { 'src/engine.ts': 'export const engine = 2;\n' }),
    release('0.1.37', { 'package.json': JSON.stringify({ name: '@wildshard/engine', version: '0.1.37', scripts: { check: 'other' } }) }),
    release('0.1.37', {}, notes('0.1.37', '')),
  ]) {
    actions([{ id: 45, head_sha: cut, proves: true }]);
    expect((await selectCI(env(other), repo.dir)).docs).toBe(false);
  }
});

test('the history-base lookup never takes the release shortcut', async () => {
  const head = release();
  const calls = actions([{ id: 46, head_sha: cut, proves: true }]);
  await selectCI({ ...env(head), GITHUB_EVENT_NAME: 'workflow_dispatch' }, repo.dir, true);
  expect(calls.some(url => url.includes('head_sha='))).toBe(false);
});

// The readers list stays complete: a new test that reads the real version or notes joins it, or the release lane would
// ship a stamp no test read. Fixtures that only write their own CHANGELOG.md or package.json are named here.
const FIXTURE_ONLY = new Set(['test/ci-release-reuse.test.ts', 'test/push-selection.test.ts', 'test/server-release-history.test.ts',
  'test/tooling/release-gate.test.mjs', 'test/release-train.test.ts']);
const reader = /scripts\/changelog\.mjs|\/whatsNew(?:Banner)?(?:\.ts)?['"]|\/buildCheck(?:\.ts)?['"]|versionFiles(?:\.ts)?['"]|CHANGELOG\.md|readFileSync\(\s*['"](?:\.\/)?package\.json['"][^\n]*\bversion\b|\.\.\/package\.json['"][^\n]*\bversion\b|version\b[^\n]*readFileSync\(\s*['"](?:\.\/)?package\.json/u;

test('every test that reads the release version or notes runs on a reused release branch', () => {
  const tests = execFileSync('git', ['ls-files', 'test', 'src'], { encoding: 'utf8' }).split('\n').filter(file => vitestFile.test(file));
  const readers = tests.filter(file => !FIXTURE_ONLY.has(file) && reader.test(readFileSync(file, 'utf8')));
  expect([...RELEASE_READER_TESTS].sort()).toEqual(readers.sort());
});

test('every ci.yml job follows the selector, so a reused release run starts no suite', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  const blocks = body.split(/\n(?= {2}[a-z0-9-]+:\n)/u).slice(1);
  expect(blocks.length).toBeGreaterThan(5);
  const unfollowed = blocks.map(block => ({ name: block.slice(2, block.indexOf(':')), block })).filter(({ block }) =>
    // Classifies itself and gates its work on the verdict, shares the packed steps that do, waits on a job that ran
    // code, or runs only on a memory qualification dispatch.
    !(block.includes('run: node scripts/ci-selection.mjs') && block.includes("steps.paths.outputs.docs != 'true'")) &&
    !block.includes('steps: *packed-steps') &&
    !/\n {4}if: \$\{\{[^\n]*outputs\.code-run == 'true'/u.test(block) &&
    !/\n {4}if: \$\{\{ inputs\.memory_record &&/u.test(block)).map(({ name }) => name);
  expect(unfollowed).toEqual([]);
});

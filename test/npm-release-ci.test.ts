// oxlint-disable-next-line import/no-nodejs-modules -- Run the hosted shell admission against a fake Actions API.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the same shell block the npm workflow runs.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/npm-publish.yml', 'utf8');
const step = workflow.slice(workflow.indexOf('      - name: Admit the exact staging release for npm next'));
const nodeStart = "          node --input-type=module <<'JS'\n";
const command = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length,
  step.indexOf(nodeStart));
const readback = step.slice(step.indexOf(nodeStart) + nodeStart.length, step.indexOf('\n          JS\n'));
const build = 'a'.repeat(40);
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
test('the release tag installs without package build lifecycle hooks', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  expect(['prepare', 'prepublish', 'prepack', 'publish'].filter(name => scripts[name])).toEqual([]);
});

const run = 44867215030;
const proof = { build, j475: { releaseCi: run } };
const ci = {
  databaseId: run, headSha: build, headBranch: `release/v${version}`, event: 'push',
  workflowName: 'ci', attempt: 1, status: 'completed', conclusion: 'success',
  jobs: Array.from({ length: 12 }, (_, i) => ({ name: `required ${i + 1}`, conclusion: 'success' })),
};

function admit(qualification: unknown, report = ci, { legacy = false, attempt = '', reuse = '' } = {}) {
  // FR6: the selector's verdict on the build. The real one needs git and the Actions API; without a token it says full.
  const selector = reuse === '' ? '' : `
    node() {
      if [[ "$1" == scripts/ci-selection.mjs ]]; then
        [[ "$GITHUB_REF" == "refs/heads/release/v$VERSION" && "$GITHUB_SHA" == "$RELEASE_BUILD" && "$GITHUB_EVENT_NAME" == push && -z "$GITHUB_OUTPUT" ]] || return 1
        printf '%s\\n' "$REUSE"
      else command node "$@"; fi
    }
  `;
  const fakeActions = selector + `
    git() { printf '%s\\n' "$RELEASE_BUILD"; }
    gh() {
      case "$1 $2" in
        'api repos/'*) printf '%s\\n' "$RELEASE_BUILD" ;;
        'run list')
          printf '%s\\n' 'index consulted' >&2
          [[ " $* " != *" --status "* ]] || return 1
          if [[ "$LEGACY_GREEN" == true ]]; then printf '%s\\n' "$EXPECTED_RUN"; fi
          ;;
        'run view')
          printf 'exact run %s\\n' "$3" >&2
          [[ "$3" == "$EXPECTED_RUN" ]] || return 1
          if [[ -n "$EXPECTED_ATTEMPT" ]]; then
            [[ "$4" == --attempt && "$5" == "$EXPECTED_ATTEMPT" && "$6" == --json ]] || return 1
          else
            [[ "$4" == --json ]] || return 1
          fi
          printf '%s\\n' "$REPORT"
          ;;
        *) return 1 ;;
      esac
    }
  `;
  return spawnSync('bash', ['-eo', 'pipefail', '-c', fakeActions + command], {
    encoding: 'utf8',
    env: {
      ...process.env, RELEASE_BUILD: build, EXPECTED_RUN: String(run), GITHUB_REPOSITORY: 'project-wildshard/engine',
      STAGING_QUALIFICATION: JSON.stringify(qualification), REPORT: JSON.stringify(report),
      LEGACY_GREEN: String(legacy), EXPECTED_ATTEMPT: attempt, GH_TOKEN: '', REUSE: reuse, VERSION: version,
    },
  });
}

test('J475 uses the recorded green run even when the Actions list omits it', () => {
  const outcome = admit(proof);
  expect(outcome.stderr).toContain(`exact run ${run}`);
  expect(outcome.stderr).not.toContain('index consulted');
  expect(outcome.status).toBe(0);
});

test('J475 admits a green release before any staging readback exists', () => {
  const outcome = spawnSync(process.execPath, ['--input-type=module', '-e',
    `globalThis.fetch = () => { throw new Error('staging is still deploying'); };\n${readback}`], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_BUILD: build, RELEASE_CI_RUN: String(run), QUEUE_ATTEMPT: '',
      STAGING_QUALIFICATION: JSON.stringify(proof) },
  });
  expect(outcome.stderr).toBe('');
  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toContain('Exact release CI admitted for npm next');
});

test('J475 never substitutes a list entry for a malformed run id', () => {
  const outcome = admit({ build, j475: { releaseCi: `${run} --attempt 2` } });
  expect(outcome.stderr).not.toMatch(/index consulted|exact run/u);
  expect(outcome.status).not.toBe(0);
});

test('the recorded run must belong to this exact release and be green', () => {
  expect(admit(proof, { ...ci, headSha: 'b'.repeat(40) }).status).not.toBe(0);
  expect(admit(proof, { ...ci, databaseId: run + 1 }).status).not.toBe(0);
  expect(admit(proof, { ...ci, conclusion: 'failure' }).status).not.toBe(0);
});

test('legacy qualification can still find green CI without the filtered index', () => {
  expect(admit({ build, stagingQualified: true }, ci, { legacy: true }).status).toBe(0);
});

test('the legacy queue exception views only the approved attempt', () => {
  const qualification = { build, ciJ381: { run, attempt: 2 }, preAliasSmokeV1: {} };
  const report = { ...ci, attempt: 2, conclusion: 'failure',
    jobs: [...ci.jobs.slice(1), { name: 'memory-ledger-guard', conclusion: 'cancelled', steps: [] }] };
  expect(admit(qualification, report, { attempt: '2' }).status).toBe(0);
  expect(admit(qualification, { ...report, attempt: 3 }, { attempt: '2' }).status).not.toBe(0);
});

test('FR6: a release run that reused main\'s proof admits only on the selector\'s release verdict', () => {
  const tests = Array.from({ length: 9 }, (_, i) => ({ name: `tests (${i + 1})`, conclusion: 'success' }));
  const report = { ...ci, jobs: [...tests, { name: 'boundaries', conclusion: 'success' }, { name: 't1-e2e', conclusion: 'skipped' },
    { name: 'memory-client-build', conclusion: 'skipped' }, { name: 'nine-ledger-diagnostic', conclusion: 'skipped' }] };
  const reused = JSON.stringify({ docs: true, reason: 'Release v0.1.37 only stamps its version and notes over 0123456789' });
  expect(admit(proof, report, { reuse: reused }).status).toBe(0);
  // Unproven reuse needs the full shape; a docs verdict about anything but a release is not a reuse.
  expect(admit(proof, report).status).not.toBe(0);
  expect(admit(proof, report, { reuse: JSON.stringify({ docs: false, reason: 'Release v0.1.37' }) }).status).not.toBe(0);
  expect(admit(proof, report, { reuse: JSON.stringify({ docs: true, reason: 'Only hosted CI or Markdown' }) }).status).not.toBe(0);
  // Reuse never excuses a failed job or a short inventory.
  expect(admit(proof, { ...report, jobs: [...report.jobs, { name: 'boundaries', conclusion: 'failure' }] }, { reuse: reused }).status).not.toBe(0);
  expect(admit(proof, { ...report, jobs: report.jobs.slice(1) }, { reuse: reused }).status).not.toBe(0);
});

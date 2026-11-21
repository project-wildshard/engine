// oxlint-disable-next-line import/no-nodejs-modules -- Run the hosted shell admission against a fake Actions API.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the same shell block the npm workflow runs.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/npm-publish.yml', 'utf8');
const step = workflow.slice(workflow.indexOf('      - name: Admit the exact staging release for npm next'));
const command = step.slice(step.indexOf('        run: |\n') + '        run: |\n'.length,
  step.indexOf("          node --input-type=module <<'JS'"));
const build = 'a'.repeat(40);
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const run = 44867215030;
const proof = { build, j475: { releaseCi: run } };
const ci = {
  databaseId: run, headSha: build, headBranch: `release/v${version}`, event: 'push',
  workflowName: 'ci', status: 'completed', conclusion: 'success',
  jobs: Array.from({ length: 12 }, (_, i) => ({ name: `required ${i + 1}`, conclusion: 'success' })),
};

function admit(qualification: unknown, report = ci, { legacy = false, attempt = '' } = {}) {
  const fakeActions = `
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
      LEGACY_GREEN: String(legacy), EXPECTED_ATTEMPT: attempt,
    },
  });
}

test('J475 uses the recorded green run even when the Actions list omits it', () => {
  const outcome = admit(proof);
  expect(outcome.stderr).toContain(`exact run ${run}`);
  expect(outcome.stderr).not.toContain('index consulted');
  expect(outcome.status).toBe(0);
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

// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual pre-checkout admission glue without GitHub.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove each isolated fake-CLI directory.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only owned fixture files.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import workflow from '../.github/workflows/deploy.yml?raw';

const sha = 'a'.repeat(40);
const job = (status: string, conclusion: string | null) => ({
  name: 'prepare', run_id: 123, run_attempt: 2, head_sha: sha, status, conclusion,
});
const inventory = (jobs: unknown[]) => ({ total_count: jobs.length, jobs });

function execute(data: unknown, apiExit = 0, event = 'push', later?: unknown) {
  const section = workflow.split('\n  fixtures:\n')[1]?.split('\n  behaviour:\n')[0];
  const block = section?.split('      - name: Admit optional fixtures for this prepare\n')[1]?.split('\n      - ')[0];
  const code = block?.split('        run: |\n')[1]?.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  if (code === undefined) throw new Error('Missing actual fixture admission');
  const directory = resolve(mkdtempSync('tmp/fixture-admission-'));
  try {
    const bin = resolve(directory, 'bin'), output = resolve(directory, 'output'), summary = resolve(directory, 'summary');
    mkdirSync(bin);
    writeFileSync(resolve(directory, 'response'), JSON.stringify(data));
    if (later !== undefined) writeFileSync(resolve(directory, 'later'), JSON.stringify(later));
    writeFileSync(resolve(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$ADMISSION_CALLS"\nif [ -f "$ADMISSION_LATER" ] && [ "$(grep -c "^api$" "$ADMISSION_CALLS")" -gt 1 ]; then cat "$ADMISSION_LATER"; else cat "$ADMISSION_RESPONSE"; fi\nexit "$ADMISSION_EXIT"\n', { mode: 0o755 });
    const calls = resolve(directory, 'calls');
    const result = spawnSync('bash', ['-e', '-c', code], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        GITHUB_REPOSITORY: 'project-wildshard/engine', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: sha, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, FIXTURE_ADMISSION_WAIT: '0',
        ADMISSION_RESPONSE: resolve(directory, 'response'), ADMISSION_LATER: resolve(directory, 'later'),
        ADMISSION_CALLS: calls, ADMISSION_EXIT: String(apiExit) },
    });
    return { status: result.status, stderr: result.stderr, stdout: result.stdout,
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
      summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
      calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('pending and successful prepares retain the parallel fixture path before checkout', () => {
  for (const status of ['queued', 'pending', 'waiting', 'in_progress', 'completed']) {
    const result = execute(inventory([job(status, status === 'completed' ? 'success' : null)]));
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('run=true\n');
    expect(result.summary).toContain('run 123 attempt 2');
    expect(result.calls).toBe('api\nrepos/project-wildshard/engine/actions/runs/123/attempts/2/jobs?per_page=100\n');
  }
});

test('only an exact terminal failed cancelled or skipped prepare skips optional fixture work', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    const result = execute(inventory([job('completed', conclusion)]));
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('run=false\n');
    expect(result.summary).toContain(`prepare completed/${conclusion}`);
  }
});

test('missing ambiguous foreign truncated and uncertain evidence cannot admit fixture work', () => {
  const valid = job('completed', 'success');
  const invalid = [null, [], {}, inventory([]), inventory([valid, valid]),
    inventory([{ ...valid, run_id: 124 }]), inventory([{ ...valid, run_attempt: 1 }]),
    inventory([{ ...valid, head_sha: 'b'.repeat(40) }]),
    { ...inventory([valid]), total_count: 101 }, inventory([null]),
    inventory([job('completed', null)]), inventory([job('completed', 'neutral')]),
    inventory([job('in_progress', 'failure')]), inventory([job('foreign', null)])];
  for (const data of invalid) {
    const result = execute(data);
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
    expect(result.stderr).toContain('Optional fixture admission unavailable');
  }
});

test('a prepare that has not settled yet is read again before it can refuse the run', () => {
  const result = execute(inventory([{ name: 'fixtures' }]), 0, 'push', inventory([job('pending', null)]));
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toBe('run=true\n');
  expect(result.calls.split('\n').filter(line => line === 'api')).toHaveLength(2);
  const absent = execute(inventory([{ name: 'fixtures' }]));
  expect(absent.status).not.toBe(0);
  expect(absent.output).toBe('');
  expect(absent.calls.split('\n').filter(line => line === 'api')).toHaveLength(4);
  expect(absent.stderr).toContain('ValueError: Ambiguous prepare identity');
});

test('unavailable API evidence fails closed after one read without polling or exposing its body', () => {
  const result = execute({ private: 'untrusted response' }, 1);
  expect(result.status).not.toBe(0);
  expect(result.output).toBe('');
  expect(result.calls.split('\n').filter(line => line === 'api')).toHaveLength(1);
  expect(result.stdout + result.stderr).not.toContain('untrusted response');
});

test('pull requests keep their merge-checkout fixture path without querying head-SHA jobs', () => {
  const result = execute(null, 1, 'pull_request');
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toBe('run=true\n');
  expect(result.calls).toBe('');
  const unsupported = execute(null, 0, 'workflow_dispatch');
  expect(unsupported.status).not.toBe(0);
  expect(unsupported.calls).toBe('');
  expect(unsupported.output).toBe('');
});

test('admission precedes optional work while behavior requires native publication and keeps snapshot fallback', () => {
  const fixtures = workflow.split('\n  fixtures:\n')[1]?.split('\n  behaviour:\n')[0];
  if (fixtures === undefined) throw new Error('Missing fixtures job');
  const steps = fixtures.split('\n      - ').slice(1);
  expect(steps[0]).toContain('name: Admit optional fixtures for this prepare');
  expect(steps[0]).not.toContain('actions/checkout');
  for (const step of steps.slice(1)) expect(step).toContain("if: steps.admission.outputs.run == 'true'");
  const behavior = workflow.split('\n  behaviour:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  expect(behavior).toContain('needs: [prepare, fixtures]');
  const admission = /^ {4}if: (.+)$/mu.exec(behavior ?? '')?.[1];
  expect(admission).toContain("needs.prepare.result == 'success'");
  expect(admission).toContain("needs.fixtures.result == 'success'");
  expect(behavior).toContain('continue-on-error: true');
  const behaviorSteps = behavior?.split('\n      - ').slice(1) ?? [];
  const nativeDownload = behaviorSteps.find(step => step.includes('\n          name: native-fixtures\n'));
  const nativeRestore = behaviorSteps.find(step => step.startsWith('name: Restore source-host native constructor inputs\n'));
  expect(nativeDownload).toBeDefined();
  expect(nativeRestore).toContain('scripts/ci-native-fixtures.mjs restore');
  for (const step of [nativeDownload, nativeRestore]) {
    expect(step).not.toContain('continue-on-error: true');
    expect(step).not.toMatch(/\n {8}if:/u);
  }
  const snapshots = behaviorSteps.find(step => /\n {10}name: test-fixtures(?:\n|$)/u.test(step));
  expect(snapshots).toContain('continue-on-error: true');
  const restoreSnapshots = behaviorSteps.find(step => step.startsWith('name: Restore exact-run fixture snapshots\n'));
  expect(restoreSnapshots).toContain('shards compute them');
  expect(restoreSnapshots).toContain('rm -f tmp/ci-fixtures/*.v8');
});

// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the committed workflows and build step.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { budgetTable, judgeAll, runCli } from '../scripts/budgets/cli.mjs';
import { readCaps } from '../scripts/budgets/files.mjs';
import { budgetReport, budgetResultLine, parseBudgetResults } from '../scripts/budgets/watch.mjs';
import { checkShardSizes } from '../scripts/shard-size-gate.mjs';

// BUDGET-CAPS BC9 (J444): a regression is never a red main or a release hold. ci (and the release train's green-main
// read of it) checks hard caps only; the 10% check runs in budgets.yml after ci; main-watch names the pusher.
const caps = readCaps();
const baselines = { schema: 1, about: '', baselines: { 'download/phone/driftwood-isle': { value: 22_218_404, contentKey: 'driftwood-isle@5' } } };
const keys = { 'driftwood-isle': 'driftwood-isle@5' };

test('the release gate\'s inputs: a regressed download passes qualification, an over-hard one refuses it', () => {
  const regressed = checkShardSizes({ caps, baselines }, { 'driftwood-isle': 25_000_000 }, { contentKeys: keys, hardOnly: true });
  expect(regressed.rows[0]?.status).toBe('regressed');
  expect(regressed.errors).toEqual([]);
  const over = checkShardSizes({ caps, baselines }, { 'driftwood-isle': 101_000_000 }, { contentKeys: keys, hardOnly: true });
  expect(over.errors[0]).toContain('hard cap');
});

test('ci holds no regression check; every build runs its gates hard-only; budgets.yml follows ci and judges', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8'), budgets = readFileSync('.github/workflows/budgets.yml', 'utf8');
  expect(ci).not.toMatch(/\n {2}memory-ledger-guard:\n/u);
  expect(ci).not.toContain('scripts/budgets/cli.mjs check');
  expect(budgets).toMatch(/workflow_run:\n {4}workflows: \[ci\]/u);
  expect(budgets).toContain('name: memory-pinned-client');
  expect(budgets).toContain('node scripts/budgets/cli.mjs check tmp/budgets/measures.json');
  expect(readFileSync('scripts/app-build-pipeline.mjs', 'utf8')).toMatch(/"scripts\/shard-size-gate\.mjs",\n\s+outDir,\n(?:\s*\/\/.*\n)?\s+"--hard-only",/u);
  expect(readFileSync('scripts/app-build/chunkReport.mjs', 'utf8')).toContain('hardOnly: true');
});

test('a failing check prints one result line a row, which main-watch parses and turns into a fix row for the pusher', () => {
  const rows = judgeAll(caps, baselines, { measures: { 'download/phone/driftwood-isle': { value: 25_000_000, contentKey: 'driftwood-isle@5' } } });
  expect(budgetTable(rows)).toContain('REGRESSED');
  const line = budgetResultLine(rows[0] ?? { key: '', status: '', value: null, baseline: null, line: null, hard: null, contentKey: '' });
  expect(line).toBe('BUDGET regressed key=download/phone/driftwood-isle measured=25000000 baseline=22218404 line=24440245 contentKey=driftwood-isle@5');
  const results = parseBudgetResults(`::error title=Budget regressed::${line}\n${line}`);
  expect(results).toEqual([{ key: 'download/phone/driftwood-isle', kind: 'regressed', measured: 25_000_000, baseline: 22_218_404, line: 24_440_245, contentKey: 'driftwood-isle@5' }]);
  const run = { id: 7, head_sha: 'a'.repeat(40), created_at: '2026-11-19T06:00:00Z', conclusion: 'failure' };
  const report = budgetReport(run, results, ['opus-caps']);
  expect(report.lines).toEqual(['main BUDGET regressed aaaaaaaaaa download/phone/driftwood-isle 25000000 B, line 24440245 B (run 7; J444: a fix row for opus-caps, never a red main)']);
  expect(report.qa).toMatchObject({ id: 7, pusher: 'opus-caps', results });
  expect(budgetReport({ ...run, conclusion: 'success' }, results, ['opus-caps'])).toEqual({ lines: [], qa: null });
});

test('in Actions the check prints an error annotation only for a failing row, never a warning', () => {
  const lines: string[] = [];
  const dir = 'test/fixtures/budgets-release-path';
  expect(runCli(['check', `${dir}/measures.json`], { root: dir, env: { GITHUB_ACTIONS: 'true' }, out: line => { lines.push(line); }, err: () => undefined })).toBe(1);
  const text = lines.join('\n');
  expect(text).not.toContain('::warning');
  expect(text.match(/::error title=Budget regressed::BUDGET regressed key=download\/phone\/a /gu)).toHaveLength(1);
  expect(text).not.toContain('key=download/phone/b');
});

// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the committed workflows and build step.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { budgetTable, judgeAll, runCli } from '../scripts/budgets/cli.mjs';
import { readCaps } from '../scripts/budgets/files.mjs';
import { budgetReport, budgetResultLine, budgetSourceRun, confirmBudgetResults, parseBudgetResults } from '../scripts/budgets/watch.mjs';
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

// BC15: a workflow_run's head_sha is the default branch's tip when it starts, not the commit it measured (run 44475200178
// named 890b4833e2 and blamed its landers for a regression from f97bbeb..f31a7d3f5). The run name carries the ci run.
test('a budgets run names the ci run it measured, so main-watch blames the measured commit', () => {
  expect(readFileSync('.github/workflows/budgets.yml', 'utf8')).toContain('run-name: budgets for ci ${{ inputs.source_run || github.event.workflow_run.id }}');
  expect(budgetSourceRun({ display_title: 'budgets for ci 44473130939' })).toBe(44_473_130_939);
  expect(budgetSourceRun({ display_title: 'budgets' })).toBeNull();
  expect(budgetSourceRun({})).toBeNull();
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

// MD9: soft readings need two consecutive runs measuring distinct commits.
test('single Ink Cel and Nalati readings stay quiet; two distinct-SHA misses confirm', () => {
  const ink = parseBudgetResults('BUDGET regressed key=ledger/made-up-valley/control measured=41767511 baseline=34715334 line=38186867 contentKey=ink@7');
  const nalati = parseBudgetResults('BUDGET regressed key=render/phone-low/draws/nalati-grasslands measured=191 baseline=79 line=87 contentKey=nalati@2');
  const first = confirmBudgetResults({ head_sha: '29e750d3a1' }, ink);
  expect(first.confirmed).toEqual([]); expect(first.quiet).toEqual(ink);
  expect(confirmBudgetResults({ head_sha: '29e750d3a1' }, ink, first.pending).confirmed).toEqual([]);
  expect(confirmBudgetResults({ head_sha: 'f8873a32a5' }, ink, first.pending).confirmed).toEqual(ink);
  const singleNalati = confirmBudgetResults({ head_sha: 'd7478463e5' }, nalati, first.pending);
  expect(singleNalati.confirmed).toEqual([]);
  expect(confirmBudgetResults({ head_sha: 'next' }, ink, singleNalati.pending).confirmed).toEqual([]);
  const green = confirmBudgetResults({ head_sha: 'green' }, [], first.pending);
  expect(confirmBudgetResults({ head_sha: 'next' }, ink, green.pending).confirmed).toEqual([]);
  expect(confirmBudgetResults({ head_sha: 'next' }, ink.map(row => ({ ...row, contentKey: 'ink@8' })), first.pending).confirmed).toEqual([]);
  expect(confirmBudgetResults({ head_sha: 'next' }, ink.map(row => ({ ...row, line: 50_000_000 })), first.pending).confirmed).toEqual([]);
  const hard = ink.map(row => ({ ...row, kind: 'over-hard' as const }));
  expect(confirmBudgetResults({ head_sha: 'first' }, hard).confirmed).toEqual(hard);
});

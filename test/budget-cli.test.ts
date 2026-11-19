// oxlint-disable-next-line import/no-nodejs-modules -- The command reads and writes its two files in a fixture root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture root sits in the OS temp folder and is removed.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { runCli } from '../scripts/budgets/cli.mjs';
import type { BudgetBaselines } from '../scripts/budgets/files.mjs';

// BUDGET-CAPS BC3: check, record and declare on fixture files.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(measures: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'budget-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'budgets'));
  writeFileSync(join(root, 'budgets/caps.json'), JSON.stringify({ schema: 1, about: 'a', caps: {
    'download/phone/*': { hard: 100, unit: 'bytes', kind: 'exact', decision: 'J338', why: 'w' },
    'ledger/*': { hard: null, unit: 'bytes', kind: 'noisy', floor: 5, decision: null, why: 'w' },
  } }));
  writeFileSync(join(root, 'budgets/baselines.json'), JSON.stringify({ schema: 1, about: 'a', baselines: {
    'download/phone/a': { value: 50, contentKey: 'a@1', commit: 'c0' },
    'ledger/a/peak': { value: 40, contentKey: 'a@1', commit: 'c0' },
  } }));
  writeFileSync(join(root, 'measures.json'), JSON.stringify(measures));
  const lines: string[] = [], errors: string[] = [], summary = join(root, 'summary.md');
  const run = (...argv: string[]) => runCli(argv.map(arg => arg === 'M' ? join(root, 'measures.json') : arg), { root, env: { GITHUB_STEP_SUMMARY: summary }, out: line => { lines.push(line); }, err: line => { errors.push(line); } });
  const baselines = (): BudgetBaselines['baselines'] => (JSON.parse(readFileSync(join(root, 'budgets/baselines.json'), 'utf8')) as BudgetBaselines).baselines;
  return { run, lines, errors, summary, baselines, root };
}

test('check exits 0 on ok and raised, and prints one table line a budget with no ::warning', () => {
  const f = fixture({ measures: { 'download/phone/a': { value: 54, contentKey: 'a@1' }, 'download/phone/b': { value: 90, contentKey: 'b@1' }, 'ledger/a/peak': { reads: [41, 60, 42], contentKey: 'a@1' } } });
  expect(f.run('check', 'M')).toBe(0);
  const table = f.lines.join('\n');
  expect(table.split('\n').filter(line => line.startsWith('| download/') || line.startsWith('| ledger/'))).toHaveLength(3);
  expect(table).toContain('raised');
  expect(table).not.toContain('::warning');
  expect(readFileSync(f.summary, 'utf8')).toContain('| download/phone/a | ok |');
});

test('check exits 1 on regressed and on over-hard; --hard-only exits 0 on regressed and 1 on over-hard', () => {
  const regressed = fixture({ measures: { 'download/phone/a': { value: 55, contentKey: 'a@1' } } });
  expect(regressed.run('check', 'M')).toBe(1);
  expect(regressed.lines.join('\n')).toContain('REGRESSED');
  expect(regressed.run('check', 'M', '--hard-only')).toBe(0);
  const over = fixture({ measures: { 'download/phone/a': { value: 101, contentKey: 'a@2' } } });
  expect(over.run('check', 'M')).toBe(1);
  expect(over.run('check', 'M', '--hard-only')).toBe(1);
  expect(over.lines.join('\n')).toContain('OVER HARD');
});

test('a measure with no cap entry fails the check', () => {
  const f = fixture({ measures: { 'nowhere/x': { value: 1, contentKey: 'k' } } });
  expect(f.run('check', 'M', '--hard-only')).toBe(1);
});

test('record writes the baselines with their content keys and clears declared; it refuses a value over the hard cap', () => {
  const f = fixture({ commit: 'c1', measures: { 'download/phone/a': { value: 70, contentKey: 'a@2' }, 'ledger/a/peak': { reads: [44, 43, 90], contentKey: 'a@2' } } });
  expect(f.run('declare', 'download/phone/a', '--why', 'audio set moves to download')).toBe(0);
  expect(f.baselines()['download/phone/a']?.declared).toBe('audio set moves to download');
  expect(f.run('record', 'M')).toBe(0);
  expect(f.baselines()['download/phone/a']).toEqual({ value: 70, contentKey: 'a@2', commit: 'c1' });
  expect(f.baselines()['ledger/a/peak']).toEqual({ value: 44, contentKey: 'a@2', commit: 'c1' });
  expect(f.run('check', 'M')).toBe(0);
  const over = fixture({ measures: { 'download/phone/a': { value: 101, contentKey: 'a@2' } } });
  expect(over.run('record', 'M')).toBe(1);
  expect(over.errors[0]).toContain('hard cap');
  expect(over.baselines()['download/phone/a']?.value).toBe(50);
});

test('declare needs a reason, and a declared key is judged as new content', () => {
  const f = fixture({ measures: { 'download/phone/a': { value: 80, contentKey: 'a@1' } } });
  expect(f.run('declare', 'download/phone/a')).toBe(1);
  expect(f.run('check', 'M')).toBe(1);
  expect(f.run('declare', 'download/phone/a', '--why', 'a feature')).toBe(0);
  expect(f.run('check', 'M')).toBe(0);
});

test('BC10: record --run writes the baselines from a saved budgets artifact; a second check on the same readings is ok', () => {
  const f = fixture({ measures: {} });
  const saved = readFileSync('test/fixtures/budgets-run/budgets/measures.json', 'utf8');
  const download = (run: string, directory: string): void => {
    expect(run).toBe('44470000001');
    mkdirSync(join(directory, 'budgets'));
    writeFileSync(join(directory, 'budgets/measures.json'), saved);
  };
  const root = f.root;
  expect(runCli(['record', '--run', '44470000001'], { root, env: {}, out: () => undefined, err: () => undefined, download })).toBe(0);
  expect(f.baselines()['download/phone/driftwood-isle']).toEqual({ value: 70, contentKey: 'driftwood-isle@6', commit: 'abcdef1234' });
  expect(f.baselines()['ledger/driftwood-isle/peak']).toEqual({ value: 44, contentKey: 'driftwood-isle@6', commit: 'abcdef1234', detail: { audio: 30 } });
  expect(f.baselines()['download/phone/a']?.value).toBe(50);
  writeFileSync(join(root, 'measures.json'), saved);
  expect(f.run('check', 'M')).toBe(0);
  expect(runCli(['record', '--run', 'nope'], { root, env: {}, out: () => undefined, err: () => undefined, download })).toBe(2);
});

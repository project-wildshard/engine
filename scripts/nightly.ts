#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {browsers, groups, markdown, partition, plan, read, requireGreen, verdict, type Receipt, type TestsReport, type Verdict} from './nightly-model.ts';

interface VitestResult {numTotalTests?: number; testResults?: {name: string; status: string; assertionResults?: {status: string}[]}[]}

const [command, directory = 'tmp/nightly/reports', baseline] = process.argv.slice(2);
const expected = plan(), out = resolve(directory);
const write = (name: string, value: unknown) => {mkdirSync(out, {recursive: true}); writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);};
if (command === 'plan') {
  console.log(JSON.stringify({include: browsers.flatMap(browser => Array.from({length: groups}, (_, group) => ({browser, group,
    os: browser === 'webkit' ? 'macos-15' : 'ubuntu-24.04', heads: partition(expected.heads, group).map(row => row.slug).join(',')})))}));
} else if (command === 'tests') {
  mkdirSync(out, {recursive: true});
  const json = join(out, 'vitest.json');
  const kit = spawnSync('pnpm', ['test:kit'], {stdio: 'inherit', timeout: 120000});
  // Run the entire admitted suite once, including every slow Ring 2 entry.
  const child = spawnSync('python3', ['scripts/heavy-lane.py', 'full-test', '--', process.execPath, 'scripts/vitest-tmp.ts', 'run',
    '--maxWorkers=2', '--reporter=default', '--reporter=json', `--outputFile.json=${json}`],
  {stdio: 'inherit', timeout: 1500000, env: {...process.env, WS_FULL_SUITE: '1', WILDSHARD_RING: '2'}});
  const raw: VitestResult = existsSync(json) ? (read(json) as VitestResult) : {};
  const files = (raw.testResults ?? []).map(file => ({path: relative(process.cwd(), file.name).replaceAll('\\', '/'),
    ok: file.status === 'passed' && file.assertionResults?.every(row => row.status === 'passed') === true,
    assertions: file.assertionResults?.length ?? 0}));
  const report: TestsReport = {...expected, kind: 'tests', exitCode: child.status ?? 1, kitExitCode: kit.status ?? 1, totalTests: raw.numTotalTests ?? 0, files};
  write('tests.json', report);
  if (report.exitCode !== 0 || report.kitExitCode !== 0 || expected.tests.some(path => !files.some(row => row.path === path && row.ok && row.assertions > 0))) process.exitCode = 1;
} else if (command === 'report') {
  mkdirSync(out, {recursive: true});
  const receipts = readdirSync(out).filter(name => /^(heads-|tests\.)/u.test(name) && name.endsWith('.json')).map(name => (read(join(out, name)) as Receipt));
  const report = {...verdict(expected, receipts, baseline !== undefined && existsSync(baseline) ? (read(baseline) as Verdict) : undefined), run: process.env.GITHUB_RUN_ID ?? null};
  write('verdict.json', report);
  writeFileSync(join(out, 'summary.md'), markdown(report));
  console.log(markdown(report));
  if (!report.ok) process.exitCode = 1;
} else if (command === 'guard') {
  requireGreen(read(directory) as Verdict, expected);
  console.log(`J167: exact-SHA nightly green for ${expected.sha}`);
} else throw new Error('Use nightly.mjs plan|tests|report|guard [report directory/file] [previous verdict]');

#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {browsers, headGroups, headRunner, markdown, parallelTestGroups, plan, read, requirePublishedGreen, testGroups, verdict, type Receipt, type TestsReport, type Verdict} from './nightly-model.ts';

interface VitestResult {numTotalTests?: number; testResults?: {name: string; status: string; assertionResults?: {status: string}[]}[]}

const [command, directory = 'tmp/nightly/reports', baseline] = process.argv.slice(2);
const expected = plan(), out = resolve(directory);
const write = (name: string, value: unknown) => {mkdirSync(out, {recursive: true}); writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);};
if (command === 'plan') {
  console.log(JSON.stringify({include: browsers.flatMap(browser => headGroups(expected.heads, browser).map((heads, group) => ({browser, group,
    os: headRunner(browser, heads), heads: heads.map(row => row.slug).join(',')})))}));
} else if (command === 'test-plan') {
  console.log(JSON.stringify({group: Array.from({length: testGroups}, (_, index) => index)}));
} else if (command === 'tests') {
  const group = Number(process.env.NIGHTLY_TEST_GROUP ?? '-1');
  if (!Number.isInteger(group) || group < 0 || group >= testGroups) throw new Error(`Set NIGHTLY_TEST_GROUP to a zero-based index below ${testGroups}; the verdict requires every suite partition`);
  mkdirSync(out, {recursive: true});
  const json = join(out, `vitest-${group}.json`);
  rmSync(json, {force: true});
  rmSync(join(out, `tests-${group}.json`), {force: true});
  const kit = spawnSync('pnpm', ['test:kit'], {stdio: 'inherit', timeout: 120000});
  // The jobs cover the entire admitted suite once, including every slow
  // Ring 2 entry. Keep each job's existing 25-minute process limit.
  const serial = group === parallelTestGroups;
  const selection = serial ? ['--maxWorkers=1'] : ['--maxWorkers=2', `--shard=${group + 1}/${parallelTestGroups}`];
  const child = spawnSync('python3', ['src/scripts/heavy-lane.py', 'full-test', '--', process.execPath, 'src/scripts/vitest-tmp.ts', 'run',
    ...selection, '--reporter=default', '--reporter=json', `--outputFile.json=${json}`],
  {stdio: 'inherit', timeout: 1500000, env: {...process.env, WS_FULL_SUITE: '1', WILDSHARD_RING: '2',
    WS_NIGHTLY_TEST_PHASE: serial ? 'serial' : 'parallel'}});
  const interruptions: string[] = [];
  for (const [name, processResult] of [['Vitest', child], ['kit', kit]] as const) {
    const reason = processResult.error?.message ?? processResult.signal;
    if (reason !== null) interruptions.push(`${name}: ${reason}`);
  }
  let raw: VitestResult = {};
  if (existsSync(json)) {
    try {raw = read(json) as VitestResult;}
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      interruptions.push('Vitest: unreadable JSON report');
    }
  }
  const files = (raw.testResults ?? []).map(file => ({path: relative(process.cwd(), file.name).replaceAll('\\', '/'),
    ok: file.status !== 'failed' && file.assertionResults?.every(row => row.status !== 'failed') === true,
    assertions: file.assertionResults?.filter(row => row.status === 'passed').length ?? 0,
    skipped: file.assertionResults?.filter(row => row.status !== 'passed' && row.status !== 'failed').length ?? 0}));
  const report: TestsReport = {...expected, kind: 'tests', group, groups: testGroups, exitCode: child.status ?? 1,
    kitExitCode: kit.status ?? 1, totalTests: raw.numTotalTests ?? 0, files, ...(interruptions.length === 0 ? {} : {interruptions})};
  write(`tests-${group}.json`, report);
  // Listed journeys in all partitions are checked together by report;
  // a partition must still fail for any ordinary or listed test failure.
  if (report.exitCode !== 0 || report.kitExitCode !== 0 || report.totalTests < 1 || files.some(file => !file.ok)) process.exitCode = 1;
} else if (command === 'report') {
  mkdirSync(out, {recursive: true});
  const receipts = readdirSync(out).filter(name => /^(heads-|tests[-.])/u.test(name) && name.endsWith('.json')).map(name => (read(join(out, name)) as Receipt));
  const jobs = {plan: process.env.NIGHTLY_PLAN_RESULT, tests: process.env.NIGHTLY_TESTS_RESULT, heads: process.env.NIGHTLY_HEADS_RESULT};
  const report = {...verdict(expected, receipts, baseline !== undefined && existsSync(baseline) ? (read(baseline) as Verdict) : undefined, jobs), run: process.env.GITHUB_RUN_ID ?? null};
  write('verdict.json', report);
  writeFileSync(join(out, 'summary.md'), markdown(report));
  console.log(markdown(report));
  if (!report.ok) process.exitCode = 1;
} else if (command === 'guard') {
  requirePublishedGreen(read(directory) as Verdict, expected);
  console.log(`J167: exact-SHA nightly green for ${expected.sha}`);
} else throw new Error('Use nightly.ts plan|test-plan|tests|report|guard [report directory/file] [previous verdict]');

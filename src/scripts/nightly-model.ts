// Ring 2 receipts fail closed: a green process is insufficient without every witness.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {NIGHTLY_SERIAL_TESTS} from './vitest-ci-files.ts';

export interface Head {slug: string; hash: string}
export interface Plan {version: number; sha: string; pins: string; testList: string; heads: Head[]; tests: string[]}
export interface Phase {name: string; ok: boolean; error?: string; ms?: number; detail?: unknown}
export interface HeadResult extends Head {phases: Phase[]}
export interface HeadsReport extends Plan {kind: 'heads'; browser: string; group: number; results: HeadResult[]}
export interface TestFile {path: string; ok: boolean; assertions: number; skipped: number}
export interface TestsReport extends Plan {kind: 'tests'; group: number; groups: number; exitCode: number; kitExitCode: number; totalTests: number; files: TestFile[]; interruptions?: string[]}
export type Receipt = HeadsReport | TestsReport;
export interface Failure {key: string; error: string}
export interface Row extends Head {browser: string; phase: string; ok: boolean; error?: string}
export interface Verdict {version: number; sha: string; pins: string; testList: string; ok: boolean; tag: string; rows: Row[]; failures: Failure[];
  tests: {group: number; ok: boolean; files: number; assertions: number}[];
  run?: string | null; baseline: {sha: string; run: string | null} | null; newFailures: string[]; resolved: string[]}
export const browsers = ['chromium', 'webkit'] as const;
export type NightlyBrowser = typeof browsers[number];
export const phases = ['cook', 'boot', 'hover', 'draw', 'explorer'];
const sharedGroups = 4;
const metalHeads: ReadonlySet<string> = new Set(['nalati-grasslands', 'nine-dragon-stack', 'pine-hollow']);
export const parallelTestGroups = 3;
export const testGroups = parallelTestGroups + 1;
const serialTests: ReadonlySet<string> = new Set(NIGHTLY_SERIAL_TESTS);
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export function plan(root = process.cwd()): Plan {
  const {shards} = read(`${root}/test/pins/shardfiles.json`) as {shards: Head[]};
  const tests = read(`${root}/test/pins/ring-2-tests.json`) as string[];
  // Every pinned head, none twice. The count follows the pins file: a hard 28 turned every night red for days after
  // `8f613824` dropped open-plot-showcase-template (27 heads, 2026-11-13).
  if (shards.length === 0 || new Set(shards.map(row => row.slug)).size !== shards.length) throw new Error('Ring 2 requires distinct pinned heads');
  if (shards.some(row => !/^[a-z0-9-]+$/u.test(row.slug) || !/^[a-f0-9]{64}$/u.test(row.hash))) throw new Error('Unsafe pinned head');
  if (tests.length === 0 || new Set(tests).size !== tests.length) throw new Error('Empty or duplicate Ring 2 list');
  const heads = [...shards].sort((a, b) => a.slug.localeCompare(b.slug));
  return {version: 2, sha: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    pins: digest(shards), testList: digest(tests), heads, tests};
}

export function headGroups(heads: Head[], browser: NightlyBrowser): Head[][] {
  // Pine's cold cook needs its own Chromium job even on Metal. Nine and
  // Nalati share the other Metal job. The phone interactions and frame
  // witnesses retain their usual limits on both runners.
  const pine = browser === 'chromium' ? heads.find(head => head.slug === 'pine-hollow') : undefined;
  const metal = browser === 'chromium' ? heads.filter(head => head !== pine && metalHeads.has(head.slug)) : [];
  const shared = Array.from({length: sharedGroups}, (_, group) =>
    heads.filter((head, index) => head !== pine && !metal.includes(head) && index % sharedGroups === group));
  return [...(pine === undefined ? [] : [[pine]]), ...(metal.length === 0 ? [] : [metal]), ...shared];
}

export function headRunner(browser: NightlyBrowser, heads: readonly Head[]): 'macos-15' | 'ubuntu-24.04' {
  return browser === 'webkit' || heads.some(head => metalHeads.has(head.slug)) ? 'macos-15' : 'ubuntu-24.04';
}

export function requireBuild(build: string, expected: Plan): void {
  const sha = /^([a-f0-9]{7,40})-[a-z0-9]+$/u.exec(build)?.[1];
  if (sha === undefined || !expected.sha.startsWith(sha)) throw new Error('Nightly build is stale: rebuild this exact checkout before proving');
}

export function verdict(expected: Plan, reports: Receipt[], previous?: Verdict, jobs: Record<string, string | undefined> = {}): Verdict {
  const failures: Failure[] = [], rows: Row[] = [];
  // An unidentifiable artifact must hold qualification even if other artifacts
  // provide every expected witness. Filtering it out would silently bless trash.
  for (const [index, report] of reports.entries()) {
    if (report === null || typeof report !== 'object' || !['heads', 'tests'].includes(report.kind) ||
      report.version !== expected.version || report.sha !== expected.sha || report.pins !== expected.pins || report.testList !== expected.testList) {
      failures.push({key: `receipt/identity/${index}`, error: 'Nightly receipt requires its ring kind, exact source SHA, version, pins and test list'});
    }
  }
  const usableReports = reports.filter(report => report !== null && typeof report === 'object');
  for (const [job, result] of Object.entries(jobs)) if (result !== undefined && result !== 'success') failures.push({key: `runner/${job}`, error: `Actions job ${result}; a red nightly holds the tag even with complete phase receipts`});
  for (const browser of browsers) for (const head of expected.heads) {
    const matches = usableReports.filter((report): report is HeadsReport => report.version === expected.version && report.kind === 'heads' && report.browser === browser &&
      report.sha === expected.sha && report.pins === expected.pins && report.testList === expected.testList)
      .flatMap(report => report.results ?? []).filter(row => row.slug === head.slug && row.hash === head.hash);
    for (const phase of phases) {
      const witnesses = matches.flatMap(row => row.phases ?? []).filter(row => row.name === phase);
      const [only] = witnesses, ok = witnesses.length === 1 && only !== undefined && only.ok;
      const key = `${browser}/${head.slug}@${head.hash}/${phase}`;
      const error = witnesses.length === 1 ? only?.error ?? 'phase did not pass' : `Expected one receipt, got ${witnesses.length}`;
      rows.push({browser, slug: head.slug, hash: head.hash, phase, ok, ...(ok ? {} : {error})});
      if (!ok) failures.push({key, error});
    }
  }
  const suites = usableReports.filter((row): row is TestsReport => row.version === expected.version && row.kind === 'tests' && row.sha === expected.sha && row.pins === expected.pins && row.testList === expected.testList);
  if (suites.length !== testGroups || suites.some(suite => suite.groups !== testGroups || !Number.isInteger(suite.group) || suite.group < 0 || suite.group >= testGroups)) failures.push({key: 'shared/tests', error: `Expected exactly ${testGroups} suite partitions, got ${suites.length}`});
  const tests: Verdict['tests'] = [];
  for (let group = 0; group < testGroups; group++) {
    const matching = suites.filter(suite => suite.group === group), suite = matching[0];
    const assertions = suite?.files.reduce((sum, file) => sum + file.assertions, 0) ?? 0;
    let error: string | undefined;
    if (matching.length !== 1 || suite === undefined) error = `Incomplete suite: expected one partition receipt, got ${matching.length}`;
    else if (suite.groups !== testGroups) error = `Incomplete suite: expected ${testGroups} partitions, got ${suite.groups}`;
    else if (suite.interruptions?.length) error = `Incomplete suite: ${suite.interruptions.join(', ')}`;
    else if (suite.kitExitCode !== 0 || suite.files.some(file => !file.ok)) error = `Suite failed: Vitest exit ${suite.exitCode}, kit exit ${suite.kitExitCode}`;
    else if (suite.totalTests < 1 || suite.files.length === 0 || assertions < 1) error = `Incomplete suite: no executable test evidence (Vitest exit ${suite.exitCode}, ${suite.totalTests} tests, ${assertions} passing assertions)`;
    else if (group === parallelTestGroups && (suite.files.length !== serialTests.size || suite.files.some(file => !serialTests.has(file.path)))) error = 'Incomplete suite: serial partition inventory differs';
    else if (group < parallelTestGroups && suite.files.some(file => serialTests.has(file.path))) error = 'Incomplete suite: a serial file ran in a parallel partition';
    else if (suite.exitCode !== 0) error = `Suite failed: Vitest exit ${suite.exitCode}`;
    tests.push({group, ok: error === undefined, files: suite?.files.length ?? 0, assertions});
    if (error !== undefined) failures.push({key: `shared/tests/${group}`, error});
  }
  const files = suites.flatMap(suite => suite.files);
  if (new Set(files.map(file => file.path)).size !== files.length) failures.push({key: 'shared/tests/duplicates', error: 'A test file appeared in more than one suite partition'});
  if (suites.length > 0) {
    for (const path of expected.tests) {
      const executions = files.filter(row => row.path === path);
      const [run] = executions;
      let error: string | undefined;
      if (executions.length !== 1 || run === undefined) error = `Incomplete suite: expected one listed test receipt, got ${executions.length}`;
      else if (!run.ok) error = 'Listed test failed';
      else if (run.skipped !== 0) error = `Incomplete suite: Listed test skipped ${run.skipped} assertions`;
      else if (run.assertions < 1) error = 'Incomplete suite: No passing assertions for listed test';
      if (error !== undefined) failures.push({key: `shared/${path}`, error});
    }
    for (const file of files.filter(row => !row.ok)) {
      if (!failures.some(row => row.key === `shared/${file.path}`)) failures.push({key: `shared/${file.path}`, error: 'Suite failure outside the slow-test list'});
    }
  }
  const baseline = (previous?.version === 1 || previous?.version === 2) && Array.isArray(previous.failures) ? previous : undefined;
  const old = new Set(baseline?.failures.map(row => row.key)), current = new Set(failures.map(row => row.key));
  return {version: expected.version, sha: expected.sha, pins: expected.pins, testList: expected.testList,
    ok: failures.length === 0, tag: failures.length === 0 ? 'eligible' : 'HOLD', rows, tests, failures,
    baseline: baseline === undefined ? null : {sha: baseline.sha, run: baseline.run ?? null},
    newFailures: failures.filter(row => !old.has(row.key)).map(row => row.key),
    resolved: [...old].filter(key => !current.has(key))};
}

export function markdown(report: Verdict): string {
  const lines = [`# Ring 2: ${report.ok ? 'GREEN' : 'RED — TAG HOLD (J167)'}`, '',
    `Commit: \`${report.sha}\``, `Pins: \`${report.pins}\``, `Ring 2 list: \`${report.testList}\``, '',
    report.baseline === null ? 'No prior nightly verdict available; all current failures are shown as new.' : `Compared with ${report.baseline.sha}.`, '',
    'Hosted draw census is report-only (J169); this is not a real-GPU performance qualification.', '',
    '| Head | Browser | Cook | Boot | Hover | Draw witness | Explorer |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const browser of browsers) for (const slug of new Set(report.rows.filter(row => row.browser === browser).map(row => row.slug))) {
    const rows = report.rows.filter(row => row.browser === browser && row.slug === slug);
    lines.push(`| ${slug} @ ${rows[0]?.hash.slice(0, 12)} | ${browser} | ${phases.map(phase => rows.find(row => row.phase === phase)?.ok ? 'pass' : '**RED**').join(' | ')} |`);
  }
  lines.push('', '## Shared suite', '', '| Partition | Files | Passing assertions | Verdict |', '| --- | --- | --- | --- |',
    ...report.tests.map(suite => `| ${suite.group + 1}/${testGroups} | ${suite.files} | ${suite.assertions} | ${suite.ok ? 'pass' : '**RED**'} |`));
  lines.push('', '## Failures', '');
  if (report.failures.length === 0) lines.push('None.');
  for (const failure of report.failures) lines.push(`- ${report.newFailures.includes(failure.key) ? 'NEW' : 'existing'} \`${failure.key}\`: ${failure.error.replaceAll(/[\r\n|<>]/gu, ' ').slice(0, 1500)}`);
  if (report.resolved.length > 0) lines.push('', 'Resolved:', ...report.resolved.map(key => `- \`${key}\``));
  return `${lines.join('\n')}\n`;
}

export function requireGreen(report: Verdict, expected: Plan): void {
  const keys = expected.heads.flatMap(head => browsers.flatMap(browser => phases.map(phase => `${browser}/${head.slug}@${head.hash}/${phase}`)));
  const actual = report.rows?.map(row => `${row.browser}/${row.slug}@${row.hash}/${row.phase}`) ?? [];
  const suites = report.tests ?? [];
  if (report.version !== expected.version || !report.ok || report.tag !== 'eligible' || report.sha !== expected.sha || report.pins !== expected.pins || report.testList !== expected.testList ||
    !Array.isArray(report.failures) || report.failures.length > 0 || actual.length !== keys.length || new Set(actual).size !== keys.length ||
    keys.some(key => !actual.includes(key)) || report.rows.some(row => !row.ok) || suites.length !== testGroups ||
    new Set(suites.map(suite => suite.group)).size !== testGroups || suites.some(suite => !Number.isInteger(suite.group) || suite.group < 0 || suite.group >= testGroups || !suite.ok || suite.files < 1 || suite.assertions < 1)) {
    throw new Error('J167: complete green nightly for this exact commit and pins required; tag held');
  }
}

export function requireLatest(report: Verdict, expected: Plan, latest: unknown): void {
  requireGreen(report, expected);
  if (report.run === undefined || report.run === null || typeof latest !== 'object' || latest === null ||
    !('id' in latest) || String(latest.id) !== report.run || !('head_sha' in latest) || latest.head_sha !== expected.sha ||
    !('status' in latest) || latest.status !== 'completed' || !('conclusion' in latest) || latest.conclusion !== 'success') {
    throw new Error('J167: latest completed nightly must be this exact green hosted run; tag held');
  }
}

export function requirePublishedGreen(report: Verdict, expected: Plan): void {
  // Refuse local/red evidence before asking gh for public Actions history.
  requireGreen(report, expected);
  if (report.run === undefined || report.run === null || !/^\d+$/u.test(report.run)) throw new Error('J167: a green hosted nightly run ID is required; tag held');
  const latest: unknown = JSON.parse(execFileSync('gh', ['api',
    'repos/project-wildshard/engine/actions/workflows/nightly.yml/runs?branch=main&event=schedule&status=completed&per_page=1',
    '--jq', '.workflow_runs[0]'], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024}));
  requireLatest(report, expected, latest);
}

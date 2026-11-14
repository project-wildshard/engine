// Ring 2 receipts fail closed: a green process is insufficient without every witness.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

export interface Head {slug: string; hash: string}
export interface Plan {version: number; sha: string; pins: string; testList: string; heads: Head[]; tests: string[]}
export interface Phase {name: string; ok: boolean; error?: string; ms?: number; detail?: unknown}
export interface HeadResult extends Head {phases: Phase[]}
export interface HeadsReport extends Plan {kind: 'heads'; browser: string; group: number; results: HeadResult[]}
export interface TestFile {path: string; ok: boolean; assertions: number; skipped: number}
export interface TestsReport extends Plan {kind: 'tests'; exitCode: number; kitExitCode: number; totalTests: number; files: TestFile[]}
export type Receipt = HeadsReport | TestsReport;
export interface Failure {key: string; error: string}
export interface Row extends Head {browser: string; phase: string; ok: boolean; error?: string}
export interface Verdict {version: number; sha: string; pins: string; testList: string; ok: boolean; tag: string; rows: Row[]; failures: Failure[];
  run?: string | null; baseline: {sha: string; run: string | null} | null; newFailures: string[]; resolved: string[]}
export const browsers = ['chromium', 'webkit'];
export const phases = ['cook', 'boot', 'hover', 'draw', 'explorer'];
export const groups = 4;
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
  return {version: 1, sha: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    pins: digest(shards), testList: digest(tests), heads, tests};
}

export function partition(heads: Head[], group: number): Head[] {
  if (!Number.isInteger(group) || group < 0 || group >= groups) throw new Error('Invalid nightly partition');
  return heads.filter((_, index) => index % groups === group);
}

export function requireBuild(build: string, expected: Plan): void {
  const sha = /^([a-f0-9]{7,40})-[a-z0-9]+$/u.exec(build)?.[1];
  if (sha === undefined || !expected.sha.startsWith(sha)) throw new Error('Nightly build is stale: rebuild this exact checkout before proving');
}

export function verdict(expected: Plan, reports: Receipt[], previous?: Verdict, jobs: Record<string, string | undefined> = {}): Verdict {
  const failures: Failure[] = [], rows: Row[] = [];
  for (const [job, result] of Object.entries(jobs)) if (result !== undefined && result !== 'success') failures.push({key: `runner/${job}`, error: `Actions job ${result}; a red nightly holds the tag even with complete phase receipts`});
  for (const browser of browsers) for (const head of expected.heads) {
    const matches = reports.filter((report): report is HeadsReport => report.version === expected.version && report.kind === 'heads' && report.browser === browser &&
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
  const suites = reports.filter((row): row is TestsReport => row.version === expected.version && row.kind === 'tests' && row.sha === expected.sha && row.pins === expected.pins && row.testList === expected.testList);
  const [suite] = suites;
  if (suites.length !== 1 || suite === undefined) failures.push({key: 'shared/tests', error: `Expected one suite, got ${suites.length}`});
  else {
    if (suite.exitCode !== 0 || suite.kitExitCode !== 0 || suite.totalTests < 1) failures.push({key: 'shared/tests', error: `Vitest exit ${suite.exitCode}, kit exit ${suite.kitExitCode}, ${suite.totalTests} tests`});
    for (const path of expected.tests) {
      const executions = suite.files.filter(row => row.path === path);
      const [run] = executions;
      if (executions.length !== 1 || run === undefined || !run.ok || run.assertions < 1 || run.skipped !== 0) failures.push({key: `shared/${path}`, error: 'Listed test missing, skipped or failed'});
    }
    for (const file of suite.files.filter(row => !row.ok)) {
      if (!failures.some(row => row.key === `shared/${file.path}`)) failures.push({key: `shared/${file.path}`, error: 'Suite failure outside the slow-test list'});
    }
  }
  const baseline = previous?.version === 1 && Array.isArray(previous.failures) ? previous : undefined;
  const old = new Set(baseline?.failures.map(row => row.key)), current = new Set(failures.map(row => row.key));
  return {version: 1, sha: expected.sha, pins: expected.pins, testList: expected.testList,
    ok: failures.length === 0, tag: failures.length === 0 ? 'eligible' : 'HOLD', rows, failures,
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
  lines.push('', '## Failures', '');
  if (report.failures.length === 0) lines.push('None.');
  for (const failure of report.failures) lines.push(`- ${report.newFailures.includes(failure.key) ? 'NEW' : 'existing'} \`${failure.key}\`: ${failure.error.replaceAll(/[\r\n|<>]/gu, ' ').slice(0, 1500)}`);
  if (report.resolved.length > 0) lines.push('', 'Resolved:', ...report.resolved.map(key => `- \`${key}\``));
  return `${lines.join('\n')}\n`;
}

export function requireGreen(report: Verdict, expected: Plan): void {
  const keys = expected.heads.flatMap(head => browsers.flatMap(browser => phases.map(phase => `${browser}/${head.slug}@${head.hash}/${phase}`)));
  const actual = report.rows?.map(row => `${row.browser}/${row.slug}@${row.hash}/${row.phase}`) ?? [];
  if (report.version !== expected.version || !report.ok || report.tag !== 'eligible' || report.sha !== expected.sha || report.pins !== expected.pins || report.testList !== expected.testList ||
    !Array.isArray(report.failures) || report.failures.length > 0 || actual.length !== keys.length || new Set(actual).size !== keys.length ||
    keys.some(key => !actual.includes(key)) || report.rows.some(row => !row.ok)) {
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
    'repos/project-wildshard/engine/actions/workflows/nightly.yml/runs?branch=main&status=completed&per_page=1',
    '--jq', '.workflow_runs[0]'], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024}));
  requireLatest(report, expected, latest);
}

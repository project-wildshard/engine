// Explicit nightly/standalone checks only: deliberately outside Vitest and hooks (J186).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {browsers, partition, phases, plan, read, requireGreen, type HeadsReport, type Plan, type TestsReport, type Verdict} from './nightly-model.ts';

interface Execution {status: number | null; report: Verdict; summary: string}
interface Fixture {root: string; heads: HeadsReport[]; suite: TestsReport; expected: Plan;
  execute: (baseline?: string) => Execution; write: (path: string, value: unknown) => void}

const cli = resolve('scripts/nightly.ts'), tagger = resolve('scripts/nightly-tag.mjs');
function fixture(run: (context: Fixture) => void): void {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/nightly-proof-'));
  const write = (path: string, value: unknown) => {mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), JSON.stringify(value));};
  try {
    execFileSync('git', ['init', '-q', '--initial-branch=main', root]);
    execFileSync('git', ['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture'], {cwd: root});
    write('test/pins/shardfiles.json', {shards: Array.from({length: 28}, (_, i) => ({slug: `head-${i}`, hash: String(i).padStart(64, '0')}))});
    write('test/pins/ring-2-tests.json', ['test/journey.test.ts']);
    const expected = plan(root);
    const heads: HeadsReport[] = browsers.flatMap(browser => Array.from({length: 4}, (_, group) => ({...expected, kind: 'heads' as const, browser, group,
      results: partition(expected.heads, group).map(head => ({slug: head.slug, hash: head.hash, phases: phases.map(name => ({name, ok: true}))}))})));
    const suite: TestsReport = {...expected, kind: 'tests', exitCode: 0, kitExitCode: 0, totalTests: 1, files: [{path: 'test/journey.test.ts', ok: true, assertions: 1}]};
    const execute = (baseline?: string): Execution => {
      for (const report of heads) write(`reports/heads-${report.browser}-${report.group}.json`, report);
      write('reports/tests.json', suite);
      const child = spawnSync(process.execPath, [cli, 'report', join(root, 'reports'), ...(baseline === undefined ? [] : [baseline])], {cwd: root, encoding: 'utf8'});
      return {status: child.status, report: read(join(root, 'reports/verdict.json')) as Verdict, summary: readFileSync(join(root, 'reports/summary.md'), 'utf8')};
    };
    run({root, heads, suite, expected, execute, write});
  } finally {rmSync(root, {recursive: true, force: true});}
}

await test('complete real report files admit the exact commit, but never another commit or repeated row', () => fixture(({expected, execute}) => {
  const result = execute(); assert.equal(result.status, 0); requireGreen(result.report, expected);
  assert.throws(() => requireGreen(result.report, {...expected, sha: 'wrong'}), /J167/u);
  result.report.rows[1] = result.report.rows[0]; assert.throws(() => requireGreen(result.report, expected), /J167/u);
}));
await test('one failed cook names its head; a later successful head remains visible', () => fixture(({heads, execute}) => {
  const broken = heads[0].results[0]; broken.phases = [{name: 'cook', ok: false, error: 'worker timed out'}];
  const result = execute(); assert.equal(result.status, 1);
  assert.match(result.summary, new RegExp(`chromium/${broken.slug}@.*cook`, 'u'));
  assert.equal(result.report.rows.find(row => row.slug === heads[0].results[1].slug && row.browser === 'chromium' && row.phase === 'boot')?.ok, true);
  assert.match(result.summary, /TAG HOLD/u);
}));
await test('missing head, duplicate receipt and receipt from another SHA each hold the tag', () => {
  const mutations: ((heads: HeadsReport[]) => void)[] = [heads => {heads[0].results.pop();}, heads => {heads[0].results.push(heads[0].results[0]);}, heads => {heads[0].sha = 'stale';}];
  for (const mutate of mutations) {
    fixture(({heads, execute}) => {mutate(heads); const result = execute(); assert.equal(result.status, 1); assert.equal(result.report.tag, 'HOLD');});
  }
});
await test('Vitest success cannot hide a missing, skipped, empty or failed listed journey', () => {
  const mutations: ((suite: TestsReport) => void)[] = [suite => {suite.files = [];}, suite => {suite.files[0].ok = false;}, suite => {suite.files[0].assertions = 0;}, suite => {suite.exitCode = 1;}];
  for (const mutate of mutations) {
    fixture(({suite, execute}) => {mutate(suite); assert.equal(execute().status, 1);});
  }
});
await test('an empty artifact directory never produces green', () => fixture(({root}) => {
  mkdirSync(join(root, 'empty'));
  const result = spawnSync(process.execPath, [cli, 'report', join(root, 'empty')], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 1); assert.equal((read(join(root, 'empty/verdict.json')) as Verdict).rows.filter(row => !row.ok).length, 280);
}));
await test('prior nightly failures are compared by head hash, browser and phase', () => fixture(({heads, execute, root, write}) => {
  heads[0].results[0].phases[0].ok = false;
  const first = execute(); write('previous.json', first.report);
  heads[0].results[0].phases[0].ok = true; heads[1].results[0].phases[1].ok = false;
  const next = execute(join(root, 'previous.json'));
  assert.equal(next.report.resolved.length, 1); assert.equal(next.report.newFailures.length, 1);
  assert.equal(next.report.baseline?.sha, first.report.sha);
}));
await test('optional tag helper refuses missing/red nightly before it can fetch or write a tag', () => fixture(({root, heads, execute}) => {
  const missing = spawnSync(process.execPath, [tagger], {cwd: root, encoding: 'utf8'});
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /J167/u);
  heads[0].results[0].phases[0].ok = false; execute();
  const red = spawnSync(process.execPath, [tagger, `--report=${join(root, 'reports/verdict.json')}`], {cwd: root, encoding: 'utf8'});
  assert.notEqual(red.status, 0); assert.match(red.stderr, /J167/u);
  assert.equal(execFileSync('git', ['tag'], {cwd: root, encoding: 'utf8'}), '');
}));
